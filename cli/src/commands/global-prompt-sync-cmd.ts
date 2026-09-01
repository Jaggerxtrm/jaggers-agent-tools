import { Command } from 'commander';
import { printGlobalPromptSyncSummary, syncGlobalPrompts } from '../core/global-prompt-sync.js';

/**
 * Minimal diagnostic entry that runs the global prompt sync on both targets.
 * Hidden (underscore-prefixed, not advertised in help) and used by the
 * package-bin smoke test to exercise the shipped bundle end to end against a
 * fixture; the same sync is invoked by `xt update --apply` and `pi install`.
 */
export function createGlobalPromptSyncCommand(): Command {
  return new Command('_global-prompt-sync')
    .description('Run the ownership-safe global prompt sync (internal diagnostic)')
    .option('--dry-run', 'Preview changes without writing', false)
    .action(async (opts: { dryRun: boolean }) => {
      const result = await syncGlobalPrompts({ dryRun: opts.dryRun });
      printGlobalPromptSyncSummary(result);
    });
}
