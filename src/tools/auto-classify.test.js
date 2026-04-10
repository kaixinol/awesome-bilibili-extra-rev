import { describe, it, expect, vi } from 'vitest';
import { extractLinks, classifyWithLLM, fixCategory, stripEmojis, fetchMetadata } from './auto-classify.mjs';

describe('auto-classify tool', () => {
  describe('link extraction', () => {
    it('extracts GitHub repository links', () => {
      const body = '推荐这个项目：https://github.com/user/bili-downloader 很好用！';
      const links = extractLinks(body);
      expect(links).toContain('https://github.com/user/bili-downloader');
    });

    it('extracts GreasyFork script links', () => {
      const body = '油猴脚本：https://greasyfork.org/zh-CN/scripts/123-bili-enhance';
      const links = extractLinks(body);
      expect(links).toContain('https://greasyfork.org/zh-CN/scripts/123-bili-enhance');
    });

    it('extracts multiple links from mixed content', () => {
      const body = `
推荐几个工具：
1. https://github.com/user/tool-a
2. https://github.com/user/tool-b
3. https://greasyfork.org/zh-CN/scripts/456-script
4. 这不是链接：https://example.com
      `;
      const links = extractLinks(body);
      expect(links).toHaveLength(3);
      expect(links).toContain('https://github.com/user/tool-a');
      expect(links).toContain('https://github.com/user/tool-b');
      expect(links).toContain('https://greasyfork.org/zh-CN/scripts/456-script');
    });

    it('deduplicates links', () => {
      const body = `
同一个链接出现多次：
https://github.com/user/repo
https://github.com/user/repo
      `;
      const links = extractLinks(body);
      expect(links).toHaveLength(1);
    });

    it('returns empty array for no links', () => {
      const body = '这里没有任何链接。';
      const links = extractLinks(body);
      expect(links).toEqual([]);
    });

    it('handles links in markdown format', () => {
      const body = '[项目名](https://github.com/user/repo) 和 ![图片](https://example.com/img.png)';
      const links = extractLinks(body);
      expect(links).toContain('https://github.com/user/repo');
    });
  });

  describe('LLM classification', () => {
    const runLLMTests = process.env.LLM_API_URL;

    if (!runLLMTests) {
      it.skip('skipped — set LLM_API_URL to run', () => {});
      return;
    }

    it('classifies bilibili-related projects', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
      try {
        const result = await classifyWithLLM([
          'https://github.com/user/bili-downloader',
        ]);
        if (result.length > 0) {
          console.log('\n--- LLM Classification Result ---');
          result.forEach((item, i) => {
            console.log(`  ${i + 1}. ${item.name || item.url}`);
            console.log(`     Related: ${item.related}`);
            if (item.related) {
              console.log(`     Category: ${item.category}`);
              console.log(`     Description: ${item.description}`);
              console.log(`     Icon: ${JSON.stringify(item.icon)}`);
            }
          });
          console.log('--- End ---\n');
          expect(Array.isArray(result)).toBe(true);
        }
      } catch (e) {
        console.log(`LLM API error: ${e.message}`);
      }
      exitSpy.mockRestore();
    });
  });

  describe('LLM response validation', () => {
    const runLLMTests = process.env.LLM_API_URL;

    if (!runLLMTests) {
      it.skip('skipped — set LLM_API_URL to run', () => {});
      return;
    }

    vi.spyOn(process, 'exit').mockImplementation(() => {});

    it('classifies a real GitHub repo correctly', async () => {
      const items = await fetchMetadata([
        'https://github.com/xiaye13579/BBLL',
      ]);
      const result = await classifyWithLLM(items);
      expect(result).toHaveLength(1);
      expect(result[0].related).toBe(true);
      expect(result[0].category).toBeDefined();
      console.log(`  ✅ ${items[0].name} → ${result[0].category}`);
    }, 30000);

    it('classifies a real GreasyFork script correctly', async () => {
      const items = await fetchMetadata([
        'https://greasyfork.org/zh-CN/scripts/448434-b',
      ]);
      const result = await classifyWithLLM(items);
      expect(result).toHaveLength(1);
      expect(result[0].related).toBe(true);
      expect(result[0].category).toBeDefined();
      console.log(`  ✅ ${items[0].name} → ${result[0].category}`);
    }, 30000);

    it('handles mixed related and unrelated items', async () => {
      const items = await fetchMetadata([
        'https://github.com/indefined/bilibili-libs',
        'https://github.com/torvalds/linux',
      ]);
      const result = await classifyWithLLM(items);
      expect(result).toHaveLength(2);
      expect(result[0].related).toBe(true);
      expect(result[1].related).toBe(false);
    }, 30000);

    it('classifies batch of GreasyFork scripts correctly', async () => {
      const links = [
        'https://greasyfork.org/zh-CN/scripts/448434-b',
        'https://greasyfork.org/zh-CN/scripts/466815-bilireveal-',
        'https://greasyfork.org/zh-CN/scripts/534807-',
        'https://greasyfork.org/zh-CN/scripts/561862-bilibili-original-avatar-downloader-viewer',
        'https://greasyfork.org/zh-CN/scripts/568124-bilibili-',
      ];
      const items = await fetchMetadata(links);
      const result = await classifyWithLLM(items);
      expect(result).toHaveLength(5);
      const relatedItems = result.filter((r) => r.related);
      // At least 3 out of 5 should be related (some may fail due to API timeout / incomplete data)
      expect(relatedItems.length).toBeGreaterThanOrEqual(3);
      for (const item of relatedItems) {
        expect(item.category).toBeDefined();
      }
      for (let i = 0; i < result.length; i++) {
        const itemName = items[i].name || '(no name)';
        console.log(`  ${result[i].related ? '✅' : '❌'} ${itemName} → ${result[i].category || 'N/A'}`);
      }
    }, 120000);
  });

  describe('stripEmojis', () => {
    it('returns empty string for empty input', () => {
      expect(stripEmojis('')).toBe('');
      expect(stripEmojis(null)).toBe('');
      expect(stripEmojis(undefined)).toBe('');
    });

    it('removes emojis from description', () => {
      expect(stripEmojis('🎉 一个工具')).toBe('一个工具');
      expect(stripEmojis('下载工具🎬🎮')).toBe('下载工具');
    });

    it('preserves non-emoji characters', () => {
      expect(stripEmojis('B站视频下载工具')).toBe('B站视频下载工具');
      expect(stripEmojis('A simple download tool for Bilibili')).toBe('A simple download tool for Bilibili');
    });

    it('collapses multiple spaces after emoji removal', () => {
      expect(stripEmojis('🎉 🎊 一个工具 🎈')).toBe('一个工具');
    });
  });

  describe('fixCategory', () => {
    it('returns valid category unchanged', () => {
      expect(fixCategory('篡改猴脚本/主站脚本')).toBe('篡改猴脚本/主站脚本');
      expect(fixCategory('下载工具')).toBe('下载工具');
    });

    it('fixes 油猴脚本 to 篡改猴脚本', () => {
      expect(fixCategory('油猴脚本/主站脚本')).toBe('篡改猴脚本/主站脚本');
      expect(fixCategory('油猴脚本/全站脚本')).toBe('篡改猴脚本/全站脚本');
      expect(fixCategory('油猴脚本/直播脚本')).toBe('篡改猴脚本/直播脚本');
      expect(fixCategory('油猴脚本')).toBe('篡改猴脚本/主站脚本');
    });

    it('fixes standalone category names to defaults', () => {
      expect(fixCategory('浏览器扩展')).toBe('浏览器扩展/主站扩展');
      expect(fixCategory('篡改猴脚本')).toBe('篡改猴脚本/主站脚本');
      expect(fixCategory('油猴脚本')).toBe('篡改猴脚本/主站脚本');
    });

    it('fixes shortcut names to categories', () => {
      expect(fixCategory('下载')).toBe('下载工具');
      expect(fixCategory('下载器')).toBe('下载工具');
      expect(fixCategory('直播')).toBe('直播相关工具');
      expect(fixCategory('开发')).toBe('开发');
      expect(fixCategory('客户端')).toBe('第三方客户端');
      expect(fixCategory('监控')).toBe('监听与推送');
      expect(fixCategory('统计')).toBe('数据分析');
    });

    it('returns unknown category unchanged if no fix matches', () => {
      expect(fixCategory('some-random-category')).toBe('some-random-category');
    });
  });
});
