import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'fs-extra';

interface RegistryFileEntry {
    hash: string;
    version: string;
}

interface RegistryAsset {
    source_dir: string;
    install_mode: 'copy' | 'symlink';
    files: Record<string, RegistryFileEntry>;
}

interface RegistryManifest {
    version: string;
    assets: Record<string, RegistryAsset>;
}

export interface DriftReport {
    missing: string[];
    upToDate: string[];
    drifted: string[];
}

function toPosix(value: string): string {
    return value.split(path.sep).join('/');
}

function stripXtrmPrefix(sourceDir: string): string {
    return sourceDir.replace(/^\.xtrm\/?/, '');
}

function buildUserRelativePath(sourceDir: string, filePath: string): string {
    return toPosix(path.posix.join(stripXtrmPrefix(sourceDir), filePath));
}

async function hashFile(filePath: string): Promise<string> {
    const content = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
}

export async function checkDrift(
    registryPath: string,
    userXtrmDir: string,
    overrideRoots?: Record<string, string>,
): Promise<DriftReport> {
    const registry = await fs.readJson(registryPath) as RegistryManifest;

    const missing: string[] = [];
    const upToDate: string[] = [];
    const drifted: string[] = [];

    for (const [assetKey, asset] of Object.entries(registry.assets)) {
        const assetRoot = overrideRoots?.[assetKey];
        for (const [filePath, entry] of Object.entries(asset.files)) {
            const relativePath = buildUserRelativePath(asset.source_dir, filePath);
            const userFilePath = assetRoot
                ? path.join(assetRoot, filePath)
                : path.join(userXtrmDir, relativePath);

            if (!await fs.pathExists(userFilePath)) {
                missing.push(relativePath);
                continue;
            }

            const userHash = await hashFile(userFilePath);
            if (userHash === entry.hash) {
                upToDate.push(relativePath);
            } else {
                drifted.push(relativePath);
            }
        }
    }

    return {
        missing: missing.sort(),
        upToDate: upToDate.sort(),
        drifted: drifted.sort(),
    };
}
