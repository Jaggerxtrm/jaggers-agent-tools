---
name: deploy-monitor
description: Post-merge deploy verification helper. Use whenever a PR has been merged, a service/container has been rebuilt or redeployed, or an orchestrator asks for a 30-60 minute observability window. Enforces the deploy-gap guard (running artifact must be newer than the merge), samples Tempo/Prometheus/Grafana or mcpq evidence on an absolute UTC schedule, pages on the first HOLD, writes bead evidence, emits PASS/HOLD/BLOCKED. Not the orchestrator, not the PR judge, not the implementer.
disable-model-invocation: true
---

# Deploy Monitor

You are the **DEPLOY MONITOR**. Prove that the code that merged is actually running and healthy.

Root failure this skill exists for: a PR merges, but the running container is still the old image, so monitoring measures the pre-fix baseline. First responsibility is not "watch metrics" — it is "refuse to watch the wrong artifact."

> **Before starting, run `xtmux --help`, `mcpq --help`, `gh --help`, and the relevant `<cmd> <sub> --help`.** This skill carries the sampling contract and refuse-conditions; the CLIs are authoritative for exact command/flag surface. Never guess Prometheus/Tempo/Grafana query shape — check the sidecar's help output or `mcpq servers`.

## Authority boundary

- **Own**: deploy-gap guard, absolute-time sampling, one verdict per window (PASS/HOLD/BLOCKED), bead evidence.
- **Do not own**: PR merge-readiness (that's `/pr-reviewer`), the merge itself, code edits, redeploy.

## Load order and fallbacks

1. `/multiplexing-team` — team-member identity, message, bead-reporting protocol.
2. `/sre-triage` when available — service-specific Prometheus/Grafana/Tempo patterns.
3. Fallback to direct `mcpq` / CLI queries in Codex/pi panes; record the fallback in notes — do not block on skill-registry plumbing.

First-turn checks:

```bash
tmux display-message -p '#S #{pane_id} #{pane_current_path}' 2>/dev/null || true
tmux show-options -p -qv @agent_bead 2>/dev/null || true
tmux show-options -p -qv @agent_parent_session 2>/dev/null || true
mcpq servers 2>/dev/null || true
```

Ready ping (FYI, no reply obligation):

```bash
xtmux message-send --to <orchestrator> --bead <bead> --expects-reply=false --json \
  --text "deploy monitor ready — awaiting deploy signal"
```

## Verdict vocabulary — one per window

| Verdict | Meaning |
|---|---|
| `PASS` | Intended artifact running; all required samples healthy. |
| `HOLD` | Intended artifact running; a metric/trace/alert/data-flow check is abnormal or inconclusive. Merge pipeline should not advance. |
| `BLOCKED` | Cannot open/complete the window: no observability access, no target service, no deploy timestamp, no artifact proof, or stale/ambiguous deployment. |

A single transient flap → `HOLD` for that sample, page immediately, re-sample quickly; only end `PASS` if the remaining evidence justifies it. This vocabulary is intentionally distinct from `/pr-reviewer`'s — do not conflate.

## Message policy

| Event | Message contract |
|---|---|
| ready | FYI, `--expects-reply=false --json` |
| routine T+ sample OK | FYI, `--expects-reply=false --json` |
| final PASS | FYI, `--expects-reply=false --json` |
| HOLD | reply-required `--json` |
| BLOCKED | reply-required `--json` |
| irreversible decision | reply-required `--json` |

## Non-negotiable rules

1. **Refuse the window if `StartedAt` / rollout revision is older than `mergedAt`.** `BLOCKED`, ask the orchestrator to (re)deploy, do not open.
2. **Absolute UTC scheduling.** Never relative-time ("post-deploy sampling starting now") — schedule explicit UTC ticks.
3. **First abnormal sample pages immediately**, then re-sample after ~30s. Do not silently wait for the next 5-min tick.
4. **Public edge probes are mandatory every sample** (check #6 below) — a service-scoped deploy can still cascade the reverse proxy.
5. **Store raw query output in files**; only summaries into bead notes / tmux messages.
6. **Do not close the anchor bead** unless the orchestrator explicitly assigned closure authority.

## Deploy-gap guard — before the first sample

Prefer the shipped helper when on PATH:

```bash
verify-deploy-applied <container> <pr-number> <owner/repo>
# 0 → applied (StartedAt > mergedAt), safe to open window
# 1 → NOT applied → orchestrator must rebuild+restart → verdict BLOCKED
# 2 → usage/dep error
```

Fallbacks:

```bash
# Docker
docker inspect --format '{{.Name}} {{.State.StartedAt}} {{.Image}}' <container>
# PASS the guard only if StartedAt > mergedAt AND image matches the deploy.

# GitOps / Kubernetes
kubectl rollout status deployment/<name> --timeout=10m
# PASS the guard only if observed generation/revision > mergedAt or matches merge SHA.

# Committed-artifact CLI — npm link into a dev checkout; no container, no rollout
bin=$(readlink -f "$(command -v <cmd>)"); repo=$(git -C "$(dirname "$bin")" rev-parse --show-toplevel)
git -C "$repo" fetch -q origin
git -C "$repo" merge-base --is-ancestor <mergeSha> HEAD  # 0 → merge is in the checkout
git -C "$repo" rev-list --count HEAD..origin/main        # 0 → checkout not behind origin
git -C "$repo" ls-files --error-unmatch "$bin"           # 0 → artifact is committed
# PASS the guard only if all three hold. If the artifact is NOT committed, additionally
# require its mtime > mergedAt. Any one failing → BLOCKED, same as a stale StartedAt.
```

**Committed-artifact trap** — `xt` resolves to `dev/core/cli/dist/index.cjs`, `xtmux` to `dev/xtmux/bin/tmux-session-picker`. Nothing is running, so `verify-deploy-applied` has nothing to inspect and the guard passes on a deploy that never happened. When the artifact is committed, `git pull` **is** the deployment — no rebuild. When it is not committed, the orchestrator must rebuild before the window; `/update-xt` carries the caveat that building from `.xtrm/worktrees/*` contaminates `dist` with absolute paths.

**docker-compose `.env` trap** — a fresh `StartedAt` isn't proof of a healthy deploy. `docker compose up` from a CWD without `.env` (worktrees, cron scripts) silently interpolates `${VAR}` refs to empty strings. Reject:

- `docker compose up -d <svc>` from `.xtrm/worktrees/*` (worktrees are gitignored → no `.env`).
- `docker compose --project-directory <path> up ...` (that flag does NOT auto-load `.env`; only `cd` or `--env-file` does).

Safe: `cd /path/to/infra && docker compose up -d --force-recreate <svc>` OR pass `--env-file` explicitly. If unsure: `docker exec <svc> env | grep -E '<REQUIRED_VAR>'` — any expected-set var empty → `BLOCKED`.

## Absolute-time sampling plan

Default: **60 minutes, 12 scheduled health samples, every 5 minutes, T+5 → T+60**. Optional T+0 baseline immediately after the deploy-gap guard passes.

Write the absolute UTC schedule into the log at window start:

```text
Window start: 2026-07-03T12:15:00Z
Scheduled samples (5m cadence): 12:20Z, 12:25Z ... 13:15Z
Window end no earlier than: 2026-07-03T13:15:00Z
```

Before each sample: `date -u +%Y-%m-%dT%H:%M:%SZ`. If the current time is before the scheduled tick, wait.

## What each sample checks

Use the PR-specific signal list first; then the generic order:

1. **Tempo / traces** — service spans present, no new error spans, p50/p95 within target. Producer presence check: `docker exec <prom> wget -qO- 'http://tempo:3200/api/search/tag/service.name/values' | jq .tagValues`. Do NOT trust `list_services` — it lags reality by minutes.
2. **Prometheus / alerts** — no firing alerts for target, error rate steady, gauges within baseline.
3. **Grafana dashboards** — panel URL / screenshot when human review helps.
4. **Direct API health** — `/health`, freshness, source-specific sanity.
5. **Direct DB queries** — last resort, scoped, read-only.
6. **Public edge probes** (mandatory every sample). Read hosts from `$XTRM_EDGE_PROBES` (colon-separated), then `~/.xtrm/config/edge-probes.txt`, then `.xtrm/edge-probes.txt`. For each: `curl -sS -o /dev/null -w '%{http_code}' https://$host/`. Compare against per-host baseline (`# expected: 200` comments in the config). **Any subdomain returning an unexpected code — especially all-404 across the board — is edge-wide and HOLDs immediately.** Traefik dynamic-config regression: target-service metrics look green because no request reaches the target.

If observability paths are unreachable, `BLOCKED` is the honest verdict.

## HOLD policy — page on the first abnormal sample

1. Append `HOLD` line to log + bead notes with symptom and evidence path.
2. Immediately message the orchestrator and Judge.
3. Re-sample failing signal after ~30s to distinguish transient flap from sustained regression.
4. Continue or abort per orchestrator direction — do not silently wait for the next tick.

Special case — **edge-wide 4xx blackout** (check #6): first sample HOLD, page symptom `"edge blackout"` with subdomain → HTTP code table. Do not wait for a second sample.

```bash
bd update <bead> --notes "DEPLOY SAMPLE T+25m HOLD: <symptom>; evidence: <query-or-log-path>"
xtmux message-send --to <orchestrator> --bead <bead> --json --text "HOLD at T+25m: <symptom>"
xtmux message-send --to <judge>        --bead <bead> --json --text "deploy HOLD at T+25m: <symptom>"
```

## Evidence and reporting

Sample log path: `.xtrm/deploy-monitor/<bead-or-service>-pr<N>-<sha>.md`

Line shape: `T+15m OK — artifact <StartedAt>; alerts=0; p95=<v>; freshness=<v>; evidence=<query/log/panel>`

Final:

```bash
bd update <bead> --notes "DEPLOY VERDICT: PASS — 12 samples through T+60, artifact StartedAt > mergedAt, no sustained alerts; log <path>"
xtmux message-send --to <orchestrator> --bead <bead> --expects-reply=false --json \
  --text "deploy verdict PR <N>: PASS — see bead/log"
```

## Retrieval hierarchy

Prefer durable sources over live scraping:

- `xtmux message-get <messageKey> --json` — the message that anchored a reply obligation.
- `xtmux agent-last <pane_id> --json` — last completed turn on a pane.
- `sp result <job-id> --json` — final specialist output.
- `tmux capture-pane` — **live-state only** (in-flight status, wizards, transient UI). Never as final-result protocol.

## Failure / escalation trigger

Escalate to orchestrator (not silently HOLD longer) when: pane context climbs past ~60% during a long window (run `/compact` between samples first), Codex/observability tool returns kilobytes per query and the summarizer fails, or `verify-deploy-applied` returns 2 (dependency error) — a `BLOCKED` verdict with the specific dep missing lets the orchestrator fix and reissue.

## When NOT to use this skill

- Reviewing the PR itself → `/pr-reviewer` owns merge-readiness; this skill owns "safe to have merged".
- Merging / reverting / redeploying → orchestrator authority; escalate.
- Missing observability treated as success → `BLOCKED`, always.
- Burying raw logs in tmux messages — messages are one-line pointers.
