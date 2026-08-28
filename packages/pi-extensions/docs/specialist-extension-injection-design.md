# Manifest-configurable Pi extension injection for Specialists

Status: design only

Bead: `xtrm-xvcyj`

Date: 2026-08-28

## Decision

Keep Specialists sessions isolated with `--no-extensions`. Treat `specialist.execution.extensions` as a boolean map whose keys are native Pi extension sources. For each effective `true` entry, append one `-e <source>` pair. Pass the same ordered source list to `PiAgentSession` and the direct script runner; Pi performs all path, npm, git, package-manifest, and entrypoint resolution. Keep `--offline` for local-only sessions, but omit it when an enabled source requires native npm/git/network resolution.

The existing global user configuration at `~/.config/specialists/user.json` can override the same per-specialist boolean fields. Omitted or `false` entries do not load. No second registry or resolver configuration is needed.

Do not generate Pi settings, change `HOME`, publish packages, add a descriptor registry, vendor extensions into Core, or change the Core `xt pi --role` launcher. The current Core launcher already uses Pi's ambient global/project extension discovery. The isolated path that needs configuration is a tracked Specialists dispatch (`sp run` and related job paths), not the interactive Core role launcher.

The smallest manifest shape is a boolean map of Pi-native extension sources:

```json
{
  "specialist": {
    "execution": {
      "extensions": {
        "npm:pi-gitnexus@0.6.1": true,
        "npm:@jaggerxtrm/pi-service-knowledge@1.0.0": true
      }
    }
  }
}
```

The source string is passed to Pi unchanged. Pi already accepts local paths, npm sources, and git sources through `-e`; package entrypoints come from the package's native `pi.extensions` metadata. Specialists owns selection and ordering only.

## Source-bound terminology correction

The inspected source has two different launch paths:

1. **Interactive role session:** `xt pi --role <role>` is implemented by Core. It calls `sp view` to render role configuration, then Core spawns Pi itself.
2. **Tracked specialist dispatch:** normal `sp run` and write-capable `sp script` paths create `PiAgentSession`. Read-only/script surfaces, including `sp serve`, can use a second direct JSON-mode Pi spawn in `script-runner.ts`.

Host observation on 2026-08-28: `readlink -f "$(command -v xt)"` returned `~/dev/core/cli/dist/index.cjs`. `~/dev/xtrm` owns the standalone service-knowledge package, not the inspected `xt pi --role` implementation. Core defines the `xt pi` command and forwards it to `launchWorktreeSession` (`cli/src/commands/pi.ts:99-117`, `cli/src/commands/pi.ts:152-174`).

No literal `.specialists.json` file or loader was found in the three scoped repositories. Current Specialists manifests are `*.specialist.json`; repository overrides are `.specialists/user/<name>.specialist.json`. Merge order is package canonical, global `~/.config/specialists/user.json`, then repository override (`~/dev/specialists/src/specialist/loader.ts:300-359`). This document uses “manifest” for that supported family.

## 1. Exact launch traces and configuration surfaces

### 1.1 Interactive `xt pi --role`

The Core command passes `--role` to `launchWorktreeSession` (`cli/src/commands/pi.ts:136-174`). The launcher resolves the role with:

```text
sp view <name> --raw --surface pi
```

(`cli/src/utils/worktree-session.ts:518-552`). Specialists returns the merged effective spec (`~/dev/specialists/src/cli/view.ts:261-276`). Core parses the system prompt, skills, model, thinking level, `execution.extensions`, and `interactive`; the parsed extension map is retained but not consumed (`cli/src/utils/worktree-session.ts:458-511`).

Core builds Pi arguments with `--append-system-prompt`, `--no-skills`, declared `--skill` paths, model/thinking, and the initial prompt (`cli/src/utils/worktree-session.ts:987-1067`). It deliberately does **not** add `--no-extensions` or `-e`; the source says Pi owns extension discovery (`cli/src/utils/worktree-session.ts:1014-1028`). A regression test fixes that behavior (`cli/src/tests/worktree-session-role.test.ts:700-709`).

Current-pane and detached launches preserve the parent environment and set only agent metadata (`cli/src/utils/worktree-session.ts:2151-2167`, `cli/src/utils/worktree-session.ts:2274-2308`). Core does not set `PI_CODING_AGENT_DIR` and does not generate a Pi settings file.

Therefore, current interactive role sessions see:

- global settings at `~/.pi/agent/settings.json`;
- trusted project settings at `<worktree>/.pi/settings.json`;
- global/project extension discovery;
- explicit operator `-e` arguments passed after `--`.

Pi documents the global/project settings scopes and merge (`<pi-agent>/docs/settings.md:1-20`, `:272-313`). `PI_CODING_AGENT_DIR` is the config-directory override (`<pi-agent>/docs/environment-variables.md:75-94`). The installed loader merges configured and CLI extensions unless discovery is disabled (`<pi-agent>/dist/core/resource-loader.js:312-319`).

The inspected host globally enrolls both local source packages (`~/.pi/agent/settings.json:7-24`). Consequently, source does not support “global enrollment is hidden from current `xt pi --role`.” If an interactive role lacks service-knowledge, likely causes are an inherited config-dir override, package-load failure, a different installed version, project trust, or the extension's registry gate.

### 1.2 Tracked Specialists dispatch

`PiAgentSession.start()` builds RPC arguments with `--no-extensions`, `--no-skills`, `--no-session`, `--offline`, `--no-context-files`, `--no-prompt-templates`, and `--no-themes` (`~/dev/specialists/src/pi/session.ts:772-800`). Declared skills are restored individually (`:807-810`).

The process keeps `HOME` and the parent environment and uses the requested job cwd (`~/dev/specialists/src/pi/session.ts:882-904`). This is discovery isolation, not a custom config directory or OS sandbox. `--no-extensions` is the reason globally enrolled packages do not reach a tracked dispatch; explicit `-e` arguments are the only restoration path. Pi explicitly documents that `--no-extensions` still permits explicit `-e` (`<pi-agent>/docs/usage.md:220-236`).

The reported live service-knowledge failure did not include its command, worktree, startup diagnostics, or session log. Source cannot prove whether it was interactive `xt pi --role` or a tracked `sp` dispatch. The isolation explanation applies to the latter. A service-specific stopgap has since landed in Specialists commit `57fbbfb9`: service-knowledge is now hand-injected when its global package entry resolves (`~/dev/specialists/src/pi/session.ts:819-828`). The general configurability gap remains.

## 2. Every extension force point

The primary RPC-session injection sites are fixed code in `PiAgentSession.start()`:

| Order | Extension | Condition | Evidence |
|---:|---|---|---|
| 1 | quality-gates | loose `~/.pi/agent/extensions/quality-gates`; non-`READ_ONLY` | `~/dev/specialists/src/pi/session.ts:812-818` |
| 2 | service-knowledge | dedicated global-package resolver; always when present | `~/dev/specialists/src/pi/session.ts:819-828` |
| 3 | python-kernel | dedicated global-package resolver; non-`READ_ONLY` | `~/dev/specialists/src/pi/session.ts:830-840` |
| 4 | caveman | loose extension directory when present | `~/dev/specialists/src/pi/session.ts:842-844` |
| 5 | NVIDIA NIM | fixed global git-package directory when present | `~/dev/specialists/src/pi/session.ts:846-849` |
| 6 | GitNexus | resolved tool contract says `available` and package path exists | `~/dev/specialists/src/pi/session.ts:851-859` |
| 7 | worktree boundary | generated temporary extension when boundary generation succeeds | `~/dev/specialists/src/pi/session.ts:661-723`, `:866-871` |
| 8 | read line numbers | bundled resolver returns a path | `~/dev/specialists/src/pi/session.ts:874-880` |

Python Kernel is fixed to `@jaggerxtrm/pi-extensions/extensions/python-kernel/index.ts`; Service Knowledge is fixed to `@jaggerxtrm/pi-service-knowledge/index.ts` (`~/dev/specialists/src/pi/python-kernel-extension.ts:20-53`, `:61-87`). The resolver builds several possible global-node-modules roots, selects the first existing root, and inspects only that root for each package; it does not search later roots when a package is absent (`:24-49`, `:70-81`).

The worktree-boundary extension is generated under the OS temporary directory and fails open with a warning (`~/dev/specialists/src/pi/session.ts:661-723`). No session settings file is generated.

### Direct `script-runner` force path

`script-runner.ts` has a separate `appendExtensionArgs()` implementation. It injects read-line-numbers, Quality Gates, a retired loose `service-skills` path, Caveman, and contract-gated GitNexus (`~/dev/specialists/src/specialist/script-runner.ts:969-990`). Write-capable `surface === "script"` invocations use `PiAgentSession` (`:1007-1022`), but the other script/read-only path spawns Pi directly with `--no-extensions` and calls the separate assembler (`:1135-1145`). `sp serve` imports and calls `runScriptSpecialist` (`~/dev/specialists/src/cli/serve.ts:7-10`, `:394-400`).

This is a real parity gap: the implementation wave must share one ordered enabled-source list across `runner.ts`, `PiAgentSession`, and the direct script runner. It must also remove the stale loose `service-skills` lookup in favor of the configured standalone Service Knowledge source.

### Existing exclusion path

The schema declares only legacy `serena` and active `gitnexus` booleans, while `.passthrough()` accepts untyped extra keys (`~/dev/specialists/src/specialist/schema.ts:45-58`). Override layers explicitly allow only `extensions.serena` and `extensions.gitnexus` (`:180-186`).

The runner ignores Serena and converts only `gitnexus === false` into package exclusion (`~/dev/specialists/src/specialist/runner.ts:1025-1035`). It passes that exclusion and the resolved contract into the session (`:1431-1446`). No other manifest extension key changes Pi arguments.

## 3. Catalog versus hardcoded runtime behavior

There is no generic catalog-to-`-e` loop.

The runtime reads one complete catalog index, preferring `<process.cwd()>/.specialists/catalog/index.json` and falling back to packaged `config/catalog/index.json` (`~/dev/specialists/src/pi/session.ts:181-198`). Individual `config/catalog/*.json` files are not independently loaded. The first valid index is cached process-wide (`:166-187`).

The index defines native, GitNexus, Python Kernel, and Service Knowledge entries (`~/dev/specialists/config/catalog/index.json:2-148`). It drives:

- tier-specific native and extension tool names;
- exact package/version health for GitNexus and Python Kernel;
- `--tools` and formatted tool-contract text;
- GitNexus package-path injection when healthy.

The tool resolver explicitly assembles only GitNexus and Python Kernel tools (`~/dev/specialists/src/specialist/manifest-resolver.ts:138-191`). Catalog names are a fixed enum (`~/dev/specialists/src/specialist/tool-catalog.ts:3-14`).

Service Knowledge has a catalog row but no tools. Its package/version are not consulted by its launch resolver; launch checks only its hardcoded entry existence (`~/dev/specialists/src/pi/python-kernel-extension.ts:61-87`). Python has the opposite mismatch: the contract can mark it disabled or incompatible, while actual `-e` assembly calls the dedicated path resolver and can still load it (`~/dev/specialists/src/pi/session.ts:265-319`, `:830-840`).

The catalog is therefore a tool-policy/health surface, not an extension inventory. Overloading it with package resolution for UI hooks, gates, context injectors, and provider adapters would widen its role. Keep it responsible for known tool names and permissions; use the specialist boolean source map plus native Pi `-e` resolution for loading.

## 4. Injectable packages and self-gating

### Service Knowledge

`@jaggerxtrm/pi-service-knowledge` exports and declares `./index.ts` as its Pi extension (`~/dev/xtrm/packages/service-knowledge-ext/package.json:6-8`, `:27-31`).

At initialization it scans the cwd and five ancestors for `.xtrm/skills` pack umbrellas (`~/dev/xtrm/packages/service-knowledge-ext/index.ts:54-109`). If no qualifying `service-knowledge/service-registry.json` exists, it immediately returns and registers zero surface (`:185-193`). The zero-surface case is tested (`~/dev/xtrm/packages/service-knowledge-ext/tests/service-knowledge.test.ts:52-63`).

When active, it registers one hidden `before_agent_start` context message and `/service-knowledge:status` (`~/dev/xtrm/packages/service-knowledge-ext/index.ts:195-238`). Missing roots, malformed registry reads, and git lookup failures fail open (`:85-93`, `:112-131`). Drift is advisory and never starts reconciliation automatically (`~/dev/xtrm/packages/service-knowledge-ext/README.md:66-93`).

This makes package injection suitable across specialists: registry-less jobs pay load/discovery cost but receive no command or prompt surface. Specialists need not model the internal gate; Pi loads the package and the package decides whether to register its surface.

### Core Pi extension bundle

`@jaggerxtrm/pi-extensions` exports and declares `./src/index.ts` (`packages/pi-extensions/package.json:15-23`). That entry delegates to the managed registry (`packages/pi-extensions/src/index.ts:3-9`), whose static imports register the active bundle (`packages/pi-extensions/src/registry.ts:3-15`, `:22-58`). Individual extension entries remain addressable, for example `extensions/beads/index.ts` (`packages/pi-extensions/extensions/beads/package.json:1-8`).

Whole-bundle injection is materially different from injecting Python Kernel alone: it loads Python Kernel and read-line-numbers again, plus gates, lifecycle hooks, UI patches, and context injectors (`packages/pi-extensions/src/registry.ts:3-15`, `:22-35`). Pi keeps conflicting extensions loaded, reports diagnostics, and uses load order for precedence (`<pi-agent>/dist/core/resource-loader.js:459-465`); the first tool registration by name wins (`<pi-agent>/dist/core/extensions/runner.js:280-290`). Duplicate event handlers can still both run.

Therefore the design must **not** pass the aggregate `@jaggerxtrm/pi-extensions` package source merely to reach one nested extension. Python Kernel retains its existing runtime-owned narrow path until it has a standalone Pi package source. Other selectable extensions should use standalone package sources whose native package metadata exposes only the intended surface.

The bundle catches errors from individual factory calls and continues with sibling extensions (`packages/pi-extensions/src/registry.ts:47-58`), but static import failure occurs before that boundary. Under this design, Pi's native loader reports package, entrypoint, and import failures; Specialists does not duplicate that preflight logic.

## 5. Proposed contract

### 5.1 Specialist manifest and user override

Use the existing `execution.extensions` object. Its keys are Pi-native extension sources and its values are booleans:

```json
{
  "specialist": {
    "execution": {
      "extensions": {
        "npm:pi-gitnexus@0.6.1": true,
        "npm:@jaggerxtrm/pi-service-knowledge@1.0.0": true,
        "git:github.com/example/pi-extension@v1": false
      }
    }
  }
}
```

Rules:

- `true`: append one `-e <source>` pair.
- `false` or omitted: do not append the source.
- Every value must be boolean.
- Preserve object insertion order after layered configuration merge.
- Pass each source string to Pi unchanged. Specialists does not parse package names, resolve global node-modules roots, inspect package versions, or find entry files.
- Keep legacy `serena` parsing/ignore behavior only for migration compatibility; do not treat it as a Pi source.

The existing global user file already provides per-specialist overrides at `~/.config/specialists/user.json` (`~/dev/specialists/src/specialist/loader.ts:300-338`). It can expose the same configurable fields:

```json
{
  "service-knowledge-sync": {
    "execution": {
      "extensions": {
        "npm:@jaggerxtrm/pi-service-knowledge@1.0.0": true
      }
    }
  }
}
```

Merge `execution.extensions` key-by-key through the existing package → global user → repository-user specialist layers. A higher layer replaces only the matching boolean. It does not replace the complete map.

### 5.2 Native Pi resolution

Pi documents `-e, --extension <source>` as accepting a path, npm source, or git source, while `--no-extensions` disables discovery (`<pi-agent>/docs/usage.md:219-224`). Pi also documents temporary package loading through `pi -e npm:@foo/bar` and `pi -e git:github.com/user/repo` (`<pi-agent>/docs/packages.md:43-50`).

The resource loader sends CLI `-e` values through the native package manager, then uses those explicitly resolved extensions even when `noExtensions` is true (`<pi-agent>/dist/core/resource-loader.js:274-280`, `:313-319`). The package manager resolves the supplied sources and collects package resources (`<pi-agent>/dist/core/package-manager.js:733-738`, `:981-1035`).

The Specialists operation is therefore only:

```text
for each (source, enabled) in effective execution.extensions
  if enabled
    args.push("-e", source)
```

Keep `--no-extensions` before the generated pairs. Do not pre-resolve a source to a filesystem path.

### 5.3 Package shape and local development

A selectable package must expose the intended extension through native Pi package metadata or conventions. If one npm package exposes a large aggregate bundle, passing its package source loads that bundle. Specialists must not reconstruct a private nested entry path to select one member.

Therefore:

- Service Knowledge can use its standalone package source.
- GitNexus can use its standalone package source.
- A future Ast-grep extension should use its own Pi package source.
- Python Kernel should remain on its existing runtime-owned narrow path until it has a correct standalone Pi package source; do not pass the whole Core extension bundle merely to reach it.

For unpublished work, Pi accepts a local package directory or file through `-e`. A user override can select that local source for development. Published/canonical manifests should use stable npm or git sources rather than machine-specific paths.

Both Specialists spawn paths currently pass `--offline` (`~/dev/specialists/src/pi/session.ts:772-800`, `~/dev/specialists/src/specialist/script-runner.ts:1135-1145`). Native npm/git resolution cannot install a missing temporary package while offline: the package manager skips missing installs in offline mode (`<pi-agent>/dist/core/package-manager.js:995-1017`). Therefore each spawn path must omit `--offline` when the enabled source list contains an npm, git, or network source. Keep `--offline` when every enabled source is local or the list is empty. This preserves offline startup for existing sessions while making configured native package names work from a clean environment.

### 5.4 One source list for every spawn path

Resolve the effective boolean map once in the runner and produce one ordered `string[]` of enabled sources. Pass that list to:

1. `PiAgentSession`, used by normal tracked runs and write-capable script runs;
2. the direct JSON-mode path in `script-runner.ts`, used by read-only/script and `sp serve` paths.

Both spawn implementations append the same list. This closes the current parity gap without a package resolver or descriptor registry.

Preserve runtime-owned injections that are not yet represented as package sources: Quality Gates, Caveman, NVIDIA NIM, the generated worktree boundary, read-line-numbers, and the narrow Python Kernel path. Remove the stale loose `service-skills` injection from the direct script runner when Service Knowledge moves to its configured native source.

### 5.5 Failure and tool-contract behavior

Pi owns package resolution and extension-load diagnostics. Specialists should not duplicate Pi's version, path, package-manifest, entrypoint, or conflict checks. Before spawn, Specialists may log the bounded ordered source list; after spawn, existing `extension_error` handling remains the evidence for native load failure (`~/dev/specialists/src/pi/session.ts:94-102`, `:1242-1248`).

Extension loading and tool permission remain separate:

- A context-only extension such as Service Knowledge needs no `--tools` change.
- A tool-bearing extension loads through `-e`, but its tools remain unavailable unless the existing resolved tool contract admits their exact registered names.
- The existing catalog remains the tool-policy surface. This design does not add custom `tools_by_tier` or descriptor metadata to extension configuration.

The generic GitNexus prompt mandate currently checks only for `.gitnexus/meta.json`, not actual extension state (`~/dev/specialists/src/specialist/runner.ts:1185-1210`). Gate that text on whether the GitNexus source is enabled and its existing catalog contract is available.

### 5.6 Security boundary

A CLI `-e` source executes code with the user's permissions and loads before Pi project trust. Therefore only configuration surfaces already treated as trusted Specialist configuration may populate `execution.extensions`. Do not accept extension sources from task text, model output, environment interpolation, or arbitrary runtime request fields.

No separate machine trust database is necessary. The operator grants trust by placing a source in a canonical specialist manifest or the existing user override configuration.

## 6. Smallest-diff implementation plan

### Phase 1: boolean source map

Files:

- `~/dev/specialists/src/specialist/schema.ts`
- `~/dev/specialists/src/specialist/loader.ts`
- `~/dev/specialists/docs/authoring.md`

Changes:

1. Validate `execution.extensions` as a string-keyed record of booleans.
2. Retain legacy `serena` compatibility without forwarding it to Pi.
3. Merge extension booleans key-by-key in the existing specialist override pipeline.
4. Document that keys use Pi-native path, `npm:`, or `git:` source syntax.
5. Add the extension map to the existing configurable user fields; do not create `extensions.json`.

### Phase 2: append sources at both force points

Files:

- `~/dev/specialists/src/specialist/runner.ts`
- `~/dev/specialists/src/specialist/script-runner.ts`
- `~/dev/specialists/src/pi/session.ts`

Changes:

1. Convert the effective boolean map to one ordered enabled-source array.
2. Pass that array through `PiSessionOptions`.
3. At each spawn implementation, append `['-e', source]` for every enabled source after `--no-extensions`.
4. Omit `--offline` in both spawn paths when any enabled source uses npm, git, or network syntax; retain it for local-only or empty source lists.
5. Remove package-specific Service Knowledge and GitNexus path assembly only when their manifests use native package sources.
6. Keep runtime-owned narrow injections that do not yet have correct standalone package sources.
7. Remove the direct script runner's stale loose `service-skills` path.

The implementation helper should stay equivalent to:

```ts
for (const source of extensionSources) args.push('-e', source)
```

### Phase 3: configuration adoption

1. Add the exact Service Knowledge npm source to `service-knowledge-sync.specialist.json`.
2. Add other standalone sources only to specialists that need them.
3. Use `~/.config/specialists/user.json` for user-specific enables, disables, or local development sources.
4. Do not add the whole `@jaggerxtrm/pi-extensions` package source to reach one narrow extension.

### Phase 4: validation

1. Schema tests for source-string keys, boolean values, and legacy Serena behavior.
2. Layer-merge tests proving user fields can enable and disable individual sources without replacing siblings.
3. `PiAgentSession` argv tests proving ordered enabled sources produce repeated `-e` pairs after `--no-extensions`.
4. Direct `script-runner` argv tests proving exact parity with `PiAgentSession`.
5. Disabled and omitted source tests proving no `-e` pair is added.
6. Local package smoke proving Pi resolves a package root and its native `pi.extensions` entry.
7. Argv tests proving a remote source omits `--offline`, while local-only and empty source lists retain it.
8. A clean-cache npm/git smoke proving Pi can natively install and load the configured package source.
9. Regression tests proving runtime-owned boundary, read-line-numbers, Quality Gates, and narrow Python Kernel behavior remain.

## 7. What does not need to change

- **Core `xt pi --role`:** no change. It already delegates extension discovery to Pi and preserves global settings (`cli/src/utils/worktree-session.ts:1014-1028`, `:2151-2167`).
- **Pi:** no change. Native `-e` resolution already supports path, npm, and git sources with `--no-extensions`.
- **Pi settings generation:** no change. Do not create a settings file or alter `HOME` or `PI_CODING_AGENT_DIR`.
- **Specialists global configuration format:** no new file. Reuse `~/.config/specialists/user.json` and its existing per-specialist override shape.
- **Descriptor registry:** none. Do not add descriptor IDs, trust records, metadata precedence, package-root probing, or custom health states.
- **Core extension bundle:** no change and no new vendoring. Do not add imports to `packages/pi-extensions/src/registry.ts`.
- **Tool catalog:** no generic extension inventory. It remains responsible only for known tool permission and contract state.
- **Package publication:** not required for local-source testing; stable shared manifests should use proper published or git package sources.
- **Existing runtime-owned injections:** no forced migration until each has a correct standalone Pi source.
- **`xt` CLI flags:** no new flag.

## 8. Risk and blast radius

GitNexus reports `PiAgentSession` as **HIGH** upstream risk: 8 direct dependents, 182 impacted items through depth 3, and affected `run`/`runSingleAttempt` processes. Direct dependents include `runner.ts`, `script-runner.ts`, `supervisor.ts`, and session/runner tests. The later implementation must warn before editing, keep the change additive, and run both focused session tests and an integrated dispatch smoke.

Security risk is higher than the code size suggests: an extension executes arbitrary code with the user's permissions and is not constrained by `--tools`. Treat canonical specialist manifests and existing user override configuration as executable configuration; do not populate extension sources from task or model input.

## 9. Explicit unknowns

- The original failing launch command, installed versions, inherited environment, cwd, registry path, Pi startup diagnostics, and job/session log were not supplied. The exact live failure path cannot be proven from source.
- If the failure was current `xt pi --role`, config isolation is not the source-backed cause.
- Pi loader behavior after an extension throws during static import was not verified with a live probe. This design intentionally leaves that failure to Pi's native diagnostics rather than adding a Specialists preflight resolver.
- No generator for `config/catalog/index.json` was found in the inspected runtime path. This design does not depend on individual catalog files being merged.
- The supported source does not contain a literal `.specialists.json` manifest. Implementation should use the existing `*.specialist.json` and `.specialists/user/<name>.specialist.json` surfaces unless a separate manifest migration is approved.
- Whole-bundle Core injection has unresolved duplicate tool/hook behavior. Configure standalone package sources only; keep narrow runtime-owned entries until such packages exist.
- Direct `script-runner` and `sp serve` parity must ship with the same enabled-source list; leaving that path unchanged would preserve the gap.
