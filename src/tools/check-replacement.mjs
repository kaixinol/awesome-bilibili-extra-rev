/**
 * Check for project replacements using LLM
 * Analyzes GitHub project READMEs to detect if they mention being replaced by another project
 */

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { loadAllItems } from '../data/yaml-manager.js';
import { callLLMJSON } from '../utils/llm-utils.js';

const execFile = promisify(execFileCb);

const REPLACEMENT_SCHEMA = {
  type: 'object',
  properties: {
    hasReplacement: { type: 'boolean' },
    originalProject: { type: 'string' },
    replacementProject: { type: 'string' },
    reason: { type: 'string' },
  },
  required: ['hasReplacement'],
  additionalProperties: false,
  allOf: [
    {
      if: { properties: { hasReplacement: { const: true } } },
      then: { required: ['originalProject', 'replacementProject', 'reason'] },
    },
  ],
};

const rotateModels = (models, offset) => [...models.slice(offset), ...models.slice(0, offset)];

/**
 * Fetch GitHub repository README content
 */
const fetchReadme = async (repoPath) => {
  const token = process.env.GITHUB_TOKEN;

  const fetchUrl = async (url) => {
    const args = ['-sS', '--max-time', '10'];
    if (token) args.push('-H', `Authorization: Bearer ${token}`);
    args.push(url);
    const { stdout } = await execFile('curl', args, { timeout: 12000 });
    return stdout && stdout.trim() ? stdout : null;
  };

  for (const branch of ['main', 'master']) {
    for (const readmeFile of ['README.md', 'README.rst', 'README']) {
      try {
        const content = await fetchUrl(`https://raw.githubusercontent.com/${repoPath}/${branch}/${readmeFile}`);
        if (content) return content;
      } catch {
        // Try next file
      }
    }
  }

  return null;
};

/**
 * Use LLM to check if project mentions being replaced
 */
const checkWithLLM = async (projectInfo, model) => {
  const prompt = `你是一个项目维护助手。请分析以下GitHub项目的README内容，判断该项目是否明确说明自己已被另一个项目替代或迁移。

如果项目明确提到：
- 已被新项目替代/取代
- 已迁移到新仓库
- 不再维护，推荐使用其他项目
- 有指向新项目的链接

请返回JSON格式：
{
  "hasReplacement": true,
  "originalProject": "原项目名称",
  "replacementProject": "新项目的完整GitHub链接（如 https://github.com/owner/repo）",
  "reason": "简要说明为什么认为被替代（引用README中的关键信息）"
}

如果没有提到被替代，返回：
{
  "hasReplacement": false
}

只返回JSON，不要其他文字。

项目信息：
名称：${projectInfo.name}
仓库：${projectInfo.link}
描述：${projectInfo.description || '无'}

README内容：
${projectInfo.readme || '无法获取README'}`;

  const result = await callLLMJSON(prompt, {
    name: 'replacement_check',
    schema: REPLACEMENT_SCHEMA,
    model,
  });

  if (result.hasReplacement && !result.replacementProject.startsWith('https://github.com/')) {
    console.warn(`Warning: Replacement project URL may not be valid: ${result.replacementProject}`);
  }

  return result;
};

/**
 * Main function to check all GitHub projects for replacements
 */
const main = async () => {
  const DRY_RUN = process.env.DRY_RUN === 'true';
  const MODELS = (process.env.LLM_MODEL || 'gpt-4o-mini').split(',').map((m) => m.trim()).filter(Boolean);
  const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY) || MODELS.length);

  if (DRY_RUN) {
    console.log('🧪 DRY RUN mode — will not create issues');
  }

  console.log('Loading all items...');
  const allItems = loadAllItems();
  
  // Filter only GitHub projects
  const githubItems = allItems.filter((item) => item.from === 'github');
  console.log(`Found ${githubItems.length} GitHub projects to check (并发 ${CONCURRENCY})`);

  const replacements = [];
  let checked = 0;
  let cursor = 0;

  const worker = async (workerIndex) => {
    const model = rotateModels(MODELS, workerIndex % MODELS.length);
    while (cursor < githubItems.length) {
      const item = githubItems[cursor++];
      checked++;
      process.stdout.write(`Checking ${checked}/${githubItems.length}: ${item.name}\n`);

      try {
        const readme = await fetchReadme(item.link);
        const result = await checkWithLLM({
          name: item.name,
          link: item.link,
          description: item.description,
          readme,
        }, model);

        if (result.hasReplacement) {
          console.log(`\n✅ Found replacement for ${item.name}`);
          console.log(`   → ${result.replacementProject}`);
          console.log(`   Reason: ${result.reason}`);

          replacements.push({
            originalItem: item,
            ...result,
          });
        }
      } catch (error) {
        console.error(`\n❌ Error checking ${item.name}: ${error.message}`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, githubItems.length) }, (_, i) => worker(i)));

  console.log('\n');
  console.log(`Checked ${checked} projects, found ${replacements.length} with replacements`);

  if (replacements.length === 0) {
    console.log('No replacements found.');
    return;
  }

  if (DRY_RUN) {
    console.log('\n🧪 DRY RUN: Would create issue with the following replacements:');
    replacements.forEach((r, i) => {
      console.log(`\n${i + 1}. ${r.originalItem.name} (${r.originalItem.link})`);
      console.log(`   → ${r.replacementProject}`);
      console.log(`   Reason: ${r.reason}`);
    });
    return;
  }

  // Create issue
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const REPO = process.env.GITHUB_REPOSITORY;

  if (!GITHUB_TOKEN || !REPO) {
    console.error('Error: GITHUB_TOKEN and GITHUB_REPOSITORY must be set');
    process.exit(1);
  }

  // Format issue body
  let body = '## Replacement Review\n\n';
  body += '默认全部替换。请**取消勾选**不想替换的项目。\n\n';
  body += '### 发现替代项目\n\n';

  replacements.forEach((r) => {
    const originalUrl = `https://github.com/${r.originalItem.link}`;
    body += `- [x] [${r.originalItem.name}](${originalUrl}) → [${r.replacementProject}](${r.replacementProject})\n`;
    body += `  - 理由：${r.reason}\n\n`;
  });

  body += '完成后添加 `apply-replacement` label\n';

  // Create issue via GitHub API
  const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: `🔄 Replacement Review - ${new Date().toISOString().slice(0, 10)}`,
      body: body,
      labels: ['replacement'],
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to create issue: ${res.status} ${errorText}`);
  }

  const issueData = await res.json();
  console.log(`\n✅ Issue created: ${issueData.html_url}`);
};

// Run if executed directly
const isMain = process.argv[1] && process.argv[1].includes('check-replacement.mjs');
if (isMain) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
