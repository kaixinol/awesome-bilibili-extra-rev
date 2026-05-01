/**
 * Auto-classify tool links from issues using LLM
 * Extracts links, classifies, and directly modifies YAML files
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { parse, stringify } from 'yaml';
import { loadYamlArray, writeYamlArray } from '../data/yaml-manager.js';
import { callLLMAPI, parseLLMJSON } from '../utils/llm-utils.js';

import Ajv from 'ajv';

const execFile = promisify(execFileCb);

const RAW_DATA = 'RAW_DATA';

const ajv = new Ajv({ allErrors: true });

// Emoji regex pattern matching most common emoji unicode ranges
const EMOJI_REGEX = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{20E3}\u{231A}-\u{231B}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{25AA}-\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}]/gu;

/**
 * Strip emojis from a description string, preserving all other characters.
 * @param {string} text - Raw description
 * @returns {string} Cleaned description
 */
export const stripEmojis = (text) => {
  if (!text) return '';
  return text.replace(EMOJI_REGEX, '').replace(/\s+/g, ' ').trim();
};

const VALID_CATEGORIES = [
  '浏览器扩展/全站扩展', '浏览器扩展/主站扩展', '浏览器扩展/直播扩展',
  '篡改猴脚本/全站脚本', '篡改猴脚本/主站脚本', '篡改猴脚本/直播脚本',
  '下载工具', '直播相关工具', 'UP_工具', '开发', '第三方客户端',
  '每日任务', '监听与推送', '数据分析', '相关插件', '其他',
];

/**
 * Auto-fix common category name variations from LLM output.
 * @param {string} category - The category string from LLM
 * @returns {string} Fixed category or original if no match
 */
export const fixCategory = (category) => {
  if (VALID_CATEGORIES.includes(category)) return category;

  const fixes = [
    // 油猴 → 篡改猴 (common LLM variation)
    [/油猴脚本\/全站脚本/, '篡改猴脚本/全站脚本'],
    [/油猴脚本\/主站脚本/, '篡改猴脚本/主站脚本'],
    [/油猴脚本\/直播脚本/, '篡改猴脚本/直播脚本'],
    [/油猴脚本/, '篡改猴脚本/主站脚本'],

    // Tampermonkey → 篡改猴脚本
    [/tampermonkey/i, '篡改猴脚本/主站脚本'],

    // Missing sub-category (e.g., just "浏览器扩展" → default to 主站)
    [/^浏览器扩展$/, '浏览器扩展/主站扩展'],
    [/^篡改猴脚本$/, '篡改猴脚本/主站脚本'],
    [/^油猴脚本$/, '篡改猴脚本/主站脚本'],

    // Shortcuts / aliases
    [/^(下载|下载器|bili下载)/, '下载工具'],
    [/^(直播工具|直播)/, '直播相关工具'],
    [/^(UP|up主|UP主|创作)/, 'UP_工具'],
    [/^(API|SDK|开发工具|开发)/, '开发'],
    [/^(第三方|客户端|客户端)/, '第三方客户端'],
    [/^(每日任务|日常任务|日常)/, '每日任务'],
    [/^(监听|推送|监控)/, '监听与推送'],
    [/^(数据分析|统计)/, '数据分析'],
    [/^(相关插件|插件)/, '相关插件'],
  ];

  for (const [pattern, replacement] of fixes) {
    if (pattern.test(category)) return replacement;
  }

  return category; // Return original if no fix matched
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
        required: ['category'],
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

// Fetch metadata for a list of links using curl (supports proxy)
export const fetchMetadata = async (links) => {
  const results = [];

  const curlArgs = ['-sS', '--max-time', '10'];
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
  if (proxy) curlArgs.push('--proxy', proxy);
  const noProxy = process.env.NO_PROXY || process.env.no_proxy;
  if (noProxy) curlArgs.push('--noproxy', noProxy);
  const token = process.env.GITHUB_TOKEN;

  for (const url of links) {
    try {
      if (url.includes('github.com/')) {
        const repoPath = url.replace('https://github.com/', '');
        const args = [...curlArgs];
        if (token) args.push('-H', `Authorization: Bearer ${token}`);
        args.push(`https://api.github.com/repos/${repoPath}`);
        const { stdout } = await execFile('curl', args, { timeout: 12000 });
        const data = JSON.parse(stdout);
        results.push({
          url,
          name: data.name || '',
          description: data.description || '',
          language: data.language || '',
          topics: data.topics || [],
        });
        continue;
      }

      if (url.includes('greasyfork.org/')) {
        const match = url.match(/scripts\/(\d+)/);
        if (match) {
          const args = [...curlArgs, `https://api.greasyfork.org/scripts/${match[1]}.json`];
          const { stdout } = await execFile('curl', args, { timeout: 12000 });
          const data = JSON.parse(stdout);
          results.push({
            url,
            name: data.name || '',
            description: data.description || '',
            code_updated_at: data.code_updated_at || '',
          });
          continue;
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
- icon: 技术栈标签数组，可选值：python, nodejs, typescript, javascript, rust, go, java, docker, cli, shell, vue, kotlin, swift, flutter, csharp, cplusplus, php, dart

如果不是 Bilibili 相关，返回 related: false 即可。

只返回 JSON 数组，不要其他文字。

项目信息：
${itemsText}`;

  try {
    const content = await callLLMAPI(prompt);
    const result = parseLLMJSON(content);

    if (!Array.isArray(result)) throw new Error('LLM response is not an array');

    if (!validateClassify(result)) {
      // Try to auto-fix common issues before rejecting
      let didFix = false;
      for (const item of result) {
        if (!item.related) continue;

        // Auto-fix common category name variations
        if (item.category) {
          const fixedCategory = fixCategory(item.category);
          if (fixedCategory !== item.category) {
            console.warn(`  ⚠️  Auto-fixed category: "${item.category}" → "${fixedCategory}"`);
            item.category = fixedCategory;
            didFix = true;
          }
        }
      }

      if (didFix) {
        // Re-validate after fix
        if (validateClassify(result)) {
          console.log('  ✓ Validation passed after auto-fix');
        } else {
          const errors = validateClassify.errors
            .map((e) => `${e.instancePath || 'root'} ${e.message}`)
            .join('; ');
          throw new Error(`Invalid LLM response (after auto-fix): ${errors}`);
        }
      } else {
        const errors = validateClassify.errors
          .map((e) => `${e.instancePath || 'root'} ${e.message}`)
          .join('; ');
        throw new Error(`Invalid LLM response: ${errors}`);
      }
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

  // Merge LLM results back with original items
  // Use API name directly, strip emojis from API description
  const result = items.map((item, i) => {
    const llmResult = classification[i] || {};
    return {
      url: item.url,
      name: item.name || 'Unknown',
      description: stripEmojis(item.description || ''),
      icon: llmResult.icon || [],
      related: llmResult.related,
      category: llmResult.category,
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
