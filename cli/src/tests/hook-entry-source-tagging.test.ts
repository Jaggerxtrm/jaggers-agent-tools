import { describe, expect, it } from 'vitest';
import { safeMergeOwnedHookSettings } from '../core/claude-runtime-sync.js';

describe('hook entry source tagging', () => {
  it('replaces owned entries and preserves foreign entries', async () => {
    const result = await safeMergeOwnedHookSettings({
      hooks: {
        PostToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'node "/tmp/global/beads-claim-sync.mjs"' }], _source: 'xtrm-global' },
          { matcher: 'foo', hooks: [{ type: 'command', command: 'my-tool' }] },
        ],
      },
    }, {
      PostToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'node "/tmp/next/beads-claim-sync.mjs"' }] },
      ],
    });

    expect(result.settings.hooks?.PostToolUse).toHaveLength(2);
    expect(result.settings.hooks?.PostToolUse?.[0]._source).toBe('xtrm-global');
    expect(result.settings.hooks?.PostToolUse?.[1].hooks[0].command).toBe('my-tool');
  });
});
