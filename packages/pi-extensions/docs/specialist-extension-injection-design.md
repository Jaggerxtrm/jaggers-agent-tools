# Manifest-configurable Pi extension injection for Specialists

Status: design only

Bead: `xtrm-xvcyj`

Date: 2026-08-28

## Decision

Add a small, trusted extension-descriptor registry shared by the Specialists runner, `PiAgentSession`, and direct script runner. A specialist selects known descriptors through `specialist.execution.extensions`; the runner resolves the selected set once and passes the same health/path plan to both spawn implementations. Each spawn adds only healthy paths as explicit `-e` arguments after `--no-extensions`.

Do not generate Pi settings, change `HOME`, publish packages, accept arbitrary repository-provided code paths, or change the Core `xt pi --role` launcher. The current Core launcher already uses Pi's ambient global/project extension discovery. The isolated path that needs configuration is a tracked Specialists dispatch (`sp run` and related job paths), not the interactive Core role launcher.

The smallest safe manifest shape is a boolean map of trusted extension IDs:

```json
{
  "specialist": {
    "execution": {
      "extensions": {
        "gitnexus": true,
        "python-kernel": true,
        "service-knowledge": true,
        "xtrm-loader": true
      }
    }
  }
}
```

Each descriptor owns its package name, entry path, default-enabled state, permission predicate, and optional tool-catalog identity. A repository manifest can select a known descriptor, but it cannot point Pi at an arbitrary file.

## Source-bound terminology correction

The inspected source has two different launch paths:

1. **Interactive role session:** `xt pi --role <role>` is implemented by Core. It calls `sp view` to render role configuration, then Core spawns Pi itself.
2. **Tracked specialist dispatch:** normal `sp run` and write-capable `sp script` paths create `PiAgentSession`. Read-only/script surfaces, including `sp serve`, can use a second direct JSON-mode Pi spawn in `script-runner.ts`.

Host observation on 2026-08-28: `readlink -f "$(command -v xt)"` returned `/home/dawid/dev/core/cli/dist/index.cjs`. `/home/dawid/dev/xtrm` owns the standalone service-knowledge package, not the inspected `xt pi --role` implementation. Core defines the `xt pi` command and forwards it to `launchWorktreeSession` (`cli/src/commands/pi.ts:99-117`, `cli/src/commands/pi.ts:152-174`).

No literal `.specialists.json` file or loader was found in the three scoped repositories. Current Specialists manifests are `*.specialist.json`; repository overrides are `.specialists/user/<name>.specialist.json`. Merge order is package canonical, global `~/.config/specialists/user.json`, then repository override (`/home/dawid/dev/specialists/src/specialist/loader.ts:300-359`). This document uses “manifest” for that supported family.

## 1. Exact launch traces and configuration surfaces

### 1.1 Interactive `xt pi --role`

The Core command passes `--role` to `launchWorktreeSession` (`cli/src/commands/pi.ts:136-174`). The launcher resolves the role with:

```text
sp view <name> --raw --surface pi
```

(`cli/src/utils/worktree-session.ts:518-552`). Specialists returns the merged effective spec (`/home/dawid/dev/specialists/src/cli/view.ts:261-276`). Core parses the system prompt, skills, model, thinking level, `execution.extensions`, and `interactive`; the parsed extension map is retained but not consumed (`cli/src/utils/worktree-session.ts:458-511`).

Core builds Pi arguments with `--append-system-prompt`, `--no-skills`, declared `--skill` paths, model/thinking, and the initial prompt (`cli/src/utils/worktree-session.ts:987-1067`). It deliberately does **not** add `--no-extensions` or `-e`; the source says Pi owns extension discovery (`cli/src/utils/worktree-session.ts:1014-1028`). A regression test fixes that behavior (`cli/src/tests/worktree-session-role.test.ts:700-709`).

Current-pane and detached launches preserve the parent environment and set only agent metadata (`cli/src/utils/worktree-session.ts:2151-2167`, `cli/src/utils/worktree-session.ts:2274-2308`). Core does not set `PI_CODING_AGENT_DIR` and does not generate a Pi settings file.

Therefore, current interactive role sessions see:

- global settings at `~/.pi/agent/settings.json`;
- trusted project settings at `<worktree>/.pi/settings.json`;
- global/project extension discovery;
- explicit operator `-e` arguments passed after `--`.

Pi documents the global/project settings scopes and merge (`/home/dawid/.nvm/versions/node/v24.15.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/settings.md:1-20`, `:272-313`). `PI_CODING_AGENT_DIR` is the config-directory override (`/home/dawid/.nvm/versions/node/v24.15.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/environment-variables.md:75-94`). The installed loader merges configured and CLI extensions unless discovery is disabled (`/home/dawid/.nvm/versions/node/v24.15.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/resource-loader.js:312-319`).

The inspected host globally enrolls both local source packages (`/home/dawid/.pi/agent/settings.json:7-24`). Consequently, source does not support “global enrollment is hidden from current `xt pi --role`.” If an interactive role lacks service-knowledge, likely causes are an inherited config-dir override, package-load failure, a different installed version, project trust, or the extension's registry gate.

### 1.2 Tracked Specialists dispatch

`PiAgentSession.start()` builds RPC arguments with `--no-extensions`, `--no-skills`, `--no-session`, `--offline`, `--no-context-files`, `--no-prompt-templates`, and `--no-themes` (`/home/dawid/dev/specialists/src/pi/session.ts:772-800`). Declared skills are restored individually (`:807-810`).

The process keeps `HOME` and the parent environment and uses the requested job cwd (`/home/dawid/dev/specialists/src/pi/session.ts:882-904`). This is discovery isolation, not a custom config directory or OS sandbox. `--no-extensions` is the reason globally enrolled packages do not reach a tracked dispatch; explicit `-e` arguments are the only restoration path. Pi explicitly documents that `--no-extensions` still permits explicit `-e` (`/home/dawid/.nvm/versions/node/v24.15.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/usage.md:220-236`).

The reported live service-knowledge failure did not include its command, worktree, startup diagnostics, or session log. Source cannot prove whether it was interactive `xt pi --role` or a tracked `sp` dispatch. The isolation explanation applies to the latter. A service-specific stopgap has since landed in Specialists commit `57fbbfb9`: service-knowledge is now hand-injected when its global package entry resolves (`/home/dawid/dev/specialists/src/pi/session.ts:819-828`). The general configurability gap remains.

## 2. Every extension force point

The primary RPC-session injection sites are fixed code in `PiAgentSession.start()`:

| Order | Extension | Condition | Evidence |
|---:|---|---|---|
| 1 | quality-gates | loose `~/.pi/agent/extensions/quality-gates`; non-`READ_ONLY` | `/home/dawid/dev/specialists/src/pi/session.ts:812-818` |
| 2 | service-knowledge | dedicated global-package resolver; always when present | `/home/dawid/dev/specialists/src/pi/session.ts:819-828` |
| 3 | python-kernel | dedicated global-package resolver; non-`READ_ONLY` | `/home/dawid/dev/specialists/src/pi/session.ts:830-840` |
| 4 | caveman | loose extension directory when present | `/home/dawid/dev/specialists/src/pi/session.ts:842-844` |
| 5 | NVIDIA NIM | fixed global git-package directory when present | `/home/dawid/dev/specialists/src/pi/session.ts:846-849` |
| 6 | GitNexus | resolved tool contract says `available` and package path exists | `/home/dawid/dev/specialists/src/pi/session.ts:851-859` |
| 7 | worktree boundary | generated temporary extension when boundary generation succeeds | `/home/dawid/dev/specialists/src/pi/session.ts:661-723`, `:866-871` |
| 8 | read line numbers | bundled resolver returns a path | `/home/dawid/dev/specialists/src/pi/session.ts:874-880` |

Python Kernel is fixed to `@jaggerxtrm/pi-extensions/extensions/python-kernel/index.ts`; Service Knowledge is fixed to `@jaggerxtrm/pi-service-knowledge/index.ts` (`/home/dawid/dev/specialists/src/pi/python-kernel-extension.ts:20-53`, `:61-87`). The resolver builds several possible global-node-modules roots, selects the first existing root, and inspects only that root for each package; it does not search later roots when a package is absent (`:24-49`, `:70-81`).

The worktree-boundary extension is generated under the OS temporary directory and fails open with a warning (`/home/dawid/dev/specialists/src/pi/session.ts:661-723`). No session settings file is generated.

### Direct `script-runner` force path

`script-runner.ts` has a separate `appendExtensionArgs()` implementation. It injects read-line-numbers, Quality Gates, a retired loose `service-skills` path, Caveman, and contract-gated GitNexus (`/home/dawid/dev/specialists/src/specialist/script-runner.ts:969-990`). Write-capable `surface === "script"` invocations use `PiAgentSession` (`:1007-1022`), but the other script/read-only path spawns Pi directly with `--no-extensions` and calls the separate assembler (`:1135-1145`). `sp serve` imports and calls `runScriptSpecialist` (`/home/dawid/dev/specialists/src/cli/serve.ts:7-10`, `:394-400`).

This is a real parity gap: the implementation wave must share one resolved extension plan across `runner.ts`, `PiAgentSession`, and the direct script runner. It must also remove the stale loose `service-skills` lookup in favor of the standalone service-knowledge descriptor.

### Existing exclusion path

The schema declares only legacy `serena` and active `gitnexus` booleans, while `.passthrough()` accepts untyped extra keys (`/home/dawid/dev/specialists/src/specialist/schema.ts:45-58`). Override layers explicitly allow only `extensions.serena` and `extensions.gitnexus` (`:180-186`).

The runner ignores Serena and converts only `gitnexus === false` into package exclusion (`/home/dawid/dev/specialists/src/specialist/runner.ts:1025-1035`). It passes that exclusion and the resolved contract into the session (`:1431-1446`). No other manifest extension key changes Pi arguments.

## 3. Catalog versus hardcoded runtime behavior

There is no generic catalog-to-`-e` loop.

The runtime reads one complete catalog index, preferring `<process.cwd()>/.specialists/catalog/index.json` and falling back to packaged `config/catalog/index.json` (`/home/dawid/dev/specialists/src/pi/session.ts:181-198`). Individual `config/catalog/*.json` files are not independently loaded. The first valid index is cached process-wide (`:166-187`).

The index defines native, GitNexus, Python Kernel, and Service Knowledge entries (`/home/dawid/dev/specialists/config/catalog/index.json:2-148`). It drives:

- tier-specific native and extension tool names;
- exact package/version health for GitNexus and Python Kernel;
- `--tools` and formatted tool-contract text;
- GitNexus package-path injection when healthy.

The tool resolver explicitly assembles only GitNexus and Python Kernel tools (`/home/dawid/dev/specialists/src/specialist/manifest-resolver.ts:138-191`). Catalog names are a fixed enum (`/home/dawid/dev/specialists/src/specialist/tool-catalog.ts:3-14`).

Service Knowledge has a catalog row but no tools. Its package/version are not consulted by its launch resolver; launch checks only its hardcoded entry existence (`/home/dawid/dev/specialists/src/pi/python-kernel-extension.ts:61-87`). Python has the opposite mismatch: the contract can mark it disabled or incompatible, while actual `-e` assembly calls the dedicated path resolver and can still load it (`/home/dawid/dev/specialists/src/pi/session.ts:265-319`, `:830-840`).

The catalog is therefore a tool-policy/health surface, not a complete extension inventory. Overloading it with UI hooks, gates, context injectors, and provider adapters would widen its role and require changes across its fixed enum and manifest resolver. A separate small injection-descriptor registry is the lower-diff design.

## 4. Injectable packages and self-gating

### Service Knowledge

`@jaggerxtrm/pi-service-knowledge` exports and declares `./index.ts` as its Pi extension (`/home/dawid/dev/xtrm/packages/service-knowledge-ext/package.json:6-8`, `:27-31`).

At initialization it scans the cwd and five ancestors for `.xtrm/skills` pack umbrellas (`/home/dawid/dev/xtrm/packages/service-knowledge-ext/index.ts:54-109`). If no qualifying `service-knowledge/service-registry.json` exists, it immediately returns and registers zero surface (`:185-193`). The zero-surface case is tested (`/home/dawid/dev/xtrm/packages/service-knowledge-ext/tests/service-knowledge.test.ts:52-63`).

When active, it registers one hidden `before_agent_start` context message and `/service-knowledge:status` (`/home/dawid/dev/xtrm/packages/service-knowledge-ext/index.ts:195-238`). Missing roots, malformed registry reads, and git lookup failures fail open (`:85-93`, `:112-131`). Drift is advisory and never starts reconciliation automatically (`/home/dawid/dev/xtrm/packages/service-knowledge-ext/README.md:66-93`).

This makes package injection safe across specialists: registry-less jobs pay load/discovery cost but receive no command or prompt surface. The descriptor health note must distinguish “package loaded” from “registry gate active”; package presence alone cannot claim an active service-knowledge surface.

### Core Pi extension bundle

`@jaggerxtrm/pi-extensions` exports and declares `./src/index.ts` (`packages/pi-extensions/package.json:15-23`). That entry delegates to the managed registry (`packages/pi-extensions/src/index.ts:3-9`), whose static imports register the active bundle (`packages/pi-extensions/src/registry.ts:3-15`, `:22-58`). Individual extension entries remain addressable, for example `extensions/beads/index.ts` (`packages/pi-extensions/extensions/beads/package.json:1-8`).

Whole-bundle injection is materially different from injecting Python Kernel alone: it loads Python Kernel and read-line-numbers again, plus gates, lifecycle hooks, UI patches, and context injectors (`packages/pi-extensions/src/registry.ts:3-15`, `:22-35`). Pi keeps conflicting extensions loaded, reports diagnostics, and uses load order for precedence (`/home/dawid/.nvm/versions/node/v24.15.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/resource-loader.js:459-465`); the first tool registration by name wins (`/home/dawid/.nvm/versions/node/v24.15.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.js:280-290`). Duplicate event handlers can still both run.

Therefore the initial design must **not** inject `@jaggerxtrm/pi-extensions/src/index.ts`. It exposes approved narrow entries such as `extensions/xtrm-loader/index.ts`, while Python Kernel retains its existing narrow descriptor. A whole-bundle descriptor remains deferred until the package offers a non-overlapping Specialists entry or the resolver suppresses every duplicate extension deterministically.

The bundle catches errors from individual factory calls and continues with sibling extensions (`packages/pi-extensions/src/registry.ts:47-58`), but static import failure occurs before that boundary. The Specialists resolver must check package and entry existence before adding `-e`; it cannot make an import-time exception non-fatal after Pi starts.

## 5. Proposed contract

### 5.1 Manifest semantics

Use boolean keys under existing `execution.extensions`:

```json
{
  "specialist": {
    "execution": {
      "extensions": {
        "service-knowledge": true,
        "python-kernel": true,
        "xtrm-loader": false,
        "gitnexus": true
      }
    }
  }
}
```

Rules:

- Omitted key: descriptor default applies.
- `true`: request injection, subject to descriptor permission and health checks.
- `false`: suppress injection, including current default-enabled descriptors.
- Unknown key: skip and add an `unknown_extension_id` health warning; do not fail the job.
- `serena`: continue to parse and ignore for compatibility.
- Only booleans are accepted for known keys in typed schema/docs.

Initial trusted descriptors:

| ID | Package/entry | Default | Predicate |
|---|---|---:|---|
| `gitnexus` | existing contract package path | enabled | contract status `available` |
| `python-kernel` | `@jaggerxtrm/pi-extensions/extensions/python-kernel/index.ts` | enabled | tier is not `READ_ONLY` and catalog-compatible |
| `service-knowledge` | `@jaggerxtrm/pi-service-knowledge/index.ts` | enabled | package entry exists; extension self-gates by registry |
| `xtrm-loader` | `@jaggerxtrm/pi-extensions/extensions/xtrm-loader/index.ts` | disabled | explicit `true`; package entry exists |

Additional Core-package entries can be approved as narrow descriptors after overlap review. The whole `src/index.ts` bundle is not an initial descriptor. Quality Gates, Caveman, NVIDIA NIM, worktree boundary, and read-line-numbers remain existing runtime-owned injections in the first wave. Migrating them into descriptors is optional cleanup, not required for this gap.

### 5.2 Resolution algorithm

Resolve once in the runner after `runCwd` is known and before prompt rendering:

1. Merge descriptor defaults with the effective specialist boolean map.
2. For each enabled known descriptor, reuse its existing vendored resolver/contract path where one exists.
3. Enumerate the existing global-node-modules candidate roots and test `<root>/<package>/<entry>` in order. Select the first package entry that exists. This intentionally fixes the current first-existing-root behavior, which can miss a package installed in a later root.
4. Read `package.json` when the descriptor/catalog has an expected version. A version mismatch is unhealthy and skipped.
5. Canonicalize successful paths with `realpath`; deduplicate by realpath.
6. Preserve descriptor order, then append runtime-owned boundary/read-line-number extensions in their existing tail order.
7. Return an immutable plan containing `id`, requested/default state, status, source, package, version, resolved path, and reason.
8. Pass that same plan to tool-contract formatting and `PiAgentSession`; the session must not independently re-resolve it.

Recommended status values are `available`, `available_self_gating`, `disabled`, `not_installed`, `incompatible`, `missing_entry`, and `unknown_id`. `available_self_gating` means the package entry is injectable but actual registry activation is cwd-dependent; it still produces `-e`, but the resolver must not claim that the command/context hook registered.

### 5.3 Local unpublished package strategy

Prefer the global-node-modules symlink pattern. Host observations on 2026-08-28, captured with `npm root -g` plus `readlink -f`, were:

```text
@jaggerxtrm/pi-extensions -> /home/dawid/dev/core/packages/pi-extensions
@jaggerxtrm/pi-service-knowledge -> /home/dawid/dev/xtrm/packages/service-knowledge-ext
```

This pattern gives a stable package identity, live source checkout, package metadata, and the same resolver path used by published installs. No npm publish is required.

Do not automatically search `~/dev/core` or `~/dev/xtrm`; those paths are machine-specific and can silently select an unrelated checkout. Do not allow repository overrides to supply arbitrary source paths: Pi extensions execute with full user permissions, outside `--tools` restrictions. If a later developer escape hatch is necessary, put an ID-to-path map in a user-owned/global Specialists config or environment variable, validate its package name/entry, and keep repository manifests limited to trusted IDs. That escape hatch is not part of the smallest diff.

### 5.4 Precedence and deduplication

Existing resolver/contract output wins over manifest fallback resolution. A manifest key controls enabled state; it does not replace a vendored path. If two descriptors resolve to the same realpath, inject the first only and report the duplicate in health details.

Keep current behavioral order:

1. existing loose/default runtime extensions through NVIDIA NIM;
2. resolved known package descriptors, preserving existing GitNexus position where practical;
3. manifest-only narrow Core-package additions such as `xtrm-loader`;
4. worktree boundary;
5. read-line-numbers.

The two final positions preserve the source's explicit boundary/read-output ordering invariant (`/home/dawid/dev/specialists/src/pi/session.ts:866-880`).

### 5.5 Failure semantics and health evidence

A missing package, missing entry, incompatible version, duplicate path, or unknown ID must never abort the specialist session. The resolver omits that `-e` pair, adds the record to `ResolvedToolContract.warnings`, and writes one bounded `[specialists:extension]` warning to the parent process stderr before spawn. `available_self_gating` still injects the entry and records that surface activation is conditional. Parent stderr is the smallest-diff operator note; validation must prove where each CLI/server surface persists or displays it before documentation calls it durable. A later structured timeline event can be added separately, but is not required for the injection seam.

Minimum health fields:

```text
component=specialists.pi.extensions
specialist=<name>
extension_id=<id>
requested=true|false
status=<status>
source=default|manifest|global-node-modules|vendored
package=<redacted package name>
entry=<relative entry>
reason=<bounded code>
```

Do not log full prompts, credentials, environment values, or arbitrary file contents. Absolute resolved paths may be included in debug output but should not be included in cross-system telemetry by default.

Pi-emitted `extension_error` events remain runtime evidence for a path that resolved but failed during load (`/home/dawid/dev/specialists/src/pi/session.ts:94-102`, `:1242-1248`). Resolution health and Pi load health are separate states.

### 5.6 Tool-contract and prompt updates

Today the runner resolves the tool contract before `runCwd` and before launch (`/home/dawid/dev/specialists/src/specialist/runner.ts:1020-1040`, `:1053-1055`). Service Knowledge appears in the catalog but receives no runtime state; Python contract and actual injection can disagree (`/home/dawid/dev/specialists/src/pi/session.ts:321-368`, `:830-840`).

Move `runCwd` computation before extension/contract resolution. Feed the resolved extension plan into `resolveRuntimeToolContract` so:

- Python tools appear only when the exact Python entry will be injected.
- GitNexus exclusion and injection use the same plan.
- Service Knowledge reports package health and `available_self_gating`, with no invented tools.
- Narrow Core-package descriptors report loaded package state but do not add tools unless a future trusted catalog declares them.
- Missing requested extensions add warnings and downgrade reasons, not fatal validation errors.

`formatResolvedToolContract` already renders extension state (`/home/dawid/dev/specialists/src/specialist/resolved-tool-contract.ts:114-139`). Extend it with requested/source/reason and the self-gate distinction. The formatted block reaches the model only when the specialist task template includes `$resolved_tool_contract` (`/home/dawid/dev/specialists/src/specialist/runner.ts:1036-1040`). Update authoring guidance to require that placeholder for specialists whose instructions depend on optional extension capabilities.

The generic GitNexus prompt mandate currently checks only for `.gitnexus/meta.json`, not extension health (`/home/dawid/dev/specialists/src/specialist/runner.ts:1185-1210`). Gate that text on the resolved GitNexus state or phrase it conditionally so prompt and tools cannot conflict.

## 6. Smallest-diff implementation plan

### Phase 1: typed manifest and trusted descriptors

Files:

- `/home/dawid/dev/specialists/src/specialist/schema.ts`
- `/home/dawid/dev/specialists/src/pi/python-kernel-extension.ts` or a small adjacent resolver module
- `/home/dawid/dev/specialists/src/pi/session.ts`
- `/home/dawid/dev/specialists/docs/pi-session.md`
- `/home/dawid/dev/specialists/docs/authoring.md`
- `/home/dawid/dev/specialists/config/skills/setup-specialists/SKILL.md`

Changes:

1. Type the known boolean keys while retaining `.passthrough()` and legacy Serena parsing.
2. Add known nested override paths. Do not add a wildcard arbitrary-path override.
3. Define the four initial trusted descriptors and one pure resolver returning health records plus deduplicated paths.
4. Extract the current global-node-modules root candidates, but search each candidate for the requested package entry instead of stopping at the first existing root. Reuse existing Python/Service Knowledge metadata and tests.

### Phase 2: one resolved plan for prompt and spawn

Files:

- `/home/dawid/dev/specialists/src/specialist/runner.ts`
- `/home/dawid/dev/specialists/src/specialist/script-runner.ts`
- `/home/dawid/dev/specialists/src/pi/session.ts`
- `/home/dawid/dev/specialists/src/specialist/resolved-tool-contract.ts`

Changes:

1. Compute `runCwd` before extension and tool-contract resolution.
2. Resolve extensions once from effective `execution.extensions`.
3. Pass `resolvedExtensions` through `PiSessionOptions`.
4. Replace package-specific `args.push('-e', ...)` decisions for GitNexus, Python, and Service Knowledge with iteration over the healthy resolved plan. Preserve current ordering and permission predicates.
5. Pass the same plan into `script-runner.ts`; remove its stale loose `service-skills` lookup and use the plan for both direct JSON-mode spawn and write-capable `PiAgentSession` execution.
6. Keep `--no-extensions`; do not write a settings file.
7. Add bounded resolution warnings to parent stderr and the contract formatter.
8. Gate extension-specific prompt text on resolved state.

### Phase 3: manifest adoption

Files:

- `/home/dawid/dev/specialists/config/specialists/service-knowledge-sync.specialist.json`
- only other specialist manifests that need approved narrow Core-package entries

Changes:

1. Add explicit `service-knowledge: true` to the librarian manifest for intent and health reporting, even though the descriptor default preserves current injection.
2. Opt individual roles into approved narrow entries such as `xtrm-loader` only after inspecting their RPC behavior.
3. Do not expose or enable the whole Core bundle.

### Phase 4: validation

Add focused tests near existing session/runner coverage:

1. Manifest parsing and override tests for each known boolean and unknown-key warning.
2. Resolver tests for regular global installs, symlinked global packages, missing package, missing entry, version mismatch, duplicate realpath, and disabled descriptor.
3. Spawn-argv tests for both `PiAgentSession` and direct `script-runner` proving `--no-extensions` remains and only healthy requested entries produce ordered `-e` pairs.
4. Contract tests proving Python tools and GitNexus prompt text agree with injected paths.
5. Service Knowledge tests for registry present and absent; absent must start successfully and register zero surface.
6. An integrated RPC smoke using a temporary global-node-modules tree with symlinked fixtures. Assert health output and effective tool/command surface without network or npm publish.
7. A regression test for current hardcoded defaults so the migration does not silently drop Quality Gates, boundary, or read-line-numbers.

The implementation must use the repository's normal typecheck and focused/full test commands. A test runner should record exact pass/fail counts and the smoke artifact path.

## 7. What does not need to change

- **Core `xt pi --role`:** no change. It already delegates extension discovery to Pi and preserves global settings (`cli/src/utils/worktree-session.ts:1014-1028`, `:2151-2167`). Adding resolver logic there would duplicate Specialists and change interactive behavior.
- **Pi config directory or settings generation:** no change. Specialists should keep `--no-extensions` plus explicit `-e`; no custom `HOME`, `PI_CODING_AGENT_DIR`, or generated settings file is required.
- **Pi itself:** no change. `--no-extensions` with explicit `-e` is already supported.
- **Package publication:** no change. Global node-modules symlinks support unpublished local testing.
- **Service Knowledge package:** no change. Its registry self-gate and fail-open behavior are suitable as-is.
- **Core extension source:** no change for the resolver wave. Specialists points only at approved existing narrow entries; whole-bundle injection is deferred.
- **Tool catalog schema/index:** no change is required for non-tool extension injection. Reuse catalog state where it already exists; do not turn the tool catalog into a universal resource manifest.
- **Existing runtime-owned extensions:** no forced migration in the first wave.
- **`xt` CLI flags:** no new flag. The per-role manifest owns tracked-dispatch selection.

## 8. Risk and blast radius

GitNexus reports `PiAgentSession` as **HIGH** upstream risk: 8 direct dependents, 182 impacted items through depth 3, and affected `run`/`runSingleAttempt` processes. Direct dependents include `runner.ts`, `script-runner.ts`, `supervisor.ts`, and session/runner tests. The later implementation must warn before editing, keep the change additive, and run both focused session tests and an integrated dispatch smoke.

Security risk is higher than the code size suggests: an extension executes arbitrary code with the user's permissions and is not constrained by `--tools`. This is why manifests select trusted IDs rather than arbitrary paths.

## 9. Explicit unknowns

- The original failing launch command, installed versions, inherited environment, cwd, registry path, Pi startup diagnostics, and job/session log were not supplied. The exact live failure path cannot be proven from source.
- If the failure was current `xt pi --role`, config isolation is not the source-backed cause.
- Pi loader behavior after a resolved extension throws during static import was not verified with a live probe; the design prevents known missing paths but cannot convert an internal module exception into a pre-spawn skip.
- No generator for `config/catalog/index.json` was found in the inspected runtime path. This design does not depend on individual catalog files being merged.
- The supported source does not contain a literal `.specialists.json` manifest. Implementation should use the existing `*.specialist.json` and `.specialists/user/<name>.specialist.json` surfaces unless a separate manifest migration is approved.
- Whole-bundle Core injection has unresolved duplicate tool/hook behavior. The first wave deliberately supports narrow entries only.
- Direct `script-runner` and `sp serve` parity must ship with the same resolved plan; leaving that path unchanged would preserve the gap.
