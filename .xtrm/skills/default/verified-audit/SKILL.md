---
name: verified-audit
description: "Audit a file, subsystem, or repo for over-engineering and inefficiency, and verify every candidate cut with call-graph impact analysis before proposing it. Use whenever the user says \"audit this\", \"what can I delete\", \"find slop\", \"find bloat\", \"is this over-engineered\", \"sweep for waste\", \"reduce complexity\", \"hunt for redundant code\", \"find performance slop\", \"latency review\", \"find hot-path waste\", or asks for a whole-file / cross-file / repo-wide review of code quality. Two orthogonal axes are covered: line-count slop (dead code, one-line wrappers, reinvented stdlib, duplicated helpers, dead enum branches) and efficiency slop (sync fork in hot path, unmemoized deterministic computation, redundant I/O, N+1, regex-per-call, object alloc in loops, sequential-independent awaits). Every finding carries verified blast-radius receipts — never propose a cut without them. Diff-scope review is out of scope (use reviewer/seconder for that); this skill is for whole-file audits and repo sweeps."
disable-model-invocation: true
---

# Verified Audit

A senior-engineer audit lens for over-engineering and inefficiency, paired with call-graph verification so no proposed cut ships without receipts.

## When to use

Whole-file audits, cross-file sweeps, repo-wide reviews. Trigger phrases:

- "audit this file / subsystem / repo"
- "what can we delete"
- "find over-engineering" / "find bloat" / "find slop"
- "sweep for waste"
- "latency review" / "hot-path review" / "find performance slop"
- "is this over-engineered"
- "reduce complexity"

## When NOT to use

- Small diffs on one branch → that's what `reviewer` and `seconder` are for. They already run a bounded post-writer gate on the writer's diff with the same vocabulary. This skill is broader (whole-file, cross-file) and heavier (efficiency lens + subagent sweeps).
- Correctness bugs → use `/code-review` or the reviewer specialist.
- Security findings → use `security-review` or `security-auditor`.

## Why bother

Two failure modes this skill is designed against:

1. **Naive audit proposes cuts that are load-bearing.** "Looks like slop" without a call-graph check is guesswork. GitNexus turns it into "safe to cut, here is the blast radius."
2. **Line-count review misses latency slop entirely.** Redundant I/O, sync fork in hot paths, unmemoized deterministic computation — zero line savings, huge user-visible cost. A pure line-count review will not catch these.

The skill exists to separate "looks like slop" from "is slop" — and to run both axes at once.

## Method: four legs

Every audit runs four legs. Skip any leg and you either miss real slop or ship a cut that breaks something.

### Leg 1 — The reduction lens (line-count)

Read the target. For every candidate, stop at the first rule that holds:

1. **Does it need to exist?** Speculative or dead code → mark for delete.
2. **Already in this codebase?** A helper 3 files over already does this → reuse it.
3. **Stdlib does it?** Use it. (Node examples: `setTimeout` from `node:timers/promises` for `sleep`, `randomUUID` from `node:crypto`, `structuredClone` for deep copy.)
4. **Native platform feature covers it?** Language/runtime primitive over user-space code.
5. **Already-installed dependency solves it?** Grep `package.json` before writing anything the deps handle (e.g. `zod` for schema validation, don't hand-roll a validator).
6. **Can it be one line?** Chained `.replace()` × 3 → one regex. Named 4-line helper with one call site → inline expression.
7. **Only then:** the minimum code that works.

### Leg 2 — Call-graph verification (GitNexus impact)

For every function/method/class candidate:

```
gitnexus_impact({target: "<symbolName>", direction: "upstream", repo: "<repo>"})
```

Record: `risk` (LOW/MEDIUM/HIGH/CRITICAL), `direct_callers`, `processes_affected`, `modules_affected`. Batch calls in parallel — one message with N tool uses.

**Filter:** LOW = safe cut, MEDIUM = safe cut with a verify pass, HIGH = redesign or leave, CRITICAL = leave. Slop can live at all levels; only CRITICAL is a hard stop.

### Leg 3 — Config / usage grep (for enum branches and dead data)

GitNexus reasons about symbols, not enum values or dead switch cases. For candidates that look like:

- A branch in a `switch (outputType) { case 'foo': ... }` and no config sets `outputType: 'foo'`.
- A `Record<Enum, T>` entry whose key is never referenced by any consumer.
- A deprecated code path (YAML fallback, legacy migration bridge) that no live spec exercises.

Grep the config directories and the consumer files to prove/disprove reachable. Dead data does not appear in a call graph.

### Leg 4 — Efficiency signals (the axis line-count misses)

Scan for these independent of line-count:

- **Sync fork in hot path**: `execSync`, `spawnSync`, `readFileSync`, `existsSync` inside per-spawn / per-turn / per-event code. Each blocks the event loop.
- **Regex / schema / template constants inside functions** — recompiled per call. Hoist to module scope.
- **Redundant instantiation** — `new X()` more than once per logical operation.
- **Deterministic pure computations re-run per call** — same input, same output, recomputed every invocation. Memoize with `Map` / `WeakMap` / module-scope const.
- **Sequential awaits / execSyncs of independent operations** — `Promise.all` / parallel batch candidates.
- **N+1 patterns** — any loop containing a subprocess spawn, fs read, or SQLite query.
- **Duplicate reads** — same file / bead / SQLite row read more than once per logical operation.
- **JSON.parse of the same string more than once** — parse once, pass the value.
- **String concatenation in loops** — accumulator `+=` on an unbounded input is O(n²). Use `parts: string[]` + `.join('')`.
- **Object allocation in hot loops** — repeated 9-field object literals at each branch of a switch, when 7 of 9 fields are invariant across branches. Bind once, spread the deltas.
- **Prompt / schema / skill-path assembly re-done for identical inputs** — memoize per-spec at load time.
- **Wasted async** — `await` on something that could have been fired-and-parallelized.

Rank each efficiency finding by **latency**:

- **HIGH**: >100ms per event, or O(n²) at scale, or sync-blocking >50ms, or a network syscall in a per-spawn path.
- **MEDIUM**: 10-100ms per event, per-turn cost, extra SQLite roundtrip per hot-path.
- **LOW**: allocation-only, regex-hoist, one-pass merge, memoize-cheap-fn.

Efficiency findings frequently save zero lines — that is fine. They are their own axis.

## Methodology gotchas

Real failures from prior sweeps. Read before running.

### 1. Closures inside methods fool GitNexus

A function defined as a closure inside another method (e.g. `const handler = () => { ... }` inside `run()`) has `direct_callers = 0` in the impact graph. GitNexus does not see the enclosing method's own body as a caller of its inner closures.

**Workaround:** when impact reports `direct_callers=0` on something you know is called, grep-verify. Search the file for the closure name; caller lives in the enclosing method.

### 2. Dead-data branches evade GitNexus

Dead entries in a `Record<Enum, T>`, unused `case 'x':` in a switch, deprecated format handlers (YAML alongside JSON when no `.yaml` files exist) — none appear as "dead code" in the call graph. The function containing the switch is very much alive.

**Workaround:** Leg 3 (config grep). List every value the discriminator can take; grep for actual producers.

### 3. Dead files exist

An entire module can be speculative infrastructure shipped ahead of demand, imported only by its own test. Whole-module gitnexus impact + `rg -n` on top-level exports across `src/` and `config/` catches these fast.

**Workaround:** for any suspected dead file, `rg -n '<exportedName>|<exportedType>' src config`. If the only hits are the file itself + its test, it is deletable.

### 4. File size ≠ slop density

The scariest, biggest file often has the least line-count slop and the most efficiency slop. Do not rank sweep priority by line count. Rank by suspected hot-path density: which files are on the request path, the per-spawn path, the per-tick path.

## Finding output format

One section per finding. Rank by (lines_saved × ease) for line-count, by latency tier for efficiency.

```
### F<n> — <one-sentence summary>. LINE-IMPACT: <LOW|MEDIUM|HIGH|-> / LATENCY: <LOW|MEDIUM|HIGH|->
- Where: `path:lineStart-lineEnd`
- Cut rule: <1-7 from Leg 1, or "efficiency-only">
- Signal: <which Leg-4 signal, or which Leg-1 rule caught it>
- Impact receipts: `<symbol>` → risk=<X>, direct_callers=<N>, processes=<N>, modules=[<list>].
- Callers: <list, or "internal to file only">
- Cost estimate: <per-spawn / per-turn / per-tick / per-N ops — for efficiency findings>
- Fix: <the lazier or faster version — one sentence or a short snippet>
- Lines saved: <N or 0>
- Verify notes: <for MEDIUM/HIGH — test / snapshot / benchmark that catches drift>
```

Always finish the report with:

- **Total est. line savings** and **total efficiency wins by tier**.
- **Methodology limits** — what this pass couldn't catch (things that need a human, a benchmark, or a different lens).
- **Skipped-but-checked** — candidates that looked like slop but proved load-bearing. Every skip cites its evidence (test that pins the behavior, cross-module caller that gitnexus caught, config value that keeps the branch live). This section is high-signal — it stops the next reviewer from re-flagging the same thing.

## Scaling: subagent sweep pattern

For a repo-wide audit, do NOT do it in one context. Fan out one subagent per file, in parallel.

Per-file subagent prompt template:

- **Target**: one file path, plus known prior findings on it (so the subagent does not re-report).
- **Legs**: all four required; explicit list of efficiency signals.
- **Verification**: GitNexus impact for every function candidate; grep for enum-branch candidates; whole-file impact + `rg` for suspected dead files.
- **Format**: the finding template above.
- **Filter**: report LOW/MEDIUM/HIGH; skip CRITICAL. MEDIUM+ needs verify notes.
- **Don't**: no edits, no invented findings, no proposed additions of abstractions. Subtractive only.

After all subagents return, merge:

1. Deduplicate cross-file findings (e.g. a `sleep` helper duplicated in two files surfaces from both — collapse to one finding with both locations).
2. Rank by (lines_saved × ease) for line-count, latency tier for efficiency.
3. Emit pure-delete inventory (zero verify needed) separately from structural findings (verify required) — the former ships as one commit, the latter goes bead-by-bead.

## Applying cuts

Sequence:

1. **Pure deletes first.** Zero-caller functions, whole-file kills, dead-data branches with no live producer. One commit, brief message. No verify required beyond `tsc --noEmit` / linter / test suite passing.
2. **LOW inlines next.** Single-caller helpers, chained `.replace()` → one regex. One commit per logical group.
3. **MEDIUM structural cuts** each get their own commit and their own verify pass:
   - Snapshot the user-facing surface before (test suite output, prompt blob, SQLite row schema, whatever the change touches).
   - Apply the cut.
   - Diff the surface. Behavior must be byte-identical unless the change is explicitly semantic.
4. **HIGH cuts** get a plan reviewed before shipping. Do not batch with anything else.

## What this skill will not do

- Add abstractions to make future work easier. Subtractive only — that is the whole point.
- Propose migrations (framework swap, dep swap). Slop reduction, not architecture change.
- Judge style or naming for taste. Findings must have concrete evidence (line count, latency estimate, gitnexus receipts). "Looks messy" is not a finding.
- Second-guess load-bearing code without evidence. The skipped-but-checked section is the discipline.

## Reference

Prior sweep on the specialists repo (7 core files, ~7500 lines) produced 61 findings, ~535 removable lines, and 38 verified efficiency wins. Top user-visible wins came from Leg 4: an SQLite N+1 in a per-status-write path, a `readFileSync + JSON.parse` per specialist during `sp list`, a 500ms–10s network syscall in a fallback branch. None would have surfaced from a line-count-only pass. Both axes are load-bearing.
