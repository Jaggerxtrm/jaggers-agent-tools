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
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xtrm-docs-verify-'));
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

const TODAY = new Date().toISOString().slice(0, 10);
const FULL_FM = `---\ntitle: My Doc\ndescription: A description.\nupdated_at: ${TODAY}\ntype: guide\n---\n\nContent here.`;

describe('xtrm docs verify', () => {
    it('outputs "No documentation files found" for empty project', () => {
        const r = run(['docs', 'verify']);
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/No documentation files found/);
    });

    it('passes with exit 0 when all required fields are present', async () => {
        await writeDoc('docs/guide.md', FULL_FM);
        const r = run(['docs', 'verify']);
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/All docs pass frontmatter verification/);
    });

    it('exits 1 and reports error for missing title', async () => {
        await writeDoc('docs/guide.md', '---\ndescription: desc\nupdated_at: ${TODAY}\n---\n');
        const r = run(['docs', 'verify']);
        expect(r.status).toBe(1);
        expect(r.stdout).toMatch(/Missing required field: title/);
    });

    it('exits 1 and reports error for missing description', async () => {
        await writeDoc('docs/guide.md', '---\ntitle: T\nupdated_at: ${TODAY}\n---\n');
        const r = run(['docs', 'verify']);
        expect(r.status).toBe(1);
        expect(r.stdout).toMatch(/Missing required field: description/);
    });

    it('exits 1 and reports error for missing updated_at', async () => {
        await writeDoc('docs/guide.md', '---\ntitle: T\ndescription: D\n---\n');
        const r = run(['docs', 'verify']);
        expect(r.status).toBe(1);
        expect(r.stdout).toMatch(/Missing required field: updated_at/);
    });

    it('suggests --fix for missing updated_at', async () => {
        await writeDoc('docs/guide.md', '---\ntitle: T\ndescription: D\n---\n');
        const r = run(['docs', 'verify']);
        expect(r.stdout).toMatch(/--fix/);
    });

    it('--fix auto-adds updated_at to existing frontmatter', async () => {
        await writeDoc('docs/guide.md', '---\ntitle: T\ndescription: D\n---\n');
        const r = run(['docs', 'verify', '--fix']);
        expect(r.stdout).toMatch(/Auto-fixed/);
        const content = await fs.readFile(path.join(tmpDir, 'docs/guide.md'), 'utf8');
        expect(content).toMatch(/updated_at:/);
    });

    it('--fix auto-adds updated_at to file without frontmatter', async () => {
        await writeDoc('docs/guide.md', '# Just content\n');
        run(['docs', 'verify', '--fix']);
        const content = await fs.readFile(path.join(tmpDir, 'docs/guide.md'), 'utf8');
        expect(content).toMatch(/updated_at:/);
    });

    it('warns when updated_at is older than file mtime', async () => {
        // Use a past updated_at so drift is guaranteed
        await writeDoc('docs/guide.md', '---\ntitle: T\ndescription: D\nupdated_at: 2020-01-01\ntype: guide\n---\n');
        const r = run(['docs', 'verify']);
        expect(r.stdout).toMatch(/older than file mtime/);
    });

    it('warns for unknown type value', async () => {
        await writeDoc('docs/guide.md', '---\ntitle: T\ndescription: D\nupdated_at: ${TODAY}\ntype: foobar\n---\n');
        const r = run(['docs', 'verify']);
        expect(r.stdout).toMatch(/Unknown type.*foobar/);
    });

    it('does not warn for valid type values', async () => {
        for (const type of ['api', 'architecture', 'guide', 'overview', 'plan', 'reference']) {
            await writeDoc('docs/guide.md', `---\ntitle: T\ndescription: D\nupdated_at: ${TODAY}\ntype: ${type}\n---\n`);
            const r = run(['docs', 'verify']);
            expect(r.stdout).not.toMatch(/Unknown type/);
        }
    });

    it('warns for broken internal .md link', async () => {
        await writeDoc('docs/guide.md', `---\ntitle: T\ndescription: D\nupdated_at: ${TODAY}\n---\n\nSee [guide](docs/missing.md).`);
        const r = run(['docs', 'verify']);
        expect(r.stdout).toMatch(/Broken internal link/);
        expect(r.stdout).toMatch(/missing\.md/);
    });

    it('does not warn for valid internal .md link', async () => {
        await writeDoc('docs/intro.md', `---\ntitle: T\ndescription: D\nupdated_at: ${TODAY}\n---\n\nSee [guide](other.md).`);
        await writeDoc('docs/other.md', FULL_FM);
        const r = run(['docs', 'verify']);
        expect(r.stdout).not.toMatch(/Broken internal link/);
    });

    it('does not flag http or anchor links', async () => {
        await writeDoc('docs/guide.md', `---\ntitle: T\ndescription: D\nupdated_at: ${TODAY}\n---\n\n[ext](https://example.com) [anchor](#section).`);
        const r = run(['docs', 'verify']);
        expect(r.stdout).not.toMatch(/Broken internal link/);
    });

    it('--json outputs valid JSON with files, findings, autoFixed', async () => {
        await writeDoc('docs/guide.md', '---\ntitle: T\ndescription: D\n---\n');
        const r = run(['docs', 'verify', '--json']);
        expect(r.status).toBe(1);
        const parsed = JSON.parse(r.stdout);
        expect(parsed).toHaveProperty('files');
        expect(parsed).toHaveProperty('findings');
        expect(parsed).toHaveProperty('autoFixed');
        expect(Array.isArray(parsed.findings)).toBe(true);
    });

    it('--json exits 0 when no findings', async () => {
        await writeDoc('docs/guide.md', FULL_FM);
        const r = run(['docs', 'verify', '--json']);
        expect(r.status).toBe(0);
        const parsed = JSON.parse(r.stdout);
        expect(parsed.findings).toHaveLength(0);
    });

    it('filter narrows to matching filename', async () => {
        await writeDoc('docs/guide.md', FULL_FM);
        await writeDoc('docs/ref.md', '---\ntitle: G\n---\n'); // missing fields
        const r = run(['docs', 'verify', 'guide']);
        expect(r.status).toBe(0); // guide.md is valid
        expect(r.stdout).not.toMatch(/ref\.md/);
    });

    it('shows file count in header', async () => {
        await writeDoc('docs/guide.md', FULL_FM);
        await writeDoc('docs/ref.md', FULL_FM);
        const r = run(['docs', 'verify']);
        expect(r.stdout).toMatch(/2 files checked/);
    });

    it('shows error/warning summary line', async () => {
        await writeDoc('docs/guide.md', '---\ntitle: T\ndescription: D\n---\n');
        const r = run(['docs', 'verify']);
        expect(r.stdout).toMatch(/1 error/);
    });
});
