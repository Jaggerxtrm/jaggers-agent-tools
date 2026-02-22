import { Command } from 'commander';
import kleur from 'kleur';

import { createSyncCommand } from './commands/sync.js';
import { createStatusCommand } from './commands/status.js';
import { createResetCommand } from './commands/reset.js';

const program = new Command();

program
    .name('jaggers-config')
    .description('Sync agent tools (skills, hooks, config, MCP servers) across AI environments')
    .version('1.2.0');

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

program.parseAsync(process.argv);
