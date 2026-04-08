/**
 * Badge/icon mapping utilities
 * Maps technology tags to Markdown badge images
 */

const ICON_MAP = {
  py: '![Python](svg/python.svg?raw=true)',
  python: '![Python](svg/python.svg?raw=true)',
  node: '![NodeJs](svg/nodejs.svg?raw=true)',
  nodejs: '![NodeJs](svg/nodejs.svg?raw=true)',
  ts: '![TypeScript](svg/tsnode.svg?raw=true)',
  typescript: '![TypeScript](svg/tsnode.svg?raw=true)',
  js: '![JavaScript](svg/javascript.svg?raw=true)',
  javascript: '![JavaScript](svg/javascript.svg?raw=true)',
  jar: '![Java](svg/openjdk.svg?raw=true)',
  java: '![Java](svg/openjdk.svg?raw=true)',
  springboot: '![Java](svg/springboot.svg?raw=true)',
  'spring-boot': '![Java](svg/springboot.svg?raw=true)',
  'c#': '![C#](svg/csharp.svg?raw=true)',
  csharp: '![C#](svg/csharp.svg?raw=true)',
  c: '![C](svg/c.svg?raw=true)',
  'c++': '![C++](svg/cplusplus.svg?raw=true)',
  cplusplus: '![C++](svg/cplusplus.svg?raw=true)',
  php: '![PHP](svg/php.svg?raw=true)',
  rust: '![Rust](svg/rust.svg?raw=true)',
  dart: '![Dart](svg/dart.svg?raw=true)',
  sh: '![Shell](svg/shell.svg?raw=true)',
  shell: '![Shell](svg/shell.svg?raw=true)',
  kotlin: '![Kotlin](svg/kotlin.svg?raw=true)',
  vue: '![Vue](svg/vue.svg?raw=true)',
  svelte: '![Svelte](svg/svelte.svg?raw=true)',
  swift: '![Swift](svg/swift.svg?raw=true)',
  flutter: '![Flutter](svg/flutter.svg?raw=true)',
  exe: '![Windows](svg/windows.svg?raw=true)',
  cli: '![Cli](svg/terminal.svg?raw=true)',
  docker: '![Docker](svg/docker.svg?raw=true)',
  go: '![Go](svg/go.svg?raw=true)',
  golang: '![Go](svg/go.svg?raw=true)',
  web: '![Web](svg/edge.svg?raw=true)',
  android: '![Android](svg/android.svg?raw=true)',
  linux: '![Linux](svg/linux.svg?raw=true)',
  apple: '![MacOS](svg/apple.svg?raw=true)',
  mac: '![MacOS](svg/apple.svg?raw=true)',
  ios: '![MacOS](svg/apple.svg?raw=true)',
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
    .map((type) => ICON_MAP[type.toLowerCase()])
    .filter(Boolean);

  return icons.join(' ');
};
