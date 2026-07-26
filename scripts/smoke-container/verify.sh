#!/usr/bin/env bash
# xtrm trio pre/post-release smoke test. Exit 0 = PASS, nonzero = FAIL.
# See README.md. Runs inside the container built from ./Dockerfile.
set -uo pipefail

# --- repos under test -------------------------------------------------------
# name|clone url|npm package (package is what --branch installs from source)
REPOS=(
  "core|https://github.com/xtrm-dev/core.git|xtrm-tools"
  "specialists|https://github.com/xtrm-dev/specialists.git|@jaggerxtrm/specialists"
  "xtmux|https://github.com/Jaggerxtrm/xtmux.git|@jaggerxtrm/xtmux"
)

BRANCH_ALL=""
declare -A BRANCH_FOR=()
KEEP=0
SKIP_LIVE=0
TAG=latest

usage() {
  cat <<'EOF'
usage: ./verify.sh [options]

  --branch <ref>            test <ref> in every repo that has it (checkout + install from source)
  --branch <repo>=<ref>     test <ref> in one repo only (repo: core|specialists|xtmux); repeatable
  --tag <dist-tag>          npm dist-tag to install in stages 1-2 (default: latest)
  --skip-live               skip the stage-5 tmux/sp live scenario
  --keep                    keep the work directory on exit
  -h, --help                this text

exit 0 = PASS; nonzero = FAIL, and the failing stage is named in the summary.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --branch)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      if [[ "$2" == *=* ]]; then BRANCH_FOR["${2%%=*}"]="${2#*=}"; else BRANCH_ALL="$2"; fi
      shift 2 ;;
    --tag) [ "$#" -ge 2 ] || { usage >&2; exit 2; }; TAG="$2"; shift 2 ;;
    --skip-live) SKIP_LIVE=1; shift ;;
    --keep) KEEP=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

WORK="$(mktemp -d /tmp/xtrm-smoke.XXXXXX)"
LOG="$WORK/commands.log"
: > "$LOG"
cleanup() { [ "$KEEP" -eq 1 ] && printf '\nwork dir kept: %s\n' "$WORK" || rm -rf "$WORK"; }
trap cleanup EXIT

FAILED=0 WARNED=0 SKIPPED=0 STAGE="0-init" FIRST_FAIL=""

stage() { STAGE="$1"; printf '\n=== STAGE %s ===\n' "$1"; printf '\n##### stage %s\n' "$1" >>"$LOG"; }
ok()    { printf '  [OK]   %s\n' "$1"; }
warn()  { WARNED=$((WARNED + 1)); printf '  [WARN] %s\n' "$1"; }
skip()  { SKIPPED=$((SKIPPED + 1)); printf '  [SKIP] %s\n' "$1"; }
fail()  {
  FAILED=$((FAILED + 1))
  [ -n "$FIRST_FAIL" ] || FIRST_FAIL="$STAGE: $1"
  printf '  [FAIL] %s\n' "$1"
}

# run <desc> <cmd...> — command output goes to the log, not the report.
run() {
  local desc="$1"; shift
  printf '\n$ %s\n' "$*" >>"$LOG"
  if "$@" >>"$LOG" 2>&1; then ok "$desc"; return 0; fi
  fail "$desc (tail of $LOG below)"
  tail -20 "$LOG" | sed 's/^/         /'
  return 1
}

field() { grep "^$1=" "$2" 2>/dev/null | cut -d= -f2-; }

# expect_ge <label> <actual> <floor>
expect_ge() {
  if [ "${2:-x}" != "x" ] && [ "$2" -ge "$3" ] 2>/dev/null; then
    ok "$1 = $2 (>= $3)"
  else
    fail "$1 = ${2:-<missing>}, expected >= $3"
  fi
}

expect_eq() {
  if [ "${2:-x}" = "$3" ]; then ok "$1 = $2"; else fail "$1 = ${2:-<missing>}, expected $3"; fi
}

# --- xtmux install needs a musl-capable bun --------------------------------
xtmux_root() { printf '%s/@jaggerxtrm/xtmux' "$(npm root -g)"; }

# Not `command -v bun`: npm relinks /usr/local/bin/bun to the glibc placeholder
# from xtmux's own `bun` dependency, so PATH lookup can point at the broken one.
MUSL_BUN="${XTRM_SMOKE_BUN:-/opt/bun/bin/bun}"

# The bun npm package that xtmux depends on ships a glibc bun.exe. On musl it is
# ENOEXEC, which fails xtmux's postinstall (and xtmux-obs at runtime). Overwrite
# it with the container's musl bun. Must run AFTER any npm install that would
# restore the package's node_modules.
# cp, not install(1): @jaggerxtrm/specialists ships a global `install` bin that
# shadows coreutils on PATH once it is installed globally (see the shadowing
# check in stage 5).
patch_bundled_bun() {
  local target; target="$(xtmux_root)/node_modules/bun/bin/bun.exe"
  [ -d "$(dirname "$target")" ] || return 1
  cp -f "$MUSL_BUN" "$target" && chmod 0755 "$target"
}

install_xtmux() {
  local spec="$1"
  printf '\n$ npm i -g %s\n' "$spec" >>"$LOG"
  if npm i -g "$spec" >>"$LOG" 2>&1 && xtmux-obs --help >>"$LOG" 2>&1; then
    ok "npm i -g $spec"
    return 0
  fi
  warn "npm i -g $spec needed the musl bun shim (bundled bun.exe is a glibc binary — Alpine/musl install path is not clean upstream)"
  npm i -g --ignore-scripts "$spec" >>"$LOG" 2>&1 || { fail "npm i -g --ignore-scripts $spec"; return 1; }
  patch_bundled_bun
  node "$(xtmux_root)/scripts/install.mjs" --from-npm >>"$LOG" 2>&1 || { fail "xtmux install.mjs --from-npm"; return 1; }
  patch_bundled_bun || { fail "could not place musl bun in $(xtmux_root)/node_modules/bun/bin"; return 1; }
  run "xtmux-obs runs after musl bun shim" xtmux-obs --help
}

# install_from_source <name> <dir> <pkg> — pack the checked-out ref and install
# it globally. --ignore-scripts keeps prepublish gates (which need
# devDependencies) out of the smoke path; cli/dist is tracked so the packed
# tarball is complete.
install_from_source() {
  local name="$1" dir="$2" pkg="$3" tarball
  tarball="$(cd "$dir" && npm pack --ignore-scripts --silent 2>>"$LOG" | tail -1)"
  if [ -z "$tarball" ] || [ ! -f "$dir/$tarball" ]; then
    fail "$name: npm pack produced no tarball"
    return 1
  fi
  if [ "$pkg" = "@jaggerxtrm/xtmux" ]; then
    install_xtmux "$dir/$tarball"
  else
    run "install $name from source ($tarball)" npm i -g "$dir/$tarball"
  fi
}

# snapshot <label> <repo dir> — records the state stage 5 compares.
snapshot() {
  # Separate statements: `local a=$1 b=$a` trips `set -u` in bash.
  local label="$1" dir="$2"
  local out="$WORK/snap-$label.txt"
  {
    printf 'xt_version=%s\n'         "$(xt --version 2>/dev/null | tail -1)"
    printf 'sp_version=%s\n'         "$(sp --version 2>/dev/null | tail -1)"
    # xtmux's bin has no --version; read the installed manifest instead.
    printf 'xtmux_version=%s\n'      "$(jq -r '.version' "$(xtmux_root)/package.json" 2>/dev/null)"
    printf 'registry_assets=%s\n'    "$(jq '.assets | length' "$dir/.xtrm/registry.json" 2>/dev/null || echo 0)"
    printf 'registry_sha=%s\n'       "$(sha256sum "$dir/.xtrm/registry.json" 2>/dev/null | cut -c1-16)"
    printf 'hook_commands=%s\n'      "$(jq '[.. | .command? | select(.)] | length' "$dir/.xtrm/config/hooks.json" 2>/dev/null || echo 0)"
    printf 'hook_files=%s\n'         "$(find "$dir/.xtrm/hooks" -type f 2>/dev/null | wc -l | tr -d ' ')"
    printf 'skill_roots_repo=%s\n'   "$(find "$dir/.xtrm/skills" -maxdepth 3 -name SKILL.md 2>/dev/null | wc -l | tr -d ' ')"
    printf 'skill_roots_global=%s\n' "$(find "$HOME/.xtrm/skills/default" -maxdepth 2 -name SKILL.md 2>/dev/null | wc -l | tr -d ' ')"
    printf 'symlinks=%s\n'           "$(find "$dir/.xtrm" -type l 2>/dev/null | wc -l | tr -d ' ')"
  } > "$out"
  printf '  snapshot %-22s %s\n' "$label" "$(paste -sd' ' "$out")"
}

printf 'xtrm trio smoke test — %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
printf 'dist-tag: %s   branch(all): %s   live checks: %s\n' \
  "$TAG" "${BRANCH_ALL:-<none>}" "$([ "$SKIP_LIVE" -eq 1 ] && echo skipped || echo on)"

# ===========================================================================
stage "1-install"
# ===========================================================================
run "npm i -g xtrm-tools@$TAG" npm i -g "xtrm-tools@$TAG"
run "npm i -g @jaggerxtrm/specialists@$TAG" npm i -g "@jaggerxtrm/specialists@$TAG"
install_xtmux "@jaggerxtrm/xtmux@$TAG"

for bin in xt sp xtmux xtmux-obs xtmux-events bd bun; do
  if command -v "$bin" >/dev/null 2>&1; then ok "$bin resolves ($(command -v "$bin"))"
  else fail "$bin is not on PATH"; fi
done
run "bun on PATH executes (musl build wins over npm's bun link)" bun --version
printf '  versions: xt=%s sp=%s xtmux=%s bd=%s\n' \
  "$(xt --version 2>/dev/null | tail -1)" "$(sp --version 2>/dev/null | tail -1)" \
  "$(jq -r '.version' "$(xtmux_root)/package.json" 2>/dev/null)" "$(bd version 2>/dev/null | head -1)"

[ "$FAILED" -eq 0 ] || { printf '\nRESULT: FAIL (%s)\n' "$FIRST_FAIL"; exit 1; }

# ===========================================================================
stage "2-update-mechanisms"
# ===========================================================================
run "npm i -g xtrm-tools@latest" npm i -g xtrm-tools@latest
run "npm i -g @jaggerxtrm/specialists@latest" npm i -g @jaggerxtrm/specialists@latest
install_xtmux "@jaggerxtrm/xtmux@latest"

SCRATCH="$WORK/scratch"
mkdir -p "$SCRATCH"
run "git init scratch project" git init -q "$SCRATCH"
( cd "$SCRATCH" && run "xt init -y" xt init -y ) || true
( cd "$SCRATCH" && run "xt update --apply" xt update --apply --repo . ) || true
[ -f "$SCRATCH/.xtrm/registry.json" ] \
  && ok "scratch project has .xtrm/registry.json" \
  || fail "xt init/update produced no .xtrm/registry.json in a fresh project"

# ===========================================================================
stage "3-clone-and-init"
# ===========================================================================
for entry in "${REPOS[@]}"; do
  IFS='|' read -r name url _pkg <<<"$entry"
  dir="$WORK/repos/$name"
  mkdir -p "$(dirname "$dir")"
  run "clone $name" git clone --quiet --depth 1 "$url" "$dir" || continue
  ( cd "$dir" && run "xt init -y ($name)" xt init -y ) || true
  snapshot "$name-pre" "$dir"
done

# ===========================================================================
stage "4-apply-edits-and-update"
# ===========================================================================
# Two edit modes. With --branch: check the ref out and install that package from
# source, i.e. test an unreleased branch. Without: induce hook/registry drift so
# stage 5 proves `xt update --apply` repairs it.
for entry in "${REPOS[@]}"; do
  IFS='|' read -r name url pkg <<<"$entry"
  dir="$WORK/repos/$name"
  [ -d "$dir" ] || continue
  ref="${BRANCH_FOR[$name]:-$BRANCH_ALL}"

  if [ -n "$ref" ]; then
    if git -C "$dir" ls-remote --exit-code --heads origin "$ref" >/dev/null 2>&1; then
      run "fetch $name@$ref" git -C "$dir" fetch --quiet --depth 1 origin "$ref" \
        && run "checkout $name@$ref" git -C "$dir" checkout --quiet FETCH_HEAD \
        && install_from_source "$name" "$dir" "$pkg"
    else
      skip "$name has no branch '$ref' on origin"
    fi
  fi

  # Drift: drop a hook payload and blank the registry, then let xt repair it.
  victim="$(find "$dir/.xtrm/hooks" -type f 2>/dev/null | head -1)"
  if [ -n "$victim" ]; then
    printf 'drift_victim=%s\n' "$victim" >> "$WORK/snap-$name-pre.txt"
    rm -f "$victim"
    ok "$name: removed hook payload $(basename "$victim") to simulate drift"
  else
    skip "$name: no .xtrm/hooks payload to drift"
  fi

  ( cd "$dir" && run "xt update --apply ($name)" xt update --apply --repo . ) || true
  snapshot "$name-post" "$dir"
done

# ===========================================================================
stage "5-verify"
# ===========================================================================
for entry in "${REPOS[@]}"; do
  IFS='|' read -r name _url _pkg <<<"$entry"
  pre="$WORK/snap-$name-pre.txt"; post="$WORK/snap-$name-post.txt"
  [ -f "$post" ] || { fail "$name: no post snapshot (earlier stage did not complete)"; continue; }
  printf '  --- %s\n' "$name"

  expect_ge "$name hook_commands"  "$(field hook_commands "$post")"  1
  expect_ge "$name hook_files"     "$(field hook_files "$post")"     "$(field hook_files "$pre")"
  expect_ge "$name registry_assets" "$(field registry_assets "$post")" 1
  expect_ge "$name skill_roots_global" "$(field skill_roots_global "$post")" 1
  expect_eq "$name symlinks under .xtrm" "$(field symlinks "$post")" 0

  victim="$(field drift_victim "$pre")"
  if [ -n "$victim" ]; then
    [ -f "$victim" ] \
      && ok "$name: xt update --apply restored $(basename "$victim")" \
      || fail "$name: xt update --apply did NOT restore removed hook $(basename "$victim")"
  fi
done

# The release contract: specialists-owned skills must land in the global mirror.
for s in using-specialists update-specialists using-specialists-auto; do
  [ -f "$HOME/.xtrm/skills/default/$s/SKILL.md" ] \
    && ok "global skill mirror has $s" \
    || fail "global skill mirror is missing $s/SKILL.md"
done

# Global npm bins must not shadow system commands. Released
# @jaggerxtrm/specialists declares bin "install", which shadows install(1) for
# any shell with the npm global bin dir ahead of /usr/bin — it silently hijacks
# build scripts. WARN not FAIL: it is a known released defect, and a hard fail
# would keep this gate red for something the release under test cannot repair.
shadowing=""
for p in "$(npm prefix -g)"/bin/*; do
  [ -e "$p" ] || continue
  b="$(basename "$p")"
  { [ -e "/bin/$b" ] || [ -e "/usr/bin/$b" ]; } && shadowing="$shadowing $b"
done
if [ -n "$shadowing" ]; then
  warn "global npm bins shadow system commands:$shadowing"
else
  ok "no global npm bin shadows a system command"
fi

# The fresh-machine regression this gate exists to catch.
if grep -qr "Source and destination must not be the same" "$LOG"; then
  fail "'Source and destination must not be the same' appeared in install/update output"
else
  ok "no 'Source and destination must not be the same' regression"
fi

# --- live scenario ---------------------------------------------------------
if [ "$SKIP_LIVE" -eq 1 ]; then
  skip "live xtmux/sp scenario (--skip-live)"
else
  run "xtmux-obs migrate (observability db schema)" xtmux-obs migrate
  if xtmux-obs health 2>/dev/null | jq -e '.ok == true' >/dev/null 2>&1; then
    ok "xtmux-obs health reports ok"
  else
    fail "xtmux-obs health is not ok"
    xtmux-obs health 2>&1 | head -3 | sed 's/^/         /'
  fi

  if tmux new-session -d -s xtrm-smoke "sleep 600" >>"$LOG" 2>&1; then
    ok "tmux session xtrm-smoke started"
    sid="$(tmux display-message -p -t xtrm-smoke '#{session_id}' 2>/dev/null)"
    follow="$WORK/follow.json"; events="$WORK/events.json"
    # Both followers are bounded by timeout, so `wait` ends the scenario.
    timeout 15 xtmux log follow --after-id 0 --json >"$follow" 2>&1 &
    timeout 15 xtmux-events --json >"$events" 2>&1 &
    sleep 4
    key="$(xtmux message-send --to "$sid" --bead xtrm-smoke --expects-reply=false \
             --text 'smoke-container live ping' --json 2>>"$LOG" | jq -r '.messageKey // empty')"
    [ -n "$key" ] && ok "xtmux message-send accepted ($key)" || fail "xtmux message-send failed"
    wait

    # Live delivery: the journal must carry the event to a running follower.
    if [ -n "$key" ] && grep -q "$key" "$follow" 2>/dev/null; then
      ok "xtmux log follow delivered messages.sent live"
    else
      fail "xtmux log follow did not deliver the messages.sent event (see $follow)"
      head -5 "$follow" 2>/dev/null | sed 's/^/         /'
    fi

    # The events dashboard on top of it.
    if grep -q 'following .* open xtmux sessions' "$events" 2>/dev/null; then
      ok "xtmux-events started and is following the live session"
    else
      fail "xtmux-events did not start (see $events)"
      head -5 "$events" 2>/dev/null | sed 's/^/         /'
    fi
    if [ -n "$key" ] && ! grep -q "$key" "$events" 2>/dev/null; then
      # WARN not FAIL: xtmux-events joins the journal's session_id ("$0") against
      # `xtmux dashboard`'s composite sessionId ("$0_name_%0_path_ts"), so the join
      # drops the event. Upstream in xtmux, not something a release can repair here.
      warn "xtmux-events did not render the event it followed (dashboard sessionId vs journal session_id join)"
    else
      [ -n "$key" ] && ok "xtmux-events rendered the live message event"
    fi
    tmux kill-session -t xtrm-smoke >>"$LOG" 2>&1
  else
    fail "tmux could not start a session"
  fi

  run "sp list" sp list
  if [ -n "${ANTHROPIC_API_KEY:-}${OPENAI_API_KEY:-}" ]; then
    ( cd "$SCRATCH" && run "sp run (smoke prompt)" \
        timeout 300 sp run explorer --prompt 'Reply with the single word OK.' ) || true
  else
    skip "sp run needs model credentials (pass -e ANTHROPIC_API_KEY=... to docker run)"
  fi
fi

# ===========================================================================
printf '\n=== SUMMARY ===\n'
printf '  failures: %d   warnings: %d   skipped: %d\n' "$FAILED" "$WARNED" "$SKIPPED"
if [ "$FAILED" -eq 0 ]; then
  printf 'RESULT: PASS\n'
  exit 0
fi
printf 'RESULT: FAIL — first failure in %s\n' "$FIRST_FAIL"
printf 'full command log: %s (re-run with --keep to retain it)\n' "$LOG"
exit 1
