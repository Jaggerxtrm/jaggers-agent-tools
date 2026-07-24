---
title: Service-Skills Claim Verifier
scope: service-skills
category: reference
version: 0.1.0
updated: 2026-07-24
description: "Deterministic, advisory-only claim verifier for service SKILL rewrites — contract, taxonomy, gate-lattice reference."
domain: [service-skills, verifier, knowledge-base]
---

# Service-Skills Claim Verifier

Bead: `xtrm-56flm.1` (PR1 of the knowledge-base reframe, epic `xtrm-56flm`).
Companion to `docs/service-skills-auto-reconcile.md`.

## Why this exists

The auto-reconcile + service-skills-sync pipelines could not tell *"the LLM wrote
something plausible"* from *"the LLM wrote something true"*. A recent specialist
run shipped three factual errors in one SKILL section — an invented redaction-key
set, a wrong redaction literal, and a mis-labeled metric-label set — caught only by
manual operator review. This module is the deterministic layer that makes those
errors machine-visible **before** a human ever reads the diff.

The design follows the candidate-in-isolation → deterministic-tools → evidence-report
→ gate pattern (Codex Security, Aider, Cursor shadow-workspace, Copilot code review).
Research §2 justifies decomposition + critic-on-residuals; it does **not** justify
LLM-panel gates. So this PR ships only the deterministic layer.

**Advisory only.** PR1 changes no behavior. `reconcile.py`, the activator, the
cataloger, and every hook are untouched. The verifier exits `0` always; the verdict
lives in the manifest, not the exit code. PR2 wires the gate; PR3 exposes the MCP
tools + FTS5 index.

## Location

```
skills/service-skills/scripts/verifier/
├── __init__.py            # public API: verify_candidate()
├── __main__.py            # CLI: python3 -m verifier ...
├── taxonomy.py            # 13-type ClaimType, Verdict/Comparison/Completeness, Claim
├── diff_parser.py         # candidate-vs-current → new/modified substantive lines
├── structural_validator.py# frontmatter, headings, SEMANTIC block, MD AST, links
├── claim_extractor.py     # the 5 implemented extractors
├── closure_markers.py     # "exactly N" / "the N … are" / "complete list" detection
├── authority.py           # 7-level evidence authority hierarchy
├── source_corpus.py       # loads territory files + parses compose YAML
├── manifest.py            # stable claim_id, content_hash, jsonschema validation
├── evidence_report.py     # JSON + Markdown rendering
├── telemetry.py           # one structured JSON line to stderr
├── schema/manifest_schema.json
└── tests/                 # pytest suite + golden fixtures
```

## CLI contract

```bash
python3 -m verifier \
  --candidate <path/to/candidate.md> \
  --current   <path/to/current.md> \
  --territory '<glob>[,<glob>...]' \      # repeatable; default: source/**
  --refs       base=<sha>,head=<sha> \     # optional; verified_at_ref := head
  --output-format json|markdown \          # default: json
  [--service-id <id>] [--source-root <dir>] [--no-telemetry]
```

Run with the package's parent on `PYTHONPATH` (e.g. `cd scripts/verifier &&
PYTHONPATH=.. python3 -m verifier …`, or `cd scripts && python3 -m verifier
--candidate verifier/tests/…`). Territory globs are resolved against the explicit
`--source-root`, the candidate's directory, its parent, and cwd (unioned); the
candidate/current SKILL files are always excluded from the corpus so prose never
verifies against itself.

**Exit code is always `0`** (advisory mode). A `CONFLICT` does not fail the process
— it is a row in the manifest. This is deliberate: PR1 must not block anything.

## Claim taxonomy (research §2.3)

Thirteen claim types are enumerated so the schema is stable and consumers can switch
on every type. **Five are implemented** in this revision (REVISION 3 scope cut); the
other eight are recognized but not yet extracted — they default to `completeness =
unknown`, which yields no false positives.

| Type | Status | What it checks |
|------|--------|----------------|
| `quoted_literal` | ✅ implemented | a backticked literal equals the source assignment for its subject |
| `set_claim` | ✅ implemented | a closure-marked set matches the source-enumerated set/count |
| `metric_label_set` | ✅ implemented | a metric's claimed labels equal its `labelnames` in source |
| `environment_constant` | ✅ implemented | an env var (and optional value) is declared in compose |
| `compose_resource` | ✅ implemented | a named service/volume/network exists in compose |
| `symbol_name` | ⏳ deferred | a code symbol exists |
| `metric_family` | ⏳ deferred | a metric family exists |
| `config_value` | ⏳ deferred | a config key/value matches |
| `citation_claim` | ⏳ deferred | a cited ref resolves |
| `procedure_claim` | ⏳ deferred | a documented procedure runs |
| `causal_claim` | ⏳ deferred | a stated cause/effect holds |
| `runtime_claim` | ⏳ deferred | a runtime behavior is observable |
| `external_claim` | ⏳ deferred | an external fact checks out |

## Verdict model

Each claim carries a `verdict` ∈ {`PASS`, `CONFLICT`, `UNKNOWN`} plus a `comparison`
∈ {`equal`, `unequal`, `subset`, `superset`, `unresolved`, `not_applicable`} and a
`completeness` ∈ {`complete`, `partial`, `unknown`}.

- **PASS** — the claim is confirmed against source (e.g. label sets equal).
- **CONFLICT** — the claim is contradicted by source (e.g. claimed literal `≠` source
  literal; claimed labels `≠` source `labelnames`).
- **UNKNOWN** — the deterministic layer cannot resolve it. This is the *safe default*
  and the hand-off point for PR2's residual LLM critic.

**Completeness defaults to `unknown` aggressively** (research §7). A false `complete`
is the most dangerous false-positive class because it manufactures a false `CONFLICT`
downstream. Closure markers (`closure_markers.py`) only assert `complete` on explicit
signals: `exactly N`, `the N <noun> are`, `complete/exhaustive/full list`, `all of the`,
`only the`.

## Closure markers (research §2.4)

`detect_closure(text)` returns `(completeness, expected_count, marker)`. The
alertmanager golden fixture exercises this: *"…uses exactly 4 sed variables…"* →
`expected_count = 4`; the extractor counts `${VAR}` substitutions in the entrypoint's
`sed` lines → `observed_count = 4` → `comparison = equal` → `PASS`.

## Authority hierarchy (research §2.6)

Evidence is ranked; a verdict is only as trustworthy as the source backing it.

```
executable code (7) > tests/fixtures (6) > read-only probes (5)
  > semantic blocks (4) > verified claims (3) > auto-gen unverified (2) > memory items (1)
```

Curatorial `SEMANTIC_START`/`SEMANTIC_END` blocks are authority-4: the verifier reads
**through** them for context but **never extracts claims from inside them** — that
content is human-authored, not machine-verifiable. `claim_extractor` masks those lines
before extraction.

## Manifest schema (research §2.5)

`schema_version = 1` (locked; breaking changes bump it). One row per claim:

```
schema_version, claim_id, service_id, section_path, claim_text, claim_type,
subject, predicate, objects[], completeness, expected_count, observed_count,
comparison, risk, authority_required, source_refs[], verdict,
verifier_id, verifier_version, verified_at_ref, evidence_digest, advisories[]
```

`claim_id` is a stable `sha256` of `service_id + section_path + normalized
subject/predicate/objects + claim_type` — so the same claim regenerated across runs
collides. This underpins the PR3 invalidation model (non-stable IDs would break it).
The manifest validates against `schema/manifest_schema.json` (Draft 2020-12).

## Gate lattice reference (no wiring yet)

PR2 will gate on the manifest. The intended lattice (research §2.6), for reference:

| Verdict pattern | Authority met? | Gate action (PR2) |
|-----------------|----------------|-------------------|
| all `PASS` | yes | allow |
| any `CONFLICT` | n/a | block + evidence report |
| only `UNKNOWN` residuals | yes | route to LLM critic on residuals |
| `UNKNOWN` + authority too low | no | require higher-authority source |

**None of this is wired in PR1.** The manifest is emitted; nothing consumes it yet.

## Telemetry contract

One structured JSON line per invocation to **stderr**, grep-able by
`component=verifier`:

```json
{"timestamp": "...", "component": "verifier", "event": "run",
 "candidate_hash": "...", "current_hash": "...", "service_id": "...",
 "claim_count": 3, "verdict_counts_by_type": {...}, "duration_ms": 4.2}
```

No secrets and **no raw claim text** — only content hashes and per-type verdict
counts. Suppress with `--no-telemetry`.

## Golden fixtures

`tests/fixtures/` reproduces real failure classes (synthetic literals only — e.g.
`FAKE_TOKEN`, never real `.env` keys):

- **api-gateway/** — the observed 3-error regression: invented redaction-key set
  (`set_claim`, complete, `unresolved`), wrong redaction literal (`quoted_literal`,
  `CONFLICT`), mis-labeled metric labels (`metric_label_set`, `unequal`).
- **alertmanager/** — closure marker + `set_claim`: *"exactly 4 sed variables"* →
  `observed_count = 4`, `equal`, `PASS`.
- **runners/** — `metric_label_set` + `compose_resource` + `environment_constant`,
  all `PASS`.

## Residual UNKNOWN (input to PR2's residual-critic design)

The deterministic verifier returns `UNKNOWN` when:

1. **No resolver exists for the claim's subject.** The `set_claim` extractor only
   resolves subjects it has a counter for (currently `sed` variables). A prose
   redaction-key set has no resolver → `unresolved`. *This is by design* — the api-gateway
   invented-set case lands here rather than risking a false `CONFLICT`.
2. **The subject/metric/resource is absent from the territory corpus.** Either the
   source genuinely lacks it (a real conflict the extractor conservatively calls
   `UNKNOWN`) or the territory glob didn't load the right file.
3. **The 8 deferred claim types** (`symbol_name`, `metric_family`, `config_value`,
   `citation_claim`, `procedure_claim`, `causal_claim`, `runtime_claim`,
   `external_claim`) are not extracted at all yet.

These residuals are exactly the claims PR2's LLM critic should adjudicate — the
deterministic layer decides what it can, and hands the rest forward with its evidence
digest intact.
