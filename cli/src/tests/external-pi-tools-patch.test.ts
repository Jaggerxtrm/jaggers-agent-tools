import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const patchScript = path.join(repoRoot, 'scripts', 'patch-external-pi-tools.mjs');
const expectedNavigationTools = [
  'find_symbol',
  'find_referencing_symbols',
  'get_symbols_overview',
  'insert_after_symbol',
  'insert_before_symbol',
  'replace_symbol_body',
  'rename_symbol',
  'jet_brains_get_symbols_overview',
  'jet_brains_find_symbol',
  'jet_brains_find_referencing_symbols',
  'jet_brains_type_hierarchy',
];

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
});

describe('external Pi tool patch', () => {
  it('exposes only Serena semantic code tools', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xtrm-pi-tools-'));
    tempRoots.push(root);
    const serenaDir = path.join(root, 'pi-serena-tools');
    await fs.ensureDir(serenaDir);
    await fs.writeFile(path.join(serenaDir, 'index.ts'), [
      'import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";',
      'export default function (pi: ExtensionAPI) {',
      '  const defaultBlockedToolNames = ["read", "write", "edit", "ls", "find", "grep"];',
      '  registerSerenaTools({',
      '    pi,',
      '  });',
      '  const handleToolCall = () => {};',
      '}',
      '',
    ].join('\n'));

    const first = spawnSync(process.execPath, [patchScript, root], { encoding: 'utf8' });
    expect(first.status, first.stderr).toBe(0);

    const patched = await fs.readFile(path.join(serenaDir, 'index.ts'), 'utf8');
    const allowlist = patched.match(/const SERENA_CODE_NAVIGATION_TOOLS = new Set\(\[([^\]]+)\]\);/)?.[1]
      .match(/["']([^"']+)["']/g)
      ?.map((name) => name.slice(1, -1));

    expect(allowlist).toEqual(expectedNavigationTools);
    expect(patched).toContain('const defaultBlockedToolNames = [];');
    expect(patched).not.toContain('defaultBlockedToolNames = ["read"');
    expect(patched).toContain('if (!SERENA_CODE_NAVIGATION_TOOLS.has(tool.name)) return;');
    expect(patched).toContain('pi.registerTool = originalRegisterTool;');
    for (const genericTool of ['read_file', 'search_for_pattern', 'list_dir', 'find_file', 'create_text_file', 'replace_content', 'execute_shell_command']) {
      expect(allowlist).not.toContain(genericTool);
    }

    const firstPatch = patched;
    const second = spawnSync(process.execPath, [patchScript, root], { encoding: 'utf8' });
    expect(second.status, second.stderr).toBe(0);
    expect(await fs.readFile(path.join(serenaDir, 'index.ts'), 'utf8')).toBe(firstPatch);
  });
});
