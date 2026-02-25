import { Command } from 'commander';
import kleur from 'kleur';

export function createAddOptionalCommand(): Command {
    return new Command('add-optional')
        .description('[deprecated] Use: jaggers-config sync — optional servers are now part of the main sync flow')
        .action(async () => {
            console.log(kleur.yellow(
                '\n⚠  add-optional is deprecated.\n' +
                '   Optional MCP servers are now part of the main sync flow.\n' +
                '   Run: jaggers-config sync\n'
            ));
        });
}
