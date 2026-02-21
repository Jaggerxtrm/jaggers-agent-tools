import { ToolAdapter } from './base.js';
import { ClaudeAdapter } from './claude.js';
import { GeminiAdapter } from './gemini.js';
import { QwenAdapter } from './qwen.js';

const adapters = new Map<string, typeof ToolAdapter>([
    ['claude-code', ClaudeAdapter as any],
    ['gemini', GeminiAdapter as any],
    ['qwen', QwenAdapter as any],
]);

export function getAdapter(toolName: string, baseDir: string): ToolAdapter {
    const AdapterClass = adapters.get(toolName);
    if (!AdapterClass) {
        throw new Error(`Unknown tool: ${toolName}`);
    }
    return new (AdapterClass as any)(baseDir);
}

export function detectAdapter(systemRoot: string): ToolAdapter | null {
    // Windows compatibility: Normalize backslashes before matching paths
    const normalized = systemRoot.replace(/\\/g, '/').toLowerCase();

    if (normalized.includes('.claude') || normalized.includes('/claude')) {
        return new ClaudeAdapter(systemRoot);
    }
    if (normalized.includes('.gemini') || normalized.includes('/gemini')) {
        return new GeminiAdapter(systemRoot);
    }
    if (normalized.includes('.qwen') || normalized.includes('/qwen')) {
        return new QwenAdapter(systemRoot);
    }

    return null;
}
