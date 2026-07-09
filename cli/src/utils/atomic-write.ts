import fs from 'fs-extra';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Atomically write JSON to a target path.
 * - Rejects if targetPath's parent dir is a symlink pointing outside its expected root.
 * - Writes to a same-directory temp file, then rename (POSIX-atomic on same filesystem).
 * - Trailing newline is written as part of the same buffer, not a separate append.
 *
 * expectedRoot (optional): if provided, the realpath of dirname(targetPath) must be a
 * descendant of the realpath of expectedRoot. Missing parents are created before the
 * check; the check runs after parent creation so a freshly-ensured tree is valid.
 */
export async function writeJsonAtomic(
    targetPath: string,
    data: unknown,
    opts: { spaces?: number; expectedRoot?: string } = {},
): Promise<void> {
    const { spaces = 2, expectedRoot } = opts;
    const parentDir = path.dirname(targetPath);

    await fs.ensureDir(parentDir);

    if (expectedRoot) {
        const [realParent, realRoot] = await Promise.all([
            fs.realpath(parentDir),
            fs.realpath(expectedRoot).catch(() => null),
        ]);
        if (realRoot === null) {
            throw new Error(`Refusing to write ${targetPath}: expectedRoot ${expectedRoot} does not exist`);
        }
        const rel = path.relative(realRoot, realParent);
        if (rel !== '' && (rel.startsWith('..') || path.isAbsolute(rel))) {
            throw new Error(
                `Refusing to write ${targetPath}: resolved parent ${realParent} escapes expectedRoot ${realRoot}`,
            );
        }
    }

    const suffix = `.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    const tmpPath = `${targetPath}${suffix}`;
    const payload = `${JSON.stringify(data, null, spaces)}\n`;

    try {
        await fs.writeFile(tmpPath, payload, 'utf8');
        await fs.rename(tmpPath, targetPath);
    } catch (err) {
        await fs.remove(tmpPath).catch(() => undefined);
        throw err;
    }
}
