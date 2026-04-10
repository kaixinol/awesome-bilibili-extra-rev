/**
 * Auto-classify tool links from issues using LLM
 * Extracts links, classifies, and directly modifies YAML files
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { loadYamlArray, writeYamlArray } from '../data/yaml-manager.js';

import Ajv from 'ajv';

const RAW_DATA = 'RAW_DATA';

const ajv = new Ajv({ allErrors: true });

// Emoji regex pattern matching most common emoji unicode ranges
const EMOJI_REGEX = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{20E3}\u{231A}-\u{231B}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{25AA}-\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}]/gu;

/**
 * Select the best description based on API and LLM results.
 * Prefers API description unless it has too many emojis (>10%) or is too long (>70 chars).
 * @param {string|null} apiDesc - Description from API
 * @param {string|null} llmDesc - Description from LLM
 * @returns {string} Selected description
 */
export const selectDescription = (apiDesc, llmDesc) => {
  if (!apiDesc || apiDesc.trim().length === 0) {
    return llmDesc || '';
  }

  const emojiMatches = apiDesc.match(EMOJI_REGEX);
  const emojiCount = emojiMatches ? emojiMatches.length : 0;
  const emojiRatio = emojiCount / apiDesc.length;

  if (emojiRatio > 0.1) {
    return llmDesc || apiDesc;
  }

  if (apiDesc.length > 70) {
    return llmDesc || apiDesc;
  }

  return apiDesc;
};

const classifyItemSchema = {
  type: 'object',
  properties: {
    related: { type: 'boolean' },
  },
  required: ['related'],
  allOf: [
    {
      if: { properties: { related: { const: true } } },
      then: {
        properties: {
          category: {
            type: 'string',
            enum: [
              '浏览器扩展/全站扩展', '浏览器扩展/主站扩展', '浏览器扩展/直播扩展',
              '篡改猴脚本/全站脚本', '篡改猴脚本/主站脚本', '篡改猴脚本/直播脚本',
              '下载工具', '直播相关工具', 'UP_工具', '开发', '第三方客户端',
              '每日任务', '监听与推送', '数据分析', '相关插件', '其他',
            ],
          },
          name: { type: 'string', minLength: 1 },
          description: { type: 'string', minLength: 1 },
          icon: {
            type: 'array',
            items: {
              type: 'string',
              enum: [
                'python', 'nodejs', 'typescript', 'javascript', 'rust', 'go', 'java',
                'docker', 'cli', 'shell', 'vue', 'kotlin', 'swift', 'flutter',
                'csharp', 'cplusplus', 'php', 'dart',
              ],
            },
          },
        },
        required: ['category', 'name', 'description'],
      },
    },
  ],
};

const classifySchema = {
  type: 'array',
  items: classifyItemSchema,
  minItems: 1,
};

const validateClassify = ajv.compile(classifySchema);

// Extract GitHub and GreasyFork links from text
export const extractLinks = (text) => {
  const patterns = [
    /https:\/\/github\.com\/[\w.-]+\/[\w.-]+/g,
    /https:\/\/greasyfork\.org\/[\w.-]+\/scripts\/\d+[\w.-]*/g,
  ];

  const links = new Set();
  for (const pattern of patterns) {
    const matches = text.match(pattern) || [];
    matches.forEach((m) => links.add(m));
  }

  return [...links];
};

// Fetch metadata for a list of links
export const fetchMetadata = async (links) => {
  const results = [];

  for (const url of links) {
    try {
      if (url.includes('github.com/')) {
        const repoPath = url.replace('https://github.com/', '');
        const res = await fetch(`https://api.github.com/repos/${repoPath}`, {
          headers: process.env.GITHUB_TOKEN
            ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
            : {},
        });
        if (res.ok) {
          const data = await res.json();
          results.push({
            url,
            name: data.name || '',
            description: data.description || '',
            language: data.language || '',
            topics: data.topics || [],
          });
          continue;
        }
      }

      if (url.includes('greasyfork.org/')) {
        const match = url.match(/scripts\/(\d+)/);
        if (match) {
          const res = await fetch(`https://api.greasyfork.org/scripts/${match[1]}.json`);
          if (res.ok) {
            const data = await res.json();
            results.push({
              url,
              name: data.name || '',
              description: data.description || '',
              code_updated_at: data.code_updated_at || '',
            });
            continue;
          }
        }
      }

      // Fallback: just URL
      results.push({ url });
    } catch {
      results.push({ url });
    }
  }

  return results;
};

// Call LLM API for classification
export const classifyWithLLM = async (items) => {
  const LLM_API_URL = process.env.LLM_API_URL;
  const LLM_API_KEY = process.env.LLM_API_KEY;
  const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

  if (!LLM_API_URL) {
    console.error('Error: LLM_API_URL not set');
    process.exit(1);
  }

  const itemsText = items.map((item) => {
    let text = `URL: ${item.url}`;
    if (item.name) text += `\nName: ${item.name}`;
    if (item.description) text += `\nDescription: ${item.description}`;
    if (item.language) text += `\nLanguage: ${item.language}`;
    if (item.topics?.length) text += `\nTopics: ${item.topics.join(', ')}`;
    if (item.code_updated_at) text += `\nLast Updated: ${item.code_updated_at}`;
    return text;
  }).join('\n\n---\n\n');

  const prompt = `你是一个 Bilibili 项目分类助手。请分析以下项目信息，判断每个项目是否属于 Bilibili 相关工具/脚本/扩展。

如果是 Bilibili 相关，请返回：
- related: true
- category: 从以下类别中选择
  浏览器扩展/全站扩展, 浏览器扩展/主站扩展, 浏览器扩展/直播扩展
  篡改猴脚本/全站脚本, 篡改猴脚本/主站脚本, 篡改猴脚本/直播脚本
  下载工具, 直播相关工具, UP_工具, 开发, 第三方客户端
  每日任务, 监听与推送, 数据分析, 相关插件, 其他
- name: 项目名称
- description: 简要描述（中文）
- icon: 技术栈标签数组，可选值：python, nodejs, typescript, javascript, rust, go, java, docker, cli, shell, vue, kotlin, swift, flutter, csharp, cplusplus, php, dart

如果不是 Bilibili 相关，返回 related: false 即可。

只返回 JSON 数组，不要其他文字。

项目信息：
${itemsText}`;

  const headers = { 'Content-Type': 'application/json' };
  if (LLM_API_KEY) headers['Authorization'] = `Bearer ${LLM_API_KEY}`;

  const body = JSON.stringify({
    model: LLM_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    extra_body: { enable_thinking: false },
  });

  try {
    const res = await fetch(LLM_API_URL, { method: 'POST', headers, body });
    if (!res.ok) throw new Error(`LLM API error: ${res.status}`);

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('LLM returned empty content');

    // Extract JSON (handle markdown code blocks)
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/```[\s\S]*?```/);
    const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0].replace(/```/g, '') : content;
    const result = JSON.parse(jsonStr.trim());

    if (!Array.isArray(result)) throw new Error('LLM response is not an array');

    if (!validateClassify(result)) {
      const errors = validateClassify.errors
        .map((e) => `${e.instancePath || 'root'} ${e.message}`)
        .join('; ');
      throw new Error(`Invalid LLM response: ${errors}`);
    }

    return result;
  } catch (error) {
    console.error('LLM classification failed:', error.message);
    throw error;
  }
};

// Apply classification results to YAML files
export const applyToYaml = (results) => {
  const relatedItems = results.filter((i) => i.related);
  if (relatedItems.length === 0) {
    console.log('No Bilibili-related items to add.');
    return 0;
  }

  const getCategoryPath = (category) => {
    const fullPath = path.join(process.cwd(), RAW_DATA, category + '.yml');
    if (fs.existsSync(fullPath)) return fullPath;
    console.warn('  ⚠️  Category path not found:', category);
    return null;
  };

  const extractLink = (url) => {
    if (url.includes('github.com/')) return url.replace('https://github.com/', '');
    if (url.includes('greasyfork.org/')) {
      const match = url.match(/scripts\/(\d+)/);
      return match ? match[1] : url;
    }
    return url;
  };

  const extractFrom = (url) =>
    url.includes('github.com/') ? 'github' : 'greasyfork';

  // Group by category
  const byCategory = {};
  for (const item of relatedItems) {
    if (!byCategory[item.category]) byCategory[item.category] = [];
    byCategory[item.category].push(item);
  }

  let addedCount = 0;

  for (const [category, items] of Object.entries(byCategory)) {
    const yamlPath = getCategoryPath(category);
    if (!yamlPath) continue;

    let currentItems = [];
    try { currentItems = loadYamlArray(yamlPath); } catch {}

    for (const item of items) {
      const link = extractLink(item.url);
      const from = extractFrom(item.url);

      if (currentItems.some((e) => e.link === link)) {
        console.log('  ⏭️  Skip duplicate:', item.name || item.url);
        continue;
      }

      currentItems.push({
        name: item.name || 'Unknown',
        link,
        from,
        description: item.description || '',
        icon: item.icon || [],
      });
      addedCount++;
      console.log('  ✅ Added:', item.name || item.url, '→', category);
    }

    writeYamlArray(yamlPath, currentItems);
  }

  return addedCount;
};

// Main
const main = async () => {
  const issueBody = process.env.ISSUE_BODY;
  if (!issueBody) {
    console.error('Error: ISSUE_BODY not set');
    process.exit(1);
  }

  const links = extractLinks(issueBody);
  if (links.length === 0) {
    console.log('No links found in issue body.');
    return;
  }

  console.log(`Found ${links.length} link(s):`);
  links.forEach((l) => console.log(`  - ${l}`));
  console.log('');

  console.log('Fetching metadata...');
  const items = await fetchMetadata(links);
  items.forEach((item) => {
    if (item.name) {
      console.log(`  ✅ ${item.name}: ${item.description || '(no description)'}`);
    } else {
      console.log(`  ⚠️  Could not fetch metadata for ${item.url}`);
    }
  });
  console.log('');

  console.log('Classifying with LLM...');
  const classification = await classifyWithLLM(items);

  // Merge LLM results back with original items (to preserve url)
  // Also select the best description based on API and LLM results
  const result = items.map((item, i) => {
    const llmResult = classification[i] || {};
    const apiDesc = item.description || '';
    const llmDesc = llmResult.description || '';
    const selectedDesc = selectDescription(apiDesc, llmDesc);

    return {
      ...item,
      ...llmResult,
      description: selectedDesc,
    };
  });

  console.log('\nApplying to YAML...');
  const added = applyToYaml(result);

  console.log(`\nTotal added: ${added}/${result.length}`);
};

// Run if executed directly (not imported by vitest)
const isMain = process.argv[1] && process.argv[1].includes('auto-classify.mjs');
if (isMain) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
