#!/usr/bin/env node

import fs from 'node:fs';

function replaceOnce(text, before, after, label) {
  if (!text.includes(before)) throw new Error(`${label}: anchor not found`);
  const replaced = text.replace(before, after);
  if (replaced === text) throw new Error(`${label}: replacement produced no change`);
  return replaced;
}

const sourcePath = 'cli/src/core/claude-runtime-sync.ts';
let source = fs.readFileSync(sourcePath, 'utf8');

source = replaceOnce(
  source,
  `function stableHookHash(wrapper: HookWrapper): string {
    const canonical = {
        matcher: wrapper.matcher ?? null,
        hooks: wrapper.hooks.map((hook) => ({ type: hook.type, command: hook.command, timeout: hook.timeout ?? null })),
    };
    return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}`,
  `function stableHookHash(wrapper: HookWrapper): string {
    const canonical = {
        matcher: wrapper.matcher ?? null,
        // settings.json is an external/runtime boundary. Unknown third-party
        // wrapper shapes must remain hashable without being mistaken for a
        // valid generated wrapper or crashing reconciliation.
        hooks: Array.isArray(wrapper.hooks)
            ? wrapper.hooks.map((hook) => ({ type: hook.type, command: hook.command, timeout: hook.timeout ?? null }))
            : null,
    };
    return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}`,
  'stableHookHash',
);

source = replaceOnce(
  source,
  `function resolveHooksForRuntime(hooks: Record<string, HookWrapper[]>, hooksDir: string): Record<string, HookWrapper[]> {
    const rewrittenHooks: Record<string, HookWrapper[]> = {};
    for (const [eventName, wrappers] of Object.entries(hooks)) {
        const wrapperList = Array.isArray(wrappers) ? wrappers : [wrappers as HookWrapper];
        rewrittenHooks[eventName] = wrapperList.map((wrapper) => ({
            ...wrapper,
            hooks: wrapper.hooks.map((hook) => hook.type !== 'command'
                ? hook
                : { ...hook, command: rewritePluginRootCommandToProjectHookPath(hook.command, hooksDir) }),
        }));
    }
    return rewrittenHooks;
}`,
  `function resolveHooksForRuntime(hooks: Record<string, HookWrapper[]>, hooksDir: string): Record<string, HookWrapper[]> {
    const rewrittenHooks: Record<string, HookWrapper[]> = {};
    for (const [eventName, wrappers] of Object.entries(hooks)) {
        const wrapperList = Array.isArray(wrappers) ? wrappers : [wrappers as HookWrapper];
        rewrittenHooks[eventName] = wrapperList.map((wrapper) => {
            // Preserve unrecognized third-party wrapper shapes verbatim. Only
            // canonical command-hook arrays are ours to rewrite.
            if (!Array.isArray(wrapper.hooks)) {
                return wrapper;
            }
            return {
                ...wrapper,
                hooks: wrapper.hooks.map((hook) => hook.type !== 'command'
                    ? hook
                    : { ...hook, command: rewritePluginRootCommandToProjectHookPath(hook.command, hooksDir) }),
            };
        });
    }
    return rewrittenHooks;
}`,
  'resolveHooksForRuntime',
);

fs.writeFileSync(sourcePath, source);

const testPath = 'cli/src/tests/claude-runtime-sync-reconcile.test.ts';
let test = fs.readFileSync(testPath, 'utf8');

test = replaceOnce(
  test,
  `import { mergeProjectOwnedHooks, reconcileProjectClaudeHooks } from '../core/claude-runtime-sync.js';`,
  `import { mergeProjectOwnedHooks, reconcileProjectClaudeHooks, resolveHooksForGlobalRuntime } from '../core/claude-runtime-sync.js';`,
  'reconcile test import',
);

const anchor = `  it('tolerates malformed hooks entries without crashing', () => {`;
const regression = `  it('preserves third-party wrapper objects without hooks across resolution and merge', () => {
    const foreign = {
      matcher: 'Bash',
      provider: 'third-party',
    };
    const resolved = resolveHooksForGlobalRuntime(
      { PreToolUse: [foreign as never] },
      '/home/test/.xtrm/hooks',
    );
    expect(resolved.PreToolUse[0]).toEqual(foreign);

    const merged = mergeProjectOwnedHooks(
      { PreToolUse: [foreign as never] },
      canonical,
      '/repo/.xtrm/hooks',
    );
    expect(merged.PreToolUse).toContainEqual(foreign);
  });

`;
test = replaceOnce(test, anchor, regression + anchor, 'foreign wrapper regression');
fs.writeFileSync(testPath, test);
