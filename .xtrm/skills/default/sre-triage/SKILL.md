---
name: sre-triage
description: >-
  Cross-stack health verification with runtime-inferred routing. Queries
  Prometheus + Grafana live via the `mcpq` CLI (sidecar registry lives in
  `.mcpq.json` — `mcpq servers` lists them) to enumerate firing alerts, down
  containers, and stale freshness feeds; matches each finding to a registered
  service skill by listing the service-skills directory and matching container
  prefix / `territory:` globs; emits a triage report and loads expert personas
  for affected services. Also handles retroactive investigation of past alerts —
  use when the user reports receiving a Telegram alert hours ago that has since
  resolved. Invoke via /sre-triage for proactive checks, active incidents, or
  past-alert triage. Falls back to per-repo SERVICE_HEALTH.md files only when
  the mcpq sidecars are unreachable.
allowed-tools: Bash(mcpq *), Bash(python3 *), Bash(docker *), Bash(ls *), Read
disable-model-invocation: true
---

# SRE Triage ( /sre-triage )

> **sre-triage v1.6 (2026-08-19)** — prior-run lookup + bundle contract + evidence-first PLAN phase + Grafana MCP + OpenTelemetry MCP + deploy correlation + bead composition template. Source of truth: `~/.claude/skills/sre-triage/SKILL.md` (mirrors: `~/.xtrm/skills/default/sre-triage/SKILL.md`, `~/.jcode/skills/sre-triage/SKILL.md`, `~/dev/core/.xtrm/skills/default/sre-triage/SKILL.md`). Freshest content wins; the two primary copies must stay byte-identical.

Verify every stack's health state **without touching the codebase**. If issues are
found, route immediately to the correct expert skill(s) by **listing the service-skills
directory and matching the offending container/alert label against service names or
their `territory:` globs** — no frozen mapping tables to maintain.

This skill is the first materialization of the `devops-sre` / monitor role from the
xtrm devops canon (`~/dev/xtrm/docs/devops/devops-system.md` §5.1). The future
`sre.specialist.json` inherits this body as its standing prompt.

> **Project-bound names vs. universal methodology.** The examples below use a
> placeholder project (`example-project`, `example_project_*` mcpq tool prefix,
> `~/projects/example-project/...`). These bindings are **not portable** —
> discover yours before running anything:
> - **mcpq tool prefix**: `mcpq prometheus list-tools` → find the
>   `<prefix>_execute_query` tool. Your prefix is almost never `example_project`.
> - **Container → repo routing**: read `infra/scripts/service-map.json`.
>   Container-name prefixes (`svc-*`, `feed-*`, `infra-*`, ...) are **project
>   topology, not a standard** — never assume them; read the file.
> - **Feed / alert / service names**: read `service-map.json` and your own alert
>   definitions; substitute them into the PromQL below.
>
> The methodology itself is universal and needs no replacement: the `mcpq`
> invocation pattern, the PromQL probes (`up == 0`, `ALERTS{alertstate="firing"}`,
> `node_*`, `container_*`), and the status taxonomy. Only the *names* change.

## Trigger

User types `/sre-triage` — or when any incident, alert, or "something is wrong" phrase
appears in the conversation without a specific service being named yet.

`/health` remains a colloquial alias during the deprecation window of the old
`checking-stack-health` skill.

---

## Team Mode (2026-08-17)

An alternative fan-out mode: `/sre-triage team <incident>` invokes the read-only SRE
forensics specialist team instead of running the inline monolithic flow.

**When to use team mode:**
- Multi-surface incident (metrics + logs + host + recent-change all matter).
- You want the investigation to run in a **fresh context**, so the main session's
  memory pressure / prior investigation state doesn't bias findings.
- The incident description already scopes the problem well enough for the specialists
  to run without further clarification.

**When to stay in the inline flow (this file, below):**
- Quick single-surface probe (only alerts, only logs, only host).
- You want to steer the investigation turn-by-turn.
- Specialists infrastructure is unavailable (pi/sp broken, mcpq down).

**How team mode works — 3 steps:**

```bash
# 1. Pour the formula. Creates root bead + 4 step beads (observability, host, change, coordinator).
#    The molecule id printed IS the chain identity — capture it.
bd mol pour sre-triage --var incident="<one-paragraph incident description>" --var window="last 1h"
# -> prints e.g. infra-mol-q5h (root)

# 2. Launch the coordinator against the root bead. Pick ONE of the two invocations:

#    A) Interactive tmux pane -- recommended for real incidents you want to watch:
xt claude --role sre-coordinator --bead <root-bead-id>
#    (or xt pi --role ... or xt codex --role ... - same effect, different runtime)
#    Creates a new tmux session with @agent_task metadata, xtmux wired up so the
#    coordinator can message-send back to the parent orchestrator on judgment calls.

#    B) Headless one-shot -- for scripted invocations or when you just want the report:
sp run sre-coordinator --bead <root-bead-id>

# 3. Coordinator fans out. It dispatches sp run --bead <step-id> for each of the three
#    forensics specialists (observability, host, change) in parallel. Each writes to
#    .specialists/<name>-result.md and appends to its step bead notes.
#    When all three are complete, coordinator synthesizes ONE report to
#    .specialists/sre-coordinator-result.md and messages back.
```

For regression / "was working, now isn't" outages, use `sre-outage` instead -- same
invocation, different formula:

```bash
bd mol pour sre-outage --var incident="..." --var window="last 6h"
xt claude --role sre-coordinator --bead <root-bead-id>
# -> change (heavy, runs first) -> observability (validates top suspect) -> coordinator
```

**Slash-shorthand (if wired):** `/sre-triage team <incident>` and `/sre-triage outage <incident>`
should collapse the pour+launch pair into one line. If the shortcut isn'''t installed for
this session, run the two bd/xt commands above verbatim.

**Freshness gate:** all four specialists load `service-knowledge/SKILL.md` at turn 1.
The coordinator's Residual Uncertainty section flags any per-service SKILL whose
`Last sync` timestamp is older than 30 days and recommends
`service-knowledge index rebuild` or `/updating-service-skills`. Stale service knowledge
means stale queries; the freshness gate keeps that from silently biasing the report.

**Team roster + design principles:** see
`<repo>/.specialists/user/SRE-README.md`. All 4 specialists are LOW tier and forbidden
from state-changing commands by system-prompt mandate — findings are advisory, the
operator applies.

**Model:** `opencode-go/deepseek-v4-flash` primary, `zai/glm-5-turbo` fallback.

**When to reach for team mode vs the inline flow — one-line rule:** if the incident's
cause is likely a recent change (deploy, PR merge, container rebuild), team mode's
`sre-outage` shape is fastest because `sre-change-forensics` runs first and often
identifies the culprit inside its own step. For pure "system feels broken" health
probes, the inline flow below is lower-overhead.

---

## Execution Flow

### Step 1 — Live Health Probe via mcpq

Run these three queries **immediately**, before any reasoning or file reads.
They are the canonical live signals — Prometheus is the SSOT, the markdown
files are a 2-minute cache.

```bash
# 1a. Which containers are down right now?
mcpq prometheus call example_project_execute_query --arg query='up == 0' --json

# 1b. Which alerts are firing right now?
mcpq prometheus call example_project_execute_query --arg query='ALERTS{alertstate="firing"}' --json

# 1c. Which fast/live freshness feeds are stale beyond their 10m SLO?
# Cadence-aware: this intentionally checks only feeds expected inside 600s.
# Do not apply the 600s SLO to daily/hourly feeds.
mcpq prometheus call example_project_execute_query \
  --arg query='time() - example_project_freshness_last_success_unix_seconds{feed_id=~"svc-data-feed|svc-snapshot-feed|example-multi-source-container"} > 600' --json
```

Read each result's `structuredContent.result` array. An empty array on all three
means the fast-path health probe is clean. Otherwise, for each entry harvest the
labels (`job`, `instance`, `alertname`, `severity`, `feed_id`, `data_class`) and
route via the mapping tables further down this skill (Container → Service,
Alert → Service).

Freshness is cadence-aware: the 600s check is only for fast/live feeds whose
operator SLO is minutes (`svc-data-feed`, `svc-snapshot-feed`,
`example-multi-source-container`). Daily/hourly feeds can be inspected with
`sort_desc(time() - example_project_freshness_last_success_unix_seconds)` for context,
but do not mark the stack degraded solely because a daily or hourly feed is
older than 600s. Use feed-specific alerts/runbooks for those cadences.

Container → repo attribution comes from the regexes in your project's
`infra/scripts/service-map.json`. **Do not assume prefixes are standard** — they
are project topology (in one project `svc-*` might map to a data repo and
`infra-*` to the infra repo; yours will differ). Open that file and read the
actual mappings before attributing containers.

**Fallback when mcpq is unreachable** — if both `mcpq` calls return errors
mentioning `docker exec ... exited` or `connection refused`, the sidecars are
down. Fall back to the file-cache path:

```bash
python3 ~/projects/example-project/infra/scripts/health_check.py
```

…and read the per-repo `SERVICE_HEALTH.md` files if even that fails. The cron
that produces them is documented in `~/projects/example-project/infra/HEALTH_SYSTEM.md`.

---

### Step 1b — Resource Metrics Check

Run alongside Step 1 whenever the user mentions high memory, high CPU, slow
response, or when investigating `ContainerHighMemory` / `DiskUsageHigh` /
`DiskUsageCritical`. Same pattern — live PromQL via mcpq:

```bash
# Host CPU% (1m avg)
mcpq prometheus call example_project_execute_query \
  --arg query='100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[1m])))' --json

# Host memory used %
mcpq prometheus call example_project_execute_query \
  --arg query='100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)' --json

# Host disk used % at /
mcpq prometheus call example_project_execute_query \
  --arg query='100 * (1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"})' --json

# Top-10 containers by 5m CPU
mcpq prometheus call example_project_execute_query \
  --arg query='topk(10, rate(container_cpu_usage_seconds_total{name!=""}[5m]) * 100)' --json

# Top-10 containers by memory-vs-limit %
mcpq prometheus call example_project_execute_query \
  --arg query='topk(10, 100 * container_memory_working_set_bytes{name!=""} / container_spec_memory_limit_bytes{name!=""})' --json
```

Warn when host CPU > 80%, host memory > 85%, any container > 80% CPU, or any
container > 85% memory-vs-limit. Use the offending container name to load the
right service skill before diagnosing further.

---

### Step 2 — Classify Overall State

Classify from the Step 1 query results:

| Signal from Step 1 queries                                              | Overall status | Action                                          |
|-------------------------------------------------------------------------|----------------|-------------------------------------------------|
| All three queries return empty `result` arrays                          | `HEALTHY`      | Report clean — but see Step 2b for past alerts  |
| `ALERTS` returns rows with `severity="warning"`, or a fast/live freshness feed breaches its cadence-aware 600s SLO | `DEGRADED` | Continue to Step 3 (warning track) |
| `up == 0` returns rows, or `ALERTS` has `severity="critical"`           | `CRITICAL`     | Continue to Step 3 (incident track)             |
| mcpq returned an error (sidecars unreachable) AND fallback also failed  | `UNKNOWN`      | Surface explicitly; load `grafana-mcp` + `prometheus-mcp` skills and fix the query surface before continuing |

---

### Step 2b — Retroactive Investigation (user reports a past alert)

When the current health check is clean but the user mentions receiving a Telegram alert
N hours ago, **do not run ad-hoc queries**. Use the dedicated scripts:

Set the skill directory once, then use it throughout:
```bash
SKILL_DIR="$CLAUDE_PROJECT_DIR/.xtrm/skills/default/sre-triage"
```

**Phase A — Find what fired:**

Derive `--hours` from what the user said (e.g. "3 hours ago" → `--hours 3`). Default to 6 if unspecified.
```bash
python3 $SKILL_DIR/scripts/alert_history.py --hours <N>
```

Options:
```bash
python3 $SKILL_DIR/scripts/alert_history.py --alert TraefikHighLatency  # filter to one alert
python3 $SKILL_DIR/scripts/alert_history.py --json                       # machine-readable
```

Exit codes: `0` = nothing fired, `1` = at least one alert fired, `2` = Prometheus unreachable.

**Phase B — Diagnose each alert that fired:**
```bash
python3 $SKILL_DIR/scripts/alert_investigator.py --alert <alertname> --hours <N>
```

The investigator:
- Fetches the rule's PromQL expression and threshold from Prometheus
- Re-evaluates the expression over the exact firing window
- Reports peak metric values and which label dimensions breached the threshold
- Applies known false-alert heuristics (WebSocket lifetime, market data feed gaps, etc.)
- Emits a structured assessment and fix hint

**Only fall back to raw PromQL or docker commands if both scripts fail** (exit code 2).

After diagnosis, report the finding and proposed fix directly — no XML scope block needed
for resolved alerts unless the root cause requires a code or config change.

---

### Step 3 — Emit XML Health Scope Block

Emit this block **before loading any skills or running any docker commands**:

```xml
<health_scope>
  <generated><!-- timestamp from script output --></generated>
  <overall_status>DEGRADED|CRITICAL</overall_status>

  <stacks>
    <stack id="example-feeds" status="DEGRADED">
      <alerts>
        <alert severity="CRITICAL" name="ContainerCrashLoop" container="example-summarizer-container">
          example-summarizer-container has restarted 3x in 1h
        </alert>
      </alerts>
      <services_affected>
        <service id="example-summarizer-skill" confidence="high">
          <reason>example-summarizer-container container crash-looping (maps to example-summarizer-skill)</reason>
          <skill>.claude/skills/example-summarizer-skill/SKILL.md</skill>
          <load>now</load>
        </service>
      </services_affected>
    </stack>
  </stacks>

  <workflow>
    <phase order="1" name="load-skills">
      Read every SKILL.md listed above. Adopt the expert persona, failure modes
      table, and diagnostic scripts from each. Do not run docker commands yet.
    </phase>
    <phase order="2" name="diagnose">
      For each affected service, run its health_probe.py and log_hunter.py scripts
      before any ad-hoc docker commands. Use the failure modes table from the skill
      to identify the root cause.
    </phase>
    <phase order="3" name="fix">
      Apply targeted fix per service. Follow the skill's operational runbook.
    </phase>
    <phase order="4" name="verify">
      Re-run health_check.py to confirm all stacks return to HEALTHY.
      If a fix involved code logic: write a regression test alongside the fix.
    </phase>
  </workflow>
</health_scope>
```

Adapt the `<services_affected>` block to what the script actually reported.

---

### Step 4 — Load Skills for Affected Services

For every `<service>` with `<load>now</load>`, read the skill file immediately:

```
Read: .claude/skills/<service-id>/SKILL.md
```

**Do not proceed to diagnosis until all affected skills are loaded.**
Adopt the failure modes table, diagnostic scripts, and runbook from each skill.

**When the symptom → service mapping is ambiguous** — the alert names a
container that doesn't match a registered service directly, a stack trace
points at a file whose owner is unclear, or two services are plausible
candidates — reach for **service-knowledge** before falling back to grep:

```bash
# Route by touched paths (what the activator does internally).
service-knowledge index query "<symptom text or metric name>"
```

Or from an MCP host:

- `knowledge_evidence_for_files` with the paths the incident touches — returns
  the service(s) whose territory covers them, plus a ranked evidence bundle
  from the shipped SKILLs.
- `knowledge_search` with a free-text query (alert name, error string, metric,
  concept) — returns the same evidence-bundle shape ranked across every
  registered service.

Both surfaces read the per-repo FTS5 evidence index (`.xtrm/cache/service-knowledge.sqlite`,
built by `service-knowledge install`) so latency is sub-10ms. They return
evidence, never conclusions — use the ranked hits to pick which skill(s) to
`Read` in this step, then proceed to Step 5 with the expert context loaded.

If the affected service has no registered skill even after the search:
1. Report: `"No registered skill for <service-id>."`
2. Continue with general expert mode using docker logs and AGENT_MONITORING.md guidance.
3. Offer: `"I can create a skill — use /creating-service-skills."`

---

### Step 5 — Diagnose Per Service

For each affected service (in severity order — CRITICAL first):

1. **Check the skill's failure modes table** — match the alert name or symptom.
2. **Run the skill's diagnostic scripts** in this order:
   - `health_probe.py` — current live state
   - `log_hunter.py` — recent error patterns
3. **Only then** run raw docker commands if scripts are insufficient:
   ```bash
   docker logs <container-name> --tail 100
   docker compose -f ~/projects/example-project/<stack>/docker-compose.yml ps
   ```

---

### Step 6 — Fix and Verify

Apply the fix identified in Step 5. Then re-run the Step 1 queries:

```bash
mcpq prometheus call example_project_execute_query --arg query='up == 0' --json
mcpq prometheus call example_project_execute_query --arg query='ALERTS{alertstate="firing"}' --json
mcpq prometheus call example_project_execute_query \
  --arg query='time() - example_project_freshness_last_success_unix_seconds{feed_id=~"svc-data-feed|svc-snapshot-feed|example-multi-source-container"} > 600' --json
```

All three `structuredContent.result` arrays must be empty (or no longer include
the previously-failing entries) before closing the incident. For broad cached
verification, run `python3 ~/projects/example-project/infra/scripts/health_check.py`;
do not treat daily/hourly freshness rows as failures unless their feed-specific
SLO or alert says they are late.

**Regression test rule:** If the root cause was a code logic bug, write a test
(see the Regression Test section below). If it was operational, extend or add a
check in the service's `health_probe.py`.

---

## Container → Service Routing (runtime inference)

**Do not consult a frozen table.** Derive the mapping at the moment of incident, by
listing the service-skills directory tree and matching the offending container's label
against the service-id or its `territory:` glob in the registry.

```bash
# 1. Enumerate registered services (across all packs in this repo)
ls .xtrm/skills/user/packs/*/service-skills/services/

# 2. For a container name like `infra-traefik`, the service-id is the
#    longest matching prefix or exact match against a directory name above.
#    (Routing is project topology, not a standard: read
#    `infra/scripts/service-map.json` for the real prefix → repo mappings rather
#    than assuming prefixes like `svc-*` or `infra-*`. Cross-repo containers'
#    service skills live in sibling repos — `cd ~/projects/<your-project>/<repo>`
#    then repeat the `ls`.)

# 3. Read the matched skill to adopt expert persona:
Read: .xtrm/skills/user/packs/<pack>/service-skills/services/<service-id>/SKILL.md

# 4. If no match: report the container as `unrouted`. Do not invent a skill path.
#    Offer to scaffold via /creating-service-skills.
```

The `service-registry.json` at each pack's root provides the authoritative
`territory:` globs and `triggers:` keywords if the directory-listing heuristic
needs disambiguation. Always prefer the registry over hand-matching when in
doubt — it's the single source of truth.

The two `-mcp` sidecars (`example-grafana-mcp`, `example-prometheus-mcp`) are
read-only query surfaces. The mcpq wiring smoke is whatever the project ships —
in example-project, it's `make verify-mcpq` from the infra repo root.

---

## Silent edge failure — traefik-route-drop pattern

`ContainerCrashLoop` and `up==0` miss a class of outage that *keeps the target
container running healthy* but drops ALL routes. One observed incident: `docker
compose up` invoked from a worktree without `.env` interpolated empty
`${ADMIN_CIDR}` into `traefik/dynamic/middlewares.yml`, dynamic config became
YAML-invalid, traefik discarded every router, and every public request 404-ed
for 7h. The traefik container stayed `up==1` throughout.

**Alert:** `TraefikEdgeRoutesMissing` — fires on >90% 404 rate on the
`websecure` entrypoint over 5m (with a `rate>0.05` idle guard).

**Live probe (adds ~200ms; run any time an "edge is down / can't reach
grafana / API 404" report comes in and no other alerts are firing).** The
host list comes from an edge-probe config surface — read from
`$XTRM_EDGE_PROBES` (colon-separated), else `~/.xtrm/config/edge-probes.txt`
(one host per line), else the repo-local `.xtrm/edge-probes.txt`, else skip
with a warning:

```bash
: "${XTRM_EDGE_PROBES:=$(cat ~/.xtrm/config/edge-probes.txt \
  .xtrm/edge-probes.txt 2>/dev/null | tr '\n' ':' )}"
IFS=: read -r -a hosts <<<"${XTRM_EDGE_PROBES}"
for host in "${hosts[@]}"; do
  [ -z "$host" ] && continue
  printf "%-45s %s\n" "$host" "$(curl -sS -o /dev/null -w '%{http_code}' https://$host/)"
done
```

Interpret the codes against your per-stack baseline (e.g. root=200, dashboards
behind auth=403, APIs=401). **All-404 across the board is the smoking gun**.

Fix (compose stack):

```bash
cd /path/to/infra && docker compose --env-file .env up -d traefik
```

Prevention: a `make preflight-env` guard for missing/empty required env vars +
an edge-probe pass in the deploy-gap observation window.

## Alert → Service Mapping Reference

When an alert fires, use this table to identify the affected service and the
Grafana dashboard to open for visual investigation.

| Alert name                       | Severity | Likely service / container           | Dashboard to open                              |
|----------------------------------|----------|--------------------------------------|------------------------------------------------|
| `ContainerCrashLoop`             | CRITICAL | match `name` label in alert detail   | Containers — Resource Metrics (cAdvisor)       |
| `ContainerHighMemory`            | WARNING  | match `name` label; run `--metrics`  | Containers — Resource Metrics (cAdvisor)       |
| `ExampleProjectFeedStarved`   | CRITICAL | `svc-data-feed`                      | Market Data — Feed Health & Ingestion Pipeline |
| `ExampleProjectSymbolStale`          | WARNING  | `svc-data-feed`                      | Market Data — Feed Health & Ingestion Pipeline |
| `PostgresDown`                   | CRITICAL | `serving-example-api` or svc/treasury| PostgreSQL — Database Stats                    |
| `PostgresTooManyConnections`     | WARNING  | `serving-example-api` or svc/treasury| PostgreSQL — Database Stats                    |
| `RedisDown`                      | CRITICAL | `serving-example-api`, `collecting-events` | Redis — Cache Metrics               |
| `RedisHighMemory`                | WARNING  | `serving-example-api`, `collecting-events` | Redis — Cache Metrics               |
| `HighErrorRate`                  | WARNING  | `serving-example-api`                | Example Project — API & MCP Traffic (Traefik)          |
| `TraefikHighLatency`             | WARNING  | `traefik`                            | Traefik — Routing & Proxy Metrics              |
| `TraefikEdgeRoutesMissing`       | CRITICAL | `traefik` (dynamic config regression)| Traefik — Routing & Proxy Metrics              |
| `DiskUsageHigh`                  | WARNING  | all stacks (shared host)             | VPS — Host Metrics (Node Exporter)             |
| `DiskUsageCritical`              | CRITICAL | all stacks — check Loki + volumes    | VPS — Node Exporter Full (Deep Dive)           |
| `ServiceDown`                    | CRITICAL | match `instance` label in alert      | Containers — Resource Metrics (cAdvisor)       |

### Market data alert context

`ExampleProjectFeedStarved` and `ExampleProjectSymbolStale` are **suppressed outside
Example Exchange trading hours** via `example_exchange_session_closed`. Before investigating:

```bash
# Check if market is open — 0 = open, 1 = closed
curl -s "http://<prometheus-ip>:9090/api/v1/query?query=example_exchange_session_closed" \
  | python3 -c "import json,sys; r=json.load(sys.stdin)['data']['result']; print('session closed:', r[0]['value'][1])"
```

If session is closed (`1`), the alert is expected noise — no action needed.
If session is open (`0`) and the alert fires, open the Market Data dashboard and check:
1. **Fresh symbol count** — should be ≥ 5 during active session
2. **Per-symbol staleness table** — identify which symbols/asset classes are stale
3. **Container restarts** — check if `svc-data-feed` or `svc-tick-ingestor-rust` crash-looped

---

## Grafana Dashboard Reference

All dashboards are provisioned at `~/projects/example-project/infra/grafana/dashboards/`.
Every alert rule maps to at least one dashboard.

| Dashboard                                    | Covers                                  | Alert rules wired             |
|----------------------------------------------|-----------------------------------------|-------------------------------|
| Containers — Resource Metrics (cAdvisor)     | CPU, mem, network, disk per container   | `ContainerCrashLoop`, `ContainerHighMemory`, `ServiceDown` |
| Market Data — Feed Health & Ingestion Pipeline | Symbol freshness, svc containers, TimescaleDB | `ExampleProjectFeedStarved`, `ExampleProjectSymbolStale` |
| Example Project — API & MCP Traffic (Traefik)        | HTTP error rate, latency by service     | `HighErrorRate`, `TraefikHighLatency` |
| Example Project Website — Nginx & Container          | nginx stats + website container         | `ServiceDown`, `ContainerCrashLoop` |
| VPS — Host Metrics (Node Exporter)           | CPU, memory, disk, network (host)       | `DiskUsageHigh`, `DiskUsageCritical` |
| VPS — Node Exporter Full (Deep Dive)         | 41-panel deep-dive host metrics         | `DiskUsageHigh`, `DiskUsageCritical` |
| PostgreSQL — Database Stats                  | pg_up, connections, query stats         | `PostgresDown`, `PostgresTooManyConnections` |
| Redis — Cache Metrics                        | redis_up, memory, hit rate              | `RedisDown`, `RedisHighMemory` |
| Traefik — Routing & Proxy Metrics            | Entrypoint-level traffic and latency    | `TraefikHighLatency`, `HighErrorRate` |
| Logs — Container Stream (Loki)               | All container logs (diagnostic)         | *(diagnosis only — no alert wired)* |
| Data Pipeline Health — DB Direct             | TimescaleDB + QuestDB direct SQL freshness, ingestion lag, table sizes | *(diagnostic — DB cross-check for ingestion-family alerts)* |
| Market Data — Direct                         | Direct-from-DB market data views (non-STIR via QuestDB after 2026-03-25 migration) | *(diagnostic — complements freshness alerts on `svc-data-feed`)* |

---

## Health State Interpretation

| Status     | Meaning                                                                                  |
|------------|------------------------------------------------------------------------------------------|
| `HEALTHY`  | All three Step 1 fast-path queries returned empty `result` arrays                         |
| `DEGRADED` | Firing `severity="warning"` alerts, or fast/live freshness feeds past their cadence-aware SLO |
| `CRITICAL` | `up == 0` rows present, or firing `severity="critical"` alerts                           |
| `UNKNOWN`  | mcpq sidecars unreachable AND `health_check.py` fallback also failed — query surface itself is down |

When `UNKNOWN`, the priority is restoring the query surface before assessing
anything else. Load both sidecar skills (`prometheus-mcp`, `grafana-mcp`) for
their failure-mode tables, then inspect:

```bash
docker ps --filter name=example-prometheus-mcp --filter name=example-grafana-mcp
docker logs --tail 50 example-prometheus-mcp
docker logs --tail 50 example-grafana-mcp
make verify-mcpq   # canonical smoke for the wiring
```

If the fallback `SERVICE_HEALTH.md` files are also missing, the file-cache cron
is what's broken (independent failure mode — does not block live diagnosis once
mcpq is back up):

```bash
crontab -l | grep health-report
make health-report   # one-shot regenerate from infra/
```

---

## Regression Test Binding

When a fix has been applied for a code logic bug:

```
Is the bug in application code logic?
  YES → write pytest/unit test in the service's test suite

  NO  (operational / infra / config issue) →
        Does the skill's health_probe.py already check this condition?
          YES → extend the existing check function
          NO  → add a new check function to health_probe.py
                OR add a dedicated script to .claude/skills/<service>/scripts/
```

Name after the failure mode, not the fix:

```python
def check_summarizer_not_crash_looping():    # ✅
def check_redis_eviction_not_exhausted():    # ✅
def test_fix():                              # ❌
```

If `alert_investigator.py` identifies a **false-alert pattern** that is not yet in
`FALSE_ALERT_PATTERNS`, add a new entry to the script:

```python
{
    "match": lambda labels, expr: <condition on labels + expr string>,
    "assessment": "FALSE ALERT — <one-line description>",
    "explanation": "<why it fires spuriously>",
    "fix": "<what to change in the alert rule>",
},
```

---

## Related Skills

- `/scope "task"` — Route any non-health task to the right expert
- `/using-service-skills` — Passive catalog at session start
- `/creating-service-skills` — Scaffold new expert skill packages
- `/updating-service-skills` — Sync skills after implementation drift

## System Documentation

Full architecture, maintenance guide, and Agent Forge migration path:
`~/projects/example-project/infra/HEALTH_SYSTEM.md`

## Prior-Run Lookup (before publishing coordinator.decision)

**MUST — not optional.** Before you publish `coordinator.decision`, run:

    service-knowledge index query "<3-5 keywords derived from the incident_brief>"

Use plain tokens only (FTS5 treats `-`, `_`, `=` as separators — `questdb`,
`candle`, `swap`, `RestoreTest`, not `NQ=F` or `sre-triage-runs` verbatim).
If you are in a target repo that has the archive registered, add
`--service-id sre-triage-runs` and `--bundle` to get the evidence bundle.

- If any hit returns, open the linked `report.md` and **cite the hit's
  `chain_id` in your coordinator.decision evidence body under
  `prior_runs_cited[]`** (one entry per prior run). Read the prior run's
  applied fixes / workarounds and do NOT re-derive from scratch.
- If no hit returns, emit `prior_runs_cited: []` — an empty array is valid;
  skipping the search is not.
- Failure mode: **if you skip the prior-run search, the reviewer step will
  flag your coordinator.decision as incomplete.** The search is the mechanism
  that makes the archive learn — a coordinator that never looks back is the
  exact failure this skill exists to prevent.

## Run Bundle Contract (at terminal state — satisfied OR escalated)

Every terminal chain run (satisfied OR escalated) writes a durable per-run
bundle into the target repo at:

    <target>/.xtrm/skills/infra/service-knowledge/services/sre-triage-runs/<UTC>_<chain_id_short>/

The coordinator-close activation writes `report.md` (narrative + gotchas +
applied fixes + workarounds + deferred + next-actions) as its evidence body
`kind=coordinator.decision`. The chain runtime is responsible for
materializing that body plus the deterministic `chain-report.json` into the
archive path. Bundle files (shape defined by service `sre-triage-runs`,
spike infra-223r.1):

| file | contents |
|---|---|
| `chain-report.json` | deterministic, `"schema": "chain-report.v1"` at top level; steps[], evidence_index[], prior_runs_cited[], plan_phase{}, next_actions[] |
| `report.md` | hand-written narrative: incident brief, participants, evidence summary, top gotchas, applied fixes, deferred, prioritized next actions |
| `gotchas.jsonl` | one JSON object per line: `{"kind","resource","symptom","evidence_ref","fix_applied","worked","prior_run_refs"}` |
| `evidence/*.json` | the run's evidence entries from `evidence/index.jsonl`, expanded one file each |
| `forensics.jsonl` | copy of `forensics/events.jsonl` |
| `messages.jsonl` | copy of `channels/messages.jsonl` |

After the bundle exists, rebuild the index so the next run can find it:

    cd <target-repo>
    service-knowledge index rebuild   # full regen (same as build)
    service-knowledge index stats     # confirm item_count + source_ref updated

## Orchestrator Handoff

After the bundle exists, the **outer orchestrator** (Claude Code session /
`xt claude` / `sp chat`) reads the run's next actions and schedules targeted
follow-ups. The exact file is:

    services/sre-triage-runs/<UTC>_<chain_id_short>/chain-report.json
    # -> next_actions[] (array of operator-actionable strings)

or the human-readable equivalent in `report.md` under "## Prioritized next
actions". The orchestrator should convert each `next_actions[]` entry into a
bd issue (or GH issue) with a `discovered-from` edge back to the incident
bead, so the archive's recommendations actually become tracked work. Priority
order in the array is intentional: P0 = stop-the-bleed, then P1/P2.

## PLAN Phase (evidence-first)

You are alert-ANCHORED but never alert-LIMITED. The alert set is one input
among three. **Before dispatching any advisor**, enumerate the ACTIVE
investigation surface and record it in your coordinator.decision evidence
body under `plan_phase`:

```json
"plan_phase": {
  "alerts_checked": ["<firing alert names, or []>"],
  "dashboards_queried": ["<grafana dashboard names, or []>"],
  "trace_queries": ["<otel trace query descriptions, or []>"],
  "deploy_correlations_examined": ["<deploy/digest surfaces examined, or []>"]
}
```

Surface enumeration (all READ-ONLY):

1. **Currently-firing alerts** — via mcpq Prometheus.
2. **Topology sweep** — for every critical service in
   `service-registry.json`'s services map, note its expected container(s). A
   degraded service with NO firing alert is the exact failure mode this phase
   exists to catch (proof: chain-sre-308163 — observability-analyst reported
   "0 firing alerts" for services that were in fact degraded).
3. **Grafana forensic dashboards** — via mcpq (see §Grafana MCP Access).
4. **OpenTelemetry traces** — via mcpq (see §OpenTelemetry MCP Access).
5. **Deploy correlation** — see §Deploy Correlation.

Every advisor gets a SCOPED subset of this surface, not just the alert set.
A missing or empty `plan_phase` sub-object is a contract violation — the
reviewer will flag your coordinator.decision as incomplete.

## Deploy Correlation

For every service surfaced by any advisor, check the last GHCR image digest
change / container recreate / compose reconciliation timestamp. If the
incident window overlaps a recent deploy, flag it as a plausible cause
candidate and cite the exact digest / commit / compose diff:

```bash
git log -20 -G 'image:.*@sha256:' --date=short --format='%h %ad %s' -- docker-compose.yml
docker events --since 24h --filter type=container
git log -5 --since='7 days ago' --format='%h %ad %s' --date=short .
```

`docker inspect <container> --format '{{.Config.Image}} {{.State.StartedAt}}'`
shows the running image digest vs start time — a `⚡BUILT+DEPLOYED` pattern
(image `.Created` ≈ container `.StartedAt`) is a fresh deploy. The
`service-map.json` (infra/scripts) maps container prefixes to repos — never
assume a prefix.

## Grafana MCP Access

Mercury runs `grafana-mcp` as an internal docker service on the `platform`
network (no Traefik route) — reachable ONLY via `mcpq`, never direct HTTP
from the host. Server entry (`.mcpq.json`, discovered by walk-up):

    mcpq servers
    # grafana  via=docker:infra-prometheus-mcp  url=http://infra-grafana-mcp:8090/mcp

Query sequence:

```bash
mcpq grafana list-tools          # live tool catalog
mcpq grafana describe <tool>     # input schema
mcpq grafana call <tool> ...     # invoke
```

Pull the dashboards relevant to the incident domain (host, containers,
observability pipeline, ingest pipelines, backup/restore, security), snapshot
key panels, and cite them in your evidence body (`dashboards_queried[]` in
`plan_phase`). The Grafana Dashboard Reference section below lists the
provisioned dashboards and the alerts each covers.

## OpenTelemetry MCP Access

Mercury runs `opentelemetry-mcp` (upstream traceloop/opentelemetry-mcp-server,
BACKEND_TYPE=tempo) as an internal docker service on the `platform` network —
reachable ONLY via `mcpq`:

    mcpq opentelemetry-mcp list-tools    # 11 tools (traces)

Pull traces around the incident window, filter by service name and error
class, cite trace IDs in your evidence body (`trace_queries[]` in
`plan_phase`). Combined with Loki logs (via grafana-mcp) this closes the
trace/log correlation loop that alert-only triage misses.

## Bead Composition Template

When the outer orchestrator creates an incident bead (via `bd create` or a
formula pour), the description SHOULD include this starter block so both live
and test invocations get the evidence-first contract:

    ## Initial surface (evidence-first — do not skip)
    - Deploy-correlation checkpoint:
      git log -20 -G 'image:.*@sha256:' --date=short --format='%h %ad %s' -- docker-compose.yml
    - Grafana dashboards to consult (mcpq grafana list-tools; pick by domain):
      [host, containers, observability pipeline, ingest pipelines, backup/restore, security]
    - OTel trace-query starter (mcpq opentelemetry-mcp):
      window=<incident window>, service=<affected service>, error class=<if known>
    - Prior-run lookup: service-knowledge index query "<3-5 incident keywords>"

The template lives in ONE place — this skill — and is referenced from the
coordinator prompt via a `## Bead Composition` section, never duplicated.

## Persistent per-run knowledge (service-knowledge integration)


Every triage run MUST leave two artefacts in the target repo so the next run
can search prior gotchas, fixes and workarounds via the `service-knowledge`
CLI. Both are written under a **single registered service**, `sre-triage-runs`,
so it is discoverable exactly like every other service skill.

### Registered service — `sre-triage-runs`

Path in the target repo:

```
<target>/.xtrm/skills/infra/service-knowledge/services/sre-triage-runs/
    SKILL.md                                              ← FTS5-indexed
    runs/
      <UTC-YYYYMMDDTHHMMSSZ>-<chain_run_id>/              ← per-run subfolder
        report.md                                         ← coordinator hand-written
        chain-report.json                                  ← deterministic, schema chain-report.v1
        report.md                                         ← coordinator hand-written narrative
        gotchas.jsonl                                     ← one JSON object per line
        evidence/*.json                                   ← evidence entries, one file each
        forensics.jsonl                                   ← copy of forensics/events.jsonl
        messages.jsonl                                    ← copy of channels/messages.jsonl
```

Register in `<target>/.xtrm/skills/infra/service-knowledge/service-registry.json`:

```json
"sre-triage-runs": {
  "name": "sre-triage-runs",
  "description": "Rolling ledger of past SRE triage chain runs — gotchas, fixes, workarounds, per-run evidence pointers. Use FIRST before starting a new triage; grep for symptoms already seen.",
  "skill_path": ".xtrm/skills/infra/service-knowledge/services/sre-triage-runs/SKILL.md",
  "territory": [".xtrm/skills/infra/service-knowledge/services/sre-triage-runs/**"],
  "triggers": ["sre triage history", "seen this before", "previous outage", "gotcha", "known workaround", "past incident", "prior run"],
  "last_sync": "<UTC iso now>",
  "last_sync_ref": "<HEAD sha>"
}
```

Territory is self-referential because the service IS the runs ledger — it has
no source-of-truth code files. That is intentional and the reconcile driver
accepts it: `service-knowledge` validates 13 claim kinds against `territory:`
globs; a self-referential territory means the SKILL.md is authoritative for
its own claims.

### SKILL.md shape (the ONLY FTS-indexed surface)

```markdown
---
name: sre-triage-runs
description: Rolling ledger of past SRE triage chain runs …
allowed-tools: Read, Grep, Bash(service-knowledge index query *)
---

# sre-triage-runs

## How to use before starting a new triage

    service-knowledge index query "<symptom>" --service-id sre-triage-runs --bundle
    # or plain grep as fallback:
    grep -rniE "<symptom>" services/sre-triage-runs/SKILL.md

If a match returns, open the linked `runs/<id>/report.md` in the same
service folder — it holds the full triage transcript, the fix or workaround
that stuck, and the reason it stuck.

## Gotchas & Fixes (append-only)

<!-- Each entry: date · run_id · symptom (indexable words) · root cause · fix that stuck. -->
<!-- Format is stable so grep + service-knowledge index query both work. -->

- 2026-08-19 · run-sre-10506 · NQ=F/YM=F equities candles stale 26-40h · Sierra-side .scid watch-file gap (config present, 0 inflight) · <fix or "unfixed — see runs/…/report.md">
- …

## Workarounds

<!-- Same append-only rule. Workarounds are things that are not the real fix but keep the system alive. -->

- …

## Recent Runs

| UTC ts | chain_run_id | chain_id | severity | outcome | report |
|---|---|---|---|---|---|
| 2026-08-19T01:53Z | run-sre-10506 | chain-sre-308163 | DEGRADED | 5/6 steps satisfied; reviewer.verdict missing | [runs/…/report.md](runs/2026-08-19T015344Z-run-sre-10506/report.md) |
| … | | | | | |
```

Keep entries short and grep-friendly — the whole file is what the FTS5 index
sees. Long prose lives in `runs/<id>/report.md`; SKILL.md only holds pointers
and the tight symptom/cause/fix triple.

### Coordinator responsibilities per run

The chain-coordinator step MUST perform, in order, before its final
`evidence_publish(kind="coordinator.decision")`:

1. **Search prior runs** for anything symptomatically similar to the incident
   brief. If a match returns, cite it in the coordinator.decision body under
   `prior_runs_consulted: [<run_id>, …]` so the reviewer can verify.

2. Compute `runs_dir = <target>/.xtrm/skills/infra/service-knowledge/services/sre-triage-runs/runs/<UTC-YYYYMMDDTHHMMSSZ>-<chain_run_id>` and ensure it exists.

3. Write `runs_dir/report.md` with fixed section headings — the same
   headings across every run so grep and the FTS5 indexer both work:

   ```
   # SRE triage report — <chain_run_id>

   ## Incident brief
   ## Summary
   ## Findings (severity-ranked)
   ## Root causes (per finding)
   ## Gotchas encountered (surprises worth remembering)
   ## Fixes applied (or explicitly NOT applied — READ-ONLY runs)
   ## Workarounds (what kept it alive without fixing)
   ## Evidence pointers
   ## Handoff to orchestrator (concrete next actions)
   ```

4. **Append** one row to `services/sre-triage-runs/SKILL.md`'s "Recent Runs"
   table AND (for any surprise/fix that is genuinely new) one bullet each
   under "Gotchas & Fixes" or "Workarounds". Never delete existing rows —
   this is an append-only ledger. If a prior gotcha now has a confirmed fix,
   add a **new** bullet stating the fix and citing the older bullet's run_id
   rather than editing the older one.

5. Emit the `coordinator.decision` evidence with a body containing
   `report_path` (relative to target repo root) so the reviewer, coordinator
   -close, and any downstream orchestrator can dereference the report
   without guessing paths.

6. Post the `work.turn` message with `evidence_refs=[<the coordinator.decision id>]`
   and `body.summary` including the same `report_path`.

Under `--specialist-json required` the XTRM authority overlay + role prompt
already enforces steps 5–6; the runs-ledger writes (steps 1–4) are the
sre-triage-specific extension that this SKILL contributes.

### Deterministic chain evidence — `chain-report.json`

The XTRM chain runtime emits `runs_dir/chain-report.json` automatically at
terminalization. It is the machine-readable evidence bundle — do not hand
edit. Shape:

```json
{
  "schema": "chain-report.v1",
  "chain_run_id": "run-sre-XXXXX",
  "chain_id": "chain-sre-XXXXXX",
  "chain_epic_id": "vsvs-chain-sre-XXXXXX-epic",
  "target_repo": "/abs/path",
  "target_repo_sha": "<git rev-parse HEAD>",
  "started_at": "<ISO>",
  "ended_at": "<ISO>",
  "terminal_state": "closed | escalated | blocked",
  "specialist_json_mode": "off | auto | required",
  "baseline_specialists": [
    { "name": "sre-coordinator", "source_sha256": "…", "resolved_model": "commandcode/deepseek/deepseek-v4-flash", "skills": [{ "name": "sre-triage", "sha256": "…" }, …] },
    …
  ],
  "steps": [
    {
      "step_id": "coordinator-entry",
      "role": "chain-coordinator",
      "participant_id": "chain-sre-XXXXXX::chain-coordinator",
      "execution_id": "exec-…-chain-coordinator-1",
      "pi_session_id": "01a017…",
      "attempts": 1,
      "status": "satisfied",
      "evidence": [{ "id": "ev-coordinato-…", "kind": "coordinator.decision", "summary_head": "…first 240 chars…" }]
    },
    …
  ],
  "evidence_index": ["ev-coordinato-…", "ev-topology-m-…", …],
  "target_mutation_check": { "clean_at_end": true, "notes": "…" }
}
```

`chain-report.json` is deterministic — the same chain rerun against the same
inputs produces byte-identical output modulo timestamps. That determinism
matters because the orchestrator downstream matches on `chain_run_id` +
`evidence_index` to route follow-ups.

### After every run — rebuild the index

```bash
cd <target-repo>
service-knowledge index build   # rebuild FTS5 index; picks up the new SKILL.md row
service-knowledge index stats   # confirm item_count went up + last source_ref updated
service-knowledge index query "<symptom you just added>" --service-id sre-triage-runs
```

If `index build` errors on the new service (usually "reconcile: territory
globs match no source files"), the fix is that this service intentionally has
self-referential territory — accept it or set territory to include the
`runs/**` subtree, whichever the current reconcile driver permits.

### One-time bootstrap (per target repo)

Only needed the first time in a repo. Produces the empty SKILL.md + registry
entry; no runs yet. Idempotent — safe to re-run.

    bash <ROOT>/scripts/bootstrap-sre-triage-runs.sh <target-repo-abs-path>

(the script is a companion asset — see the sre-triage-runs playbook block
in this SKILL for the exact steps if the script is not present).
