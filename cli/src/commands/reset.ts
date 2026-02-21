import { Command } from 'commander';
import kleur from 'kleur';
import { resetContext } from '../core/context.js';

export function createResetCommand(): Command {
    return new Command('reset')
        .description('Reset CLI configuration (clears saved sync mode and preferences)')
        .action(() => {
            resetContext();
            console.log(kleur.green('✓ Configuration reset. Run sync again to reconfigure.'));
        });
}
