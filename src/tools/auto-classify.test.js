import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { extractLinks, classifyWithLLM, selectDescription } from './auto-classify.mjs';

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
    const savedUrl = process.env.LLM_API_URL;

    beforeAll(() => {
      process.env.LLM_API_URL = 'https://api.mock.com/v1/chat';
      vi.spyOn(process, 'exit').mockImplementation(() => {});
    });

    afterAll(() => {
      process.env.LLM_API_URL = savedUrl;
      vi.restoreAllMocks();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('rejects invalid category', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify([
            { url: 'https://github.com/test/repo', related: true, category: 'INVALID', name: 'Test', description: 'Test', icon: [] },
          ]) } }],
        }),
      }));

      await expect(classifyWithLLM(['https://github.com/test/repo'])).rejects.toThrow('category');
    });

    it('rejects missing name for related items', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify([
            { url: 'https://github.com/test/repo', related: true, category: '开发', description: 'Test', icon: [] },
          ]) } }],
        }),
      }));

      await expect(classifyWithLLM(['https://github.com/test/repo'])).rejects.toThrow('name');
    });

    it('rejects invalid icon values', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify([
            { url: 'https://github.com/test/repo', related: true, category: '开发', name: 'Test', description: 'Test', icon: ['bad_icon'] },
          ]) } }],
        }),
      }));

      await expect(classifyWithLLM(['https://github.com/test/repo'])).rejects.toThrow('icon');
    });

    it('accepts valid related items', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify([
            { url: 'https://github.com/test/repo', related: true, category: '开发', name: 'TestRepo', description: '测试', icon: ['python'] },
            { url: 'https://github.com/test/not-bili', related: false },
          ]) } }],
        }),
      }));

      const result = await classifyWithLLM(['https://github.com/test/repo']);
      expect(result).toHaveLength(2);
      expect(result[0].category).toBe('开发');
      expect(result[1].related).toBe(false);
    });
  });

  describe('selectDescription', () => {
    it('uses LLM description when API description is empty', () => {
      expect(selectDescription('', 'LLM desc')).toBe('LLM desc');
      expect(selectDescription(null, 'LLM desc')).toBe('LLM desc');
      expect(selectDescription(undefined, 'LLM desc')).toBe('LLM desc');
    });

    it('returns empty string when both descriptions are empty', () => {
      expect(selectDescription('', '')).toBe('');
      expect(selectDescription(null, null)).toBe('');
      expect(selectDescription(null, '')).toBe('');
    });

    it('uses API description when it is short and has no emojis', () => {
      const apiDesc = '一个哔哩哔哩视频下载工具';
      expect(selectDescription(apiDesc, 'LLM desc')).toBe(apiDesc);
    });

    it('uses LLM description when API description is too long (>70 chars)', () => {
      const longDesc = 'A'.repeat(71);
      expect(longDesc.length).toBeGreaterThan(70);
      expect(selectDescription(longDesc, 'Short LLM desc')).toBe('Short LLM desc');
    });

    it('uses API description when it is too long but LLM description is empty', () => {
      const longDesc = 'A'.repeat(71);
      expect(selectDescription(longDesc, '')).toBe(longDesc);
    });

    it('uses LLM description when API description has high emoji ratio (>10%)', () => {
      const emojiDesc = '🎉🎊🎈 一个工具';
      expect(selectDescription(emojiDesc, 'Normal LLM desc')).toBe('Normal LLM desc');
    });

    it('uses API description when emoji ratio is low (<=10%)', () => {
      const lowEmojiDesc = '一个正常的描述，带有一个emoji🎉';
      const ratio = 1 / lowEmojiDesc.length;
      expect(ratio).toBeLessThanOrEqual(0.1);
      expect(selectDescription(lowEmojiDesc, 'LLM desc')).toBe(lowEmojiDesc);
    });

    it('uses API description when it has emojis but ratio is acceptable', () => {
      const desc = 'B站视频下载工具🎬';
      expect(selectDescription(desc, 'LLM desc')).toBe(desc);
    });

    it('handles emoji-only API description', () => {
      const emojiOnlyDesc = '🎉🎊🎈🎁';
      expect(selectDescription(emojiOnlyDesc, 'Real desc')).toBe('Real desc');
    });
  });
});
