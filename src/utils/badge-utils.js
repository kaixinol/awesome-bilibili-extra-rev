import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ICONS = parse(fs.readFileSync(fileURLToPath(new URL('../data/icons.yml', import.meta.url)), 'utf8'));
const BY_KEY = new Map(ICONS.map((icon) => [icon.key, icon]));
const ALIASES = new Map(ICONS.flatMap((icon) => (icon.aliases || []).map((a) => [a.toLowerCase(), icon.key])));

export const VALID_ICONS = ICONS.map((icon) => icon.key);

export const normalizeIcon = (type) => {
  if (typeof type !== 'string') return null;
  const key = type.toLowerCase().trim();
  const canonical = ALIASES.get(key) || key;
  return BY_KEY.has(canonical) ? canonical : null;
};

export const addIcon = (types) => {
  if (!Array.isArray(types) || types.length === 0) return '';
  return [...new Set(types.map(normalizeIcon).filter(Boolean))]
    .map((key) => {
      const { label, svg } = BY_KEY.get(key);
      return `![${label}](svg/${svg}.svg?raw=true)`;
    })
    .join(' ');
};

export const renderIconDocs = () => {
  const items = ICONS
    .map(({ svg, label, description }) => `    <li>\n      <img src="svg/${svg}.svg?raw=true" alt="${label}">: ${description}\n    </li>`)
    .join('\n');
  return `<details>\n  <summary><b>图标说明</b></summary>\n  <ul>\n${items}\n  </ul>\n</details>`;
};
