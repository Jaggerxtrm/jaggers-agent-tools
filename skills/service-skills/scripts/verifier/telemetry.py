#!/usr/bin/env python3
"""Structured telemetry: one JSON line per invocation to stderr.

Shape (grep with ``component=verifier``):
    {timestamp, component, event, candidate_hash, current_hash, service_id,
     claim_count, verdict_counts_by_type, duration_ms}

Deliberately carries NO raw claim text and NO source content — only claim_id-level
aggregates and content hashes — so the line is safe to log anywhere.
"""
from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone

from .manifest import ClaimManifest

COMPONENT = "verifier"


def verdict_counts_by_type(manifest: ClaimManifest) -> dict[str, dict[str, int]]:
    counts: dict[str, dict[str, int]] = {}
    for claim in manifest.claims:
        bucket = counts.setdefault(claim.claim_type.value, {"PASS": 0, "CONFLICT": 0, "UNKNOWN": 0})
        bucket[claim.verdict.value] += 1
    return counts


def emit_run(manifest: ClaimManifest, duration_ms: float, stream=None) -> str:
    """Write the telemetry line to stderr (or ``stream``) and return it."""
    line = json.dumps(
        {
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "component": COMPONENT,
            "event": "run",
            "candidate_hash": manifest.candidate_hash,
            "current_hash": manifest.current_hash,
            "service_id": manifest.service_id,
            "claim_count": len(manifest.claims),
            "verdict_counts_by_type": verdict_counts_by_type(manifest),
            "duration_ms": round(duration_ms, 3),
        },
        sort_keys=True,
    )
    print(line, file=stream or sys.stderr)
    return line


class Timer:
    """Tiny wall-clock timer for the duration_ms field."""

    def __init__(self) -> None:
        self._start = time.perf_counter()

    def elapsed_ms(self) -> float:
        return (time.perf_counter() - self._start) * 1000.0
