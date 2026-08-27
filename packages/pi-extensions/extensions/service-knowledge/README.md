# service-knowledge extension

Self-gating service-registry status + drift notice for repos that carry a
service-knowledge registry. Replaces the retired `service-skills` extension
(which was blind to the canonical layout).

## Self-gating

At extension init, the session cwd is scanned with the exact semantics of the
service-knowledge package's `find_umbrella_packs`
(`packages/service-knowledge/src/service_knowledge/cli/common.py`):

- candidate pack roots: `[<cwd>/.xtrm/skills, <cwd>/.xtrm/skills/user/packs]`
- reserved pack names are skipped: `default`, `optional`, `user`, `active`,
  `local-legacy`
- the NEW umbrella `service-knowledge` wins over the LEGACY `service-skills`
  per pack
- a pack counts only if `<pack>/<umbrella>/service-registry.json` exists

**No registry found → the extension registers NOTHING**: no tool, no command,
no event handlers. Zero surface. Legacy layouts (`.claude/service-registry.json`,
flat repo-root registries, registries under reserved pack names) are
deliberately ignored — only the canonical per-pack umbrella layout counts.

## Surface (registry present)

### Context note (`before_agent_start`)

Every turn gets a custom message injected:

```
<service_knowledge_context>
service registry: 1 pack(s), 2 service(s)
- service-knowledge@infra (2 services)
drift: none detected
</service_knowledge_context>
```

With a pending drift marker — either the canonical
`.xtrm/.service-knowledge-drift-pending` or the legacy wave-1
`.xtrm/.service-skills-drift-pending` (canonical wins when both exist):

```
drift: PENDING marker present (.xtrm/.service-knowledge-drift-pending) — reconcile with /updating-service-knowledge
```

### `/service-knowledge:status` command

Prints via `ctx.ui.notify`:

```
service-knowledge status
pack: service-knowledge@infra
  umbrella: service-knowledge (registry: /path/.xtrm/skills/infra/service-knowledge/service-registry.json)
  services: 2
  - db-expert: last_sync_ref abc12345
  - auth-svc: last_sync_ref (never)
git HEAD: 296be429
drift marker: absent
suggested action: run /updating-service-knowledge to reconcile + stamp last_sync_ref
```

`suggested action` is `none — registry is in sync with HEAD` when every service
`last_sync_ref` matches git HEAD and no drift marker is present.

## Reconciliation

Drift is reconciled with `/updating-service-knowledge` (the
`service-knowledge-sync` specialist) — NOT `/updating-service-skills`. This
extension only surfaces drift; it never auto-updates or rebuilds the index.

## When knowledge is absent or stale

A drift marker (`drift: PENDING` in the context note, or a `last_sync_ref`
behind git HEAD) is **advisory** — it never blocks work. Memory priority:

1. **service-knowledge, if present** — use the registry and skill bodies as-is;
   never grep-hunt for `service-registry.json` speculatively.
2. **Commit corpus — always available** — fall back to `git log -p --follow --
   <file>` for per-file history, `git log --grep`/`--oneline` for corpus, and
   diffs vs `last_sync_ref` when a registry states one. Commits do not go stale.
3. **bd memories** — `bd memories <topic>` / `bd recall <key>` before
   workflow-sensitive questions; write findings back with `bd remember`.

Suggest the reconcile, proceed with current knowledge + commit corpus in
parallel; stamp `last_sync_ref` only after a successful reconcile, and rebuild
the index only after that.

## Non-goals (v1)

- no auto-update execution
- no index rebuild trigger
- no enforcement — drift is surfaced, never acted on automatically
