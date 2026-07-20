// Interactive-role envelope contract.
//
// Slim boundary between Core (interactive session launcher) and
// Specialists (role definitions + background job supervision).
//
// Schema id: xtrm.interactive-role-envelope.v1
// Docs:      docs/architecture/interactive-role-envelope.md
// Audit:     ~/dev/11.md §P1-01
//
// Any Core code that consumes a role from Specialists SHOULD
// type-check against this interface. Additive fields (new optional
// properties) do not require a version bump; removing or renaming
// fields does.

export interface InteractiveRoleEnvelope {
    /** Canonical role name (e.g. "chain-coordinator"). */
    role: string;

    /** Effective merged system prompt for the interactive persona. */
    systemPrompt: string;

    /** Absolute paths of skills the interactive session must load at turn 1. */
    skillPaths: string[];

    /** Surface-specific model override, if any. */
    model?: string;

    /** Thinking level where the surface supports it. */
    thinkingLevel?: string;
}

/**
 * Schema id constant. Prefer importing this over hard-coding the
 * string so bumps show up as a single-file change plus every
 * consumer's compile error.
 */
export const INTERACTIVE_ROLE_ENVELOPE_SCHEMA = 'xtrm.interactive-role-envelope.v1' as const;
