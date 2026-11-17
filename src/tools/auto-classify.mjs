/**
 * Auto-classify tool links from issues using LLM
 * Extracts links, classifies, and directly modifies YAML files
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { loadYamlArray, writeYamlArray } from '../data/yaml-manager.js';
import { VALID_ICONS, normalizeIcon } from '../utils/badge-utils.js';
import { callLLMJSON } from '../utils/llm-utils.js';

const execFile = promisify(execFileCb);

const RAW_DATA = 'RAW_DATA';

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
    [/^(第三方|客户端)/, '第三方客户端'],
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

// 未知标签直接丢弃，不让一个坏 icon 导致整单失败。
const fixIcons = (icons) => [...new Set((icons || []).map(normalizeIcon).filter(Boolean))];

const fixClassification = (result) => {
  if (!Array.isArray(result)) return false;

  let didFix = false;
  for (const item of result) {
    if (!item?.related) continue;

    if (item.category) {
      const fixedCategory = fixCategory(item.category);
      if (fixedCategory !== item.category) {
        console.warn(`  ⚠️  Auto-fixed category: "${item.category}" → "${fixedCategory}"`);
        item.category = fixedCategory;
        didFix = true;
      }
    }

    if (Array.isArray(item.icon)) {
      const fixed = fixIcons(item.icon);
      if (fixed.join() !== item.icon.join()) {
        item.icon = fixed;
        didFix = true;
      }
    }
  }
  return didFix;
};

const isGitHubUrl = (url) => Boolean(url?.includes('github.com/'));
const githubRepoPath = (url) => url.replace('https://github.com/', '').split('/').slice(0, 2).join('/');

// 表单勾选：作者本人提交时直接采信，其他人提交时只作为 LLM 的参考提示。
export const extractFormIcons = (body) => {
  const values = [];
  let section = '';
  for (const line of (body || '').split(/\r?\n/)) {
    const heading = line.match(/^###\s+(.+?)\s*$/);
    if (heading) {
      section = heading[1];
      continue;
    }
    if (section !== '主要语言' && section !== '其他标志') continue;

    const checked = line.match(/^\s*[-*]?\s*\[[xX]\]\s*(.*)$/);
    values.push(checked ? checked[1].trim() : line.trim());
  }
  return fixIcons(values);
};

const ownerFromUrl = (url) => isGitHubUrl(url) ? githubRepoPath(url).split('/')[0] : '';

// 只比 GitHub repo owner；GreasyFork 拿不到可核对的 GitHub login，一律按非作者处理。
export const isSubmitter = (item, issueAuthor) => {
  const owner = item.repoOwner || ownerFromUrl(item.url);
  return Boolean(owner && issueAuthor) && owner.toLowerCase() === issueAuthor.toLowerCase();
};

// 表单、API 证据、LLM 三路取并集；非作者的表单只出现在 prompt 里，不进这里。
export const resolveIcons = ({ formIcons = [], evidenceIcons = [], llmIcons = [], trusted = false }) =>
  fixIcons([
    ...(trusted ? formIcons : []),
    ...evidenceIcons,
    ...llmIcons,
  ]);

const classifyItemSchema = {
  type: 'object',
  properties: {
    related: { type: 'boolean' },
    category: {
      type: 'string',
      enum: VALID_CATEGORIES,
    },
    icon: {
      type: 'array',
      items: {
        type: 'string',
        enum: VALID_ICONS,
      },
    },
  },
  required: ['related'],
  additionalProperties: false,
  allOf: [
    {
      if: { properties: { related: { const: true } } },
      then: { required: ['category'] },
    },
  ],
};

const classifySchema = {
  type: 'array',
  items: classifyItemSchema,
  minItems: 1,
};

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

// 单个信号 API 失败不应拖垮整单分类。
const fetchJson = async (curlArgs, token, url) => {
  try {
    const args = [...curlArgs];
    if (token && url.includes('api.github.com')) args.push('-H', `Authorization: Bearer ${token}`);
    const { stdout } = await execFile('curl', [...args, url], { timeout: 12000 });
    const data = JSON.parse(stdout);
    return data?.message ? null : data;
  } catch {
    return null;
  }
};

const assetExt = (name) => name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
const RELEASE_ICONS = {
  exe: 'windows', msi: 'windows',
  apk: 'android',
  dmg: 'apple', pkg: 'apple',
  appimage: 'linux', deb: 'linux', rpm: 'linux',
};
const DOCKER_FILES = new Set(['dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']);
const IGNORED_ASSET_EXTS = new Set(['sha1', 'sig', 'md5', 'txt', 'json']);
const MAX_ASSETS = 20;
const MAX_FILES = 60;

// 从仓库 API 证据推导确定的 icon，并整理出给 LLM 看的信号文本。
export const detectSignals = ({ languages, releases, tree } = {}) => {
  const langEntries = languages && !Array.isArray(languages)
    ? Object.entries(languages).sort((a, b) => b[1] - a[1])
    : [];
  const total = langEntries.reduce((sum, [, bytes]) => sum + bytes, 0);
  const languageNames = langEntries.slice(0, 3).map(([name, bytes]) =>
    total ? `${name} ${Math.round((bytes / total) * 100)}%` : name);

  const releaseAssets = Array.isArray(releases)
    ? [...new Set(releases.flatMap((r) => (r.assets || []).map((a) => a.name)))].slice(0, MAX_ASSETS)
    : [];
  const paths = Array.isArray(tree?.tree) ? tree.tree.map((f) => f.path) : [];
  const repoFiles = [...new Set(paths.map((p) => p.split('/').pop()))].slice(0, MAX_FILES);

  const releaseIcons = releaseAssets.flatMap((name) => {
    const ext = assetExt(name);
    return ext && Object.hasOwn(RELEASE_ICONS, ext) ? [RELEASE_ICONS[ext]] : [];
  });
  const langIcon = langEntries[0]?.[0] || '';
  const dockerIcon = repoFiles.some((f) => DOCKER_FILES.has(f.toLowerCase())) ? 'docker' : null;

  return {
    languages: languageNames,
    releaseAssets,
    repoFiles,
    truncated: Boolean(tree?.truncated),
    evidenceIcons: fixIcons([langIcon, ...releaseIcons, dockerIcon]),
  };
};

// Fetch metadata for a list of links using curl (supports proxy)
export const fetchMetadata = async (links) => {
  const curlArgs = ['-sS', '--max-time', '10'];
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
  if (proxy) curlArgs.push('--proxy', proxy);
  const noProxy = process.env.NO_PROXY || process.env.no_proxy;
  if (noProxy) curlArgs.push('--noproxy', noProxy);
  const token = process.env.GITHUB_TOKEN;

  const fetchOne = async (url) => {
    try {
      if (isGitHubUrl(url)) {
        const repoPath = githubRepoPath(url);
        const base = `https://api.github.com/repos/${repoPath}`;
        const repo = await fetchJson(curlArgs, token, base);
        if (!repo) return { url };

        const branch = encodeURIComponent(repo.default_branch || 'HEAD');
        const [languages, releases, tree] = await Promise.all([
          fetchJson(curlArgs, token, `${base}/languages`),
          fetchJson(curlArgs, token, `${base}/releases?per_page=5`),
          fetchJson(curlArgs, token, `${base}/git/trees/${branch}?recursive=1`),
        ]);

        return {
          url,
          name: repo.name || '',
          description: repo.description || '',
          language: repo.language || '',
          topics: repo.topics || [],
          repoOwner: repo.owner?.login || '',
          signals: detectSignals({ languages, releases, tree }),
        };
      }

      if (url.includes('greasyfork.org/')) {
        const match = url.match(/scripts\/(\d+)/);
        if (match) {
          const data = await fetchJson(curlArgs, token, `https://api.greasyfork.org/scripts/${match[1]}.json`);
          if (data) {
            return {
              url,
              name: data.name || '',
              description: data.description || '',
              code_updated_at: data.code_updated_at || '',
            };
          }
        }
      }

      return { url };
    } catch {
      return { url };
    }
  };

  const results = [];
  for (let i = 0; i < links.length; i += 4) {
    results.push(...await Promise.all(links.slice(i, i + 4).map(fetchOne)));
  }
  return results;
};

export const renderItemText = (item) => {
  let text = `URL: ${item.url}`;
  if (item.name) text += `\nName: ${item.name}`;
  if (item.description) text += `\nDescription: ${item.description}`;
  if (item.language) text += `\nLanguage: ${item.language}`;
  if (item.topics?.length) text += `\nTopics: ${item.topics.join(', ')}`;
  if (item.code_updated_at) text += `\nLast Updated: ${item.code_updated_at}`;

  const signals = item.signals;
  if (signals?.languages.length) text += `\nLanguages (by bytes): ${signals.languages.join(', ')}`;
  if (signals?.releaseAssets.length) {
    const exts = [...new Set(signals.releaseAssets.map(assetExt))]
      .filter((ext) => ext && !IGNORED_ASSET_EXTS.has(ext));
    if (exts.length) text += `\nRelease asset types: ${exts.join(', ')}`;
  }
  if (signals?.repoFiles.length) {
    text += `\nRepo files${signals.truncated ? ' (truncated)' : ''}: ${signals.repoFiles.slice(0, 30).join(', ')}`;
  }

  if (item.confirmedIcons?.length) text += `\nConfirmed icons (from project author): ${item.confirmedIcons.join(', ')}`;
  if (item.formHints?.length) text += `\nReported icon hints (unverified): ${item.formHints.join(', ')}`;
  return text;
};

// Call LLM API for classification
export const classifyWithLLM = async (items) => {
  const itemsText = items.map(renderItemText).join('\n\n---\n\n');

  const prompt = `你是一个 Bilibili 项目分类助手。请分析以下项目信息，判断每个项目是否属于 Bilibili 相关工具/脚本/扩展。

如果是 Bilibili 相关，请返回：
- related: true
- category: 从以下类别中选择：${VALID_CATEGORIES.join(', ')}
- icon: 技术栈标签数组，可选值：${VALID_ICONS.join(', ')}

Confirmed icons 由项目作者本人填写，可直接采用；Reported icon hints 由推荐者填写、未经核实，只作参考，与项目信息矛盾时不要采用。
表单未列出的图标，只要项目确实符合，仍可补充。

判定 icon 时优先依据 Languages (by bytes) / Release asset types / Repo files 等实际证据：
- .exe/.msi → windows, .apk → android, .dmg/.pkg → apple, .AppImage/.deb/.rpm → linux
- Dockerfile / docker-compose.yml → docker
- 主要语言取 Languages 第一项对应的标签
不要仅凭仓库名或描述猜测平台；证据不足时不要硬加平台标签。

如果不是 Bilibili 相关，返回 related: false 即可。

只返回 JSON 数组，不要其他文字。

项目信息：
${itemsText}`;

  try {
    return await callLLMJSON(prompt, {
      name: 'classification',
      schema: classifySchema,
      fix: fixClassification,
    });
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
    if (isGitHubUrl(url)) return githubRepoPath(url);
    if (url.includes('greasyfork.org/')) {
      const match = url.match(/scripts\/(\d+)/);
      return match ? match[1] : url;
    }
    return url;
  };

  const extractFrom = (url) => isGitHubUrl(url) ? 'github' : 'greasyfork';

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
  const issueAuthor = process.env.ISSUE_AUTHOR || '';
  if (!issueBody) {
    console.error('Error: ISSUE_BODY not set');
    process.exit(1);
  }

  const links = extractLinks(issueBody);
  if (links.length === 0) {
    console.log('No links found in issue body.');
    return;
  }

  const formIcons = extractFormIcons(issueBody);
  if (formIcons.length > 0) {
    console.log(`Form icons: ${formIcons.join(', ')}`);
  }
  console.log(`Issue author: ${issueAuthor || '(unknown)'}`);

  console.log(`Found ${links.length} link(s):`);
  links.forEach((l) => console.log(`  - ${l}`));
  console.log('');

  console.log('Fetching metadata...');
  const items = (await fetchMetadata(links)).map((item) => {
    const authorOwnRepo = isSubmitter(item, issueAuthor);
    return {
      ...item,
      isSubmitter: authorOwnRepo,
      confirmedIcons: authorOwnRepo ? formIcons : [],
      formHints: authorOwnRepo ? [] : formIcons,
    };
  });
  items.forEach((item) => {
    const trust = item.isSubmitter ? 'author' : 'reporter';
    if (item.name) {
      console.log(`  ✅ ${item.name} [${trust}]: ${item.description || '(no description)'}`);
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
      icon: resolveIcons({
        formIcons,
        evidenceIcons: item.signals?.evidenceIcons,
        llmIcons: llmResult.icon,
        trusted: item.isSubmitter,
      }),
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
