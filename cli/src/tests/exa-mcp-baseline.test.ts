import fs from 'fs-extra';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const claudeConfig = path.join(repoRoot, '.xtrm', 'config', 'claude.mcp.json');
const piConfig = path.join(repoRoot, '.xtrm', 'config', 'pi.mcp.json');

const CURRENT_TOOLS = [
  'web_search_exa',
  'web_fetch_exa',
  'web_search_advanced_exa',
  'agent_run',
];

const RETIRED_TOOLS = [
  'deep_researcher_start',
  'crawling_exa',
  'get_code_context_exa',
];

describe('managed Exa MCP baseline', () => {
  it('ships the current Exa tool set for Claude without embedding credentials', async () => {
    const config = await fs.readJson(claudeConfig);
    const exa = config.mcpServers.exa;

    expect(exa.type).toBe('http');
    expect(exa.url).toContain('https://mcp.exa.ai/mcp?tools=');
    for (const tool of CURRENT_TOOLS) expect(exa.url).toContain(tool);
    for (const tool of RETIRED_TOOLS) expect(exa.url).not.toContain(tool);
    expect(JSON.stringify(exa)).not.toContain('EXA_API_KEY');
    expect(JSON.stringify(exa)).not.toContain('exaApiKey=');
  });

  it('ships Exa through the managed Pi MCP adapter with lazy lifecycle', async () => {
    const config = await fs.readJson(piConfig);
    const exa = config.mcpServers.exa;

    expect(exa.command).toBe('npx');
    expect(exa.args.slice(0, 2)).toEqual(['-y', 'pi-mcp-adapter']);
    expect(exa.lifecycle).toBe('lazy');
    expect(exa.idleTimeout).toBe(10);

    const endpoint = exa.args.at(-1);
    expect(endpoint).toContain('https://mcp.exa.ai/mcp?tools=');
    for (const tool of CURRENT_TOOLS) expect(endpoint).toContain(tool);
    for (const tool of RETIRED_TOOLS) expect(endpoint).not.toContain(tool);
    expect(JSON.stringify(exa)).not.toContain('EXA_API_KEY');
    expect(JSON.stringify(exa)).not.toContain('exaApiKey=');
  });
});
