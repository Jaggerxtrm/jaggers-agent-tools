import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

// KAN-127 K4 / beads xtrm-ozknq.10.
//
// The K1 fixtures pin Codex's hook payload contract per runtime version. On
// 2026-08-12 the host moved 0.146.0 -> 0.147.0 to clear a startup interstitial
// that blocked `xt codex` (xtrm-7edzx), which left the pinned set describing a
// runtime nobody runs. These tests hold the compatibility claim that resulted,
// so the claim cannot rot into a comment: if a future bump changes the hook
// contract, the identity assertion fails and the parity matrix has to say so.
const FIXTURES = path.join(__dirname, 'fixtures/codex');
const BASE = '0.146.0';
const CURRENT = '0.147.0';

const dir = (v: string) => path.join(FIXTURES, v);
const schemaNames = (v: string) =>
    readdirSync(dir(v)).filter((f) => f.endsWith('.command.input.json') || f.endsWith('.command.output.json')).sort();

describe('Codex K1 fixture version compatibility', () => {
    it('pins both the baseline and the currently installed runtime', () => {
        expect(existsSync(dir(BASE))).toBe(true);
        expect(existsSync(dir(CURRENT))).toBe(true);
    });

    it('covers the same 21 hook schema documents in both versions', () => {
        expect(schemaNames(CURRENT)).toEqual(schemaNames(BASE));
        expect(schemaNames(CURRENT)).toHaveLength(21);
    });

    // The load-bearing assertion. Equality here is what licenses reusing the
    // 0.146.0 characterization to reason about 0.147.0 behaviour.
    it('holds every hook schema byte-identical across the runtime bump', () => {
        for (const name of schemaNames(BASE)) {
            expect(
                readFileSync(path.join(dir(CURRENT), name), 'utf8'),
                `${name} diverged between ${BASE} and ${CURRENT}`,
            ).toBe(readFileSync(path.join(dir(BASE), name), 'utf8'));
        }
    });

    it('records the comparison in the manifest rather than only in prose', () => {
        const m = JSON.parse(readFileSync(path.join(dir(CURRENT), 'manifest.json'), 'utf8'));
        expect(m.runtime_version).toBe('codex-cli 0.147.0');
        expect(m.compatibility.compared_against).toBe(BASE);
        expect(m.compatibility.hook_schemas).toMatch(/^IDENTICAL\b/);
        expect(m.compatibility.live_rollout).toMatch(/^IDENTICAL for the exec surface\b/);
        expect(m.compatibility.session_mode_caveat).toMatch(/session-MODE differences/);
        expect(m.expected_file_count).toBe(21);
    });
});

describe('Codex 0.147.0 exec-surface rollout', () => {
    const load = (v: string) =>
        readFileSync(path.join(dir(v), 'live', `rollout-${v}.observed.jsonl`), 'utf8')
            .split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);

    const profile = (rs: Record<string, unknown>[]) => {
        const top = new Set<string>();
        const types = new Set<string>();
        const meta = new Set<string>();
        for (const r of rs) {
            Object.keys(r).forEach((k) => top.add(k));
            types.add(String(r.type));
            if (r.type === 'session_meta') {
                Object.keys((r.payload ?? {}) as object).forEach((k) => meta.add(k));
            }
        }
        return { top, types, meta };
    };

    // Both fixtures come from the same exec command, so this is a like-for-like
    // comparison. Comparing an exec rollout against an interactive one instead
    // produces false drift: interactive sessions carry 'ordinal', session_meta
    // 'git', and the 'compacted' record type regardless of runtime version.
    it('is shape-identical to the 0.146.0 exec rollout', () => {
        const b = profile(load(BASE));
        const c = profile(load(CURRENT));
        expect([...c.top].filter((k) => !b.top.has(k)), 'top-level keys added').toEqual([]);
        expect([...b.top].filter((k) => !c.top.has(k)), 'top-level keys removed').toEqual([]);
        expect([...c.types].filter((t) => !b.types.has(t)), 'record types added').toEqual([]);
        expect([...b.types].filter((t) => !c.types.has(t)), 'record types removed').toEqual([]);
        expect([...c.meta].filter((k) => !b.meta.has(k)), 'session_meta fields added').toEqual([]);
        expect([...b.meta].filter((k) => !c.meta.has(k)), 'session_meta fields removed').toEqual([]);
    });

    // parseCodexSessionMeta resolves a thread id from these fields. If a bump
    // ever drops them, xt codex loses exact resume, so pin them directly.
    it('keeps the identity fields the session parser depends on', () => {
        const meta = load(CURRENT).find((r) => r.type === 'session_meta');
        const payload = (meta?.payload ?? {}) as Record<string, unknown>;
        expect(typeof payload.session_id).toBe('string');
        expect(typeof payload.id).toBe('string');
        expect(payload.cli_version).toBe('0.147.0');
    });

    it('leaks no operator home path through either live fixture', () => {
        for (const v of [BASE, CURRENT]) {
            const f = path.join(dir(v), 'live', `rollout-${v}.observed.jsonl`);
            expect(readFileSync(f, 'utf8')).not.toMatch(/\/home\/[a-z0-9_-]+\//i);
        }
    });
});
