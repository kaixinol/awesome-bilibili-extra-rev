/**
 * YAML data management utilities
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { readText, writeText, findYamlFiles } from '../utils/file-utils.js';
import { normalizeLink } from '../validators/item-validator.js';

export const README_RAW_PATH = 'README_RAW.md';

/**
 * Extract YAML file references from README template
 * @param {string} templatePath - Path to README template
 * @returns {Array<{relPath: string, absPath: string, type: string}>}
 */
export const getTemplateYamlRefs = (templatePath = README_RAW_PATH) => {
  const template = readText(templatePath);
  const regex = /\{\{\s*(RAW_DATA\/.*?\.yml)\s*\}\}/g;
  const refs = [];
  let match;

  while ((match = regex.exec(template)) !== null) {
    const relPath = match[1];
    refs.push({
      relPath,
      absPath: path.join(process.cwd(), relPath),
      type: relPath.replace('RAW_DATA/', '').replace('.yml', ''),
    });
  }

  return refs;
};

/**
 * Parse YAML content into array
 * @param {string} content - YAML content
 * @param {string} filePath - File path (for error messages)
 * @returns {Array} Parsed YAML array
 */
export const parseYamlArray = (content, filePath = 'unknown') => {
  const parsed = parse(content);
  if (!Array.isArray(parsed)) {
    throw new Error(`${filePath} does not contain a YAML array`);
  }
  return parsed;
};

/**
 * Load and parse a YAML array file
 * @param {string} filePath - Path to YAML file
 * @returns {Array} Parsed YAML array
 */
export const loadYamlArray = (filePath) => parseYamlArray(readText(filePath), filePath);

/**
 * Load all tracked YAML files referenced in template
 * @param {string} templatePath - Path to README template
 * @returns {Array<{items: Array}>}
 */
export const loadTrackedFiles = (templatePath = README_RAW_PATH) =>
  getTemplateYamlRefs(templatePath).map((ref) => ({
    ...ref,
    items: loadYamlArray(ref.absPath),
  }));

/**
 * Load all tracked items with metadata
 * @param {string} templatePath - Path to README template
 * @returns {Array<Object>} Array of items with metadata
 */
export const loadTrackedItems = (templatePath = README_RAW_PATH) => {
  let order = 0;
  return loadTrackedFiles(templatePath).flatMap((file) =>
    file.items.map((item, index) => ({
      ...item,
      __order: order++,
      __index: index,
      __type: file.type,
      __relPath: file.relPath,
      __absPath: file.absPath,
      __normalizedLink: normalizeLink(item.from, item.link),
    }))
  );
};

/**
 * Generate a stable string representation for fingerprinting
 * @param {any} value - Any value
 * @returns {string} Stable serialized string
 */
export const stableStringify = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
};

/**
 * Generate a unique fingerprint for an item
 * @param {Object} item - Item object
 * @returns {string} Fingerprint string
 */
export const itemFingerprint = (item) =>
  stableStringify({
    name: item.name,
    link: item.link,
    from: item.from,
    description: item.description,
    icon: item.icon,
  });

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
