/**
 * Badge/icon mapping utilities
 * Maps technology tags to Markdown badge images
 */

// Base icon paths organized by category
const ICON_PATHS = {
  // Languages
  python: 'languages/python',
  javascript: 'languages/javascript',
  nodejs: 'frameworks/nodejs',
  typescript: 'frameworks/tsnode',
  java: 'frameworks/openjdk',
  springboot: 'frameworks/springboot',
  csharp: 'languages/csharp',
  c: 'languages/c',
  cpp: 'languages/cplusplus',
  php: 'languages/php',
  rust: 'languages/rust',
  dart: 'languages/dart',
  shell: 'languages/shell',
  kotlin: 'languages/kotlin',
  swift: 'languages/swift',
  go: 'languages/go',
  // Frameworks
  vue: 'frameworks/vue',
  svelte: 'frameworks/svelte',
  flutter: 'frameworks/flutter',
  // Platforms
  windows: 'platforms/windows',
  terminal: 'tools/terminal',
  docker: 'tools/docker',
  web: 'platforms/web',
  android: 'platforms/android',
  linux: 'platforms/linux',
  apple: 'platforms/apple',
};

// Display labels
const ICON_LABELS = {
  python: 'Python',
  javascript: 'JavaScript',
  nodejs: 'NodeJs',
  typescript: 'TypeScript',
  java: 'Java',
  springboot: 'Java',
  csharp: 'C#',
  c: 'C',
  cpp: 'C++',
  php: 'PHP',
  rust: 'Rust',
  dart: 'Dart',
  shell: 'Shell',
  kotlin: 'Kotlin',
  swift: 'Swift',
  go: 'Go',
  vue: 'Vue',
  svelte: 'Svelte',
  flutter: 'Flutter',
  windows: 'Windows',
  terminal: 'Cli',
  docker: 'Docker',
  web: 'Web',
  android: 'Android',
  linux: 'Linux',
  apple: 'MacOS',
};

// Alias mapping (alias -> canonical key)
const ALIASES = {
  py: 'python',
  node: 'nodejs',
  ts: 'typescript',
  js: 'javascript',
  jar: 'java',
  'spring-boot': 'springboot',
  'c#': 'csharp',
  'c++': 'cpp',
  sh: 'shell',
  golang: 'go',
  exe: 'windows',
  cli: 'terminal',
  mac: 'apple',
  ios: 'apple',
};

/**
 * Convert technology tags to Markdown badge images
 * @param {string[]} types - Array of technology tags
 * @returns {string} Space-separated Markdown badges
 */
export const addIcon = (types) => {
  if (!Array.isArray(types) || types.length === 0) {
    return '';
  }

  const icons = types
    .map((type) => {
      const key = type.toLowerCase();
      const canonical = ALIASES[key] || key;
      const path = ICON_PATHS[canonical];
      const label = ICON_LABELS[canonical];
      if (!path || !label) return null;
      return `![${label}](svg/${path}.svg?raw=true)`;
    })
    .filter(Boolean);

  return icons.join(' ');
};
