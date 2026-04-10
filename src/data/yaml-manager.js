/**
 * YAML data management utilities
 */

import fs from 'node:fs';
import path from 'node:path';
import { stringify } from 'yaml';
import { parse } from 'yaml';
import { readText, writeText, findYamlFiles } from '../utils/file-utils.js';
import { normalizeLink } from '../validators/item-validator.js';

/**
 * Parse and load a YAML array file
 * @param {string} filePath - Path to YAML file
 * @returns {Array} Parsed YAML array
 */
export const loadYamlArray = (filePath) => {
  const content = readText(filePath);
  const parsed = parse(content);
  if (!Array.isArray(parsed)) {
    throw new Error(`${filePath} does not contain a YAML array`);
  }
  return parsed;
};

/**
 * Write items to a YAML file
 * @param {string} filePath - Target file path
 * @param {Array} items - Items to write
 */
export const writeYamlArray = (filePath, items) => {
  const content = stringify(items, { lineWidth: 0 }).replace(/\s+$/, '');
  writeText(filePath, `${content}\n`);
};

/**
 * Load all YAML data from RAW_DATA directory
 * @returns {Array<Object>} All items with metadata
 */
export const loadAllItems = () => {
  const rawDir = path.join(process.cwd(), 'RAW_DATA');
  const ymlFiles = findYamlFiles(rawDir);
  const allItems = [];

  for (const filePath of ymlFiles) {
    try {
      const yamlData = loadYamlArray(filePath);

      yamlData.forEach((item) => {
        allItems.push({
          ...item,
          __normalizedLink: normalizeLink(item.from, item.link),
          __sourceFile: path.relative(rawDir, filePath),
          __absPath: filePath,
        });
      });
    } catch (error) {
      console.error(`Error reading ${filePath}:`, error.message);
    }
  }

  return allItems;
};
