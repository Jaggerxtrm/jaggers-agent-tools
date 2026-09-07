/**
 * Side-effect-free predicate deciding whether the test harness must fail
 * closed on a stale host-global /tmp/.git (fae security SEC-02).
 *
 * Exempts ONLY the runner whose cwd is EXACTLY the temp root — the one case
 * where /tmp/.git legitimately belongs to the project. ANY other cwd (a
 * project under /tmp included) must be guarded: a stale /tmp/.git makes git
 * treat /tmp as a project root, and the harness never mutates the host.
 */
export function needsTmpGitGuard(cwd: string, tmpRoot: string): boolean {
    return cwd !== tmpRoot;
}
