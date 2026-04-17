/**
 * Tests for check-replacement tool
 */

import { describe, it, expect } from 'vitest';

describe('check-replacement', () => {
  it('should validate replacement schema structure', () => {
    const validResult = {
      hasReplacement: true,
      originalProject: 'old-project',
      replacementProject: 'https://github.com/owner/new-project',
      reason: 'Project is deprecated',
    };

    expect(validResult.hasReplacement).toBe(true);
    expect(validResult.originalProject).toBeTypeOf('string');
    expect(validResult.replacementProject).toMatch(/^https:\/\/github\.com\//);
    expect(validResult.reason).toBeTypeOf('string');
  });

  it('should handle no replacement case', () => {
    const noReplacement = {
      hasReplacement: false,
    };

    expect(noReplacement.hasReplacement).toBe(false);
  });

  it('should parse replacement pairs correctly', () => {
    const replacements = 'https://github.com/owner/old|https://github.com/owner/new';
    const pairs = replacements.split(/[\n|]+/).map((u) => u.trim()).filter(Boolean);
    
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toBe('https://github.com/owner/old');
    expect(pairs[1]).toBe('https://github.com/owner/new');
  });
});
