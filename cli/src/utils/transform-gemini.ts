import fs from 'fs-extra';
import { Hook } from '../types/models.js';

/**
 * Transform Claude settings.json to Gemini-compatible format
 */
export function transformGeminiConfig(claudeConfig: any, targetDir: string): any {
    const geminiConfig: any = {
        hooks: {}
    };

    if (claudeConfig.hooks) {
        for (const [event, hooks] of Object.entries(claudeConfig.hooks)) {
            const geminiEvent = mapEventName(event);
            if (!geminiEvent) continue;
            geminiConfig.hooks[geminiEvent] = (hooks as any[]).map(def => transformHookDefinition(def, targetDir));
        }
    }

    return geminiConfig;
}

function mapEventName(claudeEvent: string): string | null {
    const map: Record<string, string> = {
        'UserPromptSubmit': 'BeforeAgent',
        'PreToolUse': 'BeforeTool',
        'SessionStart': 'SessionStart',
    };
    return map[claudeEvent] || null;
}

function transformHookDefinition(claudeDef: any, targetDir: string): any {
    const geminiDef: any = {
        hooks: []
    };

    if (claudeDef.matcher) {
        let matcher = claudeDef.matcher;
        const toolMap = {
            'Read': 'read_file',
            'Write': 'write_file',
            'Edit': 'replace',
            'Bash': 'run_shell_command'
        };

        for (const [claudeTool, geminiTool] of Object.entries(toolMap)) {
            const regex = new RegExp(`\\b${claudeTool}\\b`, 'g');
            matcher = matcher.replace(regex, geminiTool);
        }

        geminiDef.matcher = matcher;
    }

    geminiDef.hooks = claudeDef.hooks.map((h: any, index: number) => {
        let newCommand = h.command;
        if (targetDir) {
            const claudePathRegex = /(\/[^\s"']+\.claude)/g;
            newCommand = newCommand.replace(claudePathRegex, ` ${targetDir}`);
        }

        return {
            name: h.name || `generated-hook-${index}`,
            type: "command",
            command: newCommand,
            timeout: h.timeout || 60000
        };
    });

    return geminiDef;
}

export interface TransformResult {
    toml: string;
    commandName: string;
}

/**
 * Transform a SKILL.md file into a Gemini command .toml content
 */
export async function transformSkillToCommand(skillMdPath: string): Promise<TransformResult | null> {
    try {
        const content = await fs.readFile(skillMdPath, 'utf8');

        // Extract frontmatter
        const frontmatterMatch = content.match(/^---([\s\S]+?)---/);
        if (!frontmatterMatch) return null;

        const frontmatter = frontmatterMatch[1];

        // Extract required and optional fields
        const nameMatch = frontmatter.match(/name:\s*(.+)/);
        const descMatch = frontmatter.match(/description:\s*(.+)/);
        const geminiCmdMatch = frontmatter.match(/gemini-command:\s*(.+)/);
        const geminiPromptMatch = frontmatter.match(/gemini-prompt:\s*\|?\s*\n?([\s\S]+?)(?=\n[a-z- ]+:|$)/);

        if (!nameMatch || !descMatch) return null;

        const name = nameMatch[1].trim();
        const description = descMatch[1].trim();
        const commandName = geminiCmdMatch ? geminiCmdMatch[1].trim() : name;

        let promptBody = `Use the ${name} skill to handle this: {{args}}`;
        if (geminiPromptMatch) {
            const extraLines = geminiPromptMatch[1].trim();
            promptBody = `Use the ${name} skill to handle this request: {{args}}\n\n${extraLines}`;
        }

        const toml = `description = """${description}"""
prompt = """
${promptBody}
"""
`;
        return {
            toml,
            commandName
        };
    } catch (error: any) {
        console.error(`Error transforming skill to command: ${error.message}`);
        return null;
    }
}
