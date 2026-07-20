import { describe, it, expect } from 'vitest';
import { collectVersionInfo, createVersionCommand } from '../commands/version.js';

describe('xt version', () => {
    it('collectVersionInfo returns the required fields with correct shape', () => {
        const info = collectVersionInfo();
        expect(info.package).toBe('xtrm-tools');
        expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
        expect(info.source === 'npm' || info.source === 'local').toBe(true);
        expect(info.runtime.node).toMatch(/^\d+\.\d+\.\d+/);
        expect(info.commit === null || typeof info.commit === 'string').toBe(true);
        expect(info.dirty === null || typeof info.dirty === 'boolean').toBe(true);
        expect(info.built_at === null || typeof info.built_at === 'string').toBe(true);
    });

    it('creates a commander Command with --json option', () => {
        const cmd = createVersionCommand();
        expect(cmd.name()).toBe('version');
        const opts = cmd.options.map((o) => o.long);
        expect(opts).toContain('--json');
    });

    it('--json emits a valid single-line JSON envelope', async () => {
        // Capture process.stdout.write directly (commander's action is sync here).
        const chunks: string[] = [];
        const originalWrite = process.stdout.write.bind(process.stdout);
        // @ts-ignore
        process.stdout.write = (chunk: string) => {
            chunks.push(chunk);
            return true;
        };
        try {
            const cmd = createVersionCommand();
            await cmd.parseAsync(['node', 'version', '--json']);
        } finally {
            process.stdout.write = originalWrite;
        }
        const output = chunks.join('');
        expect(output.trim().split('\n').length).toBe(1);
        const parsed = JSON.parse(output);
        expect(parsed.package).toBe('xtrm-tools');
        expect(parsed.runtime.node).toBeTypeOf('string');
    });

    it('human default emits multi-line block with package + node runtime', async () => {
        const chunks: string[] = [];
        const originalWrite = process.stdout.write.bind(process.stdout);
        // @ts-ignore
        process.stdout.write = (chunk: string) => {
            chunks.push(chunk);
            return true;
        };
        try {
            const cmd = createVersionCommand();
            await cmd.parseAsync(['node', 'version']);
        } finally {
            process.stdout.write = originalWrite;
        }
        const output = chunks.join('');
        expect(output).toMatch(/xtrm-tools/);
        expect(output).toMatch(/node\s/);
        expect(output.split('\n').length).toBeGreaterThan(1);
    });
});
