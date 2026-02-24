import { createHash } from 'crypto';
import fs from 'fs-extra';
import { join } from 'path';

export async function hashFile(filePath: string): Promise<string> {
    const content = await fs.readFile(filePath);
    return createHash('md5').update(content).digest('hex');
}

export async function hashDirectory(dirPath: string): Promise<string> {
    if (!(await fs.pathExists(dirPath))) return '';
    const stats = await fs.stat(dirPath);

    if (!stats.isDirectory()) {
        return hashFile(dirPath);
    }

    const children = await fs.readdir(dirPath);
    const childHashes = await Promise.all(
        children.sort().map(async (child) => {
            const h = await hashDirectory(join(dirPath, child));
            return `${child}:${h}`;
        })
    );
    return createHash('md5').update(childHashes.join('|')).digest('hex');
}

export async function getNewestMtime(targetPath: string): Promise<number> {
    if (!(await fs.pathExists(targetPath))) return 0;

    const stats = await fs.stat(targetPath);
    let maxTime = 0;

    if (stats.isDirectory()) {
        const children = await fs.readdir(targetPath);
        for (const child of children) {
            const childTime = await getNewestMtime(join(targetPath, child));
            if (childTime > maxTime) maxTime = childTime;
        }
    }
    return maxTime;
}
