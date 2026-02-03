import fs from 'fs-extra';

/**
 * Transform Claude settings.json to Gemini-compatible format
 * @param {Object} claudeConfig - The source configuration from the repo
 * @param {String} targetDir - The target directory (e.g., /home/user/.gemini)
 * @returns {Object} - The transformed Gemini configuration
 */
export function transformGeminiConfig(claudeConfig, targetDir) {
    const geminiConfig = {
        hooks: {}
    };

    // 1. Transform Hooks
    if (claudeConfig.hooks) {
        for (const [event, hooks] of Object.entries(claudeConfig.hooks)) {
            const geminiEvent = mapEventName(event);
            if (!geminiEvent) continue; // Skip unsupported events

            // Gemini expects an array of Hook Definitions
            geminiConfig.hooks[geminiEvent] = hooks.map(def => transformHookDefinition(def, targetDir));
        }
    }

    return geminiConfig;
}

/**
 * Map Claude event names to Gemini event names
 */
function mapEventName(claudeEvent) {
    const map = {
        'UserPromptSubmit': 'BeforeAgent',
        'PreToolUse': 'BeforeTool',
        'SessionStart': 'SessionStart',
    };
    return map[claudeEvent] || null;
}

/**
 * Transform a single Hook Definition
 */
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
 * @param {String} skillMdPath - Path to the SKILL.md file
 * @returns {String|null} - The TOML content or null if failed
 */
export async function transformSkillToCommand(skillMdPath) {
    try {
        const content = await fs.readFile(skillMdPath, 'utf8');
        
        // Extract frontmatter
        const frontmatterMatch = content.match(/^---([\s\S]+?)---/);
        if (!frontmatterMatch) return null;
        
        const frontmatter = frontmatterMatch[1];
        
        // Extract name and description
        const nameMatch = frontmatter.match(/name:\s*(.+)/);
        const descMatch = frontmatter.match(/description:\s*(.+)/);
        
        if (!nameMatch || !descMatch) return null;
        
        const name = nameMatch[1].trim();
        const description = descMatch[1].trim();
        
        // Construct TOML
        // We use triple quotes for both to be safe from nested quotes
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
