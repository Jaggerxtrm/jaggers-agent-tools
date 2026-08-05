---
name: capacity-reclaim
description: >-
  Capacity forecasting, safe reclaim, and post-reclaim verification for a host
  that is running out of a resource — disk, tmpfs, swap, inodes. Use when a
  volume crosses a fill threshold, when swap free reaches zero, when a capacity
  alert fires or fails to fire while the resource is visibly exhausted, when an
  operator asks "what can I delete", or before any bulk delete / prune /
  container recreate on a production host. Sizes the reclaim against the device
  that actually backs each path, names the producer behind every finding, and
  proves the reclaim held. Not incident triage (`/sre-triage`), not deploy
  verification (`/deploy-monitor`), and never the merge decision.
allowed-tools: Bash(df *), Bash(du *), Bash(docker *), Bash(findmnt *), Bash(stat *), Bash(free *), Bash(swapon *), Bash(ls *), Bash(python3 *), Read
---

# Capacity Reclaim ( /capacity-reclaim )

You are the **CAPACITY OWNER**. Answer three questions in order: *is this host about
to run out of a resource*, *what can I reclaim safely*, and *did the reclaim hold*.

This skill is the third materialization of the `devops-sre` / monitor role, after
`sre-triage` (is anything broken right now) and `deploy-monitor` (is the thing we
just shipped running and healthy). Neither sibling covers exhaustion, and on
2026-08-04 that gap produced a P0: `/dev/vda4` reached 100% used with both database
volumes on it, then the same host reached 0 free swap, twice, unannounced.

Root failure this skill exists for: **a reclaim that reports a number it did not
free.** Every rule below traces to one verified observation from that incident. Three
of them were wrong when first written and were corrected by being acted on — the
corrections are carried in full, not silently fixed, because the failure modes are
the most valuable part of the set.

> **Before starting, run `docker --help`, `docker system df --help`, `df --help`,
> `findmnt --help`, and the config-check binary of whatever service you are about to
> touch (`promtool --help`, `amtool --help`, …).** This skill carries doctrine and
> refuse-conditions; the CLIs are authoritative for exact command and flag surface.
> Do not reproduce a command table here — it goes stale and the siblings say so too.

## Trigger

A volume crosses a fill threshold; swap free reaches zero; an operator asks what can
be deleted; a capacity alert fires — **or visibly fails to fire while the resource is
exhausted**; or any bulk delete, `docker prune`, worktree sweep, or container recreate
is proposed on a production host.

## Authority boundary

- **Own**: capacity forecasting, reclaim safety predicates, producer attribution,
  post-reclaim verification, and the readability preflight before any service whose
  config is bind-mounted is reloaded or recreated.
- **Do not own**: incident triage (`/sre-triage`), deploy verification
  (`/deploy-monitor`), the merge decision, or any irreversible delete the operator has
  not authorised. Escalate; do not decide.

## Load order and fallbacks

1. `/multiplexing-team` — team-member identity, message and bead-reporting protocol.
2. `/sre-triage` when available — live Prometheus/Grafana probes and service routing.
3. Fallback to direct `df` / `docker system df -v` / `findmnt` on the host, and record
   the fallback in the bead notes. Do not block on skill-registry plumbing.

## Execution flow

### Phase A — Forecast, before touching anything

1. Enumerate devices, not paths: `findmnt` / `df -h`, and resolve every candidate
   reclaim target to its backing device (rule 4).
2. Read the fill trend, not the instantaneous value. If a capacity alert should have
   fired and did not, inspect its `for:` clause before trusting it (rule 2).
3. Record the starting figure per device. Without it, the post-reclaim number is not
   verifiable.

### Phase B — Plan the reclaim

4. Size docker against `docker system df -v`, never `docker images` (rule 5).
5. Classify each target: dead, live, or live-with-regenerable-artifacts (rules 6, 7).
6. Apply the live-session safety predicate to every live-capable target before it
   enters the plan (rule 6).
7. Name the producer of every candidate. A target with no named producer is a finding,
   not a plan item (rule 3).
8. Detect root-owned trees and separate the blocked byte count from the reclaimable
   one (rule 1).

### Phase C — Execute, in an order that cannot self-inflict

9. If the change touches a bind-mounted config: **normalise permissions → run the
   config check inside the container as the container user against the live mount →
   only then reload or recreate** (rules 8, 11). Never in another order.
10. Reclaim from the bottom of the risk ladder upward: regenerable artifacts, then
    unattached docker objects, then dead targets. Live targets are last and need
    explicit authorisation.

### Phase D — Verify the reclaim held

11. Re-measure per device, against the Phase A starting figure.
12. Report `freed X on device D, producer P, refill rate R` — never a bare "freed X"
    (rule 3).
13. Confirm the consumer is actually running the artifact you changed, and distinguish
    "unreadable now" from "not running now" (correction 3). A long-lived process holds
    what it already parsed; the damage lands on the next reload.

## Non-negotiable rules

1. **Root-owned artifacts block unprivileged reclaim — report them, never absorb
   them.** Containerised builds leave root-owned trees; this blocked reclaim three
   separate times in one day. Report the exact paths and the blocked byte count and
   escalate. Never silently under-deliver a reclaim total.
2. **`for:` clauses are unsound on a host that stalls.** A `DiskUsageHigh` alert sat
   above threshold for 24h and never matured, because every host stall took all 38
   scrape targets to `up == 0` and reset its pending clock — the alert that would
   catch the stall's cause is reset by the stall. Capacity alerts need stall-immune
   shapes: `max_over_time`, longer windows, absent-tolerant forms.
3. **Reclaim without a source fix is theatre.** 57 GB of disk and 1.43 GB of swap were
   reclaimed and consumed again within hours. Every finding names its producer and
   either fixes it or files it. Report `freed X, producer Y, refill rate Z`.
4. **Measure the device, not the path.** A `/tmp` purge was logged as 0.24 GB of disk
   reclaim; `/tmp` is tmpfs, so it returned RAM. Resolve every target to its backing
   device before attributing a number to it.
5. **`docker` reports three totals and two of them mislead.** `docker images` summed
   120 GB by double-counting shared layers; `docker system df` said 76 GB actual; its
   *reclaimable* figure means only "not attached to a running container". Plan against
   `docker system df -v`. Never treat "reclaimable" as "safe to delete".
6. **Apply the live-session safety predicate before deleting any target that could be
   in use.** Validated against 317 worktrees with zero false positives: not the current
   worktree; no process with cwd inside it (`/proc/*/cwd`); no source file with mtime
   under N days *after excluding agent scaffolding* (`AGENTS.md`, `CLAUDE.md`,
   `.beads`, `.xtrm`, `.specialists`, `.claude`, `.pi`); clean after those exclusions;
   no unpushed commits. The predicate is reusable for any reclaim target, not only
   worktrees.
7. **Reclaim in tiers — a live target still yields its regenerable artifacts.**
   Artifact-only reclaim recovered ~24 GB without deleting a single worktree. "The
   target is live" bounds what you delete, it does not end the reclaim.
8. **Never signal a reload you have not first validated from inside the consumer, as
   the consumer's user, against the real mount.** Two Prometheus rule files were mode
   0600 while eleven siblings were 0664; both containers run as `nobody` (65534). A
   blind SIGHUP would have been rejected and Prometheus would have silently continued
   serving the OLD config — while green CI, a merged PR, and a clean `promtool` run in
   the worktree all said otherwise.
9. **All bind-mounted config enforces host modes, single-file and directory alike.
   Probe readability only with a binary that exists in the target image, and treat
   "command not found" as an INVALID TEST — never as a pass.** A probe that cannot
   fail correctly is worse than no probe: it manufactures false confidence and gets
   acted on. See *Correction 2* for the retracted original.
10. **umask is an invisible deploy fault and git cannot see it.** The operator shell
    ran `umask 077`, so `git checkout` and `git pull` wrote files 0600. Git tracks
    only the executable bit, never read permissions, so the tightening is invisible in
    the diff, survives code review, recurs on every pull, and is undetectable from the
    repository alone. For any bind-mounted config consumed by a non-root container,
    assert readability **at runtime** — a loud startup or liveness check — because
    neither CI nor review can catch this class.
11. **Ordering is part of the fix.** Never recreate a service whose config is
    bind-mounted without, in this order: normalise permissions, run the config check
    inside the container as the container user, then recreate. All three tools existed
    and were run in the wrong order, which took Prometheus down for ~85 seconds. A
    permission normaliser must also cover the whole fault: the one that shipped
    (`make alert-perms`) covered `prometheus/alerts/*.yml` only and silently did not
    cover `prometheus.yml`, `web.yml` or `alertmanager.yml` — a remediation narrower
    in scope than the fault it remediates.
12. **A repaired class recurs until the producer stops.** The `git pull` that deployed
    the very PR fixing the umask fault landed that PR's own new file at 0600.
    Detection shipped; the producer did not. Any guard that detects without disarming
    the producer converts a silent failure into a recurring loud one — better, not
    solved. This is rule 3 generalised beyond reclaim.

**Supporting rule — validate the artifact the loader actually reads.**
`amtool check-config` reported `FAILED: unsupported scheme "" for URL` on
`alertmanager.yml`. Not a fault: alertmanager renders that template with environment
substitution to `/tmp/alertmanager-rendered.yml` and loads *that*. Identify what the
process actually loads — its own log line names the file — and validate that file, not
the one you assume it reads.

**Theme.** Rules 1–7 are about reclaim being blocked or undone. Rules 8–12 are about
changes that report success while changing nothing. Both collapse to one principle
neither sibling states: **verify at the consumer, in its identity, against the artifact
it actually loads.**

## Corrections carried — three findings that were wrong

These are kept as corrections, not as silently-fixed text. Each was believed, acted
on, and refuted by the consequence.

**Correction 1 — RAM reported as disk.** A `/tmp` purge was logged as 0.24 GB of disk
reclaim. `/tmp` on that host is a tmpfs backed by RAM, so the purge returned memory and
freed no disk at all, while the reclaim total implied otherwise. The corrected rule is
rule 4: resolve the device first, attribute the number second.

**Correction 2 — a probe that could not fail correctly.** Rule 9 was originally written
as *"directory binds enforce host modes; single-file binds do not"*, and it was
retracted. It came from an invalid probe: readability was tested with `docker exec …
sh -c` and `head`, **neither of which exists in the prometheus image**. Every probe
failed with `executable file not found`, while the script matched only on `permission
denied` — so all four files printed READABLE. Acting on that result, the operator
declined to widen `prometheus.yml`, then recreated the container and took Prometheus
down for ~85 seconds on `open /etc/prometheus/prometheus.yml: permission denied`. The
replacement is rule 9 above. The general lesson outlives the specific bug: a probe
whose failure mode is indistinguishable from its pass mode manufactures confidence and
gets acted on.

**Correction 3 — latent loss reported as actual loss.** The claim was that the
`forensic-mmd` alert rules "had not loaded for two days". Wrong. Prometheus loaded them
at container start on 2026-07-29 and there was **no reload** until the operator's own
at 2026-08-04 16:03, so the rules stayed in memory and kept evaluating throughout. The
file being unreadable meant the *next* reload would drop them. Distinguish **unreadable
now** from **not running now**: a long-lived process holds what it already parsed, and
the damage lands on the next reload — which may be days later and attributed to
whatever change happened to trigger it. The failure is time-shifted, so the operator
who triggers it is not the one who caused it.

## Open question — unresolved, do not paper over

Before the container recreate, `promtool` running as `nobody` parsed a mode-0600
`prometheus.yml` successfully. After the recreate, the same file at the same mode was
unreadable and Prometheus crash-looped. **No verified explanation exists.** Do not
assume a mechanism. When this shape appears, treat pre-recreate readability as
*unproven* for the post-recreate process and re-run the check after the recreate.

## Validated positively

The runtime readability healthcheck flipped the container `unhealthy` exactly as
designed, and `PrometheusContainerUnhealthy` would have paged. Self-inflicted, but a
genuine end-to-end test of the guard class in rule 10.

## Failure / escalation trigger

Escalate to the orchestrator — do not proceed and do not silently reduce the number —
when: root-owned trees block a material share of the planned reclaim (rule 1); a
candidate fails the live-session safety predicate but is needed to hit the target
(rule 6); a producer cannot be identified (rule 3); a config-check binary does not
exist in the target image, making the readability probe invalid (rule 9); or a reclaim
would require deleting something the operator has not explicitly authorised.

Report shape: one-line pointer upward, durable detail in the bead.

```bash
bd update <bead> --notes "RECLAIM: freed <X> on <device>; producer <P>; refill <R>; blocked <B> by root-owned <paths>"
xtmux message-send --to <orchestrator> --bead <bead> --expects-reply=false --json \
  --text "reclaim done: freed <X> on <device>; producer filed as <bead>"
```

## When NOT to use this skill

- "Something is broken right now" with no resource-exhaustion signal → `/sre-triage`.
- "Is the thing we just merged running and healthy" → `/deploy-monitor`.
- Merging, reverting, or authorising an irreversible delete → orchestrator authority.
- A reclaim total reported without its device, producer, and refill rate — that is the
  failure this skill exists to prevent, not an acceptable shortcut.

## Related skills

- `/sre-triage` — live health probes, alert enumeration, service routing.
- `/deploy-monitor` — post-merge artifact and health verification.
- `/multiplexing-team` — reporting protocol for a delegated pane.
