/**
 * Apply cleanup - read issue body, parse unchecked items, remove from YAML
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadYamlArray, writeYamlArray } from '../data/yaml-manager.js';
import { normalizeLink } from '../validators/item-validator.js';

const REMOVALS = (process.env.REMOVALS || '').trim();

if (!REMOVALS) {
  console.log('No items selected for removal. All projects will be kept.');
  process.exit(0);
}

// Handle both newline and pipe-separated formats
const removalList = REMOVALS.split(/[\n|]+/).map((u) => u.trim()).filter(Boolean);
const removalSet = new Set(removalList);

// Find all YAML files
const rawDir = path.join(process.cwd(), 'RAW_DATA');
function walkDir(d) {
  const files = [];
  function walk(dd) {
    for (const item of fs.readdirSync(dd)) {
      const full = path.join(dd, item);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (item.endsWith('.yml')) files.push(full);
    }
  }
  walk(d);
  return files;
}

const ymlFiles = walkDir(rawDir);
let removedCount = 0;

for (const filePath of ymlFiles) {
  const items = loadYamlArray(filePath);
  const filtered = items.filter((item) => {
    const normalized = normalizeLink(item.from, item.link);
    if (removalSet.has(normalized)) {
      console.log('Removing: ' + item.name + ' (' + normalized + ') from ' + path.basename(filePath));
      removedCount++;
      return false;
    }
    return true;
  });

  if (filtered.length !== items.length) {
    writeYamlArray(filePath, filtered);
  }
}

console.log('Total removed: ' + removedCount);
