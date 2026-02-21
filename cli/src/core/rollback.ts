import fs from 'fs-extra';

export interface BackupInfo {
    originalPath: string;
    backupPath: string;
    timestamp: Date;
}

export async function createBackup(filePath: string): Promise<BackupInfo> {
    const timestamp = Date.now();
    const backupPath = `${filePath}.backup-${timestamp}`;

    if (await fs.pathExists(filePath)) {
        await fs.copy(filePath, backupPath);
    }

    return {
        originalPath: filePath,
        backupPath,
        timestamp: new Date(),
    };
}

export async function restoreBackup(backup: BackupInfo): Promise<void> {
    if (await fs.pathExists(backup.backupPath)) {
        await fs.move(backup.backupPath, backup.originalPath, { overwrite: true });
    }
}

export async function cleanupBackup(backup: BackupInfo): Promise<void> {
    await fs.remove(backup.backupPath);
}
