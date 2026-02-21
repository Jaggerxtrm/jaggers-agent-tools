#!/usr/bin/env node
import { Command } from 'commander';
import { createSyncCommand } from './commands/sync.js';
import { createStatusCommand } from './commands/status.js';
import { createResetCommand } from './commands/reset.js';

const program = new Command();

program
    .name('jaggers-config')
    .description('Sync agent tools (skills, hooks, config, MCP servers) across AI environments')
    .version('1.2.0');

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

program.parseAsync(process.argv);
