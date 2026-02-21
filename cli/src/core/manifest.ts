import fs from 'fs-extra';
import { join } from 'path';
import { Manifest, ManifestSchema } from '../types/config.js';

const MANIFEST_FILE = '.jaggers-sync-manifest.json';

export async function loadManifest(projectDir: string): Promise<Manifest | null> {
    const manifestPath = join(projectDir, MANIFEST_FILE);

    try {
        const content = await fs.readJson(manifestPath);
        // Let schema validation gracefully fail or handle legacy
        return ManifestSchema.parse(content) as Manifest;
    } catch {
        return null;
    }
}

export async function saveManifest(projectDir: string, manifest: any): Promise<void> {
    const manifestPath = join(projectDir, MANIFEST_FILE);
    await fs.writeJson(manifestPath, manifest, { spaces: 2 });
}
