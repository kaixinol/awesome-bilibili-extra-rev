import { describe, it, expect } from 'vitest';
import { processDescription } from '../validators/item-validator.js';
import { addIcon } from '../utils/badge-utils.js';

// Mock data for testing
const generateTableRow = (item) => {
  const link = item.__normalizedLink;
  let displayName = item.name.replace(/\|/g, '&#124;');
  if (item.__archived) displayName = `~~${item.name.replace(/\|/g, '&#124;')}~~`;
  else if (item.__inactive) displayName = `*${item.name.replace(/\|/g, '&#124;')}*`;

  const desc = processDescription(item.description);
  const lastCommit = item.__updatedAt
    ? new Date(item.__updatedAt).toISOString().slice(2, 10).replace(/-/g, '/')
    : '-';
  const icons = addIcon(item.icon || []);

  return `| [${displayName}](${link}) | ${desc} | - | ${lastCommit} | ${icons} |`;
};

describe('sync - README generation', () => {
  describe('pipe character escaping', () => {
    it('escapes | in project names', () => {
      const item = {
        name: 'Test | Project',
        __normalizedLink: 'https://github.com/test/project',
        from: 'github',
        link: 'test/project',
        description: 'A test project',
        icon: [],
        __archived: false,
        __inactive: false,
        __updatedAt: '2024-06-01T00:00:00Z',
      };

      const row = generateTableRow(item);
      // Should have exactly 6 pipe characters (5 column separators + 1 escaped)
      const pipeCount = (row.match(/\|/g) || []).length;
      expect(pipeCount).toBe(6);
      expect(row).toContain('Test &#124; Project');
    });

    it('escapes | in descriptions', () => {
      const item = {
        name: 'TestProject',
        __normalizedLink: 'https://github.com/test/project',
        from: 'github',
        link: 'test/project',
        description: 'A | B | C',
        icon: [],
        __archived: false,
        __inactive: false,
        __updatedAt: null,
      };

      const row = generateTableRow(item);
      expect(row).toContain('A &#124; B &#124; C');
    });
  });

  describe('status markers', () => {
    it('renders archived projects with strikethrough', () => {
      const item = {
        name: 'ArchivedProject',
        __normalizedLink: 'https://github.com/old/archived',
        from: 'github',
        link: 'old/archived',
        description: 'Archived',
        icon: [],
        __archived: true,
        __inactive: false,
        __updatedAt: null,
      };

      const row = generateTableRow(item);
      expect(row).toContain('~~ArchivedProject~~');
      expect(row).not.toContain('*ArchivedProject*');
    });

    it('renders inactive projects with italics', () => {
      const item = {
        name: 'OldScript',
        __normalizedLink: 'https://github.com/old/script',
        from: 'github',
        link: 'old/script',
        description: 'Old',
        icon: [],
        __archived: false,
        __inactive: true,
        __updatedAt: null,
      };

      const row = generateTableRow(item);
      expect(row).toContain('*OldScript*');
      expect(row).not.toContain('~~OldScript~~');
    });

    it('prioritizes archived over inactive', () => {
      const item = {
        name: 'OldArchived',
        __normalizedLink: 'https://github.com/old/both',
        from: 'github',
        link: 'old/both',
        description: 'Both',
        icon: [],
        __archived: true,
        __inactive: true,
        __updatedAt: null,
      };

      const row = generateTableRow(item);
      expect(row).toContain('~~OldArchived~~');
      expect(row).not.toContain('*OldArchived*');
    });
  });

  describe('date formatting', () => {
    it('formats dates as yy/mm/dd', () => {
      const item = {
        name: 'Test',
        __normalizedLink: 'https://github.com/test/project',
        from: 'github',
        link: 'test/project',
        description: 'Test',
        icon: [],
        __archived: false,
        __inactive: false,
        __updatedAt: '2022-03-15T10:30:00Z',
      };

      const row = generateTableRow(item);
      expect(row).toContain('22/03/15');
    });

    it('shows dash for missing dates', () => {
      const item = {
        name: 'Test',
        __normalizedLink: 'https://github.com/test/project',
        from: 'github',
        link: 'test/project',
        description: 'Test',
        icon: [],
        __archived: false,
        __inactive: false,
        __updatedAt: null,
      };

      const row = generateTableRow(item);
      expect(row).toMatch(/\| - \|/);
    });
  });

  describe('icon generation', () => {
    it('generates badges for known tech tags', () => {
      const item = {
        name: 'Test',
        __normalizedLink: 'https://github.com/test/project',
        from: 'github',
        link: 'test/project',
        description: 'Test',
        icon: ['python', 'docker', 'cli'],
        __archived: false,
        __inactive: false,
        __updatedAt: null,
      };

      const row = generateTableRow(item);
      expect(row).toContain('![Python]');
      expect(row).toContain('![Docker]');
      expect(row).toContain('![Cli]');
    });
  });
});
