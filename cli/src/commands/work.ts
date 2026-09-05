import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kleur from 'kleur';
import { resolvePackageRoot } from '../core/registry-scaffold.js';

type BdResult = {
    ok: boolean;
    stdout: string;
    stderr: string;
    status: number;
};

export type BdRunner = (args: string[], cwd: string) => BdResult;

export interface WorkCommandDeps {
    runBd?: BdRunner;
    cwd?: () => string;
    packageRoot?: () => string;
}

function defaultBdRunner(args: string[], cwd: string): BdResult {
    const result = spawnSync('bd', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
    return {
        ok: result.status === 0,
        stdout: (result.stdout ?? '').trim(),
        stderr: (result.stderr ?? '').trim(),
        status: result.status ?? 1,
    };
}

export function buildLightweightWorkDescription(title: string, validation?: string): string {
    return [
        'WORK',
        title.trim(),
        '',
        'VALIDATION',
        validation?.trim() || 'Record the concrete validation/evidence before closing.',
        '',
        'EXECUTION',
        'Lightweight XTRM execution check-in. If scope becomes substantial, ambiguous, or consumable by another worker, run /planning and promote or replace this with a contract-quality Bead.',
    ].join('\n');
}

export function parseCreatedBeadId(stdout: string): string | null {
    try {
        const parsed = JSON.parse(stdout) as { id?: unknown };
        return typeof parsed.id === 'string' && parsed.id.length > 0 ? parsed.id : null;
    } catch {
        return null;
    }
}

export function selectSingleActiveBeadId(stdout: string): string | null {
    try {
        const parsed = JSON.parse(stdout) as unknown;
        const rows = Array.isArray(parsed)
            ? parsed
            : (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { issues?: unknown }).issues)
                ? (parsed as { issues: unknown[] }).issues
                : []);
        const ids = rows
            .map(row => (typeof row === 'object' && row !== null ? (row as { id?: unknown }).id : null))
            .filter((id): id is string => typeof id === 'string' && id.length > 0);
        return ids.length === 1 ? ids[0] : null;
    } catch {
        return null;
    }
}

function resolveActiveBead(runBd: BdRunner, cwd: string): string {
    const listed = runBd(['list', '--status=in_progress', '--json'], cwd);
    if (!listed.ok) {
        throw new Error(`Unable to inspect active work: ${listed.stderr || listed.stdout}`);
    }
    const id = selectSingleActiveBeadId(listed.stdout);
    if (!id) {
        throw new Error('No unambiguous active Bead. Pass --bead <id> explicitly.');
    }
    return id;
}

function runOrThrow(runBd: BdRunner, args: string[], cwd: string, action: string): BdResult {
    const result = runBd(args, cwd);
    if (!result.ok) {
        throw new Error(`${action} failed: ${result.stderr || result.stdout || `bd exited ${result.status}`}`);
    }
    return result;
}

function emitJson(value: unknown): void {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function createWorkCommand(deps: WorkCommandDeps = {}): Command {
    const runBd = deps.runBd ?? defaultBdRunner;
    const cwdProvider = deps.cwd ?? (() => process.cwd());
    const packageRootProvider = deps.packageRoot ?? resolvePackageRoot;

    const work = new Command('work')
        .description('Manage XTRM durable execution identity and progress without exposing Beads mechanics');

    work
        .command('guide')
        .description('Print the packaged XTRM work lifecycle contract')
        .action(async () => {
            const guidePath = path.join(packageRootProvider(), '.xtrm', 'config', 'work-lifecycle.md');
            const content = await fs.readFile(guidePath, 'utf8');
            process.stdout.write(content.endsWith('\n') ? content : `${content}\n`);
        });

    work
        .command('start')
        .description('Claim existing tracked work or create+claim a lightweight execution check-in')
        .argument('[title]', 'Short title when creating lightweight work')
        .option('--bead <id>', 'Claim an existing Bead instead of creating one')
        .option('--validation <text>', 'Concrete validation/evidence expected for lightweight work')
        .option('--relates <ids...>', 'Create non-blocking relations to existing issue(s)')
        .option('--priority <priority>', 'Beads priority for lightweight work', '2')
        .option('--type <type>', 'Beads issue type for lightweight work', 'task')
        .option('--json', 'Emit structured output', false)
        .action((title: string | undefined, opts: {
            bead?: string;
            validation?: string;
            relates?: string[];
            priority: string;
            type: string;
            json: boolean;
        }) => {
            const cwd = cwdProvider();
            if (opts.bead && title) {
                throw new Error('Use either `xt work start --bead <id>` or `xt work start "<title>"`, not both.');
            }

            let beadId = opts.bead;
            let created = false;

            if (!beadId) {
                if (!title?.trim()) {
                    throw new Error('A title is required when creating lightweight work.');
                }
                const description = buildLightweightWorkDescription(title, opts.validation);
                const create = runOrThrow(runBd, [
                    'create',
                    '--type', opts.type,
                    '--priority', opts.priority,
                    '--title', title.trim(),
                    '--description', description,
                    '--json',
                ], cwd, 'create work');
                beadId = parseCreatedBeadId(create.stdout) ?? undefined;
                if (!beadId) {
                    throw new Error(`create work failed: unable to parse Bead id from: ${create.stdout}`);
                }
                created = true;

                for (const related of opts.relates ?? []) {
                    runOrThrow(runBd, ['dep', 'relate', beadId, related], cwd, `relate ${beadId} to ${related}`);
                }
            }

            runOrThrow(runBd, ['update', beadId, '--claim', '--json'], cwd, `claim ${beadId}`);

            if (opts.json) {
                emitJson({ schema: 'xt.work.start.v1', ok: true, bead: beadId, created, relates: opts.relates ?? [] });
            } else {
                console.log(kleur.green(`✓ work ${created ? 'created + claimed' : 'claimed'}: ${beadId}`));
                console.log(kleur.dim('  progress: xt work note "<meaningful progress>" --bead ' + beadId));
                console.log(kleur.dim('  lifecycle: xt work guide'));
            }
        });

    work
        .command('resume')
        .description('Resume existing durable work by claiming its Bead')
        .argument('<id>', 'Bead id')
        .option('--json', 'Emit structured output', false)
        .action((id: string, opts: { json: boolean }) => {
            const cwd = cwdProvider();
            runOrThrow(runBd, ['update', id, '--claim', '--json'], cwd, `resume ${id}`);
            if (opts.json) emitJson({ schema: 'xt.work.resume.v1', ok: true, bead: id });
            else console.log(kleur.green(`✓ work resumed: ${id}`));
        });

    work
        .command('status')
        .description('Show one work item or current in-progress work')
        .argument('[id]', 'Optional Bead id')
        .option('--json', 'Emit Beads JSON when available', false)
        .action((id: string | undefined, opts: { json: boolean }) => {
            const cwd = cwdProvider();
            const args = id
                ? ['show', id, ...(opts.json ? ['--json'] : [])]
                : ['list', '--status=in_progress', ...(opts.json ? ['--json'] : [])];
            const result = runOrThrow(runBd, args, cwd, 'work status');
            process.stdout.write(`${result.stdout}\n`);
        });

    work
        .command('note')
        .description('Append meaningful progress to the durable work journal')
        .argument('<message...>', 'Progress, blocker, evidence, or scope transition')
        .option('--bead <id>', 'Bead id; omitted only when exactly one Bead is in progress')
        .option('--json', 'Emit structured output', false)
        .action((messageParts: string[], opts: { bead?: string; json: boolean }) => {
            const cwd = cwdProvider();
            const beadId = opts.bead ?? resolveActiveBead(runBd, cwd);
            const message = messageParts.join(' ').trim();
            if (!message) throw new Error('Progress note cannot be empty.');
            runOrThrow(runBd, ['update', beadId, '--append-notes', message, '--json'], cwd, `note ${beadId}`);
            if (opts.json) emitJson({ schema: 'xt.work.note.v1', ok: true, bead: beadId, note: message });
            else console.log(kleur.green(`✓ progress recorded: ${beadId}`));
        });

    work
        .command('done')
        .description('Close durable work through the current Beads lifecycle; never bypasses gates')
        .argument('[id]', 'Bead id; omitted only when exactly one Bead is in progress')
        .requiredOption('--reason <text>', 'Validated result or truthful terminal reason')
        .option('--json', 'Emit structured output', false)
        .action((id: string | undefined, opts: { reason: string; json: boolean }) => {
            const cwd = cwdProvider();
            const beadId = id ?? resolveActiveBead(runBd, cwd);
            const result = runOrThrow(runBd, ['close', beadId, `--reason=${opts.reason}`], cwd, `close ${beadId}`);
            if (opts.json) emitJson({ schema: 'xt.work.done.v1', ok: true, bead: beadId, reason: opts.reason, output: result.stdout });
            else {
                console.log(kleur.green(`✓ work closed: ${beadId}`));
                if (result.stdout) console.log(kleur.dim(result.stdout));
            }
        });

    work.addHelpText('after', [
        '',
        'Doctrine:',
        '  Every repository mutation belongs to a claimed durable work identity.',
        '  Use /planning before substantial, ambiguous, or multi-worker work.',
        '  Use `xt work guide` for the packaged lifecycle contract.',
    ].join('\n'));

    return work;
}
