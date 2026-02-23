# Script Quality Standards for Service Skills

> Distilled from the mercury-market-data implementation (Feb 2026).
> Apply these standards to every script generated in Phase 2 of the service-skill-builder workflow.

---

## Design Principles

### 1. Service-Specific, Not Generic

The single most important rule. Generic scripts provide zero value.

**Wrong (generic stub output):**
```python
error_patterns = [
    r"(ERROR|CRITICAL|FATAL|EXCEPTION)",
    r"ConnectionError",
    r"SyntaxError",
    r"ImportError",
]
```

**Right (service-specific, sourced from actual codebase):**
```python
PATTERNS = [
    # From yfinance source: actual exception class names
    ("Rate limit",    r"YFRateLimitError|429.*yahoo|Too Many Requests",  "error"),
    ("Missing data",  r"YFPricesMissingError|no timezone found|Period.*invalid", "warning"),
    # From DB layer: actual psycopg2 messages
    ("DB connect",    r"could not connect|password authentication failed",  "critical"),
    ("DB write",      r"relation.*does not exist|column.*does not exist",   "error"),
]
```

**How to find real patterns:** Read the service's entry point script, exception handlers, and log statements. Search for `logger.error`, `raise`, `except` blocks, and error message strings.

---

### 2. Port Awareness: Host vs. Container

Scripts in `skills/` run on the host machine, not inside Docker. Port mappings matter.

| Context | Use This Port |
|---------|--------------|
| Host scripts (`skills/*.py`) | External mapped port (e.g., `5433` for TimescaleDB `5433:5432`) |
| Docker service env vars | Internal port (`5432`) |
| `docker exec` commands | N/A — resolves via container DNS |

**Always use env vars with correct defaults:**
```python
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = int(os.getenv("DB_PORT", "5433"))   # External mapped port
```

---

### 3. Read-Before-Write Discipline

When a stub file already exists and you are replacing it, **always read it first**. Write tools fail with "File has not been read yet" otherwise. New files (no existing content) can be created directly.

---

### 4. Dual Output Mode

Every script must support both human-readable (default) and machine-readable (`--json`) output.

```python
parser.add_argument("--json", action="store_true", help="Output as JSON")

if args.json:
    print(json.dumps(result, indent=2, default=str))
    return
# ... human-readable output below
```

---

### 5. Actionable Remediation in Output

When a health probe or log hunter detects a critical problem, it must print the exact fix command — not a generic "check the logs."

```python
if by_sev["critical"]:
    print(f"\n  ⚠  Critical issues detected.")
    if any("OAuth expired" in h["labels"] for h in by_sev["critical"]):
        print(f"     Fix: docker exec -it {CONTAINER} python scripts/auth.py --refresh")
    if any("DB connect" in h["labels"] for h in by_sev["critical"]):
        print(f"     Fix: docker compose restart timescaledb && docker compose restart {CONTAINER}")
```

---

## health_probe.py Standards

### Structure

```python
CONTAINER = "service-name"   # Exact Docker container name

def check_container() -> dict:
    """docker inspect for status. Always present."""
    ...

def check_<domain>() -> dict:
    """Service-specific check (DB freshness, file presence, HTTP endpoint, etc.)"""
    ...

def main():
    # 1. Collect all checks
    # 2. --json: dump report dict
    # 3. Human: print formatted table
    # 4. Print fix commands on failure
```

### For DB-writing services: Freshness Table

```python
# Define per-table stale thresholds based on service update frequency
FRESHNESS_CHECKS = [
    # (table_name,          timestamp_col,  stale_threshold_minutes)
    ("candles_5m",          "timestamp",    30),    # 5m feed → stale if >30m old
    ("outright_snapshots",  "snapshot_ts",  10),    # continuous → stale if >10m old
    ("volatility_snapshots","snapshot_ts",  1500),  # daily job → stale if >25h old
]
```

Stale threshold logic: `update_interval × 3` is a reasonable default, but adjust for business criticality.

### For HTTP API services: Endpoint Probing

Do not ping generic ports. Probe the actual API routes the service exposes:

```python
HEALTH_ENDPOINTS = [
    ("FastAPI health",    "http://localhost:8000/api/system/health", 3),
    ("Background server", "http://localhost:5002/health",            2),
]
# Optional smoke tests against real data endpoints
SMOKE_ENDPOINTS = [
    ("Market snapshot",  "http://localhost:8000/api/market/snapshot"),
    ("Volatility data",  "http://localhost:8000/api/analytics/volatility"),
]
```

### For one-shot services (migrations, backfills): Exit Code

```python
# docker inspect returns status="exited" and exit_code="0" on success
result = subprocess.run(
    ["docker", "inspect", "--format",
     "{{.State.Status}} {{.State.ExitCode}} {{.State.FinishedAt}}",
     CONTAINER],
    capture_output=True, text=True
)
```

A one-shot service is healthy if `exit_code == "0"` and expected tables/schemas exist in the DB.

### For file watcher services: Mount + State File

```python
def check_scid_mount() -> dict:
    result = subprocess.run(
        ["docker", "exec", CONTAINER, "ls", "/data/scid"],
        capture_output=True, text=True, timeout=10
    )
    files = [f for f in result.stdout.splitlines() if f.endswith(".scid")]
    return {"accessible": result.returncode == 0, "file_count": len(files)}

def check_state_file() -> dict:
    result = subprocess.run(
        ["docker", "exec", CONTAINER, "cat", "/app/state/watcher_state.json"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        return {"present": False}
    return {"present": True, "state": json.loads(result.stdout)}
```

---

## log_hunter.py Standards

### Pattern Structure

```python
PATTERNS = [
    # (label,           regex_pattern,              severity)
    ("OAuth expired",   r"invalid_grant|token.*expired",  "critical"),
    ("PDF parse",       r"PdfReadError|pdf.*format.*changed", "error"),
    ("No data",         r"No new.*report|0 reports.*found",   "warning"),
    ("Report saved",    r"report.*ingested|saved.*DB",         "info"),
]
```

**Severity levels:**
- `critical`: Service needs restart or manual intervention to recover
- `error`: Functionality is impaired, data may be incomplete
- `warning`: Degraded state, worth monitoring
- `info`: Normal operation confirmation

### Severity Ordering

Always use `sev_order` so that the highest severity "wins" when a line matches multiple patterns:

```python
sev_order = {"critical": 0, "error": 1, "warning": 2, "info": 3}
if matched_severity is None or sev_order[severity] < sev_order[matched_severity]:
    matched_severity = severity
```

### Required CLI Flags

```python
parser.add_argument("--tail",        type=int,  default=200)
parser.add_argument("--since",       type=str,  default=None)   # Docker --since (e.g. "1h", "2026-01-01")
parser.add_argument("--errors-only", action="store_true")       # Skip info entries
parser.add_argument("--json",        action="store_true")
```

### Pattern Design Rules

1. Test patterns against the **actual log format** of the service, not hypothetical messages.
2. Use `re.IGNORECASE` — log levels and messages vary in capitalization.
3. Prefer specific class names (`YFPricesMissingError`) over generic keywords (`Error`).
4. For Rust services, add: `r"thread '.*' panicked|panicked at '"` as a critical pattern.
5. Always include at least 2 `info` patterns for normal operation confirmation — so the absence of info lines itself becomes a signal.

### Anti-patterns to avoid

| Anti-pattern | Why It Fails |
|---|---|
| `r"ERROR"` | Matches comment text, variable names, and dozens of false positives |
| `r"Exception"` | Too broad — every Python `try/except` emits this |
| `r"ConnectionError"` | Only catches one subclass; misses `OperationalError`, `InterfaceError`, etc. |
| Single `error_patterns` list without severity | Provides no triage — everything looks equally bad |

---

## Specialist Script Standards

### data_explorer.py (for DB-writing services)

Purpose: Let an agent query the service's output tables interactively without writing SQL.

```python
# Always support:
parser.add_argument("--symbol",  help="Filter to a specific symbol")
parser.add_argument("--history", action="store_true", help="Show time series, not just latest")
parser.add_argument("--limit",   type=int, default=20)
parser.add_argument("--json",    action="store_true")
```

Use `DISTINCT ON (symbol) ... ORDER BY symbol, timestamp DESC` for "latest per symbol" queries. Use parameterized queries: `WHERE symbol = %s`.

### endpoint_tester.py (for HTTP API services)

Test every real route in the API, not just `/health`. Measure response time and size:

```python
ENDPOINTS = [
    # (label, method, path, expected_status, timeout_s)
    ("Health check",    "GET", "/api/system/health",          200, 3),
    ("Market overview", "GET", "/api/market/overview",        200, 5),
    ("Symbol detail",   "GET", "/api/market/ES=F",            200, 5),
    # ... all actual routes
]
```

Report slow endpoints (>2s) separately from failed ones.

### state_inspector.py (for stateful file watchers)

Read the state file via `docker exec` and compute lag between current file size and processed byte offset:

```python
scid_size  = get_file_size_in_container(container, filepath)
lag_bytes  = scid_size - state["byte_offset"]
lag_flag   = " ⚠" if lag_bytes > 1_000_000 else ""
```

### coverage_checker.py (for one-shot backfill services)

Report per-entity (spread, symbol, etc.) row counts, date ranges, and gaps:

```sql
SELECT entity_id, COUNT(*) AS rows,
       MIN(ts) AS earliest, MAX(ts) AS latest
FROM output_table
GROUP BY entity_id ORDER BY entity_id;
```

Also detect missing entities against a known expected list, and find time-series gaps using `LAG()`.

---

## Common Pitfalls

| Pitfall | Prevention |
|---------|-----------|
| Script uses port 5432 from host | Default to 5433 (external mapped port); document the discrepancy |
| Script uses HTTP port scanning instead of real routes | Read docker-compose to find actual port mappings; check the service's API routes |
| OAuth token path is wrong | `docker exec container ls /expected/path` to verify before hardcoding |
| DB table name is assumed, not verified | `SELECT tablename FROM pg_tables WHERE schemaname='public'` to discover |
| Log patterns too broad | Read the actual `logger.error()` calls in the source code |
| Missing `--since` flag | Log hunters without `--since` can't be used for incremental monitoring |
| `health_probe.py` doesn't print fix commands | Always add actionable remediation text after detecting critical states |
| Forgot to sync to `.agent/` and `.gemini/` mirrors | Add sync step to the completion checklist |
