import fs from 'fs-extra';
import path from 'path';

/**
 * Finds the jaggers-agent-tools repo root by walking up from the start directory.
 * Looks for marker files/directories: skills/ and hooks/
 * @param startDir - The directory to start searching from (defaults to process.cwd())
 * @returns The absolute path to the repo root
 * @throws Error if repo root cannot be found
 */
export async function findRepoRoot(startDir: string = process.cwd()): Promise<string> {
    let dir = path.resolve(startDir);
    
    while (true) {
        const skillsPath = path.join(dir, 'skills');
        const hooksPath = path.join(dir, 'hooks');
        
        if (await fs.pathExists(skillsPath) && await fs.pathExists(hooksPath)) {
            return dir;
        }
        
        const parent = path.dirname(dir);
        if (parent === dir) {
            throw new Error('Could not locate jaggers-agent-tools repo root. Run from within the cloned repository.');
        }
        dir = parent;
    }
}
