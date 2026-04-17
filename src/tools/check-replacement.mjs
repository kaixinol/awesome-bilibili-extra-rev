/**
 * Check for project replacements using LLM
 * Analyzes GitHub project READMEs to detect if they mention being replaced by another project
 */

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { loadAllItems } from '../data/yaml-manager.js';

const execFile = promisify(execFileCb);

const REPLACEMENT_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      hasReplacement: { type: 'boolean' },
    },
    required: ['hasReplacement'],
    allOf: [
      {
        if: { properties: { hasReplacement: { const: true } } },
        then: {
          properties: {
            originalProject: { type: 'string' },
            replacementProject: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['originalProject', 'replacementProject', 'reason'],
        },
      },
    ],
  },
};

/**
 * Fetch GitHub repository README content
 */
const fetchReadme = async (repoPath) => {
  const args = ['-sS', '--max-time', '10'];

  const token = process.env.GITHUB_TOKEN;
  if (token) {
    args.push('-H', `Authorization: Bearer ${token}`);
  }

  // Try README.md first, then README.rst, then README
  const readmeFiles = ['README.md', 'README.rst', 'README'];
  
  for (const readmeFile of readmeFiles) {
    try {
      const url = `https://raw.githubusercontent.com/${repoPath}/main/${readmeFile}`;
      args.push(url);
      const { stdout } = await execFile('curl', args, { timeout: 12000 });
      if (stdout && stdout.trim()) {
        return stdout;
      }
    } catch {
      // Try next file
      continue;
    }
  }

  // If main branch fails, try master
  for (const readmeFile of readmeFiles) {
    try {
      const url = `https://raw.githubusercontent.com/${repoPath}/master/${readmeFile}`;
      args[args.length - 1] = url; // Replace last arg (URL)
      const { stdout } = await execFile('curl', args, { timeout: 12000 });
      if (stdout && stdout.trim()) {
        return stdout;
      }
    } catch {
      continue;
    }
  }

  return null;
};

/**
 * Use LLM to check if project mentions being replaced
 */
const checkWithLLM = async (projectInfo) => {
  const LLM_API_URL = process.env.LLM_API_URL;
  const LLM_API_KEY = process.env.LLM_API_KEY;
  const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

  if (!LLM_API_URL) {
    throw new Error('LLM_API_URL not set');
  }

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

  const headers = { 'Content-Type': 'application/json' };
  if (LLM_API_KEY) headers['Authorization'] = `Bearer ${LLM_API_KEY}`;

  const body = JSON.stringify({
    model: LLM_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    extra_body: { enable_thinking: false },
  });

  const res = await fetch(LLM_API_URL, { method: 'POST', headers, body });
  if (!res.ok) {
    throw new Error(`LLM API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  
  if (!content) {
    throw new Error('LLM returned empty content');
  }

  // Extract JSON (handle markdown code blocks)
  const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/```[\s\S]*?```/);
  const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0].replace(/```/g, '')) : content;
  
  const result = JSON.parse(jsonStr.trim());
  
  // Validate structure
  if (typeof result.hasReplacement !== 'boolean') {
    throw new Error('Invalid LLM response: missing hasReplacement field');
  }

  if (result.hasReplacement) {
    if (!result.originalProject || !result.replacementProject || !result.reason) {
      throw new Error('Invalid LLM response: missing required fields for replacement');
    }
    // Ensure replacement is a valid GitHub URL
    if (!result.replacementProject.startsWith('https://github.com/')) {
      console.warn(`Warning: Replacement project URL may not be valid: ${result.replacementProject}`);
    }
  }

  return result;
};

/**
 * Main function to check all GitHub projects for replacements
 */
const main = async () => {
  const DRY_RUN = process.env.DRY_RUN === 'true';
  
  if (DRY_RUN) {
    console.log('🧪 DRY RUN mode — will not create issues');
  }

  console.log('Loading all items...');
  const allItems = loadAllItems();
  
  // Filter only GitHub projects
  const githubItems = allItems.filter((item) => item.from === 'github');
  console.log(`Found ${githubItems.length} GitHub projects to check`);

  const replacements = [];
  let checked = 0;

  for (const item of githubItems) {
    checked++;
    process.stdout.write(`\rChecking ${checked}/${githubItems.length}: ${item.name}`);

    try {
      // Fetch README
      const readme = await fetchReadme(item.link);
      
      // Check with LLM
      const result = await checkWithLLM({
        name: item.name,
        link: item.link,
        description: item.description,
        readme: readme,
      });

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
      // Continue with next item
    }
  }

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
  body += '请**取消勾选**要替换的项目。默认全部保留。\n\n';
  body += '### 发现替代项目\n\n';

  replacements.forEach((r) => {
    const originalUrl = `https://github.com/${r.originalItem.link}`;
    body += `- [ ] [${r.originalItem.name}](${originalUrl}) → [${r.replacementProject}](${r.replacementProject})\n`;
    body += `  - 理由：${r.reason}\n\n`;
  });

  body += '完成后评论：`@github-actions[bot] apply replacement`\n';

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
