import fs from 'node:fs';
import path from 'node:path';

/**
 * Read text file synchron
 * @param {string} filePath - Absolute or relative file path
 * @returns {string} File content
 */
export const readText = (filePath) => fs.readFileSync(filePath, 'utf8');

/**
 * Write text file synchronously (creates directories if needed)
 * @param {string} filePath - Target file path
 * @param {string} content - File content
 */
export const writeText = (filePath, content) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
};

/**
 * Recursively find all YAML files in directory
 * @param {string} dir - Directory path
 * @returns {string[]} Array of YAML file paths
 */
export const findYamlFiles = (dir) => {
  const ymlFiles = [];

  const readDirRecursive = (currentDir) => {
    const items = fs.readdirSync(currentDir);

    for (const item of items) {
      const fullPath = path.join(currentDir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        readDirRecursive(fullPath);
      } else if (stat.isFile() && path.extname(item) === '.yml') {
        ymlFiles.push(fullPath);
      }
    }
  };

  readDirRecursive(dir);
  return ymlFiles;
};

/**
 * Check if file exists
 * @param {string} filePath - File path
 * @returns {boolean}
 */
export const fileExists = (filePath) => fs.existsSync(filePath);

/**
 * Ensure directory exists (creates if not exists)
 * @param {string} dirPath - Directory path
 */
export const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};
