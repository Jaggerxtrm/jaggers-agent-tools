# Refactoring Plan: Universal Service Mapper (USM) (DevOps Enhanced)

**Objective:**
Transform the existing `service-skill-builder` into a project-agnostic "Universal Service Mapper" that dynamically discovers, analyzes, and maps microservices in *any* Docker-based project, integrating modern DevOps patterns for observability, security, and CI/CD.

## 1. Architecture Overhaul

The new architecture moves to a modular, pluggable design:

```
.claude/skills/service-skill-builder/
├── assets/
│   ├── templates/          # Jinja2 templates
│   │   ├── SKILL.md
│   │   ├── REFINEMENT_BRIEF.md
│   │   ├── ci/             # CI/CD Workflows (GHA, GitLab)
│   │   └── scripts/        # Script Archetypes
│   │       ├── data_explorer.py
│   │       ├── stream_monitor.py
│   │       ├── obs_prober.py
│   │       └── log_hunter.py
├── scripts/
│   ├── discovery.py        # File system & Docker discovery
│   ├── analysis.py         # AST & Semantic analysis
│   ├── devops_audit.py     # NEW: IaC, CI/CD, and Observability audit
│   ├── generator.py        # Skill generation logic
│   └── main.py             # Entry point
└── SKILL.md                # The USM skill itself
```

## 2. Implementation Steps

### Phase 1: Dynamic Discovery (`discovery.py`)
**Goal:** Remove hardcoded paths and expand to other IaC tools.
- **Docker/K8s Anchors**: Recursively scan from project root for `docker-compose*.yml`, `Dockerfile`, `Chart.yaml`, or `*.tf` files.
- **Service Identity**: Extract container names, images, build contexts, ports, and resource constraints (CPU/Memory).
- **Auto-Grouping**: Heuristic-based grouping of services sharing the same context (e.g., `redis` + `redis-commander`).

### Phase 2: Semantic & DevOps Analysis (`analysis.py` & `devops_audit.py`)
**Goal:** Enhance mapping with better code understanding and infrastructure context.
- **Semantic Deep Dive**: Detect language (Python, Node, Go) and trace execution from entrypoint to handlers.
- **CI/CD Mapping**: Detect existing `.github/workflows` or `.gitlab-ci.yml`. Link services to their relevant build/test jobs.
- **Observability Audit**: Detect Prometheus `/metrics` endpoints, OpenTelemetry instrumentation, or structured logging patterns.
- **Security Baseline**: Identify base images in Dockerfiles and flag outdated/insecure versions for refinement.
- **SSOT Resolution**: Fuzzy match documentation in `docs/`, `.serena/memories/`, or `README.md`.

### Phase 3: Skill Generation (`generator.py`)
**Goal:** Create high-quality, standardized skills with DevOps-first scripts.
- **Script Archetypes (DevOps Edition)**:
  - `Data Explorer`: Connection-pooled query tool (supports PG, Redis, Mongo).
  - `Observability Prober`: Validates metrics endpoints and log structure.
  - `Security Auditor`: Scripts to run `trivy` or `bandit` locally on the service.
  - `Deployment Verifier`: Health checks and post-deployment smoke tests.
- **Workflows**: Optionally generate `.github/workflows/verify-<service>.yml` for automated quality gates.

### Phase 4: Migration & Validation
- **Dry Run Mode**: Test USM on different repositories (Go, Python, Node) to verify agnostic discovery.
- **Incremental Update**: Preserve manual semantic refinements using `SEMANTIC_START/END` markers.

## 3. DevOps Script Archetypes

1.  **Data Explorer (`data_explorer.py`)**:
    - CLI interface for safe read-only queries.
2.  **Observability Prober (`obs_prober.py`)**:
    - Scrapes `/metrics` if Prometheus is detected.
    - Validates JSON log format against project standards.
3.  **Security Auditor (`security_audit.sh`)**:
    - Runs container scans and static analysis (SAST).
4.  **Deployment Verifier (`deploy_verify.py`)**:
    - Smoke tests (latency, error rates, core route accessibility).

## 4. Execution Plan

1.  **Scaffold**: Create directory structure and migrate existing logic to the new modular system.
2.  **Implement Discovery**: Write `discovery.py` and test against multiple repositories.
3.  **Implement Analysis & Audit**: Develop `analysis.py` and `devops_audit.py`.
4.  **Refactor Main Entry**: Unify everything into a single project-agnostic entry point.
5.  **Verify**: Run on `darth_feedor` and verify output quality.
