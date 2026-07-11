import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'fs-extra';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_BIN = path.join(__dirname, '../dist/index.cjs');

let tmpDir: string;

function run(args: string[], cwd?: string): { stdout: string; stderr: string; status: number } {
    const r = spawnSync('node', [CLI_BIN, ...args], {
        encoding: 'utf8',
        timeout: 15000,
        cwd: cwd ?? tmpDir,
        env: { ...process.env },
    });
    return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? -1 };
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xtrm-docs-list-'));
    // Anchor current project-root discovery to tmpDir.
    await fs.ensureDir(path.join(tmpDir, '.xtrm'));
    await fs.ensureDir(path.join(tmpDir, 'skills'));
    await fs.ensureDir(path.join(tmpDir, 'hooks'));
});

afterEach(async () => {
    await fs.remove(tmpDir);
});

async function writeDoc(relPath: string, content: string): Promise<void> {
    await fs.outputFile(path.join(tmpDir, relPath), content);
}

describe('xtrm docs list (vwp0.7)', () => {
    it('outputs "No documentation files found" for empty project', () => {
        const r = run(['docs', 'list']);
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/No documentation files found/);
    });

    it('table output includes Path/Size/Modified/Title/Type headers', async () => {
        await writeDoc('docs/guide.md', '---\ntitle: Guide Doc\ntype: guide\n---\n');
        const r = run(['docs', 'list']);
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/Path/);
        expect(r.stdout).toMatch(/Size/);
        expect(r.stdout).toMatch(/Modified/);
        expect(r.stdout).toMatch(/Title/);
        expect(r.stdout).toMatch(/Type/);
    });

    it('table includes .md files from docs/ only', async () => {
        await writeDoc('README.md', '# Root');
        await writeDoc('docs/guide.md', '# Guide');
        const r = run(['docs', 'list']);
        expect(r.stdout).not.toMatch(/README\.md/);
        expect(r.stdout).toMatch(/docs\/guide\.md/);
    });

    it('--json outputs valid JSON array with expected shape', async () => {
        await writeDoc('docs/guide.md', '---\ntitle: Test\ntype: guide\n---\n');
        const r = run(['docs', 'list', '--json']);
        expect(r.status).toBe(0);
        const parsed = JSON.parse(r.stdout);
        expect(Array.isArray(parsed)).toBe(true);
        const item = parsed.find((e: any) => e.path === 'docs/guide.md');
        expect(item).toBeDefined();
        expect(item).toHaveProperty('path');
        expect(item).toHaveProperty('sizeBytes');
        expect(item).toHaveProperty('lastModified');
        expect(item).toHaveProperty('frontmatter');
    });

    it('--dir narrows results to that subdirectory', async () => {
        await writeDoc('README.md', '# Root');
        await writeDoc('docs/guide.md', '# Guide');
        await writeDoc('other/note.md', '# Note');
        const r = run(['docs', 'list', '--dir', 'docs']);
        expect(r.stdout).toMatch(/docs\/guide\.md/);
        expect(r.stdout).not.toMatch(/README\.md/);
        expect(r.stdout).not.toMatch(/other\/note\.md/);
    });

    it('--pattern narrows by filename substring', async () => {
        await writeDoc('docs/guide.md', '# Guide');
        await writeDoc('docs/changelog.md', '# Changelog');
        const r = run(['docs', 'list', '--pattern', 'guide']);
        expect(r.stdout).toMatch(/guide\.md/);
        expect(r.stdout).not.toMatch(/changelog\.md/);
    });

    it('--filter type=service returns only matching files', async () => {
        await writeDoc('docs/a.md', '---\ntype: service\n---\n');
        await writeDoc('docs/b.md', '---\ntype: guide\n---\n');
        const r = run(['docs', 'list', '--filter', 'type=service']);
        expect(r.stdout).toMatch(/a\.md/);
        expect(r.stdout).not.toMatch(/b\.md/);
    });

    it('footer shows total file count', async () => {
        await writeDoc('docs/a.md', '# A');
        await writeDoc('docs/b.md', '# B');
        const r = run(['docs', 'list']);
        expect(r.stdout).toMatch(/2 files/);
    });

    it('--no-cache forces fresh scan (no "(cached)" in footer)', async () => {
        await writeDoc('docs/guide.md', '# Guide');
        // Prime the cache
        run(['docs', 'list']);
        // Second call with --no-cache
        const r = run(['docs', 'list', '--no-cache']);
        expect(r.stdout).not.toMatch(/\(cached\)/);
    });

    it('second invocation within TTL shows "(cached)" in footer', async () => {
        await writeDoc('docs/guide.md', '# Guide');
        run(['docs', 'list']); // prime cache
        const r = run(['docs', 'list']); // should hit cache
        expect(r.stdout).toMatch(/\(cached\)/);
    });
});
