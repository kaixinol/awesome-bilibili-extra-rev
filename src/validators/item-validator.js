/**
 * Item validation and normalization utilities
 */

export const SOURCE_PREFIX = {
  github: 'https://github.com/',
  greasyfork: 'https://greasyfork.org/zh-CN/scripts/',
};

/**
 * Normalize a link based on its source type
 * @param {string} from - Source type ('github', 'greasyfork', etc.)
 * @param {string} link - Original link
 * @returns {string} Normalized full URL
 */
export const normalizeLink = (from, link) => `${SOURCE_PREFIX[from] || ''}${link}`;

/**
 * Process description text (remove trailing punctuation, escape pipes)
 * @param {string} text - Raw description
 * @returns {string} Processed description
 */
export const processDescription = (text) => {
  if (!text) return '';
  const cleaned = text.replace(/[？！。，；?!,;]$/, '.').replace(/\|/g, '&#124;');
  return cleaned.endsWith('.') ? cleaned : `${cleaned}.`;
};
