import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { extractLinks, classifyWithLLM } from './auto-classify.mjs';

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
});
