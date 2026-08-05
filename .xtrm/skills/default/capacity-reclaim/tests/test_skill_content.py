"""
TDD tests for capacity-reclaim SKILL.md correctness.

Each test binds a non-negotiable rule or carried correction to a verified
observation from the 2026-08-04 incident recorded in beads issue xtrm-gvek4.
A test failing means the skill lost a mechanism that was paid for in production.

Run with:
  pytest .xtrm/skills/default/capacity-reclaim/tests/ -v
"""

import re
from pathlib import Path

SKILL_DIR = Path(__file__).parent.parent
SKILL_PATH = SKILL_DIR / "SKILL.md"


def _content() -> str:
    return SKILL_PATH.read_text()


def _frontmatter(content: str) -> str:
    """Extract YAML frontmatter between the first two --- markers."""
    if not content.startswith("---"):
        return ""
    end = content.index("---", 3)
    return content[3:end]


def _section(content: str, heading: str) -> str:
    """Extract content from a heading until the next same-or-higher-level heading."""
    idx = content.find(heading)
    if idx == -1:
        return ""
    after = content[idx:]
    next_heading = re.search(r"\n###? ", after[len(heading) :])
    if next_heading:
        return after[: len(heading) + next_heading.start()]
    return after


# ---------------------------------------------------------------------------
# Frontmatter contract — parses, name matches directory, tools cover the flow
# ---------------------------------------------------------------------------


def test_frontmatter_name_matches_directory():
    """name: must equal the skill directory name, or the loader will not resolve it."""
    fm = _frontmatter(_content())
    match = re.search(r"^name:\s*(\S+)\s*$", fm, re.MULTILINE)
    assert match, "name field not found in frontmatter"
    assert match.group(1) == SKILL_DIR.name, (
        f"frontmatter name {match.group(1)!r} must match directory {SKILL_DIR.name!r}"
    )


def test_frontmatter_parses_as_yaml():
    """Frontmatter must be valid YAML with the keys the skill loader reads."""
    yaml = __import__("yaml")
    data = yaml.safe_load(_frontmatter(_content()))
    assert isinstance(data, dict), "frontmatter must parse to a mapping"
    for key in ("name", "description"):
        assert key in data, f"frontmatter missing required key: {key}"
    assert "scripts:" not in _frontmatter(_content()), (
        "scripts: is not a recognized Claude skill frontmatter key"
    )


def test_allowed_tools_cover_the_measurement_commands():
    """Rules 4 and 5 need df/findmnt and docker; the frontmatter must permit them."""
    fm = _frontmatter(_content())
    for tool in ("Bash(docker", "Bash(df", "Bash(findmnt"):
        assert tool in fm, f"allowed-tools must include {tool} *) — required by rules 4/5"


def test_description_triggers_on_exhaustion_not_generic_health():
    """Description must trigger on resource exhaustion, else it collides with sre-triage."""
    fm = _frontmatter(_content()).lower()
    assert any(kw in fm for kw in ("run out of", "exhaust", "fill threshold")), (
        "description must trigger on resource exhaustion"
    )
    assert "swap" in fm and "disk" in fm, "description must name the resources covered"


# ---------------------------------------------------------------------------
# Authority boundary — the skill must disown its siblings' scope
# ---------------------------------------------------------------------------


def test_authority_boundary_disowns_siblings_and_merge():
    """Contract: owns forecast/reclaim/verification; does not own triage, deploy, merge."""
    section = _section(_content(), "## Authority boundary")
    assert section, "Authority boundary section missing"
    low = section.lower()
    for disowned in ("sre-triage", "deploy-monitor", "merge"):
        assert disowned in low, f"Authority boundary must disown {disowned}"


# ---------------------------------------------------------------------------
# Rule 1 — root-owned artifacts block unprivileged reclaim
# ---------------------------------------------------------------------------


def test_rule_root_owned_reports_blocked_bytes():
    content = _content().lower()
    assert "root-owned" in content, "rule 1 (root-owned trees block reclaim) missing"
    assert "blocked byte count" in content, (
        "rule 1 must require reporting the blocked byte count, not a silently reduced total"
    )


# ---------------------------------------------------------------------------
# Rule 2 — `for:` clauses are unsound on a host that stalls
# ---------------------------------------------------------------------------


def test_rule_for_clause_is_stall_unsound():
    content = _content()
    assert "`for:`" in content, "rule 2 (for: clauses unsound under stall) missing"
    assert "max_over_time" in content, (
        "rule 2 must name a stall-immune alert shape (max_over_time)"
    )
    assert "up == 0" in content, "rule 2 must carry the scrape-target reset evidence"


# ---------------------------------------------------------------------------
# Rule 3 — reclaim without a source fix is theatre
# ---------------------------------------------------------------------------


def test_rule_reclaim_reports_producer_and_refill():
    content = _content().lower()
    assert "producer" in content, "rule 3 requires naming the producer of each finding"
    assert "refill rate" in content, (
        "rule 3 requires the freed X / producer Y / refill rate Z report shape"
    )


# ---------------------------------------------------------------------------
# Rule 4 — measure the device, not the path (Correction 1)
# ---------------------------------------------------------------------------


def test_rule_measure_device_not_path():
    content = _content()
    assert "backing device" in content.lower(), "rule 4 (resolve to backing device) missing"
    assert "tmpfs" in content, "rule 4 must carry the tmpfs evidence (/tmp returns RAM)"


# ---------------------------------------------------------------------------
# Rule 5 — docker's three totals, two of which mislead
# ---------------------------------------------------------------------------


def test_rule_docker_plan_against_system_df():
    content = _content()
    assert "docker system df -v" in content, "rule 5 must direct planning at system df -v"
    assert "double-count" in content.lower(), (
        "rule 5 must state that docker images double-counts shared layers"
    )
    assert "not attached to a running container" in content, (
        "rule 5 must define what docker's 'reclaimable' figure actually means"
    )


# ---------------------------------------------------------------------------
# Rule 6 — live-session safety predicate, all five conditions
# ---------------------------------------------------------------------------


def test_rule_live_session_predicate_is_complete():
    """All five validated conditions must survive; a partial predicate deletes live work."""
    content = _content()
    assert "/proc/*/cwd" in content, "predicate must include the cwd-in-target check"
    assert "unpushed commits" in content, "predicate must include the unpushed-commits check"
    assert "mtime" in content, "predicate must include the recent-mtime check"
    for scaffold in (".beads", ".xtrm", "CLAUDE.md"):
        assert scaffold in content, (
            f"predicate must exclude agent scaffolding {scaffold} from the mtime check"
        )


# ---------------------------------------------------------------------------
# Rule 7 — tiered reclaim
# ---------------------------------------------------------------------------


def test_rule_tiered_reclaim_of_regenerable_artifacts():
    content = _content().lower()
    assert "regenerable" in content, "rule 7 (artifact-only reclaim inside live targets) missing"


# ---------------------------------------------------------------------------
# Rule 8 — validate from inside the consumer, as its user, against the mount
# ---------------------------------------------------------------------------


def test_rule_validate_inside_consumer_before_reload():
    content = _content().lower()
    assert "as the consumer's user" in content or "as the container user" in content, (
        "rule 8 must require validating as the consumer's own user"
    )
    assert "live mount" in content or "real mount" in content, (
        "rule 8 must require validating against the real mount, not the worktree copy"
    )
    assert "nobody" in content, "rule 8 must carry the nobody/65534 evidence"


# ---------------------------------------------------------------------------
# Rule 9 — replacement only; the retracted claim must NOT be present as doctrine
# ---------------------------------------------------------------------------


def test_rule9_replacement_present_and_retraction_not_doctrine():
    content = _content()
    assert "single-file and directory alike" in content, (
        "rule 9 replacement missing: all bind-mounted config enforces host modes"
    )
    assert "INVALID TEST" in content, (
        "rule 9 must classify 'command not found' as an invalid test, never a pass"
    )
    # The retracted claim may only appear inside the Correction section, labelled.
    retracted = "directory binds enforce host modes; single-file binds do not"
    for occurrence in re.finditer(re.escape(retracted), content):
        before = content[: occurrence.start()]
        assert "## Corrections carried" in before, (
            "the retracted rule 9 may appear only inside Corrections carried, as a retraction"
        )


# ---------------------------------------------------------------------------
# Rule 10 — umask is invisible to git; assert readability at runtime
# ---------------------------------------------------------------------------


def test_rule_umask_invisible_to_git():
    content = _content()
    assert "umask 077" in content, "rule 10 must name the umask 077 root cause"
    assert "executable bit" in content, (
        "rule 10 must state that git tracks only the executable bit"
    )
    assert "at runtime" in content, (
        "rule 10 must require a runtime readability assertion, since CI cannot catch this"
    )


# ---------------------------------------------------------------------------
# Rule 11 — ordering, and a normaliser narrower than the fault
# ---------------------------------------------------------------------------


def test_rule_ordering_permissions_then_check_then_recreate():
    content = _content()
    order = re.search(
        r"normalise permissions.{0,200}?config check.{0,200}?recreate",
        content,
        re.DOTALL | re.IGNORECASE,
    )
    assert order, "rule 11 must state the order: normalise → check inside container → recreate"
    assert "alert-perms" in content, (
        "rule 11 must carry the narrower-than-the-fault normaliser evidence"
    )


# ---------------------------------------------------------------------------
# Rule 12 — a repaired class recurs until the producer stops
# ---------------------------------------------------------------------------


def test_rule_detection_without_disarming_producer():
    content = _content().lower()
    assert "producer did not" in content, (
        "rule 12 must carry the evidence that the fixing PR's own pull re-created the fault"
    )
    assert "recurring loud one" in content, (
        "rule 12 must state that detection alone converts silent failure into recurring failure"
    )


# ---------------------------------------------------------------------------
# Corrections must be carried as corrections, not silently fixed
# ---------------------------------------------------------------------------


def test_three_corrections_are_carried_explicitly():
    section = _section(_content(), "## Corrections carried")
    assert section, "Corrections carried section missing"
    assert "Correction 1" in section and "Correction 2" in section and "Correction 3" in section, (
        "all three refuted findings must be carried, labelled as corrections"
    )
    assert "85 second" in section or "~85 second" in section, (
        "Correction 2 must state the measured consequence: Prometheus down ~85 seconds"
    )
    assert "latent" in section.lower() and "next reload" in section.lower(), (
        "Correction 3 must distinguish latent from actual loss and name the next-reload trigger"
    )


def test_unresolved_question_states_no_verified_explanation():
    """The promtool discrepancy has no mechanism; the skill must not invent one."""
    section = _section(_content(), "## Open question")
    assert section, "Open question section missing"
    assert "promtool" in section, "the unresolved question must name the promtool discrepancy"
    assert "no verified explanation" in section.lower(), (
        "the unresolved question must state plainly that no verified explanation exists"
    )


# ---------------------------------------------------------------------------
# Shape — doctrine, not a lookup table; CLIs stay authoritative
# ---------------------------------------------------------------------------


def test_cli_is_declared_authoritative():
    content = _content()
    assert "authoritative" in content, (
        "the skill must defer command/flag surface to the CLIs, as both siblings do"
    )


def test_when_not_to_use_routes_to_both_siblings():
    section = _section(_content(), "## When NOT to use this skill")
    assert section, "When NOT to use section missing"
    assert "/sre-triage" in section and "/deploy-monitor" in section, (
        "When NOT to use must route to both sibling skills"
    )
