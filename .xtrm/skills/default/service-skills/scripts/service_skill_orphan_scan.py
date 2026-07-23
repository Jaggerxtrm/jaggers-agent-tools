#!/usr/bin/env python3
"""Detect compose services missing from the service-skills registry."""

from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path

import yaml

CONCEPTUAL_SERVICES = {"alerting", "runners", "grafana-dashboards"}


def scan(root: Path) -> dict[str, list[str]]:
    compose = yaml.safe_load((root / "docker-compose.yml").read_text(encoding="utf-8")) or {}
    compose_services = set((compose.get("services") or {}).keys())
    registry_paths = sorted(root.glob(".xtrm/skills/*/service-skills/service-registry.json"))
    if not registry_paths:
        raise FileNotFoundError("no service-registry.json found under .xtrm/skills/*/service-skills")

    registered: set[str] = set()
    for path in registry_paths:
        registry = json.loads(path.read_text(encoding="utf-8"))
        registered.update((registry.get("services") or {}).keys())

    return {
        "missing": sorted(compose_services - registered),
        "conceptual_ok": sorted((registered - compose_services) & CONCEPTUAL_SERVICES),
    }


def _write_fixture(root: Path, compose: set[str], registered: set[str]) -> None:
    (root / "docker-compose.yml").write_text(
        yaml.safe_dump({"services": {name: {} for name in compose}}), encoding="utf-8"
    )
    registry = root / ".xtrm/skills/test/service-skills/service-registry.json"
    registry.parent.mkdir(parents=True)
    registry.write_text(
        json.dumps({"services": {name: {} for name in registered}}), encoding="utf-8"
    )


def _self_test() -> None:
    cases = [
        ({"api"}, {"api"}, {"missing": [], "conceptual_ok": []}),
        ({"api", "worker"}, {"api"}, {"missing": ["worker"], "conceptual_ok": []}),
        ({"api"}, {"api", "alerting"}, {"missing": [], "conceptual_ok": ["alerting"]}),
        (
            {"api", "worker"},
            {"api", "grafana-dashboards", "runners"},
            {"missing": ["worker"], "conceptual_ok": ["grafana-dashboards", "runners"]},
        ),
    ]
    with tempfile.TemporaryDirectory() as tmp:
        for index, (compose, registered, expected) in enumerate(cases):
            root = Path(tmp) / str(index)
            root.mkdir()
            _write_fixture(root, compose, registered)
            assert scan(root) == expected, (index, scan(root), expected)
    print("service_skill_orphan_scan.py: self-test OK")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        _self_test()
        return 0

    result = scan(args.root.resolve())
    print(json.dumps(result, sort_keys=True))
    return int(bool(result["missing"]))


if __name__ == "__main__":
    raise SystemExit(main())
