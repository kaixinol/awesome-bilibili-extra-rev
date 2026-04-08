/**
 * YAML syntax check - 检查所有 YAML 文件语法
 */

import path from 'node:path';
import fs from 'node:fs';
import { parse } from 'yaml';
import { findYamlFiles } from '../utils/file-utils.js';

const rawDir = path.join(process.cwd(), 'RAW_DATA');
const ymlFiles = findYamlFiles(rawDir);
let hasErrors = false;

console.log('检查 YAML 语法...\n');

for (const fullPath of ymlFiles) {
  try {
    parse(fs.readFileSync(fullPath, 'utf8'));
    console.log(`✓ ${path.relative(rawDir, fullPath)}`);
  } catch (error) {
    hasErrors = true;
    console.error(`✗ ${path.relative(rawDir, fullPath)}: ${error.message}`);
  }
}

console.log(`\n共检查 ${ymlFiles.length} 个文件`);

if (hasErrors) {
  console.error('\n❌ 发现语法错误');
  process.exit(1);
} else {
  console.log('✅ 所有 YAML 文件语法正确');
}
