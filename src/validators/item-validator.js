/**
 * Item validation utilities
 */

export const SOURCE_PREFIX = {
  github: 'https://github.com/',
  greasyfork: 'https://greasyfork.org/zh-CN/scripts/',
};

export const SUPPORTED_SOURCES = new Set(Object.keys(SOURCE_PREFIX));
const REQUIRED_FIELDS = ['name', 'link', 'from', 'description', 'icon'];

/**
 * Normalize a link based on its source type
 * @param {string} from - Source type ('github', 'greasyfork', etc.)
 * @param {string} link - Original link
 * @returns {string} Normalized full URL
 */
export const normalizeLink = (from, link) => `${SOURCE_PREFIX[from] || ''}${link}`;

/**
 * Validate an item object has all required fields with correct types
 * @param {Object} item - Item to validate
 * @returns {string[]} Array of validation error messages (empty if valid)
 */
export const validateItem = (item) => {
  const errors = [];

  // Check required fields exist
  for (const field of REQUIRED_FIELDS) {
    if (!(field in item)) {
      errors.push(`missing field \`${field}\``);
    }
  }

  // Check string fields are non-empty
  for (const field of ['name', 'link', 'from', 'description']) {
    if (field in item && (typeof item[field] !== 'string' || item[field].trim() === '')) {
      errors.push(`field \`${field}\` must be a non-empty string`);
    }
  }

  // Check 'from' is a supported source
  if ('from' in item && !SUPPORTED_SOURCES.has(item.from)) {
    errors.push(`field \`from\` must be one of: ${[...SUPPORTED_SOURCES].join(', ')}`);
  }

  // Check icon is a non-empty array of strings
  if ('icon' in item) {
    if (!Array.isArray(item.icon)) {
      errors.push('field `icon` must be an array');
    } else if (item.icon.length === 0) {
      errors.push('field `icon` must not be empty');
    } else if (item.icon.some((icon) => typeof icon !== 'string' || icon.trim() === '')) {
      errors.push('field `icon` must contain non-empty strings');
    }
  }

  return errors;
};

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
