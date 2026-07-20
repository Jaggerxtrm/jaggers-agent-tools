import { defineConfig } from 'vitest/config';

// xtrm-on2mk: repo-root config exists solely to prevent `npx vitest run`
// (invoked from repo root by mistake) from globbing test files across every
// .xtrm/worktrees/*/cli/src/tests/ tree — which would otherwise multiply
// any failure by the number of worktrees present. The canonical entry point
// is `npm test --workspace cli` (see CLAUDE.md); this is a safety net.
export default defineConfig({
  test: {
    include: ['cli/src/**/*.test.ts', 'cli/test/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '.xtrm/worktrees/**',
      '.git/**',
    ],
  },
});
