# XTRM Orchestration Determinism — Final Consolidated Audit and Architecture Conclusion

**Status:** final consolidated report; implementation wave merged, audit closure conditional
**Last verified:** 2026-07-24, Europe/Rome
**Repositories:** `xtrm-dev/core`, `Jaggerxtrm/xtmux`, `xtrm-dev/specialists`
**Experimental comparison:** Archon workflows
**Primary objective:** consolidate the earlier cross-repository audit and the newest evidence, then make XTRM multiplexing and Specialists orchestration more deterministic without creating duplicate runtimes, state stores, notification systems, or workflow authorities.

**Revision note:** this version supersedes all earlier audit drafts. It now also includes the 2026-07-24 cross-runtime messaging, hook-matcher, managed-instruction, CLI-help, and orchestration-skill audit. The final conclusion below is authoritative; later sections retain the chronological evidence and intermediate snapshots for traceability.

---

## Final conclusion

### 1. Overall verdict

The completed work across Core, xtmux, and Specialists has produced a substantially stronger foundation:

- runtime versions are compatible and released;
- coordinator→Specialist branch ancestry is explicit and live-tested;
- runtime origin and descendant lineage are reconstructable;
- topology carries role, branch, worktree, and parent-pane context;
- integration evidence has public write and read surfaces;
- exact messages and completed agent turns have dedicated retrieval commands;
- Specialists now emits a structured Pi-compatible NDJSON progress stream;
- release, package, installer, and changelog machinery is materially more reliable.

The implementation program should therefore be considered **successfully landed**.

The audit itself is **not yet closed**. Several previously reproduced correctness and security findings remain current. The next work must be split into two deliberately separate tracks:

```text
Track A — close the existing audit
Track B — build deterministic orchestration
```

Do not mix routine defect closure with the new workflow architecture into one large epic or PR series.

### 2. Authoritative current state

| Surface | Current state |
|---|---|
| Core package | `xtrm-tools` 0.11.2 |
| Core source head verified | `428a27bfa1dcf3ae6d2e819db92533823ca0aa58` |
| xtmux package | `@jaggerxtrm/xtmux` 0.2.2 |
| xtmux source head verified | `048b742d01db5d0c05e5d4e413ecdedeba47a8e5` |
| Specialists package | `@jaggerxtrm/specialists` 3.21.1 |
| Specialists source head verified | `05c57e568e8e11286bd159ecbc985f58e9ee5782`; #206–#208 are newer than release 3.21.1 |
| Runtime compatibility | Core accepts Specialists `>=3.21.0 <4` and xtmux `>=0.1.0 <0.3` |
| Changelog freshness hardening | Landed through Core #488/#489, xtmux #70/#71, and Specialists #208 |
| Historical review state | Previous audit snapshot: 15 current unresolved threads and 4 outdated unresolved threads; recount before closure |
| Archon | experiment/reference workflow engine, not an adopted XTRM authority |

Core #488 has merged. Changelog freshness is now part of the landed maintenance baseline, not an open orchestration dependency. Core #490 is open at this snapshot but concerns service-skill orphan detection and is outside this messaging/orchestration closure wave.

### 3. What is now definitively landed

#### Runtime and lineage

```text
Core coordinator
→ published pane/session/role/branch/worktree identity
→ Specialist job branch derived from coordinator branch
→ descendant jobs inherit root runtime origin
→ xtrm.forensic.v1 reconstructs the chain
```

The live Suite C lane proves:

- a coordinator-only commit exists;
- the Specialist branch descends from it;
- the job records the coordinator runtime origin;
- the accepted branch integrates back into the coordinator branch.

This closes the earlier uncertainty around whether the contracts merely existed on paper or actually composed in a real run.

#### Result and event retrieval

The retrieval hierarchy is now:

```text
exact coordination message
→ xtmux message-get <message-key> --json

latest completed generic agent turn
→ xtmux agent-last <pane|session> --json

structured Specialist progress
→ sp run --json / sp feed --json

complete authoritative Specialist result
→ sp result <job-id> --json

live interactive terminal state
→ pane capture
```

Pane capture is not the result protocol.

#### Branch-integration evidence

```text
Git merge/cherry-pick/PR merge
→ sp integration record
→ xtrm.branch.integration.v1
→ sp integration list
```

Git remains the merge authority. The event is evidence, not a second merge state machine.

#### Release and packaging

- Core 0.11.2 carries the corrected xtmux compatibility range.
- xtmux 0.2.2 uses npm Trusted Publishing through OIDC and provenance.
- Specialists 3.21.1 packages the audit wave through PR #203.
- xtmux release ownership between the external release driver and tag workflow is no longer duplicated.
- package bin paths and installed-artifact contracts are covered.

### 4. New architectural evidence from Specialists NDJSON

PRs #206–#207 change the practical integration boundary.

The structured progress path is now:

```text
sp run --json
→ session
→ agent_start
→ turn/message/tool events
→ retry/compaction events
→ agent_end
→ agent_settled
```

Properties that matter:

- events are projected from the persisted timeline;
- internal forensic envelopes are not leaked as the public workflow stream;
- replay uses the persisted job worktree as `cwd`;
- SQLite is preferred, with file fallback;
- fallback suppresses already emitted sequences;
- per-job order is canonical by `seq`;
- multiple jobs are merged through a stable k-way chronological merge.

This is the correct stream for Archon and future workflow adapters.

It does not replace `sp result --json`, which remains the complete terminal result surface.

### 5. Authority model

| Concern | Authority |
|---|---|
| Workflow graph, dependencies, deterministic transitions | canonical chain template; Archon only inside an Archon-owned experiment |
| Interactive coordinator placement | Core |
| Specialist execution, status, timeline, result | Specialists |
| Pane/session identity, messages, obligations, monitors, wakes | xtmux |
| Durable task contract and acceptance state | Beads |
| Branch, commit, merge truth | Git |
| Integration observation | `xtrm.branch.integration.v1` |
| Runtime correlation and reconstruction | `xtrm.forensic.v1` |
| Hard operational thresholds | deterministic code |
| Semantic judgment and exceptions | coordinator/Specialist |
| Production mutation authority | operator or explicitly authorized workflow gate |

No new work should create a competing owner for any row in this table.

---

## Messaging, hook, managed-instruction, and skill-contract re-audit — 2026-07-24

### Purpose

This section is the implementation brief for local agents assigned to align the current runtime, hook enforcement, CLI help, documentation, and orchestration skills.

The operator’s primary concern is not merely whether a command exists. Agents routinely forget coordination duties. The system therefore needs all four layers to agree:

```text
small always-loaded instruction
→ on-demand skill procedure
→ runtime hook/extension reminder
→ durable state and deterministic gate
```

A skill alone is insufficient. A reminder alone is insufficient. A hook matcher that depends on an exact output shape without reconciliation is insufficient.

### Executive verdict

| Capability | Current state | Disposition |
|---|---|---|
| Durable session/pane messages | Landed in xtmux SQLite | Keep |
| Exact message retrieval | `message-get` landed | Adopt in all consumer docs and extensions |
| Exact completed-turn retrieval | `agent-last` landed | Adopt; pane capture is not the completion protocol |
| Pi interactive turn FYI to parent | Landed on `agent_end` | Keep, make idempotency explicit |
| Claude completed turn in `agent-last` | Landed when transcript extraction succeeds | Keep; fix bounded read and fallback |
| Claude automatic parent FYI | Not landed | Implement or document asymmetry explicitly |
| Pi inbound reply-required detection | Landed through periodic inbox extension | Harden retrieval and ack ordering |
| Claude inbound message detection | Only on normal hook cycles; no idle inbox wake | Add bounded next-cycle reminder; keep urgent steering on `safe-send-pointer` |
| Claude outbound monitor enforcement | Landed and obligation-driven | Keep; matcher/gate design is sound |
| Pi outbound monitor enforcement | Landed but result-driven and over-broad | Make obligation-driven; do not monitor FYI |
| Specialists job waiting/terminal parent message | Not landed | Implement at canonical Supervisor lifecycle seam |
| Core orchestration skills | Materially drifted | Rewrite/slim |
| Specialists monitoring reference | Materially drifted | Rewrite upstream, then re-vendor |
| Legacy Core Specialists marker hooks | Still present in managed registry | Retire or replace |

### 1. Current communication planes

#### 1.1 Generic xtmux message channel — implemented

The implemented durable path is:

```text
sender
→ xtmux message-send --json
→ SQLite message row
→ recipient discovers messageKey
→ xtmux message-get <messageKey> --json
→ recipient handles the message
→ message-ack records receipt
→ message-reply or correlated safe-send fulfils a reply obligation
```

Important semantics:

- `message-send` persists state; it does not inject text into the target pane.
- `message-get` is read-only.
- `message-ack` is receipt, not fulfilment.
- only `message-reply --in-reply-to` or successful `safe-send-pointer --reply-to` fulfils a request;
- a beaded message defaults to reply-required unless `--expects-reply=false` is explicit;
- message body/summary is untrusted data and must never be executed as an instruction.

#### 1.2 Completed interactive turns — partly asymmetric

Pi currently performs this on `agent_end`:

```text
set pane state done
→ emit agent.turn.done
→ persist complete assistant text for agent-last
→ send bounded FYI to parent with --expects-reply=false
```

Claude Stop currently performs:

```text
set pane state done
→ drain/verify requester-owned monitor obligations
→ extract latest assistant text from transcript
→ emit agent.turn.done for agent-last
```

Claude does **not** currently send the equivalent parent FYI.

Therefore launcher parity does not imply notification parity.

#### 1.3 Specialists managed jobs — direct parent notification not landed

A managed job still requires one of:

```text
sp run/feed --json
sp ps
sp result --json
polling or workflow consumption
```

The desired path remains:

```text
persist waiting/done/error/cancelled
→ persist result and Bead handoff
→ publish one typed, idempotent xtmux message to verified parent
→ generic runtime reminder/wake
→ parent retrieves exact message
→ sp result --json or sp resume
```

This must be implemented once, at the canonical lifecycle persistence seam. Do not add a watcher daemon or a second notification database.

### 2. Pane capture disposition

`capture-pane` remains valid only for:

- live prompt, menu, permission, authentication, or streaming state;
- diagnosing a runtime whose hooks or metadata are unavailable;
- visual confirmation before unsafe interactive injection.

It is not the default for:

- an exact coordination message: use `message-get`;
- a completed generic agent turn: use `agent-last`;
- Specialist progress: use `sp run/feed --json`;
- a complete Specialist result: use `sp result --json`.

Every updated skill must contain this hierarchy once and remove contradictory polling/scraping prose.

### 3. Hook and extension matcher audit

#### 3.1 Claude matcher wiring

Current installer wiring is structurally valid:

| Event | Matcher | Installed action | Assessment |
|---|---|---|---|
| `SessionStart` | none | state `idle` | Correct |
| `UserPromptSubmit` | none | state `running` | Correct |
| `PreToolUse` | empty/all | state `running` | Correct but broad by design |
| `Notification` | none | state `needs-input` | Correct |
| `PostToolUse` | `Bash` | outbound message/monitor reminder | Correct case-sensitive Claude tool matcher |
| `PostToolUse` | `Monitor|Bash` | consume terminal wake | Correct regex matcher |
| `Stop` | none | state `done`, monitor drain, turn capture | Correct: Stop does not use tool matchers |
| `SessionEnd` | none | state `off` | Correct |

The Claude design is robust because the Stop gate does not trust memory of the earlier Bash result. It queries durable sender-owned obligations and requires a fresh requester/target/pane-matched wait before allowing Stop.

The cheap shell prefilter for outbound coordination may remain:

```text
message-send
safe-send-pointer
tmux send-keys
```

The Node hook must remain the authority for parsing the successful JSON result and deciding whether a reply is expected.

Required refinements:

1. keep the broad shell grep only as a cold-start optimization;
2. keep the Stop obligation query as the correctness backstop;
3. add fixtures for the current Claude `PostToolUse` payload and native `Monitor` payload;
4. test project/user/plugin hook coexistence and installer idempotency;
5. add next-cycle inbound message surfacing; do not claim an idle Claude session can be woken by a passive SQLite insert;
6. use `safe-send-pointer` for urgent interactive delivery.

#### 3.2 Pi matcher wiring

The Pi tool matcher itself is correct:

```text
event.toolName === "bash"
```

The current weakness is the result contract, not the tool name.

`coordinationResult()` intentionally recognizes only one standalone coordination JSON object. It ignores unrelated JSON, NDJSON, and multiple JSON values. This is a good trust boundary, but it means auto-monitoring is missed when an agent:

- omits `--json`;
- chains the command with another JSON-producing command;
- wraps the result in a script that produces multiple structured values.

More importantly, the parsed `message-send` result drops `expectsReply`, and `pi-auto-monitor` currently arms a monitor for every recognized send/reply/safe-send except ack. Consequences:

- FYI `message-send --expects-reply=false --json` can arm an unnecessary monitor;
- a correlated reply can arm another monitor even though the reply cannot expect a reply;
- parser misses can suppress monitor arming entirely.

Required design:

```text
tool-result parser = latency optimization
durable obligations reconciliation = correctness authority
```

Pi must periodically reconcile sender-owned obligations and arm only missing, fresh, reply-required waits. The parser may trigger an immediate refresh but must not decide monitor necessity alone.

#### 3.3 Inbound detection and agent forgetfulness

Current Pi inbox behavior is useful:

- pane-scoped periodic query;
- bounded row and operation budgets;
- one continuation at a time;
- untrusted summaries excluded from prompts;
- durable reconstruction after restart.

But it currently acknowledges unacked messages during DB load, before successful continuation queueing, and it does not call `message-get`.

The report adopts this preferred delivery contract:

```text
message-list discovers bounded keys
→ message-get retrieves exact row
→ validate and construct bounded reminder
→ successfully queue follow-up/system reminder
→ message-ack
```

If maintainers choose `ack = database read` instead, that is acceptable only if the contract, help, extension comments, tests, and report all say so. Do not keep ambiguous semantics.

Pi reminder content should include:

- exact validated message keys;
- sender/bead labels only when safe;
- explicit commands: `message-get`, then reply/cancel as appropriate;
- no raw message summary promoted to instructions.

Claude needs a bounded inbox check on normal runtime cycles:

```text
UserPromptSubmit / selected PostToolUse / Stop
→ pane-scoped unacked/pending query
→ inject only validated keys and exact inspection commands
```

This does not make Claude real-time while idle. Document that limitation. An urgent message uses correlated `safe-send-pointer`.

### 4. Always-loaded instruction audit

Current managed blocks:

```text
core/.xtrm/config/instructions/claude-top.md
core/.xtrm/config/instructions/agents-top.md
```

correctly preserve `messageKey` and distinguish receipt from fulfilment, but they omit the behaviors agents most often forget:

- use `--json` on coordination mutations when runtime automation depends on the result;
- use `--expects-reply=false` for FYI/status/PASS;
- after sending a reply-required message, verify a fresh monitor exists;
- inspect pending inbound keys before long waits and before session close;
- retrieve exact content with `message-get`;
- retrieve completed turns with `agent-last`;
- do not use `capture-pane` as a result protocol;
- managed Specialist jobs use `sp result`/`sp resume`, not generic message summaries.

Add one compact invariant block to both managed instructions, no more than approximately 12 lines:

```text
XTMUX COMMUNICATION INVARIANTS
- Coordination mutations are standalone `--json` commands.
- FYI/status/PASS use `--expects-reply=false`.
- Decision/blocker requests preserve `messageKey` and require a fresh requester-owned monitor.
- Read exact inbound content with `message-get`; ack only according to the declared receipt contract.
- Fulfil through `message-reply` or successful correlated safe-send.
- Use `agent-last` for a completed interactive turn.
- Use `sp result` / `sp resume` for managed Specialist jobs.
- Pane capture is live-state diagnosis only.
- Before waiting or closing, inspect inbox, obligations, and monitors.
```

Also verify the Claude skill invocation syntax in `claude-top.md`. It currently contains `/skill-using-xtrm`, while the current Claude-facing contract elsewhere uses `/<name>` such as `/using-xtrm`. Resolve the outlier and add a test.

### 5. Skill-set audit and slimming plan

#### 5.1 Current weight

Approximate current root lengths:

| Skill | Current root size | Assessment |
|---|---:|---|
| `multiplexing` | ~402 lines | Too long and internally contradictory |
| `multiplexing-team` | ~343 lines | Too long for every delegated pane |
| `deploy-monitor` | ~265 lines | Heavy but role-specific |
| `pr-reviewer` | ~210 lines | Moderately heavy |
| `using-specialists` | ~258 lines | Router concept is correct, root still overloaded |
| `using-specialists/references/monitoring.md` | ~206 lines | Phase reference, but materially stale |

`chain-coordinator` force-loads both `multiplexing` and `using-specialists`. That is roughly 660 lines before any on-demand reference or task context. It undermines the coordinator’s stated purpose of avoiding parent-context monitoring rot.

#### 5.2 Target structure

Use progressive disclosure consistently.

| Root skill | Target root | Move to references |
|---|---:|---|
| `multiplexing` | 120–160 lines | sprint protocol, coordinator launch, V2 internals, recovery, hygiene, deploy-gap doctrine, legacy fallbacks |
| `multiplexing-team` | 100–140 lines | inbound/reply procedure, waits/wakes, subdelegation, sibling rules, recovery |
| `using-specialists` | 120–150 lines | draft-Bead doctrine, title conventions, role catalog, SCRUTINY details, long examples |
| `deploy-monitor` | 140–180 lines | provider-specific Tempo/Prometheus recipes, incident history, edge-probe implementation, sampling templates |
| `pr-reviewer` | 120–150 lines | Codex fetch recipes, recurring hazard catalog, board examples, detailed disagreement templates |

Root files should keep only:

- purpose and non-goals;
- authority boundary;
- five to ten non-negotiable rules;
- routing table to references;
- minimal happy path;
- failure/escalation trigger;
- exact current retrieval hierarchy.

Add a CI budget:

```text
router root line/byte/token budget
reference files exempt but individually bounded
forbid contradictory deprecated phrases
verify every command example against CLI help fixtures
```

Suggested lint failures:

- root exceeds agreed budget;
- `capture-pane` described as final result retrieval;
- `--background` under `sp run`;
- `@agent_prompt_file` described as active Core launcher transport;
- beaded FYI without `--expects-reply=false`;
- message mutation used without `--json` in a flow that expects automation;
- `message-list` shown as exact message retrieval without `message-get`;
- combined `session:pane` passed where CLI expects separate session and pane flags.

### 6. Per-skill required changes

#### `core/.xtrm/skills/default/multiplexing/SKILL.md` — major rewrite

Current contradictions include:

- says no native push/custom bus is needed and default completion is polling;
- later documents SQLite messaging and Pi auto-notification;
- later again says back-channel notification is not primary;
- recommends capture-pane summaries where `agent-last`, `message-get`, or structured state exist;
- does not teach `message-get` or the retrieval hierarchy;
- describes prompt-file metadata that Core has retired;
- mixes operator router, sprint doctrine, deploy incidents, team-member protocol, and recovery manual in one root.

Required result:

```text
multiplexing/SKILL.md = compact router and operator invariants
references/communication.md
references/launch-and-topology.md
references/monitoring-and-wakes.md
references/sprint-orchestration.md
references/recovery-and-hygiene.md
```

#### `multiplexing-team/SKILL.md` — medium rewrite

Keep:

- Bead as durable contract;
- messages as bounded pointer/decision channel;
- ack distinct from fulfilment;
- no multiline pane injection;
- safe metadata handling.

Change:

- add `message-get`;
- add `agent-last`;
- document Pi/Claude asymmetry;
- adopt the selected ack ordering;
- remove active reliance on `@agent_prompt_file`;
- reduce manual polling prose;
- route detailed inbox/wake/subdelegation procedures to references.

#### `deploy-monitor/SKILL.md` — correctness fixes plus slim

Current contradiction:

- prose says ready/PASS FYI must set `--expects-reply=false`;
- ready and final PASS examples omit the flag and therefore create obligations.

Required message policy:

| Event | Message contract |
|---|---|
| ready | FYI, `--expects-reply=false --json` |
| routine T+ sample OK | FYI, `--expects-reply=false --json` |
| final PASS | FYI, `--expects-reply=false --json` |
| HOLD | reply-required `--json` |
| BLOCKED | reply-required `--json` |
| irreversible decision | reply-required `--json` |

Move provider recipes and incident narratives to references.

#### `pr-reviewer/SKILL.md` — correctness fixes plus slim

Fix addressing examples to the canonical shape:

```text
--from <session-id> --from-pane <pane-id>
--to <session-id> --to-pane <pane-id>
```

Do not use combined `session:pane` unless the CLI explicitly adds and tests that grammar.

Verdict message policy:

| Verdict | Default |
|---|---|
| PASS | FYI |
| PASS_WITH_NOTES | FYI unless a decision is requested |
| NEEDS_CHANGES | reply-required or correlated interactive steer |
| BLOCKED | reply-required |

Add standalone `--json`.

Explicitly distinguish this interactive sprint-judge vocabulary from the Specialists reviewer vocabulary (`PASS` / `PARTIAL` / `FAIL`). Do not silently treat them as one schema.

#### `specialists/config/skills/using-specialists/references/monitoring.md` — replace upstream

Remove:

- “sleep timers are mandatory” as the primary doctrine;
- direct private SQLite queries as the preferred public interface;
- status spelling `completed`;
- polling-first completion logic;
- the statement that the private DB is the consumer contract.

Teach:

```text
foreground run → consume returned stream/result
background/workflow run → sp run/feed --json
terminal truth → sp result --json
waiting → sp result + sp resume
generic interactive turn → agent-last
coordination message → message-get
```

Then re-vendor the updated Specialists skill into Core. Do not patch only the vendored copy.

#### `specialists/src/cli/help.ts` — help honesty

Remove the impossible example:

```text
specialists run executor --background ...
```

The same help currently states native shell backgrounding elsewhere. Retain one truthful path.

Resolve the contradiction between help advertising `sp merge` / `sp epic merge` and the canonical skill declaring both known-broken and prohibited. Options:

1. fix and certify the commands;
2. hide/deprecate them from help;
3. label them explicitly unsafe/experimental.

Do not leave the CLI advertising a path the canonical skill forbids.

#### `specialists/config/specialists/chain-coordinator.specialist.json`

Correct:

- “On turn_end” to the actual Pi `agent_end` behavior;
- state clearly that automatic parent FYI is Pi-specific today;
- remove hard-coded full chain order when canonical chain-template resolution lands;
- reduce the force-loaded skills after their roots are slimmed;
- include the compact communication invariant, or depend on a small dedicated coordination skill.

### 7. Legacy hook inconsistencies

#### Core `specialists-complete.mjs`

This hook:

- reads `.specialists/ready` marker files;
- reads per-job `status.json`;
- injects completion only on a later Claude hook cycle;
- deletes the marker.

It is a second, Claude-only completion path outside current SQLite/NDJSON/public CLI contracts.

Disposition:

- retire it when direct Specialists→parent notification lands;
- until then, clearly label it compatibility-only;
- do not extend it;
- add migration/removal handling to the managed hook registry.

#### Core `specialists-session-start.mjs`

This hook still:

- scans `.specialists/jobs/*/status.json`;
- looks for `*.specialist.yaml`;
- reads deprecated user-scope specialist locations;
- repeats stale CLI examples.

It does not match the current JSON config and project-only model. Replace it with public CLI queries or retire it. Do not repair its private-file traversal into another long-lived API.

### 8. Implementation work packages for local agents

#### MSG-01 — Freeze receipt semantics

**Repos:** xtmux, Core docs/skills
**Decision:** choose one:

```text
A. ack = SQLite row read
B. ack = successfully queued to recipient runtime
```

Recommended: **B**.

**Acceptance:**

- contract text exists in CLI help and README;
- Pi extension tests prove no ack before successful queue;
- failed queue leaves row unacked;
- restart retries safely;
- ack remains idempotent.

#### MSG-02 — Pi obligation-driven outbound monitor reconciliation

**Files:**

```text
xtmux/extensions/coordination-json.ts
xtmux/extensions/pi-auto-monitor.ts
xtmux/extensions/pi-inbox-reply.ts
xtmux/tests/contracts/coordination-json.test.ts
xtmux/tests/contracts/pi-auto-monitor.test.ts
xtmux/tests/contracts/pi-inbox-reply.test.ts
```

**Required:**

- preserve `expectsReply` in parsed send result;
- FYI send does not arm a monitor;
- correlated reply does not arm a monitor;
- safe-send only arms when it creates an actual outstanding duty;
- periodic sender-owned obligation reconciliation arms a missing fresh monitor even when tool-result parsing misses;
- parser remains strict and ignores multi-JSON/NDJSON.

#### MSG-03 — Exact inbound retrieval

**Repos:** xtmux
**Required:**

```text
message-list → bounded key discovery
message-get → exact row
validation → bounded runtime reminder
successful queue → ack
```

No message summary becomes executable instructions.

Add FYI policy:

- decide whether FYI creates a bounded next-cycle reminder;
- coalesce multiple FYIs;
- do not create reply obligations;
- terminal Specialist notifications must be visible to an active Pi parent without manual pane capture.

#### MSG-04 — Claude inbox and parent-FYI parity

**Files:**

```text
xtmux/hooks/claude/claude-agent-turn-capture.mjs
new or existing Claude inbox hook
xtmux/scripts/install.mjs
installer and hook contract tests
```

**Required:**

- send one idempotent parent FYI after a completed Claude turn, or explicitly reject parity and document it;
- add bounded pending-message reminder on normal hook cycles;
- no raw summaries as instructions;
- no duplicate FYI on repeated Stop;
- missing/malformed transcript still yields a retrievable fallback completed-turn record;
- urgent idle delivery remains `safe-send-pointer`.

#### MSG-05 — Specialists lifecycle parent notification

**Repo:** Specialists
**Seam:** the single Supervisor path that persists status/result and writes the unified Bead handoff.

**Transitions:**

```text
waiting
done
error
cancelled
stalled, only if canonical
```

**Payload:**

- schema/version;
- transition;
- job ID and Specialist;
- Bead/chain/node IDs when present;
- verified parent runtime identity;
- bounded summary;
- exact `sp result --json` or `sp resume` command;
- trace/span correlation;
- stable idempotency key.

**Non-goals:**

- no full result in message;
- no notification database;
- no watcher daemon;
- no pane scraping;
- delivery failure must not roll back job completion.

#### MSG-06 — Retire compatibility notification hooks

**Repo:** Core
**Files:**

```text
.xtrm/hooks/specialists/specialists-complete.mjs
.xtrm/hooks/specialists/specialists-session-start.mjs
.xtrm/registry.json
hook installer/reconcile tests
```

Either remove them in a migration-safe release or clearly quarantine them as compatibility-only until MSG-05 ships.

#### DOC-01 — Rewrite canonical Specialists monitoring docs

Update upstream Specialists first, then re-vendor Core.

Acceptance:

- no `--background`;
- no direct private-DB recommendation;
- current statuses;
- NDJSON public flow;
- `message-get` / `agent-last` / `sp result` hierarchy;
- direct notification marked proposed until MSG-05 lands.

#### DOC-02 — Slim orchestration skill roots

Refactor the five roots according to the target budgets. Add references and routing tests.

Acceptance:

- chain-coordinator always-loaded skill content is materially smaller;
- no policy is lost—content migration map records every moved section;
- evaluation prompts still trigger the right reference;
- no contradictory legacy completion doctrine remains.

#### DOC-03 — Fix role-specific communication examples

Update `deploy-monitor` and `pr-reviewer` message semantics, addressing, `--json`, and verdict policy.

#### DOC-04 — Help/README/managed-instruction parity

Update:

```text
Core managed instructions
xtmux README/help only where runtime changes require it
Specialists help
Core top-level docs and skill registry
```

Generate command snippets from fixtures where practical.

#### EVAL-01 — Cross-runtime hook/matcher suite

The release gate must cover:

| Scenario | Claude | Pi |
|---|---:|---:|
| reply-required standalone `message-send --json` | Stop requires fresh wait | fresh wait armed |
| reply-required send without parseable output | Stop DB gate still catches | periodic obligation reconciliation catches |
| FYI send | no wait required | no wait armed |
| correlated reply | no new wait | no new wait |
| successful wait completion | wake consumed once | wake consumed once |
| inbound reply-required message | surfaced next normal cycle | continuation queued, then ack |
| inbound FYI | bounded policy, no duty | bounded policy, no duty |
| restart with pending state | reconstructed | reconstructed |
| hostile metadata | not reflected/executed | not reflected/executed |
| duplicate Stop/settled events | idempotent | idempotent |
| idle urgent steering | correlated safe-send | correlated safe-send |

#### EVAL-02 — Skill and documentation drift gates

Add:

- root size budgets;
- command-example tests;
- forbidden stale phrase checks;
- upstream/vendored Specialists skill hash parity;
- managed instruction syntax tests;
- hook installer snapshot tests;
- one live coordinator scenario for Pi and Claude.

### 9. Updated ordering

This messaging/hook/skill wave belongs between audit correctness closure and the new chain-template program:

```text
existing P1/security closure
→ existing P2 correctness closure
→ message/hook semantic alignment
→ skill/docs slimming and re-vendor
→ Specialists patch release
→ canonical chain resolver and exact dispatch
→ direct Specialists lifecycle notification if not already included
→ extended live Suite C
```

MSG-05 may proceed in parallel with the documentation rewrite, but docs must not claim it landed until a released trio passes the live test.

### 10. Definition of done for this wave

This wave is complete only when:

- no normal completion path requires pane capture;
- Pi and Claude parity/asymmetry is explicitly documented and tested;
- reply-required sends always result in a fresh monitor even when result parsing misses;
- FYI sends never create reply obligations or unnecessary monitors;
- inbound message retrieval uses the declared exact-row contract;
- ack semantics are unambiguous and tested;
- active Pi and Claude agents receive bounded reminders;
- urgent idle delivery uses safe correlated injection;
- managed Specialists transitions notify the verified parent exactly once;
- legacy marker hooks are removed or explicitly quarantined;
- all five skill roots meet agreed budgets;
- Core’s vendored Specialists monitoring skill equals upstream;
- CLI help contains no unsupported command examples;
- managed instructions carry the compact communication invariant;
- the live cross-runtime suite passes from packed/released artifacts.

---

## Track A — Audit closure

### A1. Current P1 and security closure

The following items remain closure blockers.

#### Complete topology source ledger

`xtrm.topology.projection.v1.sources` must contain exactly one result for every expected source:

```text
xtmux
tmux
specialists
beads
git
github
```

An empty, partial, or duplicate ledger must not validate.

#### xtmux Beads cursor correctness

Fix both problems together:

1. retain the exact raw `created_at` representation, or normalize the SQL side and cursor identically;
2. capture the initial repository cursor before dashboard and follower startup work.

Acceptance must prove:

- no duplicate event on repeated polling;
- no event loss during startup;
- stable `(created_at, id)` progression.

#### Public operational export

Remove `open-issues.json` from the public Specialists tree.

The repository should not expose:

- live runner identifiers and labels;
- fork or runner policy;
- operator email addresses;
- known security backlog;
- infrastructure findings intended for private operational triage.

The separate immutable runner-denial P0 must be verified independently; removing the export is not remediation of the underlying runner policy.

### A2. Current P2 correctness closure

#### Core

- avoid provisional worktree creation before `--reuse` resolves an existing session;
- make topology worktree discovery correct across repositories;
- route obligations to the pane selected from the snapshot;
- join PR evidence against each Specialist job branch;
- reconcile Serena installation/support with hook matchers and permissions;
- preserve the caller’s staged index during Semgrep recovery;
- restore or delegate a bounded Beads cache writer for Pi-only sessions;
- retire or quarantine the marker-based Specialists completion/session-start hooks;
- align managed Claude/Pi instructions with `message-get`, `agent-last`, monitor duties, FYI semantics, and current Claude skill syntax;
- slim and synchronize the multiplexing, team, deploy-monitor, and PR-reviewer skills.

#### xtmux

- use a positioned bounded tail read rather than full transcript `readFileSync`;
- emit a fallback completed-turn row when Claude transcript extraction has no usable text;
- resolve the `tmux_server_id` producer/contract discrepancy if still present in live validation;
- freeze ack semantics and implement the chosen ordering;
- make Pi monitor correctness obligation-driven and suppress FYI/reply over-monitoring;
- adopt exact `message-get` retrieval in the Pi inbox path;
- add bounded Claude inbound reminders and decide/implement parent-FYI parity;
- add the cross-runtime hook/matcher acceptance matrix.

#### Specialists

- record the real temporary publication branch as the integration target;
- reject unknown flags, missing values, and flag-shaped values in `sp integration record`;
- establish an intentional clean test baseline for the CLI suites;
- remove the unsupported `run --background` help example;
- resolve help-versus-skill disagreement on merge commands;
- replace the polling/private-DB monitoring reference with public NDJSON/result/message contracts;
- implement typed, idempotent waiting/terminal parent notification at the canonical Supervisor seam;
- correct and slim the chain-coordinator prompt/skill payload.

### A3. Review administration

Every current thread must end in one of two states:

```text
reproduced → fixed → regression test → resolved

superseded → evidence-backed reply naming commit/PR → resolved
```

Merge status is not thread resolution.

### A4. Release closure

Specialists #206–#207 landed after 3.21.1. Cut a patch release before claiming the installed package exposes the new NDJSON contract.

A coordinated release verification should execute:

```text
xt version --json
xtmux-obs version --json
sp version --json
runtime compatibility preflight
packed install smoke
live Suite C
sp run --json replay smoke
```

---

## Track B — Deterministic orchestration

Track B is the next architecture program. It is not a continuation of the bug-fix audit disguised as feature closure.

### B1. Canonical chain templates and deterministic dispatch must land together

The source material is:

- the Specialists roadmap;
- **Specialists Prompt, Chain Context, Interactive Coordination, Observability and Evaluation Modernization**;
- the chain-template proposals already discussed in this report.

A chain template must define:

```text
nodes
Specialist role per node
dependencies
parallelism
scrutiny level
input/output contracts
when conditions
review gates
retry
waiting behavior
integration authority
target branch
cleanup
completion criteria
```

One canonical resolver must produce:

```text
selected template
→ resolved DAG
→ exact Specialist and dispatch flags
→ parent/coordinator assignment
→ expected notification or monitor behavior
→ typed result contract
→ eligible next transitions
```

Do not implement separate partial resolvers in Core, xtmux, Specialists, prompts, and Archon adapters.

### B2. Direct Specialists→parent notification

At the same canonical lifecycle seam where Specialists persists the result and appends the Bead handoff:

```text
persist status/result
→ append Bead handoff
→ send typed xtmux message to verified parent
→ generic xtmux wake
```

Initial actionable transitions:

```text
waiting
done
error
cancelled
stalled, only if already canonical
```

The notification should contain:

- schema version;
- transition kind;
- job ID;
- Specialist;
- status;
- Bead/chain/node identifiers when available;
- verified parent;
- bounded summary;
- exact `sp result` / `sp resume` / inspection command;
- trace/span correlation.

It must not contain the complete result.

Delivery is best-effort relative to job completion. Do not introduce an outbox, daemon, retry worker, notification database, or Specialist-specific Pi/Claude extension until measured delivery loss requires one.

### B3. Generic xtmux delivery semantics

The receiving path remains:

```text
message-get
→ continuation successfully queued
→ message-ack
```

Do not merge these concepts:

```text
delivered
retrieved
receipt acknowledged
reply obligation fulfilled
```

A terminal Specialist notification is usually reply-free FYI. A waiting notification is normally fulfilled through `sp resume`, not a coordination reply.

### B4. Merge and hygiene

The deterministic merge pattern is:

```text
eligible integration set computed by code
+ unresolved review blockers checked independently
+ repository/ancestry preflight
+ advisory model risk summary
+ coordinator/operator approval
→ merge in predetermined order
→ sp integration record
→ independent Git/GitHub verification
→ post-merge hygiene
```

Worktree hygiene remains proposal-first:

- preserve dirty worktrees;
- preserve unlanded commits;
- preserve worktrees without reliable integration evidence;
- release only resources owned by terminal jobs automatically;
- do not auto-prune merely because a job is terminal.

---

## Archon conclusion

### Origin of the Archon discussion

The Archon analysis began from the Confluence working PRD/workflow plan:

**Archon + XTRM — QuestDB Maintenance Workflow Plan**

The derivation was:

```text
QuestDB workflow plan
→ concrete read-only Archon experiment
→ extract reusable deterministic workflow patterns
→ compare them with XTRM chains
→ feed the conclusions into this audit
```

### Current role

Archon is:

- an experimental workflow engine;
- a builder/viewer reference;
- a source of DAG, typed-output, deterministic-gate, approval, and verification patterns.

Archon is not currently:

- the XTRM source of truth;
- the owner of Specialists jobs;
- the owner of xtmux messages or pane identity;
- the owner of Beads;
- the owner of Git integration truth;
- the default owner of XTRM worktrees.

### QuestDB experiment

The PRD separates:

```text
questdb-v2-maintenance-planning
→ read-only evidence
→ deterministic GO/NO-GO
→ proposed plan

questdb-v2-maintenance-execution
→ approved plan only
→ fresh preflight
→ explicit approval
→ checkpointed mutation
→ verification and rollback
```

Only the planning experiment should be used to evaluate the integration initially.

### Thin adapter after #206–#207

The adapter can now remain genuinely thin:

```text
Archon node
→ sp run --json
→ consume ordered NDJSON
→ observe terminal settlement
→ sp result --json
→ return typed node output
```

It must not:

- scrape a pane;
- parse human logs;
- read private Specialists SQLite schemas;
- create another XTRM worktree;
- duplicate job lifecycle;
- reinterpret a deterministic NO-GO.

### Comparative experiment

Run the same planning DAG in two forms:

```text
A — Archon-native nodes
B — selected nodes delegated to Specialists
```

Score:

- graph determinism;
- role fidelity;
- routing correctness;
- structured-output reliability;
- pause/resume behavior;
- failure semantics;
- evidence traceability;
- preserved XTRM identities;
- adapter size;
- operator intervention;
- cost;
- UI clarity.

Do not design the production mutation workflow until the read-only comparison produces evidence.

---

## Final implementation sequence

### Phase 1 — close P1/security

1. Remove the public operational export and verify runner policy.
2. Fix xtmux Beads cursor duplication and startup loss.
3. Enforce the complete topology source ledger.

### Phase 2 — close current P2 and review threads

4. Resolve Core topology/routing/reuse/Serena/index/cache findings.
5. Resolve xtmux Claude capture and topology identity findings.
6. Resolve Specialists integration target and parser findings.
7. Resolve all outdated threads with evidence.
8. Establish a clean Specialists test baseline.

### Phase 2B — align messages, hooks, instructions, and skills

9. Freeze receipt/ack semantics.
10. Make Pi monitor arming obligation-driven and FYI-safe.
11. Add exact inbound retrieval and bounded cross-runtime reminders.
12. Add Claude completion notification parity or explicitly document/test the asymmetry.
13. Implement typed Specialists waiting/terminal parent notification.
14. Retire or quarantine legacy marker-based Core Specialists hooks.
15. Rewrite and slim canonical orchestration skills, then re-vendor.
16. Repair Specialists and xtmux/Core help/documentation parity.
17. Run the cross-runtime matcher, restart, hostility, and packed-install suites.
18. Release Specialists with #206–#208 and the messaging/doc changes; coordinate xtmux/Core releases if their runtime artifacts change.

### Phase 3 — deterministic orchestration foundation

19. Land canonical chain templates and their resolver.
20. Land exact deterministic dispatch from that resolver.
21. Extend live Suite C through notification, exact retrieval, integration evidence, and terminal cleanup.

### Phase 4 — experiments

22. Run the QuestDB Archon planning workflow natively.
23. Run the same DAG with selected Specialists-backed nodes.
24. Complete the scorecard.
25. Evaluate merge FIFO and worktree hygiene separately.

### Phase 5 — architecture decision

26. Decide whether Archon remains:
    - an external workflow engine for selected workflows;
    - a workflow builder/viewer that exports canonical XTRM templates;
    - only a reference implementation whose patterns are absorbed into XTRM.

No production execution engine or Archon→Substrate compiler should be built before this decision.

---

## Definition of done

### Audit closed

The audit may be marked closed only when:

- all P1/security findings are fixed;
- all current P2 findings are fixed or explicitly rejected with evidence;
- all review threads are resolved;
- the installed trio passes compatibility and packed-install checks;
- Specialists has a published release containing its current public JSON contracts;
- ack semantics, FYI behavior, and monitor ownership are documented and enforced identically by help, skills, hooks, and tests;
- Core has no active stale marker-based Specialists notification path;
- the canonical orchestration skill roots meet agreed context budgets and vendored copies match upstream;
- CLI help contains no unsupported examples;
- live Suite C plus the cross-runtime message/hook matrix pass on the released trio.

### Deterministic orchestration foundation complete

The next architecture milestone is complete only when:

- a versioned canonical chain template resolves to one exact dispatch plan;
- a real coordinator dispatches a Specialist from that plan;
- waiting/terminal state generates one typed, idempotent parent message;
- an active parent receives a bounded reminder, retrieves the exact message with `message-get`, and acknowledges it according to the frozen receipt contract;
- progress is available through ordered NDJSON;
- the complete result is retrieved through `sp result --json`;
- the accepted branch integrates into the coordinator branch;
- integration evidence is recorded;
- terminal owned resources are released;
- unfinished jobs and preserved worktrees are explicitly accounted for.

### Archon experiment complete

The Archon investigation is complete only when:

- the read-only QuestDB planning workflow has run in both variants;
- deterministic gates cannot be overridden by model prose;
- no duplicate authority or worktree ownership appears;
- artifacts and XTRM identities remain traceable;
- the comparison scorecard supports a concrete adoption decision.

---

## Final architectural position

The system should converge on:

```text
canonical declarative chain
+ one deterministic resolver
+ exact dispatch
+ Specialists-owned execution and result
+ ordered structured progress events
+ direct typed parent notification
+ xtmux-owned delivery and wake
+ Beads-owned task contract
+ Git-owned integration truth
+ forensic correlation
+ explicit approval and cleanup
```

Archon strengthens this direction by demonstrating how DAGs, deterministic gates, typed artifacts, approvals, and independent verification can work. It should influence XTRM through measured experiments, not by taking ownership away from existing components.

The previous implementation wave established the necessary substrate. The remaining audit fixes should now be closed cleanly, followed by a separate, narrowly scoped deterministic-orchestration program.

---

## Historical evidence and intermediate snapshots

The sections below preserve the complete prior audit, delta analyses, finding matrix, and implementation rationale. Where an older section conflicts with the **Final conclusion**, the final conclusion is authoritative.

## Hardening delta re-audit — later 2026-07-22

### Revised verdict

The latest work materially improves release safety and machine-consumable runtime behavior. It also closes two blockers identified by the preceding audit:

- Core no longer rejects xtmux 0.2.x;
- the three repositories now have coordinated release identities: Core 0.11.2, xtmux 0.2.2, Specialists 3.21.1.

The system is nevertheless **not audit-closed**. The hardening work is mostly orthogonal to the unresolved topology, event-cursor, lifecycle-retrieval, public-export, integration-recording, and cleanup findings.

This distinction matters:

```text
release and transport hardening improved
≠
all previously reproduced correctness findings fixed
```

### Latest repository state

| Repository | Current source/package state | Latest material changes |
|---|---|---|
| Core | `xtrm-tools` 0.11.2 | xtmux compatibility widened to `<0.3`; coordinated release cut. |
| xtmux | `@jaggerxtrm/xtmux` 0.2.2 | npm Trusted Publishing through OIDC; release workflow ownership corrected; changelog updater landed. |
| Specialists | `@jaggerxtrm/specialists` 3.21.1 plus unreleased #206–#207 | Pi-compatible NDJSON for `sp run/feed --json`; SQLite-first replay; deterministic per-job ordering. |

Core PR #488 remains open at this snapshot. Its changelog pre-push/CI enforcement is not yet landed and is not counted as completed hardening.

### Closed since the previous audit

#### Core↔xtmux compatibility

Core now accepts:

```json
{
  "specialists": ">=3.21.0 <4",
  "xtmux": ">=0.1.0 <0.3",
  "node": ">=24.0.0"
}
```

This closes the previous blocker where Core 0.11.1 rejected xtmux 0.2.0 at launch.

#### Release identity and publication pipeline

- Core released 0.11.2.
- Specialists released 3.21.1, covering the integration record/list and roleless Bead work through PR #203.
- xtmux reached 0.2.2 and moved publication authentication from a long-lived npm token to Trusted Publishing through GitHub OIDC and provenance.
- xtmux removed duplicate GitHub Release creation from the tag-triggered workflow because the external release driver already owns that operation.
- xtmux gained an idempotent `[Unreleased]` updater.

These are legitimate closure improvements even though they were not necessarily derived from this audit.

### Specialists JSON transport: important new evidence

PRs #206 and #207 substantially improve Specialists as a deterministic workflow component.

`sp run --json` and `sp feed --json` now emit Pi-compatible NDJSON containing structured lifecycle records such as:

```text
session
agent_start
turn_start / turn_end
message_start / message_update / message_end
tool_execution_start / update / end
compaction_start / end
auto_retry_start / end
agent_end
agent_settled
```

The implementation projects the persisted Specialists timeline instead of exposing internal forensic envelopes or asking a consumer to parse human feed output.

Review found and fixed three substantive defects before merge:

1. replay/live session `cwd` used the caller checkout rather than the persisted job worktree;
2. SQLite-success followed by file fallback could replay already emitted events;
3. mixed timestamp/sequence sorting across jobs was non-transitive and could violate per-job ordering.

The final implementation groups events by job, sorts each job stream by canonical `seq`, and performs a k-way chronological merge across queue heads.

### Consequence for Archon and deterministic workflows

This new NDJSON surface is now the preferred streaming boundary for a thin workflow adapter:

```text
start sp run --json
→ consume structured Pi-compatible events
→ correlate tools/messages/turns
→ observe agent_end / agent_settled
→ retrieve the authoritative final result with sp result --json
```

It removes the need to:

- poll and parse the human `sp feed`;
- scrape terminal panes;
- infer completion from prose;
- invent an Archon-specific Specialists event parser.

The authority split remains:

```text
sp run/feed --json = structured progress stream
sp result --json   = authoritative complete result
Supervisor status  = authoritative job lifecycle
```

The new stream does **not** replace the proposed direct Specialists→parent xtmux message. An interactive coordinator still benefits from an automatic typed terminal/waiting notification rather than maintaining a live stream for every child.

### Review and CI quality of the new hardening

- Core 0.11.2 release head passed CI, Semgrep, Gitleaks, and OSV.
- xtmux’s latest hardening head passed CI and CodeQL.
- Specialists #207 passed Gitleaks, OSV, Semgrep, and package-payload.
- Specialists #206 and #207 received actionable Codex review and resolved all findings raised on those PRs.
- Several xtmux release-hardening PRs did not receive Codex review because the review quota was exhausted. Their green CI is evidence of tested behavior, not evidence of an independent semantic review.

### Findings still current after the hardening delta

The recent PR file scopes do not touch the following defects, and their review threads remain current and unresolved.

#### Core

- `xtrm.topology.projection.v1` still allows an empty, partial, or duplicated source ledger.
- topology still collects Git worktrees from only the invocation repository while collecting panes server-wide.
- the rendered obligations route still resolves the invoking pane rather than the selected pane.
- the integration view still does not join PR state for each Specialist job branch.
- Serena remains provisioned while relevant GitNexus/service-skill hook matchers omit Serena tools.
- Semgrep recovery still uses `git reset --mixed`, which can unstage unrelated work.
- the Pi-only footer still rereads but does not generate the Beads status cache.
- `--subordinate --reuse` can still provision an unused worktree before session reuse is detected.

#### xtmux

- the Beads event follower still normalizes the stored cursor differently from the raw database timestamp, allowing repeated emission.
- the startup Beads cursor is still captured after setup work, leaving a loss window.
- Claude turn capture still reads the complete transcript before slicing its final 1 MiB.
- Claude turn capture still emits no fallback completed-turn record when transcript extraction returns no text.

#### Specialists

- the public `open-issues.json` operational export remains tracked.
- automatic branch-integration emission can still report the default branch instead of the temporary publication branch.
- `sp integration record` still accepts another flag as a missing option value and can persist malformed attribution.
- the direct typed Specialists→parent lifecycle notification has not landed.

### Review-thread state

The previous unresolved-thread count remains operationally relevant:

| Repository | Current unresolved | Outdated unresolved | Total |
|---|---:|---:|---:|
| Core | 9 | 1 | 10 |
| xtmux | 3 | 2 | 5 |
| Specialists | 3 | 1 | 4 |
| **Total** | **15** | **4** | **19** |

Recent Specialists findings on #206 and #207 are not added to this count because they were fixed and resolved before merge.

### Release caveat

Specialists #206 and #207 landed **after** release 3.21.1. The source tree contains the new NDJSON and ordering fixes, but package version 3.21.1 does not identify those commits. A later patch release is needed before treating that behavior as installed-artifact evidence.

Likewise, xtmux #68 and #69 landed after release 0.2.2; they harden the next release cycle rather than changing the already cut 0.2.2 package.

### Updated closure priorities

The compatibility and initial release-identity blockers can be removed from the closure list.

The remaining minimum closure wave is:

1. remove `open-issues.json` from the public repository and verify immutable runner protection;
2. fix the xtmux Beads cursor duplication and startup loss window;
3. enforce a complete, unique topology source ledger;
4. close the remaining Core topology/routing/Serena/index/cache/reuse findings;
5. fix Claude bounded-tail reading and completed-turn fallback;
6. correct Specialists integration target and CLI argument validation;
7. reply to and resolve all superseded review threads;
8. establish and publish the intended Specialists test baseline;
9. release Specialists with #206–#207 included;
10. implement direct Specialists→parent notification and deterministic chain-template dispatch as the next architectural program.

### Architectural conclusion after the new delta

The latest work strengthens the planned architecture rather than replacing it.

Most importantly, Specialists now has a credible structured streaming surface for workflow engines. The preferred future shape becomes:

```text
chain template resolves exact dispatch
→ adapter starts sp run --json
→ workflow consumes ordered structured events
→ Supervisor persists authoritative result
→ Specialists directly notifies the interactive parent through xtmux
→ parent or workflow retrieves sp result --json
→ deterministic gate selects the next node
```

This is a better foundation for the Archon comparison and for a canonical chain resolver. It does not reduce the need for direct parent notification, precise dispatch, or explicit hygiene ownership.

---

## Final delta re-audit — 2026-07-22

### Verdict

The implementation wave is **merged**, but the three-repository system is **not audit-closed**.

Positive closure evidence:

- the latest operator-authored PRs are merged;
- Core’s latest PR head passed CI, Semgrep, Gitleaks, and OSV;
- xtmux’s v0.2.0 release PR passed CI and CodeQL;
- Specialists’ latest PR passed Gitleaks, OSV, Semgrep, and package-payload;
- Core #484 made the global-skill migration durable;
- Core #485 added final installed-artifact ownership checks;
- xtmux #62 repaired npm bin packaging;
- xtmux #63 tagged v0.2.0;
- Specialists #203 completed the read/write surface for `xtrm.branch.integration.v1`.

Audit-closure blockers:

1. Core 0.11.1 still declares `xtmux >=0.1.0 <0.2`, while xtmux is now 0.2.0. Core’s launch preflight therefore rejects the final source trio.
2. Nineteen GitHub review threads remain unresolved: fifteen non-outdated and four outdated. Code revalidation shows that one outdated xtmux finding remains substantively valid.
3. Four P1/security findings remain live: incomplete topology source ledger, duplicate Beads event cursor, public operational issue export, and the runtime compatibility mismatch.
4. Multiple P2 correctness findings still reproduce in current source.
5. Specialists’ latest PR records approximately 68 pre-existing failures in `tests/unit/cli/`; the final workflow set does not provide a clean full-suite certification.
6. The final Specialists changes remain under package version 3.21.0, whose release commit predates PRs #199–#203.
7. The proposed direct Specialists→parent notification and canonical deterministic chain-template dispatch have not landed. They remain roadmap work, not missing implementation from the completed audit wave.

### Actual final delta

#### Core

- #484 merged: repo-scoped skill state no longer recreates retired `default/` and `optional/` tiers.
- #485 merged: Suite A verifies preservation of project-owned skills and flat global user packs; temporary suite sandboxes are cleaned correctly.
- Current source head: `14ef17810d4addec0346c1a558673dae255649de`.
- Current package version: `0.11.1`.

#### xtmux

- #62 merged: npm bin paths no longer use a leading `./`, preserving all seven commands during publication.
- #63 merged and tagged: `v0.2.0`.
- npm publication remains explicitly operator-authorized and was not performed by #63.
- Current source head: `8eb24cb99d3d7bce71732ad5acc43fe6459926ba`.

#### Specialists

- #203 merged: `sp integration list` reads `xtrm.branch.integration.v1` records and composes with #201 `record`.
- Current source head: `74b50b247c468ae4e449cf107c9b57fd24dde3c2`.
- Current package version remains `3.21.0`; PRs #199–#203 are not represented by a new release identity.

### New release blocker: Core rejects xtmux v0.2.0

Current Core contract:

```json
{
  "specialists": ">=3.21.0 <4",
  "xtmux": ">=0.1.0 <0.2"
}
```

Current xtmux package:

```json
{
  "version": "0.2.0"
}
```

Core #476 made this contract an enforced pre-worktree launch gate. Installing or linking xtmux 0.2.0 therefore causes `xt claude` / `xt pi` interactive launch to fail before worktree creation.

Required disposition:

- do not publish/install xtmux 0.2.0 across the fleet until Core’s compatibility contract and tests are updated;
- validate the real trio with xtmux 0.2.0;
- widen the range only after that live proof;
- release/update Core and xtmux in coordinated order.

### Review-thread accounting

| Repository | Current unresolved | Outdated unresolved | Total |
|---|---:|---:|---:|
| Core | 9 | 1 | 10 |
| xtmux | 3 | 2 | 5 |
| Specialists | 3 | 1 | 4 |
| **Total** | **15** | **4** | **19** |

Outdated-thread disposition:

- Core #485 user-pack location: fixed in later commits, thread not resolved.
- Specialists #203 subcommand help: fixed, thread not resolved.
- xtmux #57 temp-file permissions: fixed with a private temp directory and mode `0600`.
- xtmux #57 bounded transcript-tail read: marked outdated by line movement, but **not fixed**; current code still calls `readFileSync(transcriptPath)` before taking the final 1 MiB.

### Current P1 and security findings

#### P1 — runtime compatibility mismatch

Core’s enforced range rejects xtmux 0.2.0. This is a release blocker introduced by the final delta.

#### P1 — topology source ledger remains incomplete by contract

`xtrm.topology.projection.v1` still defines `sources` as an unconstrained array. It does not require exactly one entry for each of `xtmux`, `tmux`, `specialists`, `beads`, `git`, and `github`, nor uniqueness.

#### P1 — xtmux Beads cursor still duplicates ISO rows

Current `follow_beads()` still transforms the cursor:

```bash
.created_at | sub("T"; " ") | rtrimstr("Z")
```

but compares it against unchanged database `created_at`. ISO values containing `T` can remain greater than the normalized cursor containing a space, causing repeated emission.

#### P1 / security — `open-issues.json` remains public

The repository still tracks an operational export containing a known critical runner vulnerability, runner identity/labels, fork policy, operator email addresses, and internal security backlog.

Required disposition:

- remove it from the public tree;
- keep future exports outside version control;
- assess history cleanup and exposure;
- independently verify whether immutable runner denial has been implemented externally.

### Current P2 correctness findings

#### Core #465 — reuse can orphan a provisional worktree

`--subordinate --reuse` may create a worktree before session reuse is detected, leaving the extra branch and checkout behind.

#### Core #468 — cross-repository worktree projection remains incomplete

`collectProjection()` queries worktrees only from the invocation `cwd`, while pane collection spans the tmux server. Panes from another repository cannot resolve their worktrees correctly.

#### Core #469 — obligations route uses the invoking pane

The rendered command still resolves `#{pane_id}` at execution time rather than using the pane selected in the projection.

#### Core #469 — integration view omits Specialist-job PR state

The integration table shows Specialist job branches, but PR state is read only from `pane.pull_request`, which represents the coordinator/pane branch.

#### Core #470 — Serena provisioning and hook policy disagree

Core still installs Serena, while GitNexus and service-skill policies no longer match Serena navigation and mutation tools.

#### Core #471 — semgrep recovery unstages unrelated work

Recovery still runs `git reset --quiet --mixed`, preserving bytes but resetting the caller’s index.

#### Core #473 — Pi-only footer has no Beads cache writer

The Pi footer only reads and rereads `.xtrm/cache/beads-status.json`; it does not regenerate it.

#### xtmux #56 — startup cursor can lose Beads events

The Beads cursor is captured after dashboard/setup work and other followers, so mutations in that interval are excluded by the strict newer-than query.

#### xtmux #57 — Claude `agent-last` fallback remains missing

The Stop hook returns when transcript extraction yields no text; no fallback completed-turn enrichment is emitted.

#### xtmux #57 — transcript tail remains unbounded I/O

The hook reads the complete transcript, then slices the last 1 MiB.

#### Cross-repo topology contract — `tmux_server_id`

Core’s `xtrm.xtmux.topology.v1` requires `host.tmux_server_id`. Review evidence from xtmux #61 records that the producer emitted only `host_id`, and no later topology implementation PR followed #61.

#### Specialists #199 — automatic merge event can record the wrong target branch

The automatic emitter still falls back to the default branch, even when publication merges into a temporary PR branch.

#### Specialists #201 — flag-shaped values can corrupt integration records

The parser blindly consumes the next argv token as a value. A missing value can consume another flag and persist malformed attribution; the unique integration key may then prevent correction.

#### Specialists test health

The latest PR documents approximately 68 pre-existing `tests/unit/cli/` failures. Targeted and security/package checks pass, but no clean full-suite proof exists for the current head.

### Landed and verified improvements

The re-audit confirms these are complete:

- runtime compatibility is enforced before worktree creation;
- Specialist branches inherit coordinator ancestry;
- live Suite C proves ancestry, runtime origin, and integration;
- topology carries role/worktree/branch/parent-pane lineage;
- external merges can write integration evidence;
- integration evidence has a public read surface;
- roleless Bead turn-1 rendering exists;
- completed generic agent turns and exact messages have read surfaces;
- xtmux Claude hook installation converges;
- Core’s global-skill migration no longer recreates retired repo tiers;
- latest available PR workflows are green.

### Roadmap items not landed

These are roadmap items, not regressions in the completed wave:

- direct typed Specialists→parent lifecycle notification;
- `xtrm.specialist.parent-notification.v1`;
- canonical deterministic chain-template resolver;
- precise dispatch derived from the roadmap and modernization templates;
- Archon/XTRM production integration;
- automatic worktree pruning;
- production QuestDB execution workflow.

### Minimum closure wave

1. Repair Core↔xtmux 0.2 compatibility and run the real trio.
2. Remove `open-issues.json` and verify external runner denial.
3. Fix the xtmux Beads cursor P1.
4. Fix the Core topology source-ledger P1.
5. Fix or formally dispose every current review finding.
6. Reply to and resolve all outdated threads.
7. Establish a clean, intentional Specialists test baseline.
8. Cut coordinated releases so package versions and installed artifacts identify the same code.

Only then should the audit state move from **implementation merged** to **system closed**.

---

## 1. Executive decision

The current XTRM stack already contains most of the primitives required for deterministic orchestration:

- Core launches coordinators and subordinate runtimes, owns interactive worktree placement, and publishes agent branch/runtime metadata.
- Specialists owns specialist job execution, lifecycle, result persistence, Bead handoff, runtime lineage, and subordinate worktrees.
- xtmux owns pane/session identity, messages, reply obligations, monitors, wakes, topology, event transport, and completed-agent-turn retrieval.
- Beads owns durable work contracts and task acceptance state.
- Git owns branch, commit, merge, and integration truth.
- `xtrm.forensic.v1` owns reconstructable runtime evidence and correlation.
- Archon is being evaluated as an external declarative workflow engine, not adopted as an XTRM authority.

The main remaining weakness is not missing observability. It is that orchestration still depends too often on an agent remembering procedural machinery:

```text
dispatch
→ remember to poll sp ps / sp feed
→ infer a transition
→ remember to retrieve sp result
→ remember to dispatch the next node
→ remember to integrate the branch
→ remember to stop or clean jobs
```

The immediate correction is narrower:

```text
Specialists persists a meaningful transition
→ Specialists sends one typed xtmux message to the assigned parent
→ xtmux performs its existing generic delivery and wake behavior
→ the parent reads the message
→ sp result --json remains the authoritative complete result
→ the chain template determines the eligible next step
```

No Specialists-specific Pi extension, Claude hook pipeline, notification database, daemon, or result protocol should be added in the first implementation.

---

## 2. Evidence classification

This document uses four evidence classes.

| Class | Meaning |
|---|---|
| **Landed** | Merged and available in the repository snapshot. |
| **Open** | Active PR or explicitly unresolved implementation work. |
| **Needs revalidation** | Previously observed defect or review finding that may have been affected by later merges. |
| **Experimental** | Archon workflow behavior being tested; not an adopted XTRM contract. |

Claims about architecture must not silently promote experimental behavior into landed behavior.

---


## 3. Prior audit baseline and disposition

This section preserves the findings and contract conclusions established before the Specialists notification and Archon discussion. It is intentionally explicit so the document does not depend on conversation history.

### 3.1 Original audit scope

The original audit covered `xtrm-dev/core`, `Jaggerxtrm/xtmux`, and `xtrm-dev/specialists` as one runtime system rather than as isolated repositories.

The requested work included:

- inspect recent merged and open PRs as the freshest implementation evidence;
- inspect releases when they were newer than repository documentation;
- reconcile the existing `open-issues.json` inventory against current code;
- identify work that was completed, superseded, duplicated, mis-prioritized, or still active;
- inspect unresolved Codex review findings rather than treating merge status as review completion;
- verify runtime compatibility and packed-install behavior;
- verify coordinator, subordinate, worktree, pane, session, branch, Bead, and Specialist lineage;
- identify stale canonical and vendored skill guidance;
- distinguish observability evidence from operational authority;
- produce a later Jira/epic reorganization only after operator approval.

The audit must continue to treat recent code and live contracts as stronger evidence than stale planning documents.

### 3.2 Prior unresolved-review snapshot

At the prior audit snapshot there were **16 unacknowledged Codex findings**:

- **14 current unresolved findings**;
- **2 unresolved findings considered outdated by later code**, but still requiring an evidence-backed reply and explicit thread resolution.

This count is historical. It must be re-enumerated against the current PR heads before closure because later merges may have fixed, moved, or invalidated individual findings.

A merge does not imply that review obligations are complete.

### 3.3 Prior finding disposition matrix

| Repository / reviewed PR | Severity | Original finding | Current disposition | Later evidence that may affect it | Remaining action |
|---|---:|---|---|---|---|
| Core #467 | P1 | The topology `sources` ledger could be empty, partial, or duplicate, making the projection unable to explain which source contributed each fact. | **Needs revalidation** | Core #479 and xtmux #61 widened and populated agent topology fields, but they do not by themselves prove source-ledger completeness or deduplication. | Reproduce against the current aggregation path; fix once in the shared projection ledger if still present. |
| xtmux #56 | P1 | Timestamp cursor normalization could compare ISO and stored timestamp forms inconsistently and repeatedly select the same Beads rows. | **Needs revalidation; not known closed** | Later event rendering did not explicitly claim to change cursor semantics. | Test mixed timestamp forms and repeated polling against current main; preserve `(created_at, id)` monotonicity. |
| Specialists #199 | P1 / security | A public `open-issues.json` artifact reportedly exposed runner, security, operator, or environment details inappropriate for a public repository. | **Needs immediate revalidation** | Later Specialists PRs did not explicitly claim removal or redaction. | Confirm whether the artifact remains public; remove, redact, or relocate sensitive operational content. |
| Core #465 | P2 | `--subordinate --reuse` could provision or retain an orphan worktree when the reuse path did not complete cleanly. | **Needs revalidation** | Live Suite C proves normal ancestry/integration, not reuse failure cleanup. | Exercise reuse success, rejection, timeout, and launcher failure; assert no unowned worktree remains. |
| Core #468 | P2 | Cross-repository worktrees could disappear from aggregation because discovery or projection remained repository-local. | **Needs revalidation** | xtmux #61 improves remote pane lineage; it does not prove cross-repository worktree inventory completeness. | Test a parent and Specialist spanning different repositories and verify one coherent topology view. |
| Core #469 | P2 | Obligation routing could associate the wrong pane, and PR state could be derived from the coordinator/current branch rather than the job branch. | **Partially superseded; still needs separate checks** | xtmux #61 publishes `parent_pane_id`; Specialists #200 fixes branch ancestry; #201 records external integration. | Verify requester/target pane routing and job-branch PR lookup independently. Do not close one because the other improved. |
| Core #470 | P2 | Serena matcher/configuration was removed from one surface while Serena was still provisioned or referenced elsewhere. | **Needs revalidation** | Global-skill migration work changed provisioning paths but did not explicitly close this contract mismatch. | Trace every Serena provisioner, matcher, skill reference, and runtime registration; delete or restore one canonical path. |
| Core #471 | P2 | A mixed/reset operation could unstage unrelated operator work rather than only the files owned by the workflow. | **Needs revalidation** | No later PR reviewed in this audit explicitly claims this ownership-bound reset fix. | Reproduce with unrelated staged changes; replace broad reset with path-scoped ownership-safe behavior. |
| Core #473 | P2 | The footer could retain stale agent/runtime state in Pi-only sessions. | **Needs revalidation** | Core #473 substantially simplified the footer into a cache reader, which may supersede the original symptom but does not automatically resolve the review thread. | Run the original stale-state reproduction against current main; reply with evidence and resolve or fix. |
| xtmux #56 | P2 | Startup cursor capture could race with rows written during initialization and skip or duplicate events. | **Needs revalidation; not known closed** | Later human rendering is unrelated. | Add a deterministic startup-concurrency test around cursor establishment and first poll. |
| xtmux #57 | P2 | Claude transcript extraction failure could suppress full turn enrichment, causing `agent-last` to report not found despite a completed turn. | **Needs revalidation; high operational relevance** | No later PR explicitly claims a fallback that persists the completed turn when transcript parsing fails. | Simulate malformed/missing transcript; persist bounded fallback output or explicit unavailable reason without suppressing the turn row. |
| Specialists #199 | P2 | Reported integration target branch could be incorrect. | **Partially superseded** | Specialists #200 establishes coordinator branch ancestry; #201 publishes integration recording with explicit target fields. | Verify actual result/status output, forensic events, and integration rows all report the same target branch. |
| Two prior review threads | Outdated | Later commits appeared to invalidate the comments, but the threads remained unresolved. | **Administrative closure still required** | Exact identities must be re-enumerated from GitHub. | Reply with the superseding commit/PR and resolve explicitly; do not silently ignore them. |

The matrix records the original defect class, not a claim that each problem still reproduces. The closure rule is evidence, not age.

### 3.4 Prior requirements that have since landed

Several requirements identified during the earlier audit now have direct implementation evidence.

| Requirement | Evidence | Disposition |
|---|---|---|
| Publish build identity through machine-readable CLI output | Core and Specialists audit PRs; xtmux build identity work | Landed |
| Reject incompatible runtime combinations before creating an interactive worktree | Core #476 | Landed |
| Run packed installer/update smoke earlier on relevant PRs | Core #477 | Landed |
| Publish coordinator role, branch, worktree, and parent-pane lineage through topology | Core #479 + xtmux #61 | Landed |
| Make Specialist job branches descend from the coordinator branch | Specialists #200 | Landed |
| Prove ancestry, runtime origin, and integration in a real opt-in lane | Core #475 | Landed |
| Record integration performed outside `sp merge` | Specialists #201 | Landed |
| Render a Bead turn-1 body for roleless launches | Specialists #202 | Landed |
| Retrieve full completed generic agent turns without pane capture | xtmux #57 `agent-last` | Landed, with transcript-fallback caveat |
| Retrieve exact coordination message bodies | xtmux #57 `message-get` | Landed |
| Converge duplicate Claude hook registrations | xtmux #58 | Landed |
| Stream canonical Beads lifecycle events rather than duplicate hook facts | xtmux #56 | Landed, with cursor caveats pending revalidation |

### 3.5 Completed-turn and message semantics established by the earlier audit

The earlier audit established three distinct retrieval planes.

| Need | Canonical surface | Semantics |
|---|---|---|
| Exact coordination body | `xtmux message-get <message-key|id> --json` | Reads the durable message body. It does not mean the message was processed and does not retrieve a generic agent's full turn. |
| Latest completed generic agent response | `xtmux agent-last <pane|session> --json` | Reads the bounded full completed turn stored in `agent_turns.last_message_text`, subject to the Claude transcript caveat. |
| Live terminal state | pane capture | Used for streaming output, prompts, menus, authentication, or other state not represented by a completed result. |

The Pi child-to-parent completion path added with xtmux #57 stores the full response separately but sends only a compact one-line FYI summary to the parent. Therefore:

```text
automatic parent FYI
≠ full completed response
```

The parent must use `agent-last` when the full generic-agent conclusion is required.

For Specialists, the authoritative complete output remains:

```text
sp result <job-id> --json
```

### 3.6 Pane-capture conclusion

No hard technical prohibition against `tmux capture-pane` was landed.

The intended policy is semantic:

```text
completed coordination message → message-get
completed generic agent turn    → agent-last
completed Specialist job        → sp result --json
live terminal interaction       → pane capture
```

At the earlier snapshot, Core's canonical `multiplexing` skill still recommended capture for several ordinary result-discovery and preflight paths. Those instructions must be re-audited and corrected in the canonical source, then re-vendored.

### 3.7 Message acknowledgement conclusion

`message-get` should remain a pure read operation because it is also useful to:

- consoles and viewers;
- forensic tooling;
- an orchestrator inspecting another participant;
- retries and previews.

The receiving runtime should use:

```text
message-get
→ successfully queue the continuation
→ message-ack
```

This preserves at-least-once delivery and avoids acknowledging a message before its content reaches the model.

Do not conflate:

- wake delivered;
- message retrieved;
- receipt acknowledged;
- correlated reply obligation fulfilled.

A Specialist completion notification is normally reply-free FYI. A Specialist waiting transition normally requires `sp resume`, not `xtmux message-reply`.

### 3.8 Pi wake behavior observed during the earlier audit

The existing Pi coordination extension already:

- polls durable messages expecting replies and durable reply obligations;
- acknowledges receipts through the coordination path;
- renders bounded widget/system metadata;
- consumes terminal wakes with `wait-agent --consume`;
- sends one follow-up wake;
- intentionally avoids injecting untrusted inbound message summaries as executable instructions.

The missing bridge at that snapshot was precision. The continuation text was generic and did not reliably carry:

- the exact message key;
- the exact `message-get` command;
- the source pane/session for `agent-last`;
- a typed distinction between a coordination message and a completed-agent notification.

The proposed Specialists direct-message design reduces the need for a Specialists-specific extension. It does not remove the requirement that the generic Pi message wake preserve the stable message key and exact retrieval instruction.

### 3.9 Claude wake behavior observed during the earlier audit

The existing Claude hook path already:

- emits the native `Monitor(... wait-agent ... --consume)` continuation;
- consumes terminal wakes idempotently;
- uses xtmux monitor/wake state rather than a new Specialists state store.

The earlier gap was similar:

- no typed Specialists transition payload;
- no direct instruction to retrieve a Specialist result;
- no guarantee of Pi/Claude wording parity;
- no automatic child-to-parent completion FYI parity proven for every Claude path.

The current plan should therefore send one ordinary typed xtmux message from Specialists. Claude should receive it through the generic xtmux coordination path, not through a new Specialists completion hook.

### 3.10 Why typed completion metadata was considered

The compact Pi FYI was originally free-form text. Free-form text makes it difficult to select reliably between:

```text
message-get <message-key>
agent-last <source-pane>
sp result <job-id>
```

A typed Specialists parent notification is justified because it provides stable fields such as:

- transition kind;
- job ID;
- parent job ID;
- Specialist role;
- Bead and chain IDs;
- exact result/action command;
- correlation IDs.

For generic agent-turn FYIs, a later improvement may add typed source pane/session or turn ID metadata. That is separate from the Specialists notification package and should not be bundled without a concrete consumer.

### 3.11 Prior audit closure requirements

The consolidated audit is not complete until:

1. every previously unresolved review thread is re-enumerated;
2. every current finding has a reproduction or supersession proof;
3. every outdated finding receives an explicit evidence-backed response;
4. open-issue inventory is reconciled against landed PRs and current defects;
5. canonical skills are updated and vendored copies are regenerated;
6. packed-install and runtime compatibility checks pass;
7. the live cross-repository lane proves ancestry, routing, result retrieval, integration evidence, and cleanup;
8. remaining work is grouped into implementation packages or epics only after the technical disposition is known.

---

## 4. Updated repository evidence

### 4.1 Core

Recent work materially closes several earlier audit gaps.

| Evidence | Status | Consequence |
|---|---:|---|
| Core PR #475 — opt-in live Suite C lane | Landed | A real coordinator dispatches a real Specialist, verifies coordinator-branch ancestry, runtime origin, and integration back into the coordinator branch. |
| Core PR #476 — runtime compatibility preflight | Landed | Incompatible Core/xtmux/Specialists combinations are rejected before worktree creation. |
| Core PR #477 — PR installer smoke | Landed | Installer/runtime surface changes receive an earlier packed-install smoke. |
| Core PR #479 — topology contract widening | Landed | `role`, `worktree`, `branch`, and `parent_pane_id` are accepted in `xtrm.xtmux.topology.v1`. |
| Core PR #483 — prune retired empty skill tiers | Landed | Global-skill migration residue is reduced. |
| Core PR #484 — stop repo scope from recreating retired tiers | **Open** | The migration is not fully durable until this merges. |

Implication: branch ancestry, runtime compatibility, and topology contract gaps are no longer speculative design work. Follow-up work should reuse these landed contracts.

### 4.2 xtmux

| Evidence | Status | Consequence |
|---|---:|---|
| xtmux PR #56 — canonical Beads lifecycle event streaming | Landed | xtmux can observe canonical Beads mutations without duplicating lifecycle authority. |
| xtmux PR #57 — full completed turns, `agent-last`, `message-get` | Landed | Completed agent conclusions and exact coordination messages are retrievable without pane capture. |
| xtmux PR #58 — idempotent Claude hook installation | Landed | Duplicate lifecycle hook execution self-heals on install. |
| xtmux PR #60 — human event rendering and `xtmux-events` | Landed | The event journal is more usable without changing its machine format. |
| xtmux PR #61 — topology publishes role/worktree/branch/parent pane | Landed | Remote topology no longer needs a second local tmux read to reconstruct agent lineage. |

Implication: xtmux already has the delivery, identity, wake, topology, and retrieval primitives needed by Specialists. A new notification runtime would duplicate existing functionality.

### 4.3 Specialists

| Evidence | Status | Consequence |
|---|---:|---|
| Specialists PR #199 — `xtrm.branch.integration.v1` primitive | Landed | Integration can be recorded as evidence without replacing Git as authority. |
| Specialists PR #200 — job branches derive from coordinator branch | Landed | Specialists see coordinator work and can return changes to the correct branch lineage. |
| Specialists PR #201 — `sp integration record` | Landed | Manual, `xt`, or GitHub-driven merges can record the integration result through a public Specialists CLI. |
| Specialists PR #202 — `sp render-bead` | Landed | Bare Bead launches can receive a deterministic turn-1 task body without inventing a Specialist role. |
| Direct Specialists→parent lifecycle notification | **Not landed** | The parent still lacks a Supervisor-originated typed completion/waiting/failure message. |
| Automatic terminal resource cleanup audit | **Open** | Existing `sp clean` capabilities do not prove every owned runtime resource is released at the terminal transition. |

Implication: the correct notification seam is now easier to identify. Specialists already performs result persistence and Bead handoff at completion; message publication belongs beside that existing operation.

---

## 5. Architectural ownership

The system must preserve one authority per concept.

| Concept | Authority |
|---|---|
| Workflow graph and workflow-local node state | Chain template or experimental Archon workflow |
| Interactive worktree and coordinator placement | Core |
| Specialist job lifecycle and complete result | Specialists |
| Pane/session identity and live runtime routing | xtmux |
| Message delivery, reply obligations, monitors, and wakes | xtmux |
| Durable task contract and acceptance state | Beads |
| Branch, commit, and merge truth | Git |
| Branch-integration observation | `xtrm.branch.integration.v1` |
| Runtime evidence and correlation | `xtrm.forensic.v1` |
| Operational GO/NO-GO thresholds | Versioned deterministic code |
| Semantic judgment and exception handling | Coordinator or Specialist |
| Final production authority | Operator |

A component may reference another component’s record. It must not silently become the canonical owner of that state.

---

## 6. Design rule: push transitions, do not poll lifecycle

`sp ps` and `sp feed` remain valuable operator and recovery surfaces. They should not be the normal orchestration protocol.

### Current weak path

```text
parent dispatches Specialist
→ parent polls sp ps or sp feed
→ parent detects done/waiting/error
→ parent executes sp result
→ parent reconstructs chain context
```

Weaknesses:

- repeated process and database reads;
- agent attention consumed by supervision;
- missed transitions when the agent forgets to poll;
- no automatic wake;
- duplicated result-discovery instructions;
- follow-up dispatch depends on memory rather than the chain contract;
- orphaned jobs and sessions are easy to overlook.

### Target path

```text
Supervisor changes authoritative state
→ result and handoff are persisted
→ typed xtmux message is sent to the assigned parent
→ xtmux uses the existing generic wake path
→ parent retrieves the complete result with sp result --json
→ workflow template exposes the next eligible transition
```

Polling remains available for:

- live diagnostics;
- recovery after unavailable routing;
- human dashboards;
- forensic investigation;
- old runs without runtime origin.

---

## 7. Specialists direct parent notification

### 7.1 Correct implementation seam

Specialists already has a shared handoff path that:

- formats a unified handoff;
- appends it to the input Bead;
- records append failures without failing the run;
- optionally writes an output artifact.

The parent notification must be emitted from the same completion/waiting lifecycle seam, after authoritative state and result persistence.

Conceptually:

```ts
persistStatusAndResult();
appendResultToInputBead();
notifyAssignedParent();
```

Do not add notification behavior to:

- `sp feed`;
- `sp ps`;
- the CLI result reader;
- a new Pi extension;
- a new Claude-specific hook;
- the legacy ready-marker scanner.

### 7.2 Notification states

Initial implementation should publish only transitions requiring orchestration attention:

- `waiting`;
- `done`;
- `error`;
- `cancelled`;
- `stalled`, only if this is already a canonical Supervisor transition.

Do not publish:

- streaming text;
- thinking;
- every tool call;
- heartbeats;
- repeated unchanged status snapshots.

### 7.3 Routing precedence

The target must be derived from verified lineage, never guessed.

1. Explicit assigned parent target, if the dispatch contract already provides one.
2. Immediate verified parent runtime origin.
3. For a child Specialist job, resolve the parent job and use its verified runtime target.
4. Verified root runtime origin.
5. No target: do not send; retain result, Bead handoff, forensic evidence, and legacy fallback behavior.

A root pane must not receive a duplicate when the immediate parent is already the correct coordinator.

### 7.4 Minimal shared schema

A schema is justified here because the payload crosses Specialists, xtmux, and an agent runtime.

Recommended schema name:

```text
xtrm.specialist.parent-notification.v1
```

Minimum envelope:

```json
{
  "schema_version": "xtrm.specialist.parent-notification.v1",
  "kind": "job.completed",
  "job_id": "49adda",
  "specialist": "reviewer",
  "status": "done",
  "bead_id": "unitAI-123",
  "parent_job_id": null,
  "chain_id": "chain-abc",
  "node_id": "review",
  "summary": "Review completed with PASS_WITH_FOLLOWUPS.",
  "result_command": "sp result 49adda --json",
  "inspect_command": "sp log 49adda --limit 200",
  "action_command": null,
  "correlation": {
    "trace_id": "...",
    "span_id": "..."
  }
}
```

For a waiting run:

```json
{
  "schema_version": "xtrm.specialist.parent-notification.v1",
  "kind": "job.waiting",
  "job_id": "49adda",
  "specialist": "debugger",
  "status": "waiting",
  "bead_id": "unitAI-123",
  "summary": "A compatibility decision is required.",
  "result_command": "sp result 49adda --json",
  "inspect_command": "sp log 49adda --limit 200",
  "action_command": "sp resume 49adda \"<answer>\""
}
```

Rules:

- `summary` is bounded.
- Full output is never copied into the message.
- `sp result --json` remains authoritative.
- Commands are generated by Specialists, not inferred by the receiving LLM.
- No raw prompt, terminal capture, secret, or unrestricted environment data enters the payload.
- Missing optional correlation fields remain absent; values are never fabricated.

The schema should live in the existing shared contracts package only if more than one repository parses it. xtmux may transport the body opaquely.

### 7.5 Delivery semantics

Message publication is best-effort relative to job completion:

```text
job succeeds + message delivery fails
→ job remains successful
→ message failure is recorded
```

Initial implementation should not add:

- a notification outbox;
- retry worker;
- notification database;
- delivery daemon;
- `sp notifications` command group.

Add durable retry only after measured evidence shows message loss is operationally significant.

### 7.6 `xtrm.forensic.v1`

The message is delivery. Forensics is evidence.

Emit an existing-schema forensic event for:

```text
coordination.parent_notification.sent
coordination.parent_notification.failed
```

Correlate, where available:

- job ID;
- parent job ID;
- Bead ID;
- chain ID and chain root;
- node ID;
- pane/session/agent instance;
- trace/span;
- branch and commit evidence;
- returned xtmux message key.

The event must record outcome and identifiers, not the full model output.

### 7.7 Generic wake behavior

No Specialists-specific wake extension is required.

The existing xtmux message delivery path should wake Pi or Claude in the same way as any other coordination message. The receiving continuation should direct the agent to:

```text
xtmux message-get <message-key> --json
sp result <job-id> --json
```

`message-get` should remain read-only. Receipt acknowledgement belongs after the runtime has successfully queued the continuation, preserving the distinction between:

- message delivered;
- message inspected;
- receipt acknowledged;
- reply obligation fulfilled.

A Specialists completion notification is normally an FYI, not a reply obligation.

---

## 8. Completed output retrieval hierarchy

The canonical guidance across Core and Specialists skills should be:

```text
Exact coordination message
→ xtmux message-get <message-key> --json

Latest completed generic agent turn
→ xtmux agent-last <pane|session> --json

Complete Specialist result
→ sp result <job-id> --json

Live terminal/UI/auth/interactive state
→ pane capture
```

`capture-pane` must not be the standard mechanism for retrieving a completed conclusion or Specialist result.

The Core `multiplexing` and `multiplexing-team` skills must be re-audited and updated wherever they still recommend capture for result discovery, model detection, or ordinary sibling inspection.

---

## 9. Monitors after direct notification

Direct Specialist lifecycle notification reduces, but does not eliminate, monitors.

### Do not create a redundant monitor when

- Specialists already owns the lifecycle;
- a verified parent target exists;
- the required transition is `waiting` or terminal;
- Specialists will publish that transition directly.

### Keep or automatically create a monitor when

- the target is a generic agent pane rather than a Specialist job;
- the requester needs timeout semantics independent of agent completion;
- the task is interactive and does not produce a Specialists result;
- the parent target cannot receive direct lifecycle messages;
- a workflow gate explicitly requires a bounded wait.

Monitor creation must occur in the dispatch/launcher path, not as an instruction the agent must remember after dispatch.

---

## 10. Deterministic chain templates

The chain template should move procedural decisions out of model memory.

A mature template should declare:

- nodes and Specialist roles;
- dependencies;
- allowed parallelism;
- input and output schemas;
- deterministic `when` conditions;
- retry limits;
- waiting behavior;
- review gates;
- integration authority and target branch;
- operator approvals;
- terminal cleanup behavior;
- failure and cancellation behavior;
- chain completion criteria.

Example:

```yaml
nodes:
  - id: implement
    specialist: executor
    output_type: implementation-result

  - id: test
    specialist: test-runner
    depends_on: [implement]
    when: "$implement.output.status == 'complete'"

  - id: review
    specialist: reviewer
    depends_on: [test]
    when: "$test.output.verdict == 'PASS'"

  - id: integrate
    action: integrate-specialist-branch
    depends_on: [review]
    when: "$review.output.verdict == 'PASS'"
    approval: coordinator

  - id: cleanup
    action: cleanup-owned-runtime
    depends_on: [integrate]
```

The coordinator remains responsible for:

- semantic judgment that cannot be reduced to a deterministic rule;
- exceptions and conflict resolution;
- choosing among explicitly allowed transitions;
- authorized integration;
- operator escalation.

The coordinator should not have to remember the standard happy-path procedure.

> **Landing dependency — deterministic dispatch and chain templates**
>
> Precise, deterministic dispatch must land **alongside the canonical chain-template work**, not as an isolated launcher enhancement. The dispatch contract should be derived from the templates proposed in the Specialists roadmap and in **“Specialists Prompt, Chain Context, Interactive Coordination, Observability and Evaluation Modernization”**. Those documents define the broader chain model: node roles, dependencies, scrutiny levels, gates, context propagation, review behavior, and terminal conditions.
>
> The implementation should therefore ship one coherent contract:
>
> ```text
> selected chain template
> → resolved node graph
> → exact Specialist role and dispatch parameters
> → parent/coordinator assignment
> → automatic monitor or direct lifecycle-notification expectation
> → typed result contract
> → deterministic eligible next transition
> ```
>
> Dispatch logic must not invent a second, partial interpretation of a chain in Core, xtmux, or the coordinator prompt. One canonical template resolver should produce the dispatch plan consumed by the launcher and recorded in chain/job evidence. Until those proposed chain templates are implemented and versioned, any new deterministic dispatch behavior should remain narrowly scoped and explicitly transitional.

---

## 11. Archon evidence and its current status

### 11.1 Status

Archon remains an experiment.

The QuestDB plan explicitly separates:

1. `questdb-v2-maintenance-planning`
   - read-only;
   - evidence gathering;
   - deterministic GO/NO-GO;
   - plan generation;
   - no production change.

2. `questdb-v2-maintenance-execution`
   - mutating;
   - accepts only an approved plan;
   - repeats live preflight;
   - approval-gated;
   - checkpointed;
   - abortable;
   - rollback-aware.

The initial experiment must not replace Beads, xtmux, Specialists, or Core authority.

### 11.2 Transferable patterns

The useful Archon patterns are:

- explicit DAGs;
- parallel evidence gathering;
- typed node outputs;
- deterministic hard gates;
- fail-closed behavior;
- model synthesis that cannot override hard gates;
- approval nodes;
- dry-run by default;
- independent post-action verification;
- independent rollback workflows;
- single worktree authority;
- visible skipped/failed/cancelled state;
- artifact passing instead of terminal scraping.

### 11.3 Current experimental workflows

The attached examples demonstrate two valuable patterns.

#### Read-only hygiene

```text
deterministic worktree classification
→ LLM operator summary
→ approval records acceptance only
→ no pruning
```

This is the correct initial posture for worktree hygiene.

#### Gated merge FIFO

```text
deterministic eligible queue
+ independent Codex blocker gate
+ advisory LLM review
+ deterministic preflight
+ operator approval
→ merge
→ independent GitHub verification
→ post-merge hygiene
```

The LLM does not decide the merge set.

### 11.4 Archon/XTRM integration boundary

For the current experiment:

```text
Archon bash/script node
→ thin adapter
→ existing XTRM CLI
→ structured result
```

The first adapter should do only:

```text
start sp run
capture job_id
wait for a terminal result
read sp result --json
normalize exit/failure
return JSON
```

It must never:

- scrape a terminal pane;
- infer completion from log prose;
- create a second XTRM worktree;
- become the Bead authority;
- duplicate Specialists job state.

### 11.5 Ponytail correction to the proposed adapter surface

The QuestDB plan lists many potential `xtrm-archon` commands. Do not implement that surface up front.

Initial implementation should contain only the commands required by the read-only planning experiment, preferably wrappers over existing tools. Add another command only when a real workflow node cannot be expressed safely with an existing CLI or a short deterministic script.

### 11.6 Evaluation sequence

Run:

- **A:** native Archon nodes;
- **B:** the same DAG with selected analysis nodes delegated to Specialists.

Compare:

- graph determinism;
- routing correctness;
- role fidelity;
- structured-output reliability;
- evidence traceability;
- pause/resume;
- failure semantics;
- UI clarity;
- adapter size;
- preserved xtmux/Specialists identities;
- cost and operator intervention.

Do not build production execution until planning behavior is proven.

---

## 12. Merge and integration

### 12.1 Current evidence

The stack now contains:

- coordinator-based Specialist branch ancestry;
- a live Suite C integration test;
- `xtrm.branch.integration.v1`;
- `sp integration record`;
- topology fields for branch/worktree/parent;
- forensic lineage.

Therefore the next work should not invent a merge database or custom branch graph.

### 12.2 Minimal integration flow

```text
Specialist result accepted
→ coordinator integrates Specialist branch into coordinator branch
→ Git confirms resulting commit
→ caller runs sp integration record
→ xtrm.branch.integration.v1 records the observed result
→ topology/forensics can reconstruct the relationship
```

Git remains authority. The event is evidence.

### 12.3 Deterministic merge workflow candidate

The Archon merge-FIFO experiment is a useful model for a future coordinator merge gate:

1. Compute eligible branches or PRs deterministically.
2. Check unresolved Codex or reviewer blockers independently.
3. Run deterministic repository and ancestry preflight.
4. Ask the model for advisory risk analysis only.
5. Require coordinator or operator approval.
6. Merge in the predetermined order.
7. Record integration through `sp integration record`.
8. Independently re-query Git/GitHub.
9. Run post-merge hygiene.

This remains experimental until tested against real XTRM chain output.

---

## 13. Specialists hygiene

Process cleanup and worktree deletion must remain separate.

### 13.1 Terminal job cleanup

At terminal transition, Specialists should automatically release only resources owned by that job:

- RPC/agent child;
- process group;
- owned legacy tmux session;
- steer/resume FIFO;
- temporary prompt/materialization files;
- transient marker artifacts.

It must preserve:

- result;
- observability rows;
- Bead handoff;
- branch;
- worktree;
- integration evidence.

### 13.2 Waiting jobs

Use the existing waiting lifecycle and configured `waiting_auto_close_ms`.

Expected behavior:

```text
enter waiting
→ publish one waiting notification
→ suppress duplicate unchanged notifications
→ resume, finalize, stop, or auto-close
→ publish the resulting transition
```

### 13.3 Dead active jobs

Reconciliation rule:

```text
status in starting/running/waiting
+ owned PID is dead
→ mark canonical error/orphaned state
→ release remaining owned resources
→ notify parent
```

### 13.4 Worktree hygiene

Worktree cleanup must remain read-only/proposal-first until integration evidence is reliable.

Classify:

- recent and behind;
- dirty;
- unlanded commits;
- integrated and safe to prune;
- stale with work;
- orphan with no known PR/integration evidence.

Never auto-prune a dirty or unlanded worktree.

### 13.5 No new daemon initially

Do not add a global reaper daemon yet.

First:

- fix terminal cleanup at the shared Supervisor seam;
- retain `sp clean` for repair;
- run read-only hygiene through the Archon experiment;
- measure whether new orphan creation continues.

Add periodic reconciliation only if the local cleanup fix is insufficient.

---

## 14. Core and skill changes

Update only canonical skill sources, then re-vendor through the existing process.

Priority skills:

- `multiplexing`;
- `multiplexing-team`;
- `using-specialists`;
- `chain-coordinator`;
- `pr-reviewer`;
- `deploy-monitor`.

Required rules:

```text
Completed generic agent output → xtmux agent-last
Exact coordination message → xtmux message-get
Complete Specialist output → sp result --json
Pane capture → live terminal-only diagnostics
```

Coordinator contract:

```text
- Consume typed Specialist transition messages.
- Follow the chain template for eligible next steps.
- Do not implement delegated work directly.
- Integrate accepted Specialist branches into the coordinator branch.
- Record integration evidence.
- Do not merge the coordinator branch into main unless explicitly authorized.
- Before final completion, account for every owned non-terminal job.
- Report unresolved review threads, unintegrated branches, and preserved worktrees.
```

Review contract:

```text
PASS is forbidden while actionable unresolved review threads remain.
```

Deployment contract:

```text
PR merged is not deployment evidence.
Topology discovers branch/PR/job.
deploy-monitor verifies the deployed state.
```

---

## 15. Remaining audit work

### 15.1 Revalidate prior Codex findings

Later merges may have superseded earlier findings. For every current PR or affected code path:

```text
list unresolved threads
→ determine whether the finding still reproduces
→ fix once in the shared seam or reply with evidence
→ resolve the thread
```

Prioritize:

1. security or data-loss risk;
2. P1 correctness;
3. P2 correctness;
4. outdated findings.

### 15.2 Specific areas to re-audit

- Core topology source ledger completeness.
- Cross-repository worktree discovery.
- Pane routing for obligations and parent lineage.
- PR state association with the correct job/coordinator branch.
- xtmux Claude transcript extraction and `agent-last` availability.
- Specialists terminal cleanup and orphan creation.
- Stale skill copies after canonical updates.
- Open Core PR #484 and global-skill migration durability.

---

## 16. Minimal implementation packages

### Package A — shared notification contract

**Repositories:** Core contracts, Specialists
**Scope:**

- add `xtrm.specialist.parent-notification.v1` only if cross-repo parsing requires it;
- validate bounded fields and trust-boundary rules;
- one focused schema test.

**Skipped:** schema registry expansion, compatibility negotiation, notification database.

### Package B — Specialists direct parent notification

**Repository:** Specialists
**Scope:**

- call one notification helper from the shared lifecycle/handoff seam;
- route only through verified runtime lineage;
- send waiting/terminal messages through existing xtmux CLI;
- emit forensic sent/failed evidence;
- never fail the job because delivery failed;
- one focused transition test plus one routing test.

**Skipped:** outbox, daemon, retry worker, notification CLI.

### Package C — terminal resource hygiene

**Repository:** Specialists
**Scope:**

- audit every terminal exit through the shared Supervisor path;
- release resources owned by the job;
- preserve worktree/branch/result/evidence;
- one orphan-regression test.

**Skipped:** automatic worktree pruning.

### Package D — canonical skill propagation

**Repositories:** Specialists source skill, Core vendored/runtime distribution
**Scope:**

- update result retrieval hierarchy;
- remove ordinary result-discovery capture guidance;
- add coordinator notification and final-accounting rules;
- re-vendor once.

### Package E — live integration extension

**Repository:** Core integration suite, with installed trio
**Scope:**

Extend the existing live Suite C scenario:

```text
launch coordinator
→ commit coordinator-only change
→ dispatch Specialist
→ verify Specialist branch ancestry
→ complete Specialist
→ verify result appended to Bead
→ verify typed xtmux message targets parent
→ wake/read exact message
→ retrieve sp result --json
→ integrate branch
→ record sp integration record
→ verify topology and forensic lineage
→ verify owned runtime cleanup
```

No new simulation framework.

### Package F — Archon read-only experiment

**Location:** experimental workflow repository/configuration
**Scope:**

- run QuestDB planning workflow only;
- no worktree ownership in Archon;
- deterministic NO-GO evaluator;
- native run and Specialist-backed run;
- complete scorecard;
- preserve raw artifacts and run IDs.

**Skipped:** production execution, automatic board writes by default, Archon→Substrate compilation.

### Package G — deterministic merge/hygiene experiment

**Status:** open design, separate from Packages A–E
**Scope:**

- use read-only hygiene first;
- test deterministic merge queue and Codex gate;
- require approval before mutation;
- record integration;
- independently verify;
- no automatic pruning.

---

## 17. Acceptance criteria

The follow-up is complete when all of the following are true.

### Notification

- A terminal or waiting Specialist transition sends exactly one typed message.
- The message reaches the verified assigned parent.
- The message contains the exact result/action commands.
- Full output is not duplicated in the message.
- Delivery failure does not alter the job verdict.
- Sent/failed delivery is visible through `xtrm.forensic.v1`.

### Retrieval

- The parent does not use `sp feed` polling for ordinary completion.
- The parent does not use pane capture for a completed result.
- `sp result --json` returns the authoritative result.
- `xtmux message-get` returns the exact coordination payload.

### Integration

- Specialist branch descends from the coordinator branch.
- Accepted work integrates into the coordinator branch.
- Integration is recorded through `sp integration record`.
- Git remains the source of truth.
- Review blockers are resolved or explicitly reported.

### Hygiene

- Terminal jobs release owned process/session/FIFO resources.
- Worktrees containing unintegrated work are preserved.
- No automatic prune occurs without deterministic safety evidence.
- Every chain completion accounts for remaining active/waiting jobs.

### Workflow determinism

- The chain template determines standard next-node eligibility.
- Deterministic gates cannot be overridden by LLM prose.
- The coordinator handles judgment and exceptions, not procedural memory.
- Archon remains experimental until scorecard evidence supports a narrower decision.

---

## 18. Non-goals

The following are explicitly excluded from the immediate implementation:

- replacing xtmux messages with a Specialists notification bus;
- adding a Specialists-specific Pi extension or Claude hook;
- copying full Specialist output into wake prompts;
- building a notification outbox before message loss is observed;
- introducing a global cleanup daemon before fixing local cleanup;
- automatic worktree deletion;
- making Archon the XTRM source of truth;
- running both Archon and Core worktree ownership in one workflow;
- compiling Archon YAML into Substrate templates before experiments;
- automatic production QuestDB maintenance;
- allowing an LLM to override deterministic operational gates;
- creating many `xtrm-archon` commands speculatively.

---

## 19. Recommended order

1. Merge or resolve Core PR #484.
2. Revalidate current unresolved review findings against the new repository heads.
3. Implement the shared Specialist parent-notification contract.
4. Emit direct parent notifications from the existing lifecycle/handoff seam.
5. Audit and fix terminal owned-resource cleanup.
6. Land the canonical chain-template resolver and precise deterministic dispatch contract together, aligned with the Specialists roadmap and the modernization document.
7. Update and re-vendor canonical orchestration skills.
8. Extend live Suite C with template resolution, exact dispatch, notification, result, integration-record, and cleanup assertions.
9. Run the Archon QuestDB planning experiment in native and Specialist-backed modes.
10. Evaluate the merge/hygiene experiment separately.
11. Produce a narrower architectural decision from measured results.

---

## 20. Evidence register

### Repository PRs

- Core #475 — live Suite C Specialist ancestry/integration lane
  https://github.com/xtrm-dev/core/pull/475
- Core #476 — runtime compatibility before worktree creation
  https://github.com/xtrm-dev/core/pull/476
- Core #477 — PR installer smoke
  https://github.com/xtrm-dev/core/pull/477
- Core #479 — topology agent contract widening
  https://github.com/xtrm-dev/core/pull/479
- Core #483 — retired skill-tier pruning
  https://github.com/xtrm-dev/core/pull/483
- Core #484 — scope-aware skill scaffolding, open at snapshot
  https://github.com/xtrm-dev/core/pull/484
- xtmux #56 — canonical Beads lifecycle stream
  https://github.com/Jaggerxtrm/xtmux/pull/56
- xtmux #57 — agent-last and message-get
  https://github.com/Jaggerxtrm/xtmux/pull/57
- xtmux #58 — hook installer idempotency
  https://github.com/Jaggerxtrm/xtmux/pull/58
- xtmux #60 — human event renderer and xtmux-events
  https://github.com/Jaggerxtrm/xtmux/pull/60
- xtmux #61 — topology role/worktree/branch/parent pane
  https://github.com/Jaggerxtrm/xtmux/pull/61
- Specialists #199 — branch-integration event primitive
  https://github.com/xtrm-dev/specialists/pull/199
- Specialists #200 — coordinator branch ancestry
  https://github.com/xtrm-dev/specialists/pull/200
- Specialists #201 — `sp integration record`
  https://github.com/xtrm-dev/specialists/pull/201
- Specialists #202 — `sp render-bead`
  https://github.com/xtrm-dev/specialists/pull/202

### Internal and experimental material

- **Archon + XTRM — QuestDB Maintenance Workflow Plan**
- Archon workflow examples:
  - `orch-hygiene-readonly`
  - `xtrm-merge-fifo`
  - `sre-triage-live`
- Existing Specialists modernization and open-issues audit context.
- Prior Core/xtmux/Specialists cross-repository audit findings and Codex review threads.

---

## 21. Final architectural position

The shortest path to a more deterministic system is not another orchestrator layer inside Specialists.

It is:

```text
declarative chain
+ deterministic gates
+ Specialists-owned lifecycle
+ direct typed parent notification
+ xtmux-owned delivery and wake
+ authoritative structured result
+ Git-owned integration truth
+ forensic evidence
+ explicit cleanup
```

Archon is valuable as an experimental workflow engine and as evidence for better chain semantics. Its strongest patterns should influence XTRM only after they have been exercised in real read-only workflows and compared against the existing Specialists runtime.

The immediate production improvement remains small: one lifecycle notification helper, one shared payload contract, one generic xtmux delivery path, one terminal cleanup audit, and one live end-to-end check.
