/**
 * Link validation utilities
 * Uses curl subprocess with automatic proxy detection, redirect following, and retry logic
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_CONCURRENCY = 10;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 3;
const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 (+https://github.com/kaixinol/awesome-bilibili-extra)';
const PROGRESS_INTERVAL = 100;

// Build curl args with proxy support
const getCurlArgs = (url) => {
  const args = [
    '-L',
    '-sS',
    '-o', NULL_DEVICE,
    '-w', '%{http_code} %{url_effective}',
    '--max-time', String(Math.ceil(DEFAULT_TIMEOUT_MS / 1000)),
    '--user-agent', USER_AGENT,
  ];

  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
  if (proxy) {
    args.push('--proxy', proxy);
  }

  const noProxy = process.env.NO_PROXY || process.env.no_proxy;
  if (noProxy) {
    args.push('--noproxy', noProxy);
  }

  args.push(url);
  return args;
};

/**
 * Draw progress bar
 */
const drawProgressBar = (current, total, prefix = '') => {
  const percentage = ((current / total) * 100).toFixed(1);
  const filled = Math.round((current / total) * 30);
  const bar = '█'.repeat(filled) + '░'.repeat(30 - filled);
  process.stdout.write(`\r${prefix}[${bar}] ${percentage}% (${current}/${total})`);
};

/**
 * Check URL with curl, retries up to 3 times with exponential backoff
 */
export const checkLink = async (url, retries = DEFAULT_RETRIES) => {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }

    try {
      const { stdout } = await execFileAsync('curl', getCurlArgs(url), {
        timeout: DEFAULT_TIMEOUT_MS + 1000,
      });

      const [statusStr, finalUrl] = stdout.trim().split(' ');
      const status = parseInt(statusStr, 10);

      return {
        ok: Number.isFinite(status) && ((status >= 200 && status < 400) || status === 429),
        status,
        finalUrl: finalUrl || url,
        renamed: false,
        attempts: attempt + 1,
      };
    } catch {
      if (attempt === retries - 1) {
        return { ok: false, finalUrl: url, attempts: retries };
      }
    }
  }

  return { ok: false, finalUrl: url, attempts: retries };
};

/**
 * Check multiple items with concurrency and progress bar
 */
export const checkItems = async (items, options = {}) => {
  const concurrency = Number(options.concurrency) || DEFAULT_CONCURRENCY;

  const uniqueItems = [];
  const seen = new Set();
  for (const item of items) {
    if (!item.__normalizedLink || seen.has(item.__normalizedLink)) continue;
    seen.add(item.__normalizedLink);
    uniqueItems.push(item);
  }

  const results = new Array(uniqueItems.length);
  let cursor = 0;
  let completed = 0;
  let lastProgressUpdate = 0;
  const total = uniqueItems.length;
  let outputLock = Promise.resolve();

  const worker = async () => {
    while (cursor < uniqueItems.length) {
      const idx = cursor++;
      const item = uniqueItems[idx];
      const linkResult = await checkLink(item.__normalizedLink);
      results[idx] = { ...item, ...linkResult };

      outputLock = outputLock.then(() => {
        completed++;
        if (completed - lastProgressUpdate >= PROGRESS_INTERVAL || completed === total) {
          drawProgressBar(completed, total, '   ');
          lastProgressUpdate = completed;
        }
      });
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));
  await outputLock;

  const okCount = results.filter((r) => r.ok).length;
  const failCount = total - okCount;
  console.log(`\n   ✓ 检查完成: ${okCount} 有效, ${failCount} 无效 (并发 ${concurrency}, 重试 ${DEFAULT_RETRIES} 次)\n`);

  return results;
};

// ==================== Project Status Detection ====================

const THREE_YEARS_AGO = new Date(Date.now() - 3 * 365.25 * 24 * 60 * 60 * 1000).toISOString();

/**
 * Extract GF script ID from link
 */
const extractGfId = (link) => {
  const match = String(link).match(/^(\d+)/);
  return match ? match[1] : null;
};

/**
 * Fetch GitHub repo status via API
 */
const fetchGithubStatus = async (repoPath) => {
  const url = `https://api.github.com/repos/${repoPath}`;
  const args = ['-sS', '--max-time', '5'];

  const token = process.env.GITHUB_TOKEN;
  if (token) {
    args.push('-H', `Authorization: Bearer ${token}`);
  }
  args.push(url);

  try {
    const { execFile: execFileRaw } = await import('node:child_process');
    const execFileCb = promisify(execFileRaw);
    const { stdout } = await execFileCb('curl', args, { timeout: 6000 });
    const data = JSON.parse(stdout);
    return {
      archived: data.archived === true,
      updatedAt: data.pushed_at || null,
    };
  } catch {
    return null;
  }
};

/**
 * Fetch GreasyFork script status via API
 */
const fetchGreasyforkStatus = async (scriptId) => {
  const url = `https://api.greasyfork.org/en/scripts/${scriptId}.json`;
  const args = ['-sS', '--max-time', '5', url];

  try {
    const { execFile: execFileRaw } = await import('node:child_process');
    const execFileCb = promisify(execFileRaw);
    const { stdout } = await execFileCb('curl', args, { timeout: 6000 });
    const data = JSON.parse(stdout);
    const author = data.users?.[0]?.name || '';
    return {
      archived: data.deleted === true,
      updatedAt: data.code_updated_at || null,
      author,
      name: data.name || '',
    };
  } catch {
    return null;
  }
};

/**
 * Check project status for both GitHub and GreasyFork
 */
export const checkRepoStatus = async (items) => {
  const results = [...items];
  let total = 0;
  let completed = 0;
  let lastProgressUpdate = 0;

  // GitHub items
  const githubItems = items.filter((item) => item.from === 'github');
  total += githubItems.length;

  let ghCursor = 0;
  const ghWorker = async () => {
    while (ghCursor < githubItems.length) {
      const idx = ghCursor++;
      const item = githubItems[idx];
      const status = await fetchGithubStatus(item.link);

      if (status) {
        const resultIdx = results.findIndex(
          (r) => r.__normalizedLink === item.__normalizedLink
        );
        if (resultIdx >= 0) {
          results[resultIdx] = {
            ...results[resultIdx],
            __archived: status.archived,
            __inactive: !status.archived && status.updatedAt && status.updatedAt < THREE_YEARS_AGO,
            __updatedAt: status.updatedAt,
          };
        }
      }

      completed++;
      if (completed - lastProgressUpdate >= PROGRESS_INTERVAL || completed === total) {
        drawProgressBar(completed, total, '   ');
        lastProgressUpdate = completed;
      }
    }
  };

  // GreasyFork items
  const gfItems = items.filter((item) => item.from === 'greasyfork');
  total += gfItems.length;

  let gfCursor = 0;
  const gfWorker = async () => {
    while (gfCursor < gfItems.length) {
      const idx = gfCursor++;
      const item = gfItems[idx];
      const scriptId = extractGfId(item.link);
      if (!scriptId) {
        completed++;
        continue;
      }

      const status = await fetchGreasyforkStatus(scriptId);

      if (status) {
        const resultIdx = results.findIndex(
          (r) => r.__normalizedLink === item.__normalizedLink
        );
        if (resultIdx >= 0) {
          results[resultIdx] = {
            ...results[resultIdx],
            __archived: status.archived,
            __inactive: !status.archived && status.updatedAt && status.updatedAt < THREE_YEARS_AGO,
            __updatedAt: status.updatedAt,
            __gfAuthor: status.author || '',
            __gfName: status.name || '',
          };
        }
      }

      completed++;
      if (completed - lastProgressUpdate >= PROGRESS_INTERVAL || completed === total) {
        drawProgressBar(completed, total, '   ');
        lastProgressUpdate = completed;
      }
    }
  };

  await Promise.all([
    Array.from({ length: Math.min(10, githubItems.length) }, () => ghWorker()),
    Array.from({ length: Math.min(10, gfItems.length) }, () => gfWorker()),
  ].flat());

  if (total > 0) {
    process.stdout.write('\n');
    const archivedCount = results.filter((r) => r.__archived).length;
    const inactiveCount = results.filter((r) => r.__inactive).length;
    console.log(`   ✓ 项目状态检查: ${archivedCount} 个归档/删除, ${inactiveCount} 个超过3年未更新\n`);
  }

  return results;
};
