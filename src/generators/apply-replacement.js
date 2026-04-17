/**
 * Apply replacement - read issue body, parse unchecked items, update YAML to replace old projects with new ones
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadYamlArray, writeYamlArray } from '../data/yaml-manager.js';
import { normalizeLink } from '../validators/item-validator.js';

const REPLACEMENTS = (process.env.REPLACEMENTS || '').trim();

if (!REPLACEMENTS) {
  console.log('No items selected for replacement. All projects will be kept.');
  process.exit(0);
}

// Parse replacements format: "original_url|replacement_url" separated by newlines or pipes
const replacementList = REPLACEMENTS.split(/[\n|]+/).map((u) => u.trim()).filter(Boolean);

// Parse into pairs
const replacementPairs = [];
for (let i = 0; i < replacementList.length; i += 2) {
  if (i + 1 < replacementList.length) {
    replacementPairs.push({
      original: replacementList[i],
      replacement: replacementList[i + 1],
    });
  }
}

if (replacementPairs.length === 0) {
  console.log('No valid replacement pairs found.');
  process.exit(0);
}

console.log('Replacements to apply:');
replacementPairs.forEach((pair) => {
  console.log(`  ${pair.original} → ${pair.replacement}`);
});

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
let replacedCount = 0;

for (const filePath of ymlFiles) {
  const items = loadYamlArray(filePath);
  let modified = false;

  const updated = items.map((item) => {
    const normalized = normalizeLink(item.from, item.link);
    
    // Check if this item should be replaced
    const replacement = replacementPairs.find((pair) => {
      const pairOriginal = pair.original.replace('https://github.com/', '');
      return normalized === pairOriginal || item.link === pairOriginal;
    });

    if (replacement) {
      console.log(`Replacing: ${item.name} (${item.link})`);
      console.log(`  → ${replacement.replacement}`);
      
      // Extract new repo path
      const newRepoPath = replacement.replacement.replace('https://github.com/', '');
      
      // Update the item
      modified = true;
      replacedCount++;
      
      return {
        ...item,
        link: newRepoPath,
        // Keep other fields but might want to fetch new metadata later
      };
    }
    
    return item;
  });

  if (modified) {
    writeYamlArray(filePath, updated);
  }
}

console.log(`\nTotal replaced: ${replacedCount}`);
