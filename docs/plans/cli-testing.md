# Testing Plan: CLI TypeScript Migration

## Goal
Add a Vitest unit test suite to the `cli/` package, covering the core modules introduced during the TypeScript migration.

## Setup Required

```bash
cd cli
# vitest and @types/fs-extra already in devDependencies
# Just create the config and test files
```

### `cli/vitest.config.ts`
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/commands/**'],
      thresholds: { lines: 70, functions: 70 },
    },
  },
});
```

## Test Files to Create

### 1. `cli/test/unit/adapters/registry.test.ts`
Test `detectAdapter()` returns the right adapter class for each path pattern.

```
✓ ~/.claude → ClaudeAdapter
✓ ~/.gemini → GeminiAdapter
✓ ~/.qwen   → QwenAdapter
✓ C:\Users\foo\AppData\Claude → ClaudeAdapter (Windows path)
✓ unknown path → null
```

### 2. `cli/test/unit/core/diff.test.ts`
Test `calculateDiff()` categorisation logic using a mocked `fs-extra` + `hash.ts`.

```
✓ item missing on system → goes into "missing"
✓ hashes match → not in any category
✓ repo newer (mtime) → goes into "outdated"
✓ system newer (mtime > repo + 2s) → goes into "drifted"
```

### 3. `cli/test/unit/utils/atomic-config.test.ts`
Test `deepMergeWithProtection()` and `atomicWrite()`.

```
✓ Protected key in original preserved when update has same key
✓ Non-protected key in original overwritten by update
✓ mcpServers: local servers preserved, new repo servers added
✓ atomicWrite: temp file cleaned up on error
✓ atomicWrite: rename is atomic (no partial write)
```

### 4. `cli/test/unit/utils/config-adapter.test.ts`
Test `EnvVarTransformer` and `ConfigAdapter`.

```
✓ claude→cursor: ${VAR} becomes ${env:VAR}
✓ cursor→claude: ${env:VAR} becomes ${VAR}
✓ resolvePath: ~/foo → /home/user/foo
✓ resolvePath (Windows): backslashes → forward slashes
✓ adaptMcpConfig: env vars resolved, paths normalized
✓ resolveHookScripts: uses 'python3' on Linux, 'python' on Windows
```

## Running Tests

```bash
cd cli
npm test                    # run all tests
npm test -- --coverage      # with coverage report
npm test -- --watch         # watch mode during development
```

## Notes
- Use `vi.mock('fs-extra')` for filesystem isolation in diff tests
- Use `vi.stubEnv()` for env var tests in config-adapter
- Use `vi.spyOn(process, 'platform', 'get')` to test Windows code paths
- No integration tests needed at this stage — the e2e sync acts as the integration test
