import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getRuntimePointerTarget } from '../core/skills-runtime-views.js';

describe('skills-runtime-views', () => {
  it('returns project runtime pointer target', () => {
    expect(getRuntimePointerTarget({ scope: 'project' })).toBe(path.join('..', '.xtrm', 'skills', 'active'));
  });

  it('returns global runtime pointer target', () => {
    expect(getRuntimePointerTarget({ scope: 'global' })).toBe(path.join(os.homedir(), '.xtrm', 'skills', 'active'));
  });
});
