export interface Skill {
    name: string;
    description: string;
    content: string;
}

export interface Command {
    name: string;
    description: string;
    prompt: string;
}

export interface Hook {
    name?: string;
    type?: string;
    command?: string;
    script?: string;
    timeout?: number;
    events?: string[];
    matcher?: string;
}

export interface MCPServer {
    type?: 'stdio' | 'http' | 'sse';
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    serverUrl?: string;
    headers?: Record<string, string>;
    disabled?: boolean;
}

export interface SyncOptions {
    dryRun?: boolean;
    yes?: boolean;
    prune?: boolean;
}

export interface ManifestItem {
    type: 'skill' | 'hook' | 'config' | 'command';
    name: string;
    hash: string;
    lastSync: string;
    source: string;
}

export interface Manifest {
    version: string;
    lastSync: string;
    items: Record<string, ManifestItem>;
}
