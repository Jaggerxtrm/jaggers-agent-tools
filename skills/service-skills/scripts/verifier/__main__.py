#!/usr/bin/env python3
"""CLI entry point: ``python3 -m verifier ...`` (advisory mode — always exits 0).

Invocation:
    python3 -m verifier --candidate <path> --current <path> \
        --territory 'svc/**' --refs base=<sha>,head=<sha> \
        --output-format json|markdown

The manifest carries the verdicts; the process never fails on a CONFLICT. Territory
globs are resolved against several sensible base dirs (explicit --source-root, the
candidate's directory, its parent, and cwd) and unioned, so the same command works
from the package root or a fixtures dir. The candidate/current SKILL files are
always excluded from the source corpus so prose never verifies against itself.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Allow `python3 -m verifier` when invoked from inside the package dir as well as
# from the sibling scripts/ dir (drift_detector.py path-resolution idiom).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from verifier import SourceCorpus, verify_candidate  # noqa: E402
from verifier.evidence_report import render_json, render_markdown  # noqa: E402


def _parse_refs(refs: str | None) -> str:
    """Turn ``base=<sha>,head=<sha>`` into the verified_at_ref (head, or base)."""
    if not refs:
        return ""
    parts = dict(kv.split("=", 1) for kv in refs.split(",") if "=" in kv)
    return parts.get("head") or parts.get("base") or ""


def _split_globs(values: list[str]) -> list[str]:
    globs: list[str] = []
    for value in values:
        globs.extend(g.strip() for g in value.split(",") if g.strip())
    return globs


def _load_corpus(globs: list[str], source_root: Path | None, candidate: Path, current: Path) -> SourceCorpus:
    """Union territory-glob matches across candidate base dirs; exclude the SKILL files."""
    excluded = {p.resolve() for p in (candidate, current) if p.exists()}
    base_dirs: list[Path] = []
    if source_root is not None:
        base_dirs.append(source_root)
    base_dirs += [candidate.resolve().parent, candidate.resolve().parent.parent, Path.cwd()]

    merged = SourceCorpus(base_dir=base_dirs[0])
    seen: set[Path] = set()
    for base in base_dirs:
        if not base.is_dir():
            continue
        for pattern in globs:
            for path in sorted(base.glob(pattern)):
                if not path.is_file():
                    continue
                resolved = path.resolve()
                if resolved in excluded or resolved in seen:
                    continue
                seen.add(resolved)
                rel = path.relative_to(base).as_posix()
                text = path.read_text(encoding="utf-8", errors="ignore")
                merged.files[rel] = text
                if path.name.lower() in ("compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"):
                    merged._absorb_compose(rel, text)  # noqa: SLF001 — same-package reuse
    return merged


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="verifier",
        description="Deterministic, advisory-only claim verifier for service SKILLs.",
    )
    parser.add_argument("--candidate", required=True, help="Path to the candidate (proposed) SKILL.md")
    parser.add_argument("--current", required=True, help="Path to the current (in-force) SKILL.md")
    parser.add_argument("--territory", action="append", default=[], help="Source territory glob (repeatable, comma-separated)")
    parser.add_argument("--refs", default="", help="base=<sha>,head=<sha> — refs the diff/verdict are anchored to")
    parser.add_argument("--output-format", choices=["json", "markdown"], default="json")
    parser.add_argument("--service-id", default="", help="Service id (defaults to the candidate directory name)")
    parser.add_argument("--source-root", default="", help="Base dir for territory globs (defaults to candidate dir)")
    parser.add_argument("--no-telemetry", action="store_true", help="Suppress the stderr telemetry line")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    candidate = Path(args.candidate)
    current = Path(args.current)
    candidate_text = candidate.read_text(encoding="utf-8")
    current_text = current.read_text(encoding="utf-8")

    globs = _split_globs(args.territory) or ["source/**"]
    source_root = Path(args.source_root) if args.source_root else None
    corpus = _load_corpus(globs, source_root, candidate, current)
    service_id = args.service_id or candidate.resolve().parent.name

    manifest = verify_candidate(
        candidate_text,
        current_text,
        service_id=service_id,
        corpus=corpus,
        verified_at_ref=_parse_refs(args.refs),
        emit_telemetry=not args.no_telemetry,
    )

    output = render_markdown(manifest) if args.output_format == "markdown" else render_json(manifest)
    print(output)
    return 0  # advisory mode: verdict lives in the manifest, never in the exit code


if __name__ == "__main__":
    raise SystemExit(main())
