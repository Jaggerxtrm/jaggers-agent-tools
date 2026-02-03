import fs from 'fs-extra';

/**
 * Transform Claude settings.json to Gemini-compatible format
 */
export function transformGeminiConfig(claudeConfig, targetDir) {
    const geminiConfig = {
        hooks: {}
    };

    if (claudeConfig.hooks) {
        for (const [event, hooks] of Object.entries(claudeConfig.hooks)) {
            const geminiEvent = mapEventName(event);
            if (!geminiEvent) continue;
            geminiConfig.hooks[geminiEvent] = hooks.map(def => transformHookDefinition(def, targetDir));
        }
    }

    return geminiConfig;
}

function mapEventName(claudeEvent) {
    const map = {
        'UserPromptSubmit': 'BeforeAgent',
        'PreToolUse': 'BeforeTool',
        'SessionStart': 'SessionStart',
    };
    return map[claudeEvent] || null;
}

function transformHookDefinition(claudeDef, targetDir) {
    const geminiDef = {
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

    geminiDef.hooks = claudeDef.hooks.map((h, index) => {
        const cmd = h.command;
        let newCommand = cmd;
        if (targetDir) {
             const claudePathRegex = /(\/[^\s"']+\.claude)/g;
             newCommand = newCommand.replace(claudePathRegex, (match) => {
                 return targetDir;
             });
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

/**
 * Transform a SKILL.md file into a Gemini command .toml content
 */
export async function transformSkillToCommand(skillMdPath) {
    try {
        const content = await fs.readFile(skillMdPath, 'utf8');
        const frontmatterMatch = content.match(/^---([\s\S]+?)---/);
        if (!frontmatterMatch) return null;
        
        const frontmatter = frontmatterMatch[1];
        const nameMatch = frontmatter.match(/name:\s*(.+)/);
        const descMatch = frontmatter.match(/description:\s*(.+)/);
        
        if (!nameMatch || !descMatch) return null;
        
        const name = nameMatch[1].trim();
        const description = descMatch[1].trim();
        
        const toml = `description = """${description}"""
prompt = """
Use the ${name} skill to handle this: {{args}}
"""
`;
        return toml;
    } catch (error) {
        console.error(`Error transforming skill to command: ${error.message}`);
        return null;
    }
}

/**
 * Transform a SKILL.md file into a Claude command .md content
 */
export async function transformSkillToClaudeCommand(skillMdPath) {
    try {
        const content = await fs.readFile(skillMdPath, 'utf8');
        const frontmatterMatch = content.match(/^---([\s\S]+?)---/);
        if (!frontmatterMatch) return null;
        
        const frontmatter = frontmatterMatch[1];
        const nameMatch = frontmatter.match(/name:\s*(.+)/);
        const descMatch = frontmatter.match(/description:\s*(.+)/);
        
        if (!nameMatch || !descMatch) return null;
        
        const name = nameMatch[1].trim();
        const description = descMatch[1].trim();
        
        const md = `# ${name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, ' ')}

${description}

## Usage

Use the ${name} skill to handle this: {{args}}
`;
        return md;
    } catch (error) {
        console.error(`Error transforming skill to Claude command: ${error.message}`);
        return null;
    }
}