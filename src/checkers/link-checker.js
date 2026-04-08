/**
 * Link validation utilities
 * Uses curl subprocess with automatic proxy detection, redirect following, and retry logic
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_CONCURRENCY = 30;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 3;
const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null';

// Build curl args with proxy support
const getCurlArgs = (url) => {
  const args = [
    '-L',
    '-sS',
    '-o', NULL_DEVICE,
    '-w', '%{http_code} %{url_effective}',
    '--max-time', String(Math.ceil(DEFAULT_TIMEOUT_MS / 1000)),
    '--user-agent', 'Mozilla/5.0 (compatible; awesome-bilibili-extra-ci/1.0)',
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
        drawProgressBar(completed, total, '   ');
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
