# Coordination terminology

Audit references: `~/dev/11.md` §P3-01, §P3-02, §P3-03.

These words have precise meanings across xtrm-tools, Specialists,
xtmux, and the aggregated viewer. Overloading them silently is one
of the fastest ways to render a UI misleading. Preserve them.

## Message states

- **unread** — recipient has not yet consumed the message.
- **acknowledged** — recipient received or inspected it. Does NOT
  mean the requested task is done.
- **pending reply** — sender is still owed a correlated reply.
- **fulfilled** — a valid correlated reply completed the
  obligation.
- **cancelled** — sender withdrew the obligation.

A UI must NEVER render "acknowledged" as "task completed". A UI
that shows a "read receipt" for a reply-required message and marks
it green invites bugs where a coordinator thinks work is done that
was merely seen.

## Wake semantics

Three distinct events, distinct labels:

- **target became terminal** — the awaited condition is true (a job
  finished, a bead closed, a marker landed).
- **wake was delivered** — the runtime dispatched the wake payload
  to the owning requester pane.
- **wake was consumed** — the requester pane took action on the
  wake (or the continuation process ran).

Displaying a wake in a viewer MUST NOT consume it. Only the owning
requester pane or an authorized continuation process may consume a
wake. This is a hard rule: multiple viewers must all see the same
wake, but exactly one entity may consume it.

## Read-only bridge

The xtmux read-only bridge exposes observation surfaces (topology,
journal, messages, obligations, monitors, wakes). It exposes NO
mutation methods.

Do NOT add mutation methods until a distinct remote-control
protocol lands with:

- authentication
- authorization
- operation scopes
- audit events
- idempotency
- replay protection
- rate limits
- confirmation semantics

The fact that a local CLI command exists is NOT sufficient to
expose it remotely. "Read-only" is the design principle, not a
current limitation.

## Cross-references

- `docs/observability/prometheus-labels.md` — where identity
  fields go instead of metric labels.
- Coordination event schemas (published later via `@xtrm/contracts`
  per audit P2-02).
