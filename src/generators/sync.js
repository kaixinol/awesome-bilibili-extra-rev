/**
 * Sync - 核心维护命令
 * 读 YAML → 检查链接 → 修正改名 + 删除死链 → 生成 README + user.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadAllItems, loadYamlArray, writeYamlArray } from '../data/yaml-manager.js';
import { normalizeLink } from '../validators/item-validator.js';
import { checkItems, checkRepoStatus } from '../checkers/link-checker.js';
import { readText, writeText, findYamlFiles } from '../utils/file-utils.js';
import { processDescription } from '../validators/item-validator.js';
import { addIcon } from '../utils/badge-utils.js';

const README_TEMPLATE = 'README_RAW.md';
const README_OUTPUT = 'README.md';

// ==================== 变更检测 ====================

const extractGfId = (link) => {
  if (!link) return null;
  const match = String(link).match(/^(\d+)/);
  return match ? match[1] : null;
};

const detectChanges = (checkedItems) => {
  const changes = { renamed: [], deadRemoved: [], networkError: [] };

  for (const item of checkedItems) {
    let isRenamed = false;

    if (item.finalUrl && item.finalUrl !== item.__normalizedLink && item.finalUrl !== item.__normalizedLink + '/') {
      const url = new URL(item.finalUrl);
      let newLink = '';
      if (item.from === 'github') {
        newLink = url.pathname.replace(/^\//, '');
      } else if (item.from === 'greasyfork') {
        newLink = url.pathname.split('/').pop() || '';
      }

      if (item.from === 'greasyfork') {
        const oldId = extractGfId(item.link);
        const newId = extractGfId(newLink);
        if (oldId && newId && oldId === newId) {
          isRenamed = false;
        } else if (newLink && newLink !== item.link) {
          isRenamed = true;
        }
      } else if (newLink && newLink !== item.link) {
        isRenamed = true;
      }

      if (isRenamed) {
        changes.renamed.push({ item, oldLink: item.link, newLink, name: item.name });
      }
    }

    const status = item.status;
    if (status === 404 || status === 410 || status === 403 || status === 451) {
      changes.deadRemoved.push(item);
    } else if (!item.ok) {
      changes.networkError.push(item);
    }
  }

  return changes;
};

// ==================== 更新 YAML ====================

const updateYamlFiles = (changes) => {
  const filesToProcess = new Map();

  for (const item of [...changes.renamed, ...changes.deadRemoved]) {
    if (!item.__absPath) continue;
    if (!filesToProcess.has(item.__absPath)) filesToProcess.set(item.__absPath, []);
    filesToProcess.get(item.__absPath).push(item);
  }

  for (const [filePath, items] of filesToProcess.entries()) {
    const yamlContent = loadYamlArray(filePath);
    const deadLinks = new Set(items.filter((i) => i.status && [404, 410, 403, 451].includes(i.status)).map((i) => i.__normalizedLink));
    const renameMap = new Map();
    for (const item of items) {
      if (item.oldLink && item.newLink) {
        renameMap.set(item.oldLink, item.newLink);
      }
    }

    const updated = yamlContent
      .filter((entry) => {
        const normalized = normalizeLink(entry.from, entry.link);
        return !deadLinks.has(normalized);
      })
      .map((entry) => {
        if (renameMap.has(entry.link)) {
          return { ...entry, link: renameMap.get(entry.link) };
        }
        return entry;
      });

    writeYamlArray(filePath, updated);
    const removedCount = items.filter((i) => i.status && [404, 410, 403, 451].includes(i.status)).length;
    const renamedCount = items.filter((i) => i.oldLink && i.newLink).length;
    if (removedCount > 0) console.log(`   🗑️  ${path.basename(filePath)} 删除 ${removedCount} 个死链`);
    if (renamedCount > 0) console.log(`   ✏️  ${path.basename(filePath)} 修正 ${renamedCount} 个改名`);
  }
};

// ==================== 生成 README ====================

// Category → heading level + display title mapping
const CATEGORY_META = {
  '浏览器扩展/全站扩展':     { level: 3, title: '全站扩展' },
  '浏览器扩展/主站扩展':     { level: 3, title: '主站扩展' },
  '浏览器扩展/直播扩展':     { level: 3, title: '直播扩展' },
  '篡改猴脚本/全站脚本':     { level: 3, title: '全站脚本' },
  '篡改猴脚本/主站脚本':     { level: 3, title: '主站脚本' },
  '篡改猴脚本/直播脚本':     { level: 3, title: '直播脚本' },
  '下载工具':               { level: 2, title: '下载工具' },
  '直播相关工具':            { level: 2, title: '直播相关工具' },
  'UP_工具':               { level: 2, title: 'UP 工具' },
  '开发':                 { level: 2, title: '开发' },
  '第三方客户端':            { level: 2, title: '第三方客户端' },
  '每日任务':               { level: 2, title: '每日任务' },
  '监听与推送':             { level: 2, title: '监听与推送' },
  '数据分析':               { level: 2, title: '数据分析' },
  '相关插件':               { level: 2, title: '相关插件' },
  '其他':                 { level: 2, title: '其他' },
};

const generateReadme = (validItems) => {
  const template = readText(README_TEMPLATE);
  const grouped = {};

  for (const item of validItems) {
    const category = item.__sourceFile.replace('.yml', '');
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push(item);
  }

  const sortedKeys = Object.keys(grouped).sort();

  let result = template;
  for (const category of sortedKeys) {
    const categoryItems = grouped[category];
    const placeholder = `{{ RAW_DATA/${category}.yml }}`;
    const meta = CATEGORY_META[category] || { level: 2, title: category };
    // const heading = `${'#'.repeat(meta.level)} ${meta.title}`;

    const sorted = categoryItems.sort((a, b) => a.name.localeCompare(b.name));
    const header = '| 项目名称&地址 | 项目描述 | Star/安装 | 最近更新 | 备注 |\n|:--- |:--- |:--- |:--- |:--- |';
    const rows = sorted.map((item) => {
      const link = item.__normalizedLink;
      let displayName = item.name.replace(/\|/g, '&#124;');
      if (item.__archived) displayName = `~~${item.name.replace(/\|/g, '&#124;')}~~`;
      else if (item.__inactive) displayName = `*${item.name.replace(/\|/g, '&#124;')}*`;
      const desc = processDescription(item.description);
      const stars = item.from === 'github'
        ? `![Star](https://img.shields.io/github/stars/${item.link}?&label=)`
        : item.from === 'greasyfork'
        ? `![总安装量](https://img.shields.io/badge/dynamic/regex?url=https%3A%2F%2Fgreasyfork.org%2Fen%2Fscripts%2F${item.link}&search=%3Cdd%20class%3D%22script-show-total-installs%22%3E%3Cspan%3E(.%2B%3F)%3C%2Fspan%3E%3C%2Fdd%3E&replace=%241&style=social&logo=greasyfork&label=%20)`
        : '';
      const lastCommit = item.__updatedAt
        ? new Date(item.__updatedAt).toISOString().slice(2, 10).replace(/-/g, '/')
        : '-';
      const icons = addIcon(item.icon || []);
      return `| [${displayName}](${link}) | ${desc} | ${stars} | ${lastCommit} | ${icons} |`;
    }).join('\n');

    const table = `<details>\n<summary>${meta.title}</summary>\n\n${header}\n${rows}\n\n</details>`;
    result = result.replaceAll(placeholder, table);
  }

  return result;
};

// ==================== 主流程 ====================

const main = async () => {
  console.log('🚀 开始同步...\n');

  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
  if (proxy) console.log(`🌐 代理: ${proxy}\n`);

  console.log('📖 加载 YAML...');
  const allItems = loadAllItems();
  console.log(`   总计: ${allItems.length} 个项目\n`);

  console.log('🔗 检查链接...');
  const checkedItems = await checkItems(allItems);

  console.log('📂 检查项目状态...');
  const itemsWithStatus = await checkRepoStatus(checkedItems);

  const validItems = itemsWithStatus.filter((i) => i.ok || !i.status);
  const changes = detectChanges(itemsWithStatus);

  console.log('\n📈 变更统计:');
  const archivedCount = validItems.filter((i) => i.__archived).length;
  const inactiveCount = validItems.filter((i) => i.__inactive).length;
  console.log(`   ✏️  改名: ${changes.renamed.length}`);
  console.log(`   💀 死链删除: ${changes.deadRemoved.length}`);
  console.log(`   ⚠️  网络错误(跳过): ${changes.networkError.length}`);
  if (archivedCount > 0 || inactiveCount > 0) {
    console.log(`\n📊 项目状态:`);
    if (archivedCount > 0) console.log(`   ⏸️  归档: ${archivedCount}`);
    if (inactiveCount > 0) console.log(`   💤 超过3年未更新: ${inactiveCount}`);
  }
  console.log('');

  if (changes.renamed.length > 0) {
    console.log('改名详情:');
    changes.renamed.forEach((c) => console.log(`   ${c.name}: ${c.oldLink} → ${c.newLink}`));
    console.log('');
  }

  if (changes.deadRemoved.length > 0) {
    console.log('死链详情:');
    changes.deadRemoved.forEach((item) => console.log(`   ${item.name} - HTTP ${item.status}`));
    console.log('');
  }

  if (changes.networkError.length > 0) {
    console.log(`⚠️  ${changes.networkError.length} 个项目网络错误（已重试 3 次）:`);
    changes.networkError.forEach((item) => console.log(`   ${item.name}`));
    console.log('');
  }

  if (changes.renamed.length > 0 || changes.deadRemoved.length > 0) {
    console.log('📝 更新 YAML...');
    updateYamlFiles(changes);
    console.log('');
  } else {
    console.log('📝 YAML 无变更\n');
  }

  // 对 validItems 中改名项更新链接，并过滤死链
  const deadLinks = new Set(changes.deadRemoved.map((i) => i.__normalizedLink));
  const renameMap = new Map(changes.renamed.map((c) => [c.item.__normalizedLink, c.newLink]));

  const finalItems = validItems
    .filter((i) => !deadLinks.has(i.__normalizedLink))
    .map((item) => {
      if (renameMap.has(item.__normalizedLink)) {
        return { ...item, link: renameMap.get(item.__normalizedLink), __normalizedLink: normalizeLink(item.from, renameMap.get(item.__normalizedLink)) };
      }
      return item;
    });

  console.log('📄 生成 README...');
  const readme = generateReadme(finalItems);
  const existingReadme = fs.existsSync(README_OUTPUT) ? readText(README_OUTPUT) : '';
  if (readme !== existingReadme) {
    writeText(README_OUTPUT, readme);
    console.log('   ✓ README.md 已更新\n');
  } else {
    console.log('   - README.md 无变化\n');
  }

  console.log('✅ 同步完成！');
  console.log(`   有效: ${validItems.length} / 总计: ${allItems.length}\n`);
};

main().catch((error) => {
  console.error('❌ 同步失败:', error);
  process.exit(1);
});
