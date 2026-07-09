/**
 * Link validation utilities
 * Uses axios with keep-alive connection reuse, API-only checks for GitHub/GreasyFork
 */

import axios from 'axios';
import https from 'node:https';
import http from 'node:http';

const DEFAULT_CONCURRENCY = 5;
const DEFAULT_RETRIES = 3;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 (+https://github.com/kaixinol/awesome-bilibili-extra-rev)';
const PROGRESS_INTERVAL = 100;
const THREE_YEARS_AGO = new Date(Date.now() - 3 * 365.25 * 24 * 60 * 60 * 1000).toISOString();

const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;

const client = axios.create({
  timeout: 10_000,
  headers: { 'User-Agent': USER_AGENT },
  validateStatus: () => true,
  ...(proxyUrl
    ? { proxy: (() => { const u = new URL(proxyUrl); return { protocol: u.protocol.replace(':', ''), host: u.hostname, port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80) }; })() }
    : {
        proxy: false,
        httpsAgent: new https.Agent({ keepAlive: true }),
        httpAgent: new http.Agent({ keepAlive: true }),
      }),
});

const drawProgressBar = (current, total, prefix = '') => {
  const percentage = ((current / total) * 100).toFixed(1);
  const filled = Math.round((current / total) * 30);
  const bar = '█'.repeat(filled) + '░'.repeat(30 - filled);
  process.stdout.write(`\r${prefix}[${bar}] ${percentage}% (${current}/${total})`);
};

const extractGfId = (link) => {
  const match = String(link).match(/^(\d+)/);
  return match ? match[1] : null;
};

let currentConcurrency = DEFAULT_CONCURRENCY;
let cooldownUntil = 0;
let rateLimitWarnings = 0;

const handleRateLimit = (source, status) => {
  const cooldownSecs = 10 + Math.floor(Math.random() * 21);
  if (rateLimitWarnings < 5) {
    rateLimitWarnings++;
    console.warn(`\n   ⚠️  ${source} 返回 ${status}，触发限流。降低并发至 ${Math.max(1, Math.floor(currentConcurrency / 2))}，冷却 ${cooldownSecs} 秒`);
  }
  cooldownUntil = Date.now() + cooldownSecs * 1000;
  currentConcurrency = Math.max(1, Math.floor(currentConcurrency / 2));
};

const shouldRetry = (status) => !status || status >= 500 || status === 429;

const requestWithRetry = async (config, retries = DEFAULT_RETRIES) => {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
    try {
      const response = await client.request(config);
      if (!shouldRetry(response.status) || attempt === retries - 1) {
        return response;
      }
    } catch {
      if (attempt === retries - 1) return null;
    }
  }
  return null;
};

const checkGithub = async (item) => {
  const response = await requestWithRetry({
    method: 'get',
    url: `https://api.github.com/repos/${item.link}`,
    headers: process.env.GITHUB_TOKEN
      ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
      : {},
  });

  if (!response) {
    return { ok: false, finalUrl: item.__normalizedLink, attempts: DEFAULT_RETRIES };
  }

  const { status, data } = response;

  if (status === 403) {
    handleRateLimit('GitHub API', status);
    return { ok: false, status, finalUrl: item.__normalizedLink, attempts: 1 };
  }

  const ok = status >= 200 && status < 400;
  const finalUrl = data?.html_url || item.__normalizedLink;

  return {
    ok,
    status,
    finalUrl,
    renamed: false,
    attempts: 1,
    __archived: data?.archived === true,
    __inactive: data?.pushed_at ? data.pushed_at < THREE_YEARS_AGO : false,
    __updatedAt: data?.pushed_at || null,
  };
};

const checkGreasyfork = async (item) => {
  const scriptId = extractGfId(item.link);
  if (!scriptId) {
    return { ok: false, finalUrl: item.__normalizedLink, attempts: 0 };
  }

  const response = await requestWithRetry({
    method: 'get',
    url: `https://api.greasyfork.org/en/scripts/${scriptId}.json`,
  });

  if (!response) {
    return { ok: false, finalUrl: item.__normalizedLink, attempts: DEFAULT_RETRIES };
  }

  const { status, data } = response;

  if (status === 404) {
    return { ok: false, status, finalUrl: item.__normalizedLink, attempts: 1 };
  }

  if (status === 403 || status === 429) {
    handleRateLimit('GreasyFork API', status);
    return { ok: true, status, finalUrl: item.__normalizedLink, attempts: 1 };
  }

  const ok = status >= 200 && status < 400;
  const slug = data?.url?.split('/').pop() || '';
  const finalUrl = slug
    ? `https://greasyfork.org/zh-CN/scripts/${slug}`
    : item.__normalizedLink;

  return {
    ok,
    status,
    finalUrl,
    renamed: false,
    attempts: 1,
    __archived: data?.deleted === true,
    __inactive: data?.code_updated_at ? data.code_updated_at < THREE_YEARS_AGO : false,
    __updatedAt: data?.code_updated_at || null,
    __gfAuthor: data?.users?.[0]?.name || '',
    __gfName: data?.name || '',
  };
};

const checkOther = async (item) => {
  const response = await requestWithRetry({
    method: 'head',
    url: item.__normalizedLink,
    maxRedirects: 5,
  });

  if (!response) {
    return { ok: false, finalUrl: item.__normalizedLink, attempts: DEFAULT_RETRIES };
  }

  const { status, request } = response;
  const ok = status >= 200 && status < 400 || status === 429;
  const finalUrl = request?.res?.responseUrl || item.__normalizedLink;

  return { ok, status, finalUrl, renamed: false, attempts: 1 };
};

const SOURCE_CHECKERS = {
  github: checkGithub,
  greasyfork: checkGreasyfork,
};

/**
 * Check all items: liveness + metadata in one API call per item
 */
export const checkItems = async (items, options = {}) => {
  const initialConcurrency = Number(options.concurrency) || DEFAULT_CONCURRENCY;
  currentConcurrency = initialConcurrency;
  cooldownUntil = 0;
  rateLimitWarnings = 0;

  const uniqueItems = [];
  const seen = new Set();
  for (const item of items) {
    if (!item.__normalizedLink || seen.has(item.__normalizedLink)) continue;
    seen.add(item.__normalizedLink);
    uniqueItems.push(item);
  }

  const results = new Array(uniqueItems.length);
  let cursor = 0;
  let activeWorkers = 0;
  let completed = 0;
  let lastProgressUpdate = 0;
  const total = uniqueItems.length;
  let outputLock = Promise.resolve();

  const worker = async () => {
    activeWorkers++;
    while (cursor < uniqueItems.length && activeWorkers <= currentConcurrency) {
      const now = Date.now();
      if (now < cooldownUntil) {
        await new Promise((resolve) => setTimeout(resolve, cooldownUntil - now));
        continue;
      }

      const idx = cursor++;
      const item = uniqueItems[idx];
      const checker = SOURCE_CHECKERS[item.from] || checkOther;
      const result = await checker(item);
      results[idx] = { ...item, ...result };

      outputLock = outputLock.then(() => {
        completed++;
        if (completed - lastProgressUpdate >= PROGRESS_INTERVAL || completed === total) {
          drawProgressBar(completed, total, '   ');
          lastProgressUpdate = completed;
        }
      });
    }
    activeWorkers--;
  };

  await Promise.all(Array.from({ length: Math.min(initialConcurrency, total) }, () => worker()));
  await outputLock;

  const okCount = results.filter((r) => r.ok).length;
  const failCount = total - okCount;
  const archivedCount = results.filter((r) => r.__archived).length;
  const inactiveCount = results.filter((r) => r.__inactive).length;
  const concurrencyNote = currentConcurrency < initialConcurrency ? `，最终并发 ${currentConcurrency}` : '';
  console.log(`\n   ✓ 检查完成: ${okCount} 有效, ${failCount} 无效 (初始并发 ${initialConcurrency}${concurrencyNote}, 重试 ${DEFAULT_RETRIES} 次)`);
  if (archivedCount > 0 || inactiveCount > 0) {
    console.log(`   ✓ 项目状态: ${archivedCount} 个归档/删除, ${inactiveCount} 个超过3年未更新`);
  }
  console.log('');

  return results;
};
