import { defineConfig } from 'vitest/config';

// Own config so this package's tests are discovered independently of the repo
// root config (which scopes to cli/** and excludes .xtrm/worktrees/**).
export default defineConfig({
    test: {
        include: ['test/**/*.test.ts'],
    },
});
