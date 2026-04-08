/**
 * Userscript generation utilities
 */

import { parse } from 'yaml';
import { readText, writeText } from '../utils/file-utils.js';

const TEMPLATE_PATH = 'src/templates/raw.user.js';
const OUTPUT_PATH = 'src/user.js';
const README_TEMPLATE = 'README_RAW.md';

/**
 * Extract all project links from YAML files referenced in README template
 * @returns {string[]} Array of links
 */
const extractLinks = () => {
  const template = readText(README_TEMPLATE);
  const regex = /\{\{\s*(RAW_DATA\/.*?\.yml)\s*\}\}/g;
  const links = [];
  let match;

  while ((match = regex.exec(template)) !== null) {
    const yamlPath = match[1];
    try {
      const yamlContent = readText(yamlPath);
      const data = parse(yamlContent);
      if (Array.isArray(data)) {
        links.push(...data.map((item) => item.link));
      }
    } catch (error) {
      console.error(`Error reading ${yamlPath}:`, error.message);
    }
  }

  return links;
};

/**
 * Generate userscript by injecting links into template
 */
export const generateUserScript = () => {
  const links = extractLinks();
  const template = readText(TEMPLATE_PATH);
  const linksArray = `["${links.join('","')}"]`;
  const output = template.replace('__addedItem__', linksArray);
  
  writeText(OUTPUT_PATH, output);
  console.log('   ✓ user.js 已更新\n');
};
