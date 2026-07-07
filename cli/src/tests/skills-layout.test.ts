import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveGlobalSkillsRoot, resolveSkillsRoot } from '../core/skills-layout.js';

describe('skills-layout', () => {
  it('keeps project skills root unchanged', () => {
    expect(resolveSkillsRoot('/repo')).toBe(path.join('/repo', '.xtrm', 'skills'));
  });

  it('resolves global skills root from home directory', () => {
    expect(resolveGlobalSkillsRoot()).toBe(path.join(os.homedir(), '.xtrm', 'skills'));
  });
});
