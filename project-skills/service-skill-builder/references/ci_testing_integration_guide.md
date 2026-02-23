# Service Skill Scripts: CI/CD & Testing Integration Guide

**Created:** 2026-02-14
**Purpose:** Demonstrate operational value of service-skill-builder scripts beyond agentic use
**Audience:** DevOps engineers, SREs, CI/CD pipeline maintainers

---

## Overview

The service-skill-builder methodology generates operational scripts that provide **immediate production value** independent of AI agents. These scripts serve as:

- **Pre-deployment validation gates**
- **CI/CD health checks**
- **Monitoring probe endpoints**
- **Troubleshooting automation**
- **Integration test fixtures**

This guide demonstrates real-world usage patterns for teams without AI agent infrastructure.

---

## Table of Contents

1. [CI/CD Pipeline Integration](#cicd-pipeline-integration)
2. [Pre-Deployment Validation](#pre-deployment-validation)
3. [Monitoring & Alerting](#monitoring--alerting)
4. [Automated Testing](#automated-testing)
5. [Troubleshooting Automation](#troubleshooting-automation)
6. [Docker Compose Health Checks](#docker-compose-health-checks)

---

## CI/CD Pipeline Integration

### GitHub Actions Example

```yaml
# .github/workflows/ext-papers-validation.yml
name: ext-papers Service Validation

on:
  push:
    paths:
      - 'research-papers-pipeline/**'
      - 'research-papers-pipeline/config/publisher_mapping.json'
  pull_request:
    paths:
      - 'research-papers-pipeline/**'

jobs:
  validate-config:
    name: Validate Publisher Config
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'

      - name: Validate regex patterns in publisher_mapping.json
        run: |
          python3 .claude/skills/ext-papers/scripts/validate_config.py
          if [ $? -ne 0 ]; then
            echo "❌ Config validation failed - TextCleaner will crash in production"
            exit 1
          fi

      - name: Comment on PR if validation fails
        if: failure() && github.event_name == 'pull_request'
        uses: actions/github-script@v6
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '❌ **Config Validation Failed**\n\nInvalid regex patterns detected in `publisher_mapping.json`. Run `python3 .claude/skills/ext-papers/scripts/validate_config.py` locally for details.'
            })

  health-check:
    name: Service Health Check
    runs-on: ubuntu-latest
    needs: validate-config
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_PASSWORD: test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3

      - name: Setup Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install -e ./shared

      - name: Run health check
        env:
          DB_HOST: localhost
          DB_PASSWORD: test
        run: |
          python3 .claude/skills/ext-papers/scripts/health_check.py
```

---

### GitLab CI Example

```yaml
# .gitlab-ci.yml
stages:
  - validate
  - test
  - deploy

validate:config:
  stage: validate
  image: python:3.11-slim
  script:
    - python3 .claude/skills/ext-papers/scripts/validate_config.py
  rules:
    - changes:
        - research-papers-pipeline/config/publisher_mapping.json
  allow_failure: false

test:health:
  stage: test
  image: python:3.11-slim
  services:
    - postgres:17
  variables:
    POSTGRES_PASSWORD: test
    DB_HOST: postgres
    DB_PASSWORD: test
  before_script:
    - apt-get update && apt-get install -y git
    - pip install -r requirements.txt
    - pip install -e ./shared
  script:
    - python3 .claude/skills/ext-papers/scripts/health_check.py
  only:
    - merge_requests
    - main
```

---

## Pre-Deployment Validation

### Deployment Gate Script

Create a comprehensive pre-deployment validation script:

```bash
#!/bin/bash
# deploy/pre-flight-check.sh
# Run before deploying ext-papers service

set -e

echo "======================================"
echo "ext-papers Pre-Deployment Validation"
echo "======================================"
echo ""

# 1. Config validation (prevents TextCleaner crashes)
echo "Step 1: Validating publisher_mapping.json..."
python3 .claude/skills/ext-papers/scripts/validate_config.py
if [ $? -ne 0 ]; then
    echo "❌ ABORT: Config validation failed"
    exit 1
fi
echo "✓ Config validation passed"
echo ""

# 2. Database connectivity test
echo "Step 2: Testing database connectivity..."
python3 .claude/skills/ext-papers/scripts/db_query.py "SELECT 1" > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "❌ ABORT: Cannot connect to database"
    exit 1
fi
echo "✓ Database reachable"
echo ""

# 3. Check for data staleness (no ingestion in 24h = potential issue)
echo "Step 3: Checking data freshness..."
LATEST_DATE=$(python3 .claude/skills/ext-papers/scripts/db_query.py \
  "SELECT MAX(doc_date)::text FROM research_documents" 2>/dev/null | tail -1 | tr -d '(),"')

if [ -z "$LATEST_DATE" ]; then
    echo "⚠ WARNING: Cannot determine latest paper date"
else
    DAYS_OLD=$(( ($(date +%s) - $(date -d "$LATEST_DATE" +%s)) / 86400 ))
    if [ $DAYS_OLD -gt 7 ]; then
        echo "⚠ WARNING: Latest paper is $DAYS_OLD days old (potential ingestion issue)"
    else
        echo "✓ Data freshness OK (latest paper: $LATEST_DATE)"
    fi
fi
echo ""

# 4. Check container resource usage (memory leak detection)
echo "Step 4: Checking current container stats..."
if docker stats ext-papers --no-stream --format "table {{.MemUsage}}\t{{.CPUPerc}}" 2>/dev/null | tail -1; then
    echo "✓ Container stats retrieved"
else
    echo "⚠ WARNING: Container not running (expected if deploying fresh)"
fi
echo ""

echo "======================================"
echo "✓ Pre-deployment validation PASSED"
echo "======================================"
echo ""
echo "Safe to proceed with deployment."
exit 0
```

### Usage in Deployment Pipeline

```yaml
# k8s deployment with validation gate
apiVersion: batch/v1
kind: Job
metadata:
  name: ext-papers-preflight
  namespace: mercury
spec:
  template:
    spec:
      containers:
      - name: validator
        image: python:3.11-slim
        command: ["/bin/bash", "/scripts/pre-flight-check.sh"]
        volumeMounts:
        - name: validation-scripts
          mountPath: /scripts
        envFrom:
        - secretRef:
            name: mercury-db-credentials
      volumes:
      - name: validation-scripts
        configMap:
          name: ext-papers-validation-scripts
      restartPolicy: Never
  backoffLimit: 0  # Fail immediately if validation fails
```

---

## Monitoring & Alerting

### Prometheus Integration

The health check script's exit codes enable direct Prometheus monitoring:

```yaml
# prometheus/blackbox.yml
modules:
  ext_papers_health:
    prober: exec
    timeout: 30s
    exec:
      command: python3
      args:
        - /opt/skills/ext-papers/scripts/health_check.py
```

```yaml
# prometheus/prometheus.yml
scrape_configs:
  - job_name: 'ext-papers-health'
    metrics_path: /probe
    params:
      module: [ext_papers_health]
    static_configs:
      - targets:
          - ext-papers-health-check
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - source_labels: [__param_target]
        target_label: instance
      - target_label: __address__
        replacement: blackbox-exporter:9115
```

### Custom Health Check Exporter

Wrap the health check as a Prometheus exporter:

```python
#!/usr/bin/env python3
# monitoring/ext_papers_exporter.py
"""Prometheus exporter for ext-papers health metrics"""
import subprocess
import time
from prometheus_client import start_http_server, Gauge, Counter

# Metrics
health_status = Gauge('ext_papers_health_status',
                     'Overall health status (1=healthy, 0=unhealthy)')
container_running = Gauge('ext_papers_container_running',
                         'Container running status (1=running, 0=stopped)')
volume_accessible = Gauge('ext_papers_volume_accessible',
                         'Volume mount accessibility (1=accessible, 0=failed)')
database_connected = Gauge('ext_papers_database_connected',
                          'Database connectivity (1=connected, 0=failed)')
pdf_count = Gauge('ext_papers_pdf_count',
                 'Number of PDF files in volume')
document_count = Gauge('ext_papers_documents_total',
                      'Total documents in research_documents table')

check_duration = Gauge('ext_papers_health_check_duration_seconds',
                      'Time taken to run health check')
check_errors = Counter('ext_papers_health_check_errors_total',
                      'Total health check errors')

def run_health_check():
    """Run health check and update metrics"""
    start_time = time.time()

    try:
        # Run health check script
        result = subprocess.run(
            ['python3', '/opt/skills/ext-papers/scripts/health_check.py'],
            capture_output=True,
            text=True,
            timeout=60
        )

        # Parse output for individual check results
        output = result.stdout

        # Container status
        if 'Container running' in output:
            container_running.set(1)
        else:
            container_running.set(0)

        # Volume accessibility
        if 'Volume accessible' in output:
            volume_accessible.set(1)
            # Extract PDF count if available
            import re
            match = re.search(r'Volume accessible \(([0-9,]+) PDF files', output)
            if match:
                count = int(match.group(1).replace(',', ''))
                pdf_count.set(count)
        else:
            volume_accessible.set(0)

        # Database connectivity
        if 'Database connected' in output:
            database_connected.set(1)
            # Extract document count
            match = re.search(r'research_documents: ([0-9,]+) records', output)
            if match:
                count = int(match.group(1).replace(',', ''))
                document_count.set(count)
        else:
            database_connected.set(0)

        # Overall health
        if result.returncode == 0:
            health_status.set(1)
        else:
            health_status.set(0)
            check_errors.inc()

    except Exception as e:
        print(f"Health check failed: {e}")
        health_status.set(0)
        check_errors.inc()

    finally:
        duration = time.time() - start_time
        check_duration.set(duration)

if __name__ == '__main__':
    # Start Prometheus HTTP server
    start_http_server(8000)
    print("Exporter started on :8000")

    # Run health checks every 60 seconds
    while True:
        run_health_check()
        time.sleep(60)
```

### Grafana Dashboard

```json
{
  "dashboard": {
    "title": "ext-papers Service Health",
    "panels": [
      {
        "title": "Overall Health Status",
        "type": "stat",
        "targets": [{
          "expr": "ext_papers_health_status"
        }],
        "fieldConfig": {
          "defaults": {
            "thresholds": {
              "steps": [
                {"value": 0, "color": "red"},
                {"value": 1, "color": "green"}
              ]
            }
          }
        }
      },
      {
        "title": "PDF Files in Volume",
        "type": "stat",
        "targets": [{
          "expr": "ext_papers_pdf_count"
        }]
      },
      {
        "title": "Documents in Database",
        "type": "stat",
        "targets": [{
          "expr": "ext_papers_documents_total"
        }]
      },
      {
        "title": "Health Check Duration",
        "type": "graph",
        "targets": [{
          "expr": "ext_papers_health_check_duration_seconds"
        }]
      }
    ]
  }
}
```

---

## Automated Testing

### Integration Test Suite

```python
# tests/integration/test_ext_papers_service.py
"""Integration tests using service-skill-builder scripts"""
import subprocess
import pytest

class TestExtPapersService:
    """Integration tests for ext-papers service"""

    def test_config_validation_passes(self):
        """Config validator should pass with valid config"""
        result = subprocess.run(
            ['python3', '.claude/skills/ext-papers/scripts/validate_config.py'],
            capture_output=True,
            text=True
        )
        assert result.returncode == 0, f"Config validation failed: {result.stdout}"

    def test_health_check_passes(self):
        """Health check should pass when service is running"""
        result = subprocess.run(
            ['python3', '.claude/skills/ext-papers/scripts/health_check.py'],
            capture_output=True,
            text=True
        )
        assert result.returncode == 0, f"Health check failed: {result.stdout}"
        assert "HEALTHY" in result.stdout

    def test_database_connectivity(self):
        """Database query tool should successfully connect"""
        result = subprocess.run(
            ['python3', '.claude/skills/ext-papers/scripts/db_query.py', 'stats'],
            capture_output=True,
            text=True,
            timeout=10
        )
        assert result.returncode == 0
        assert "total_documents" in result.stdout

    def test_standard_queries_execute(self):
        """All standard queries should execute without errors"""
        # Get list of standard queries
        result = subprocess.run(
            ['python3', '.claude/skills/ext-papers/scripts/db_query.py', '--list'],
            capture_output=True,
            text=True
        )

        # Extract query names
        import re
        queries = re.findall(r'^\s+(\S+)\s+', result.stdout, re.MULTILINE)

        # Test each query
        for query_name in queries:
            result = subprocess.run(
                ['python3', '.claude/skills/ext-papers/scripts/db_query.py', query_name],
                capture_output=True,
                text=True,
                timeout=30
            )
            assert result.returncode == 0, f"Query '{query_name}' failed: {result.stderr}"

    @pytest.mark.slow
    def test_data_freshness_within_threshold(self):
        """Latest paper should be within 7 days (indicates active ingestion)"""
        result = subprocess.run(
            ['python3', '.claude/skills/ext-papers/scripts/db_query.py',
             "SELECT MAX(doc_date) FROM research_documents"],
            capture_output=True,
            text=True
        )

        assert result.returncode == 0

        # Parse date and check freshness
        from datetime import datetime, timedelta
        import re

        date_match = re.search(r'(\d{4}-\d{2}-\d{2})', result.stdout)
        if date_match:
            latest_date = datetime.strptime(date_match.group(1), '%Y-%m-%d')
            days_old = (datetime.now() - latest_date).days

            assert days_old < 7, f"Data is stale: latest paper is {days_old} days old"
```

### Smoke Test Script

```bash
#!/bin/bash
# tests/smoke-test.sh
# Quick smoke test after deployment

set -e

echo "Running ext-papers smoke tests..."

# Test 1: Config is valid
echo -n "1. Config validation... "
python3 .claude/skills/ext-papers/scripts/validate_config.py > /dev/null 2>&1
echo "✓"

# Test 2: Service is healthy
echo -n "2. Health check... "
python3 .claude/skills/ext-papers/scripts/health_check.py > /dev/null 2>&1
echo "✓"

# Test 3: Database has data
echo -n "3. Database has documents... "
COUNT=$(python3 .claude/skills/ext-papers/scripts/db_query.py \
  "SELECT COUNT(*) FROM research_documents" 2>/dev/null | tail -1 | tr -d '(),')
if [ "$COUNT" -gt 1000 ]; then
    echo "✓ ($COUNT documents)"
else
    echo "⚠ Low document count: $COUNT"
fi

# Test 4: Recent ingestion activity
echo -n "4. Recent ingestion... "
python3 .claude/skills/ext-papers/scripts/db_query.py daily-ingest > /dev/null 2>&1
echo "✓"

echo ""
echo "✓ All smoke tests passed"
```

---

## Troubleshooting Automation

### Automated Diagnostic Script

```bash
#!/bin/bash
# ops/diagnose-ext-papers.sh
# Automated troubleshooting for ext-papers issues

echo "======================================"
echo "ext-papers Automated Diagnostics"
echo "======================================"
echo ""

# Collect all diagnostic information
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_FILE="/tmp/ext-papers-diagnostics-${TIMESTAMP}.txt"

{
    echo "Diagnostic Report: ext-papers"
    echo "Generated: $(date)"
    echo "======================================"
    echo ""

    echo "1. HEALTH CHECK RESULTS"
    echo "--------------------------------------"
    python3 .claude/skills/ext-papers/scripts/health_check.py 2>&1
    echo ""

    echo "2. DATABASE STATISTICS"
    echo "--------------------------------------"
    python3 .claude/skills/ext-papers/scripts/db_query.py stats 2>&1
    echo ""

    echo "3. DATA QUALITY CHECK"
    echo "--------------------------------------"
    python3 .claude/skills/ext-papers/scripts/db_query.py data-quality 2>&1
    echo ""

    echo "4. RECENT INGESTION ACTIVITY"
    echo "--------------------------------------"
    python3 .claude/skills/ext-papers/scripts/db_query.py daily-ingest 2>&1
    echo ""

    echo "5. CONTAINER LOGS (Last 100 lines)"
    echo "--------------------------------------"
    docker logs ext-papers --tail 100 2>&1
    echo ""

    echo "6. CONTAINER RESOURCE USAGE"
    echo "--------------------------------------"
    docker stats ext-papers --no-stream 2>&1
    echo ""

    echo "7. CONFIG VALIDATION"
    echo "--------------------------------------"
    python3 .claude/skills/ext-papers/scripts/validate_config.py 2>&1

} > "$REPORT_FILE"

echo "Diagnostic report saved to: $REPORT_FILE"
echo ""

# Auto-detect common issues
echo "Analyzing for common issues..."
echo ""

# Issue 1: Container not running
if ! docker ps | grep -q ext-papers; then
    echo "❌ ISSUE DETECTED: Container is not running"
    echo "   Resolution: docker-compose up -d ext-papers"
    echo ""
fi

# Issue 2: Stale data
DAYS_STALE=$(grep -A5 "Latest paper date" "$REPORT_FILE" | grep -o '[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}' | xargs -I{} bash -c "echo \$(( (\$(date +%s) - \$(date -d {} +%s)) / 86400 ))")
if [ "$DAYS_STALE" -gt 7 ]; then
    echo "❌ ISSUE DETECTED: Data is stale ($DAYS_STALE days old)"
    echo "   Resolution: Check volume mount and polling activity"
    echo ""
fi

# Issue 3: Config validation failures
if grep -q "❌.*Config validation failed" "$REPORT_FILE"; then
    echo "❌ ISSUE DETECTED: Invalid regex patterns in config"
    echo "   Resolution: Review publisher_mapping.json for problematic patterns"
    echo ""
fi

# Issue 4: Database connectivity
if grep -q "Database connection failed" "$REPORT_FILE"; then
    echo "❌ ISSUE DETECTED: Cannot connect to database"
    echo "   Resolution: Check .env file and DB credentials"
    echo ""
fi

echo "Full diagnostic report: $REPORT_FILE"
```

---

## Docker Compose Health Checks

### Enhanced Compose with Script-Based Health Checks

```yaml
# research-papers-pipeline/infra/docker-compose.yml
services:
  ext-papers:
    container_name: ext-papers
    build:
      context: ../..
      dockerfile: research-papers-pipeline/Dockerfile
    restart: unless-stopped

    env_file:
      - ../../.env

    volumes:
      - research_papers_storage:/research-papers:ro
      - ../config:/app/research-papers-pipeline/config:ro
      - bge_cache:/home/appuser/.cache
      - pipeline_state:/app/state
      # Mount health check script
      - ../../.claude/skills/ext-papers/scripts:/app/health-scripts:ro

    networks:
      - merc

    # Use custom health check script
    healthcheck:
      test: ["CMD", "python3", "/app/health-scripts/health_check.py"]
      interval: 60s
      timeout: 30s
      retries: 3
      start_period: 60s

    # Depends on health of database
    depends_on:
      postgres:
        condition: service_healthy

  # Add health check monitoring sidecar
  ext-papers-monitor:
    image: python:3.11-slim
    container_name: ext-papers-monitor
    restart: unless-stopped

    volumes:
      - ../../.claude/skills/ext-papers/scripts:/scripts:ro
      - ../../.env:/app/.env:ro

    environment:
      - MONITORING_INTERVAL=300  # Run every 5 minutes

    command: >
      bash -c "
        pip install python-dotenv prometheus-client &&
        while true; do
          python3 /scripts/health_check.py || echo 'Health check failed';
          sleep ${MONITORING_INTERVAL:-300};
        done
      "

    networks:
      - merc

    depends_on:
      - ext-papers
```

---

## Best Practices

### 1. Exit Code Conventions

All scripts follow standard Unix exit codes:
- `0` - Success
- `1` - Failure (actionable error)
- `2` - Warning (service degraded but operational)

### 2. Output Formatting

Scripts support multiple output formats for different contexts:

```bash
# Human-readable (default)
python3 health_check.py

# Machine-readable JSON (for parsing)
python3 health_check.py --json

# Silent mode (exit code only, for CI)
python3 health_check.py --silent
```

### 3. Timeout Configuration

All scripts respect environment variables for timeouts:

```bash
export HEALTH_CHECK_TIMEOUT=60  # seconds
export DB_QUERY_TIMEOUT=30
export VALIDATION_TIMEOUT=120

python3 health_check.py
```

### 4. Credential Management

Scripts read credentials from environment:

```bash
# Use .env file
export $(cat .env | xargs)
python3 db_query.py stats

# Or Docker secrets
export DB_PASSWORD=$(cat /run/secrets/db_password)
python3 db_query.py stats
```

---

## Maintenance Considerations

### Script Versioning

Track script versions alongside service versions:

```yaml
# k8s ConfigMap
apiVersion: v1
kind: ConfigMap
metadata:
  name: ext-papers-scripts
  labels:
    app: ext-papers
    scripts-version: "1.0.0"
    service-version: "2.5.0"
data:
  health_check.py: |
    # Script content here
```

### Periodic Validation

Run validation scripts on a schedule:

```yaml
# k8s CronJob
apiVersion: batch/v1
kind: CronJob
metadata:
  name: ext-papers-weekly-validation
spec:
  schedule: "0 2 * * 0"  # Every Sunday at 2 AM
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: validator
            image: python:3.11-slim
            command:
            - /bin/bash
            - -c
            - |
              python3 /scripts/validate_config.py
              python3 /scripts/health_check.py
              python3 /scripts/db_query.py data-quality
            volumeMounts:
            - name: scripts
              mountPath: /scripts
          restartPolicy: OnFailure
```

---

## Conclusion

Service-skill-builder scripts provide **tangible operational value** beyond AI agent knowledge:

| Script | Primary Use Case | CI/CD Value | Monitoring Value |
|--------|------------------|-------------|------------------|
| `validate_config.py` | Pre-deployment gate | ✓ Prevents crashes | ✗ |
| `health_check.py` | Service validation | ✓ Integration tests | ✓ Probe endpoint |
| `db_query.py` | Operational queries | ✓ Data validation | ✓ Metrics source |

These scripts are **production-ready tools** that can be adopted incrementally by teams without any AI infrastructure.

---

**Next Steps:**

1. Integrate `validate_config.py` into your CI pipeline today (5-minute setup)
2. Add `health_check.py` as a Docker Compose health check (10-minute setup)
3. Create Prometheus exporter wrapper for monitoring (30-minute setup)
4. Build automated troubleshooting scripts (1-hour setup)

**ROI:** Even without AI agents, these scripts prevent production incidents, accelerate troubleshooting, and enable proactive monitoring.
