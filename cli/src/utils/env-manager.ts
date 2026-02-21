import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import kleur from 'kleur';
import dotenv from 'dotenv';

/**
 * Environment file location: ~/.config/jaggers-agent-tools/.env
 */
const CONFIG_DIR = path.join(os.homedir(), '.config', 'jaggers-agent-tools');
const ENV_FILE = path.join(CONFIG_DIR, '.env');
const ENV_EXAMPLE_FILE = path.join(CONFIG_DIR, '.env.example');

interface EnvVarConfig {
    description: string;
    example: string;
    getUrl: () => string;
}

/**
 * Required environment variables for MCP servers
 */
const REQUIRED_ENV_VARS: Record<string, EnvVarConfig> = {
    CONTEXT7_API_KEY: {
        description: 'Context7 MCP server API key',
        example: 'ctx7sk-your-api-key-here',
        getUrl: () => 'https://context7.com/',
    },
};

/**
 * Ensure config directory and .env file exist
 */
export function ensureEnvFile(): boolean {
    // Create config directory if missing
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.ensureDirSync(CONFIG_DIR);
        console.log(kleur.gray(`  Created config directory: ${CONFIG_DIR}`));
    }

    // Create .env.example if missing
    if (!fs.existsSync(ENV_EXAMPLE_FILE)) {
        createEnvExample();
    }

    // Create .env if missing
    if (!fs.existsSync(ENV_FILE)) {
        createEnvFile();
        return false; // File was created (user needs to fill it)
    }

    return true; // File already exists
}

function createEnvExample(): void {
    const content = [
        '# Jaggers Agent Tools - Environment Variables',
        '# Copy this file to .env and fill in your actual values',
        '',
        ...Object.entries(REQUIRED_ENV_VARS).map(([key, config]) => {
            return [
                `# ${config.description}`,
                `# Get your key from: ${config.getUrl()}`,
                `${key}=${config.example}`,
                '',
            ].join('\n');
        }),
        '# See config/.env.example in the repository for all available options',
        '',
    ].join('\n');

    fs.writeFileSync(ENV_EXAMPLE_FILE, content);
    console.log(kleur.gray(`  Created example file: ${ENV_EXAMPLE_FILE}`));
}

function createEnvFile(): void {
    const content = [
        '# Jaggers Agent Tools - Environment Variables',
        '# Generated automatically by jaggers-agent-tools CLI',
        '',
        '# Copy values from .env.example and fill in your actual keys',
        '',
    ].join('\n');

    fs.writeFileSync(ENV_FILE, content);
    console.log(kleur.green(`  Created environment file: ${ENV_FILE}`));
}

/**
 * Load environment variables from .env file
 * Also loads from process.env (which takes precedence)
 */
export function loadEnvFile(): Record<string, string> {
    if (fs.existsSync(ENV_FILE)) {
        const envConfig = dotenv.parse(fs.readFileSync(ENV_FILE));

        // Merge with process.env (process.env takes precedence)
        for (const [key, value] of Object.entries(envConfig)) {
            if (!process.env[key]) {
                process.env[key] = value;
            }
        }

        return envConfig;
    }

    return {};
}

/**
 * Check if required environment variables are set
 * Returns array of missing variable names
 */
export function checkRequiredEnvVars(): string[] {
    const missing: string[] = [];

    for (const [key] of Object.entries(REQUIRED_ENV_VARS)) {
        if (!process.env[key]) {
            missing.push(key);
        }
    }

    return missing;
}

/**
 * Prompt user about missing environment variables
 * Returns true if user wants to proceed anyway
 */
export function handleMissingEnvVars(missing: string[]): boolean {
    if (missing.length === 0) {
        return true;
    }

    console.log(kleur.yellow('\n  ⚠️  Missing environment variables:'));
    for (const key of missing) {
        const config = REQUIRED_ENV_VARS[key];
        console.log(kleur.yellow(`    - ${key}: ${config.description}`));
        console.log(kleur.dim(`      Get your key from: ${config.getUrl()}`));
    }

    console.log(kleur.yellow(`\n  Please edit: ${ENV_FILE}`));
    console.log(kleur.gray(`  Or copy from example: ${ENV_EXAMPLE_FILE}`));

    return false; // Don't proceed automatically
}

export function getEnvFilePath(): string {
    return ENV_FILE;
}

export function getConfigDir(): string {
    return CONFIG_DIR;
}
