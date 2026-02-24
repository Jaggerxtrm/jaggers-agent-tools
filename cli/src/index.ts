import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';
import kleur from 'kleur';

// __dirname is available in CJS output (tsup target: cjs)
declare const __dirname: string;
let version = '0.0.0';
try { version = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')).version; } catch { /* fallback */ }

import { createSyncCommand } from './commands/sync.js';
import { createStatusCommand } from './commands/status.js';
import { createResetCommand } from './commands/reset.js';
import { createAddOptionalCommand } from './commands/add-optional.js';

const program = new Command();

program
    .name('jaggers-config')
    .description('Sync agent tools (skills, hooks, config, MCP servers) across AI environments')
    .version(version);

// Add exit override for cleaner unknown command error
program.exitOverride((err) => {
    if (err.code === 'commander.unknownCommand') {
        console.error(kleur.red(`\n✗ Unknown command. Run 'jaggers-config --help'\n`));
        process.exit(1);
    }
    // Let commander handle other errors normally
});

program.addCommand(createSyncCommand());
program.addCommand(createStatusCommand());
program.addCommand(createResetCommand());
program.addCommand(createAddOptionalCommand());

// Default action: run sync (for backwards compatibility)
program
    .action(async () => {
        // Delegate to sync command by default
        const syncCmd = createSyncCommand();
        await syncCmd.parseAsync([], { from: 'user' });
    });

// Global error handlers for clean error messages (unexpected errors only)
process.on('uncaughtException', (err) => {
    // Suppress commander errors (they're already handled)
    if ((err as any).code?.startsWith('commander.')) {
        return;
    }
    console.error(kleur.red(`\n✗ ${err.message}\n`));
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    console.error(kleur.red(`\n✗ ${String(reason)}\n`));
    process.exit(1);
});

// Show startup banner unless --help or --version flag is present
const isHelpOrVersion = process.argv.some(a => a === '--help' || a === '-h' || a === '--version' || a === '-V');
if (!isHelpOrVersion) {
    console.log(kleur.bold(`\n  jaggers-config`) + kleur.dim(` v${version}`));
    console.log(kleur.dim(`  Sync agent tools across AI environments\n`));
}

program.parseAsync(process.argv);
