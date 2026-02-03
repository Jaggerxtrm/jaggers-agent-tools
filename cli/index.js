#!/usr/bin/env node

import kleur from 'kleur';
import minimist from 'minimist';
import path from 'path';
import { fileURLToPath } from 'url';
import prompts from 'prompts';
import { getContext, resetContext } from './lib/context.js';
import { calculateDiff } from './lib/diff.js';
import { executeSync } from './lib/sync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const args = minimist(process.argv.slice(2));

function printDetails(title, items, colorFn) {
    if (items.length > 0) {
        console.log(colorFn(`\n  ${title}:`));
        items.forEach(item => console.log(colorFn(`    - ${item}`)));
    }
}

async function processTarget(targetDir, syncMode) {
    console.log(kleur.cyan().bold(`\nTarget: ${targetDir}`));
    
    const isClaude = targetDir.includes('.claude') || targetDir.includes('Claude');
    const isDryRun = !!args['dry-run'];

    if (isDryRun) {
        console.log(kleur.yellow().bold('  [DRY RUN MODE - No changes will be written to disk]'));
    }

    // 1. Scan/Diff
    console.log(kleur.gray('Scanning differences...'));
    const changeSet = await calculateDiff(repoRoot, targetDir);

    const categories = ['skills', 'hooks', 'config', 'commands'];

    const totalMissing = categories.reduce((sum, cat) => sum + changeSet[cat].missing.length, 0);
    const totalOutdated = categories.reduce((sum, cat) => sum + changeSet[cat].outdated.length, 0);
    const totalDrifted = categories.reduce((sum, cat) => sum + changeSet[cat].drifted.length, 0);

    // 2. Display Detailed Breakdown
    if (totalMissing === 0 && totalOutdated === 0 && totalDrifted === 0) {
        console.log(kleur.green('System is up to date.'));
    } else {
        console.log(kleur.bold('Analysis Results:'));
        
        // Missing (Green)
        const missingItems = [];
        categories.forEach(cat => {
            changeSet[cat].missing.forEach(item => {
                let prefix = cat;
                if (cat === 'commands') {
                    prefix = isClaude ? '.claude/commands' : '.gemini/commands';
                }
                missingItems.push(`${prefix}/${item}`);
            });
        });
        printDetails('[+] Missing in System (Will be Installed)', missingItems, kleur.green);

        // Outdated (Blue)
        const outdatedItems = [];
        categories.forEach(cat => {
            changeSet[cat].outdated.forEach(item => {
                let prefix = cat;
                if (cat === 'commands') {
                    prefix = isClaude ? '.claude/commands' : '.gemini/commands';
                }
                outdatedItems.push(`${prefix}/${item}`);
            });
        });
        printDetails('[^] Outdated in System (Will be Updated)', outdatedItems, kleur.blue);

        // Drifted (Magenta)
        const driftedItems = [];
        categories.forEach(cat => {
            changeSet[cat].drifted.forEach(item => {
                let prefix = cat;
                if (cat === 'commands') {
                    prefix = isClaude ? '.claude/commands' : '.gemini/commands';
                }
                driftedItems.push(`${prefix}/${item}`);
            });
        });
        printDetails('[<] Drifted / Locally Modified (Needs Backport or Manual Merge)', driftedItems, kleur.magenta);
        
        console.log(''); // spacer
    }

    // 3. Prompt for Action (Per Target)
    const actions = [];
    if (totalMissing > 0 || totalOutdated > 0) {
        actions.push({ title: 'Sync Repo -> System (Update/Install)', value: 'sync' });
    }
    if (totalDrifted > 0) {
        actions.push({ title: 'Backport System -> Repo (Save local changes)', value: 'backport' });
    }
    
    actions.push({ title: 'Skip this target', value: 'skip' });

    const response = await prompts({
        type: 'select',
        name: 'action',
        message: 'What would you like to do?',
        choices: actions
    });

    if (!response.action || response.action === 'skip') {
        console.log(kleur.gray('Skipping.'));
        return;
    }

    // Execute Sync/Backport
    console.log(kleur.gray('\nExecuting changes...'));
    const count = await executeSync(repoRoot, targetDir, changeSet, syncMode, response.action, isDryRun);
    
    console.log(kleur.green().bold(`\nSuccessfully processed ${count} items.`));
}

async function main() {
    console.log(kleur.cyan().bold('\nJaggers Agent Tools - Config Manager'));

    if (args.reset) {
        resetContext();
    }

    try {
        const context = await getContext();
        
        console.log(kleur.dim(`\nMode: ${context.syncMode}`));
        console.log(kleur.dim(`Selected Targets: ${context.targets.length}`));

        for (const target of context.targets) {
            await processTarget(target, context.syncMode);
        }

        console.log(kleur.gray('\nAll operations complete. Goodbye!'));

    } catch (err) {
        if (err.message === 'SIGINT') {
            console.log(kleur.yellow('\nExited.'));
        } else {
            console.error(kleur.red(`\nError: ${err.message}`));
        }
        process.exit(1);
    }
}

main();