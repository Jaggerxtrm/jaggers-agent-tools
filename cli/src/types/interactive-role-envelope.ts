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

    /**
     * Whether this role is meant to run as a persistent interactive session
     * (`specialist.execution.interactive`) rather than only as a background
     * Specialists-supervised job.
     *
     * Additive in xtrm-6hey0.3 — no version bump, per the rule above. Core uses
     * it for one thing: refusing a `--subordinate` coordinator launch of a role
     * that declares `false`. It is deliberately tri-state — `undefined` means
     * "the installed Specialists release does not declare it", which must stay
     * permissive so an older release keeps working.
     *
     * This is NOT a job-supervision field. It says what shape the role is, not
     * how Specialists governs it — the distinction the "Rules" section draws.
     */
    interactive?: boolean;
}

/**
 * Schema id constant. Prefer importing this over hard-coding the
 * string so bumps show up as a single-file change plus every
 * consumer's compile error.
 */
export const INTERACTIVE_ROLE_ENVELOPE_SCHEMA = 'xtrm.interactive-role-envelope.v1' as const;
