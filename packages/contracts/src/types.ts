// Hand-authored TypeScript types mirroring the JSON Schemas under ../schemas.
// The JSON Schema files are the source of truth; these mirror them for
// consumers who want compile-time shapes. Keep them in sync when a schema
// changes (the fixture test guards the schema<->fixture agreement, not this).

/** Canonical schema ids shipped by this package. */
export const SCHEMA_ID = {
    runtimeCompatibility: 'xtrm.runtime-compatibility.v1',
    interactiveRoleEnvelope: 'xtrm.interactive-role-envelope.v1',
    piExtensionManifest: 'xtrm.pi-extension-manifest.v1',
    commandDeprecations: 'xtrm.command-deprecations.v1',
    runtimeMatrix: 'xtrm.runtime-matrix.v1',
    runtimeOrigin: 'xtrm.runtime-origin.v1',
    branchIntegration: 'xtrm.branch.integration.v1',
    xtmuxTopology: 'xtrm.xtmux.topology.v1',
    xtmuxMessage: 'xtrm.xtmux.message.v1',
    xtmuxObligation: 'xtrm.xtmux.obligation.v1',
    xtmuxMonitor: 'xtrm.xtmux.monitor.v1',
    xtmuxWait: 'xtrm.xtmux.wait.v1',
    xtmuxBridge: 'xtrm.xtmux.bridge.v1',
    agentRoleLaunched: 'xtrm.agent-role-launched.v1',
    specialistRoleEnvelope: 'xtrm.specialist-role-envelope.v1',
} as const;

export type SchemaId = (typeof SCHEMA_ID)[keyof typeof SCHEMA_ID];

// --- xtrm.runtime-compatibility.v1 ---
export interface RuntimeCompatibilityV1 {
    schema_version: 'xtrm.runtime-compatibility.v1';
    notes?: string[];
    core: {
        package: string;
        requires: { specialists: string; xtmux: string; node: string; [dep: string]: string };
    };
    contracts: Record<string, string>;
}

// --- xtrm.interactive-role-envelope.v1 ---
export interface InteractiveRoleEnvelopeV1 {
    role: string;
    systemPrompt: string;
    skillPaths: string[];
    model?: string;
    thinkingLevel?: string;
}

// --- xtrm.pi-extension-manifest.v1 ---
export interface PiExtensionManifestV1 {
    schema_version: 'xtrm.pi-extension-manifest.v1';
    active: Array<{ id: string; displayName: string; required: boolean; ownership?: string }>;
    disabled: Record<string, string>;
}

// --- xtrm.command-deprecations.v1 ---
export interface CommandDeprecationEntry {
    command: string;
    deprecated_since: string;
    remove_in: string;
    replacement: string;
    behavior: 'execute-with-warning' | 'fail-with-redirect';
    code_ref: string;
    notes?: string;
}
export interface CommandDeprecationsV1 {
    schema_version: 'xtrm.command-deprecations.v1';
    notes?: string[];
    entries: CommandDeprecationEntry[];
}

// --- xtrm.runtime-matrix.v1 ---
export interface RuntimeMatrixRepoBlock {
    primary_runtime: 'node' | 'bun';
    minimum?: string;
    bun_minimum?: string;
    node_minimum?: string | null;
    node_usage?: string[];
    bun_usage?: string[];
    notes?: string;
}
export interface RuntimeMatrixV1 {
    schema_version: 'xtrm.runtime-matrix.v1';
    core: RuntimeMatrixRepoBlock;
    xtmux: RuntimeMatrixRepoBlock;
    specialists: RuntimeMatrixRepoBlock;
    consumers: Array<{ workflow: string; repo: string; runtime: string }>;
}

// --- xtrm.runtime-origin.v1 ---
export interface RuntimeOriginV1 {
    schema_version: 'xtrm.runtime-origin.v1';
    kind: 'xtmux.agent_instance';
    host_id: string;
    tmux_server_id?: string;
    tmux_session_id: string;
    tmux_window_id: string;
    tmux_pane_id: string;
    agent_instance_id?: string;
    bead_id?: string;
    parent_session_id?: string;
    captured_at_ms: number;
    capture_source: 'xtmux-context' | 'propagated';
    verified: boolean;
}

// --- xtrm.branch.integration.v1 ---
export interface BranchIntegrationV1 {
    schema_version: 'xtrm.branch.integration.v1';
    timestamp: string;
    t_unix_ms: number;
    source: { job_id: string; branch: string; worktree: string };
    target: { branch: string; worktree: string; role?: string };
    status: 'merged';
    commit: string;
}

// --- xtrm.xtmux.topology.v1 ---
export interface XtmuxTopologyAgent {
    instance_id?: string;
    state?: string;
    bead_id?: string;
    task?: string;
    prompt_file?: string;
    parent_session_id?: string;
    last_transition?: string;
}
export interface XtmuxTopologyPane {
    pane_id: string;
    pane_index: number;
    active: boolean;
    width: number;
    height: number;
    left: number;
    top: number;
    pid: number;
    current_command: string;
    current_path: string;
    agent?: XtmuxTopologyAgent;
}
export interface XtmuxTopologyWindow {
    window_id: string;
    window_index: number;
    name: string;
    active: boolean;
    panes: XtmuxTopologyPane[];
}
export interface XtmuxTopologySession {
    session_id: string;
    name: string;
    created_at_ms: number;
    activity_at_ms: number;
    attached: boolean;
    active: boolean;
    windows: XtmuxTopologyWindow[];
}
export interface XtmuxTopologyV1 {
    schema_version: 'xtrm.xtmux.topology.v1';
    generated_at_ms: number;
    host: { host_id: string; tmux_server_id: string };
    sessions: XtmuxTopologySession[];
}

// --- xtrm.xtmux.message.v1 ---
export type XtmuxReplyStatus = 'pending' | 'fulfilled' | 'cancelled' | null;
export interface XtmuxCorrelatedReply {
    messageKey: string;
    senderId: string;
    senderPaneId?: string | null;
    recipientId: string;
    targetPaneId?: string | null;
    summary: string;
    createdAtMs: number;
}
export interface XtmuxMessageV1 {
    messageKey: string;
    senderId: string;
    recipientId: string;
    messageId?: number;
    duplicate?: boolean;
    senderPaneId?: string | null;
    senderKind?: string;
    targetPaneId?: string | null;
    recipientKind?: string;
    beadId?: string | null;
    summary?: string;
    createdAtMs?: number | null;
    expectsReply?: boolean;
    acked?: boolean;
    ackedAtMs?: number | null;
    ackedBy?: string | null;
    replyStatus?: XtmuxReplyStatus;
    fulfilledAtMs?: number | null;
    fulfilledByMessageKey?: string | null;
    replyToMessageKey?: string;
    fulfilledMessageKey?: string;
    fulfilled?: boolean;
    correlatedReply?: XtmuxCorrelatedReply | null;
}

// --- xtrm.xtmux.obligation.v1 ---
export interface XtmuxObligationV1 {
    messageKey: string;
    messageId: number;
    senderId: string;
    senderPaneId: string | null;
    recipientId: string;
    targetPaneId: string | null;
    summary: string;
    createdAtMs: number;
    acked: boolean;
    ackedAtMs: number | null;
    replyStatus: 'pending';
}

// --- xtrm.xtmux.monitor.v1 ---
export interface XtmuxMonitorV1 {
    monitorId: string;
    target: string;
    sessionId: string;
    paneId: string;
    state: string;
    startedAtMs: number;
    updatedAtMs: number;
    timeoutMs: number;
    intervalMs: number;
    wakeDelivered: boolean;
    wakeConsumed: boolean;
    orphan: boolean;
    waitId?: string;
    requesterSessionId?: string | null;
    requesterPaneId?: string | null;
    terminalStatus?: string | null;
    terminalAtMs?: number | null;
}

// --- xtrm.xtmux.wait.v1 ---
export interface XtmuxWaitV1 {
    waitId: string;
    target: string;
    requesterSessionId: string;
    requesterPaneId: string;
    targetSessionId: string;
    targetPaneId: string;
    state: string;
    wakeDelivered: boolean;
    wakeConsumed: boolean;
    replayed: boolean;
    startedAtMs: number;
    monitorId?: string | null;
    terminalStatus?: string | null;
    completedAtMs?: number | null;
    timeoutMs?: number | null;
    intervalMs?: null;
}

// --- xtrm.xtmux.bridge.v1 ---
export interface XtmuxBridgeRequest {
    id: string | number;
    method:
        | 'bridge.hello'
        | 'bridge.cancel'
        | 'topology.snapshot'
        | 'journal.query'
        | 'journal.follow'
        | 'pane.capture'
        | 'health.get';
    params?: Record<string, unknown>;
}
export interface XtmuxBridgeSuccess {
    id: string | number | null;
    result: Record<string, unknown>;
}
export interface XtmuxBridgeError {
    id: string | number | null;
    error: { code: string; message: string; detail?: Record<string, unknown> };
}
export type XtmuxBridgeV1 = XtmuxBridgeRequest | XtmuxBridgeSuccess | XtmuxBridgeError;

// --- xtrm.agent-role-launched.v1 (loose k=v field bag) ---
export interface AgentRoleLaunchedV1 {
    instance_id?: string;
    instance?: string;
    session?: string;
    session_id?: string;
    session_name?: string;
    pane?: string;
    pane_id?: string;
    runtime?: string;
    role?: string;
    bead?: string;
    bead_id?: string;
    task?: string;
    prompt_file?: string;
    parent?: string;
    parent_session?: string;
    [key: string]: string | undefined;
}

// --- xtrm.specialist-role-envelope.v1 (legacy "1", passthrough/open) ---
export interface SpecialistRoleEnvelopeV1 {
    specialist: {
        metadata: {
            name: string;
            version: string;
            description: string;
            category: string;
            [key: string]: unknown;
        };
        execution: { model: string | null; [key: string]: unknown };
        prompt: { task_template: string; [key: string]: unknown };
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

/** Map from schema id to its TypeScript payload type. */
export interface ContractTypeMap {
    'xtrm.runtime-compatibility.v1': RuntimeCompatibilityV1;
    'xtrm.interactive-role-envelope.v1': InteractiveRoleEnvelopeV1;
    'xtrm.pi-extension-manifest.v1': PiExtensionManifestV1;
    'xtrm.command-deprecations.v1': CommandDeprecationsV1;
    'xtrm.runtime-matrix.v1': RuntimeMatrixV1;
    'xtrm.runtime-origin.v1': RuntimeOriginV1;
    'xtrm.branch.integration.v1': BranchIntegrationV1;
    'xtrm.xtmux.topology.v1': XtmuxTopologyV1;
    'xtrm.xtmux.message.v1': XtmuxMessageV1;
    'xtrm.xtmux.obligation.v1': XtmuxObligationV1;
    'xtrm.xtmux.monitor.v1': XtmuxMonitorV1;
    'xtrm.xtmux.wait.v1': XtmuxWaitV1;
    'xtrm.xtmux.bridge.v1': XtmuxBridgeV1;
    'xtrm.agent-role-launched.v1': AgentRoleLaunchedV1;
    'xtrm.specialist-role-envelope.v1': SpecialistRoleEnvelopeV1;
}
