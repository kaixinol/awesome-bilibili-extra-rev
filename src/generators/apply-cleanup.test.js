import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadYamlArray, writeYamlArray } from '../data/yaml-manager.js';
import { normalizeLink } from '../validators/item-validator.js';

const MOCK_YAML_DIR = '.tmp-test-yaml';

// Mock Issue body with unchecked items
const MOCK_ISSUE_BODY = `
## Cleanup Review
请取消勾选要移除的项目。默认全部保留。

### 归档且超过3年未更新
- [x] [user/repo-a](https://github.com/user/repo-a)
- [ ] [user/repo-b](https://github.com/user/repo-b)
- [x] [author/script-a](https://greasyfork.org/en/scripts/123-script-a)

### 已归档
- [ ] [user/repo-c](https://github.com/user/repo-c)
- [x] [user/repo-d](https://github.com/user/repo-d)

### 超过3年未更新
- [ ] [author/script-b](https://greasyfork.org/zh-CN/scripts/456-script-b)
`;

const extractRemovalsFromIssue = (body) => {
  const removalLines = body.split('\n').filter((line) => line.match(/- \[ \]/));
  const urls = removalLines.map((line) => {
    const match = line.match(/\((https?:\/\/[^)]+)\)/);
    return match ? match[1] : null;
  }).filter(Boolean);
  return urls;
};

const applyCleanup = (yamlDir, removals) => {
  const removalSet = new Set(removals);
  let totalRemoved = 0;

  function findYamlFiles(dir) {
    const files = [];
    function walk(d) {
      for (const item of fs.readdirSync(d)) {
        const full = path.join(d, item);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) walk(full);
        else if (item.endsWith('.yml')) files.push(full);
      }
    }
    walk(dir);
    return files;
  }

  const ymlFiles = findYamlFiles(yamlDir);

  for (const filePath of ymlFiles) {
    const items = loadYamlArray(filePath);
    const filtered = items.filter((item) => {
      const normalized = normalizeLink(item.from, item.link);
      if (removalSet.has(normalized)) {
        totalRemoved++;
        return false;
      }
      return true;
    });

    if (filtered.length !== items.length) {
      writeYamlArray(filePath, filtered);
    }
  }

  return totalRemoved;
};

describe('apply-cleanup workflow', () => {
  beforeAll(() => {
    fs.mkdirSync(path.join(MOCK_YAML_DIR, '篡改猴脚本'), { recursive: true });

    writeYamlArray(path.join(MOCK_YAML_DIR, '下载工具.yml'), [
      { name: 'repo-a', link: 'user/repo-a', from: 'github', description: 'Test A', icon: ['python'] },
      { name: 'repo-b', link: 'user/repo-b', from: 'github', description: 'Test B', icon: ['nodejs'] },
      { name: 'repo-c', link: 'user/repo-c', from: 'github', description: 'Test C', icon: ['rust'] },
    ]);

    writeYamlArray(path.join(MOCK_YAML_DIR, '篡改猴脚本', '主站脚本.yml'), [
      { name: 'script-a', link: '123-script-a', from: 'greasyfork', description: 'Script A', icon: ['javascript'] },
      { name: 'script-b', link: '456-script-b', from: 'greasyfork', description: 'Script B', icon: ['javascript'] },
      { name: 'script-c', link: '789-script-c', from: 'greasyfork', description: 'Script C', icon: [] },
    ]);
  });

  afterAll(() => {
    fs.rmSync(MOCK_YAML_DIR, { recursive: true, force: true });
  });

  it('extracts unchecked items from issue body', () => {
    const removals = extractRemovalsFromIssue(MOCK_ISSUE_BODY);
    expect(removals).toHaveLength(3);
    expect(removals).toContain('https://github.com/user/repo-b');
    expect(removals).toContain('https://github.com/user/repo-c');
    expect(removals).toContain('https://greasyfork.org/zh-CN/scripts/456-script-b');
  });

  it('removes correct items from YAML files', () => {
    const removals = extractRemovalsFromIssue(MOCK_ISSUE_BODY);
    const removed = applyCleanup(MOCK_YAML_DIR, removals);
    expect(removed).toBe(3);

    // Verify 下载工具.yml
    const downloadItems = loadYamlArray(path.join(MOCK_YAML_DIR, '下载工具.yml'));
    expect(downloadItems).toHaveLength(1);
    expect(downloadItems[0].name).toBe('repo-a');

    // Verify 篡改猴脚本/主站脚本.yml
    const scriptItems = loadYamlArray(path.join(MOCK_YAML_DIR, '篡改猴脚本', '主站脚本.yml'));
    expect(scriptItems).toHaveLength(2);
    expect(scriptItems.map((i) => i.name)).toContain('script-a');
    expect(scriptItems.map((i) => i.name)).toContain('script-c');
  });

  it('skips already-removed items on second run', () => {
    // Re-create mock YAML to the post-cleanup state
    writeYamlArray(path.join(MOCK_YAML_DIR, '下载工具.yml'), [
      { name: 'repo-a', link: 'user/repo-a', from: 'github', description: 'Test A', icon: ['python'] },
    ]);
    writeYamlArray(path.join(MOCK_YAML_DIR, '篡改猴脚本', '主站脚本.yml'), [
      { name: 'script-a', link: '123-script-a', from: 'greasyfork', description: 'Script A', icon: ['javascript'] },
      { name: 'script-c', link: '789-script-c', from: 'greasyfork', description: 'Script C', icon: [] },
    ]);

    const removals = extractRemovalsFromIssue(MOCK_ISSUE_BODY);
    const removed = applyCleanup(MOCK_YAML_DIR, removals);
    expect(removed).toBe(0);
  });
});
