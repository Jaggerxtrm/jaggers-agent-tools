// @ts-ignore
import prompts from 'prompts';
import kleur from 'kleur';
import type { PreflightPlan, TargetPlan, OptionalServerItem } from './preflight.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface SelectedFileItem {
    target: string;
    name: string;
    status: 'missing' | 'outdated' | 'drifted';
    category: string;
}

export interface SelectedMcpItem {
    target: string;
    agent: string;
    name: string;
}

export interface SelectedPlan {
    files: SelectedFileItem[];
    mcpCore: SelectedMcpItem[];
    optionalServers: OptionalServerItem[];
    repoRoot: string;
    syncMode: 'copy' | 'symlink';
}

// ── Helpers ────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
    missing:  kleur.green('[+]'),
    outdated: kleur.blue('[↑]'),
    drifted:  kleur.red('[~]'),
};

function fileChoices(target: TargetPlan): any[] {
    if (target.files.length === 0) return [];
    const choices: any[] = [
        { title: kleur.bold().dim(`  ── ${target.label} files ──`), disabled: true, value: null },
    ];
    for (const f of target.files) {
        const label = STATUS_LABEL[f.status] ?? '[?]';
        const hint = f.status === 'drifted' ? kleur.dim(' local edits — skip recommended') : '';
        choices.push({
            title: `  ${label} ${f.category}/${f.name}${hint}`,
            value: { type: 'file', target: target.target, name: f.name, status: f.status, category: f.category },
            selected: f.status !== 'drifted',
        });
    }
    return choices;
}

function mcpCoreChoices(target: TargetPlan): any[] {
    const uninstalled = target.mcpCore.filter(m => !m.installed);
    const installed   = target.mcpCore.filter(m => m.installed);
    if (target.mcpCore.length === 0) return [];

    const choices: any[] = [
        { title: kleur.bold().dim(`  ── ${target.label} MCP servers ──`), disabled: true, value: null },
    ];
    for (const m of uninstalled) {
        choices.push({
            title: `  ${kleur.green('[+]')} ${m.name}`,
            value: { type: 'mcp-core', target: target.target, agent: target.agent, name: m.name },
            selected: true,
        });
    }
    for (const m of installed) {
        choices.push({
            title: kleur.dim(`  [=] ${m.name}  (already installed)`),
            disabled: true,
            value: null,
        });
    }
    return choices;
}

function optionalChoices(optionalServers: OptionalServerItem[]): any[] {
    if (optionalServers.length === 0) return [];
    const choices: any[] = [
        { title: kleur.bold().dim('  ── optional servers ──'), disabled: true, value: null },
    ];
    for (const s of optionalServers) {
        const prereq = s.prerequisite ? kleur.yellow(` ⚠ ${s.prerequisite}`) : '';
        choices.push({
            title: `  ${kleur.yellow('[?]')} ${s.name}${prereq}`,
            value: { type: 'mcp-optional', server: s },
            selected: false,
        });
    }
    return choices;
}

// ── Main export ────────────────────────────────────────────────────────────

export async function interactivePlan(
    plan: PreflightPlan,
    opts: { dryRun?: boolean; yes?: boolean } = {}
): Promise<SelectedPlan | null> {
    const allChoices = [
        ...plan.targets.flatMap(t => [...fileChoices(t), ...mcpCoreChoices(t)]),
        ...optionalChoices(plan.optionalServers),
    ].filter(c => c.title); // remove any undefined entries

    const totalSelectable = allChoices.filter(c => !c.disabled && c.value !== null).length;

    if (totalSelectable === 0) {
        console.log(kleur.green('\n✓ Everything is up-to-date\n'));
        return { files: [], mcpCore: [], optionalServers: [], repoRoot: plan.repoRoot, syncMode: plan.syncMode };
    }

    console.log(kleur.bold('\n📋 Sync Plan') + kleur.dim('  (space to toggle, a = all, enter to confirm)\n'));

    if (opts.dryRun) {
        // Just display, don't prompt
        for (const c of allChoices) {
            if (c.disabled) { console.log(kleur.dim(c.title)); continue; }
            const bullet = c.selected ? '◉' : '◯';
            console.log(`  ${bullet} ${c.title?.trim()}`);
        }
        console.log(kleur.cyan('\n💡 Dry run — no changes written\n'));
        return null;
    }

    if (opts.yes) {
        // Select all pre-selected defaults, skip prompt
        const selected = allChoices.filter(c => !c.disabled && c.selected && c.value).map(c => c.value);
        return buildSelectedPlan(selected, plan);
    }

    const response = await prompts({
        type: 'multiselect',
        name: 'selected',
        message: 'Select items to sync:',
        choices: allChoices,
        hint: 'space to toggle · a = all · enter to confirm',
        instructions: false,
        min: 0,
    });

    // ctrl+c returns undefined
    if (!response || response.selected === undefined) {
        console.log(kleur.gray('\n  Cancelled.\n'));
        return null;
    }

    return buildSelectedPlan(response.selected, plan);
}

function buildSelectedPlan(selected: any[], plan: PreflightPlan): SelectedPlan {
    const files: SelectedFileItem[] = selected
        .filter(v => v?.type === 'file')
        .map(v => ({ target: v.target, name: v.name, status: v.status, category: v.category }));

    const mcpCore: SelectedMcpItem[] = selected
        .filter(v => v?.type === 'mcp-core')
        .map(v => ({ target: v.target, agent: v.agent, name: v.name }));

    const optionalServers: OptionalServerItem[] = selected
        .filter(v => v?.type === 'mcp-optional')
        .map(v => v.server);

    return { files, mcpCore, optionalServers, repoRoot: plan.repoRoot, syncMode: plan.syncMode };
}
