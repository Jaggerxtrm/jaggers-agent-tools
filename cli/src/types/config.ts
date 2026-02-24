import { z } from 'zod';

export const SyncModeSchema = z.enum(['copy', 'symlink', 'prune']);
export type SyncMode = z.infer<typeof SyncModeSchema>;

export const TargetConfigSchema = z.object({
    label: z.string(),
    path: z.string(),
    exists: z.boolean(),
});
export type TargetConfig = z.infer<typeof TargetConfigSchema>;

export const ChangeSetCategorySchema = z.object({
    missing: z.array(z.string()),
    outdated: z.array(z.string()),
    drifted: z.array(z.string()),
    total: z.number(),
});
export type ChangeSetCategory = z.infer<typeof ChangeSetCategorySchema>;

export const ChangeSetSchema = z.object({
    skills: ChangeSetCategorySchema,
    hooks: ChangeSetCategorySchema,
    config: ChangeSetCategorySchema,
    commands: ChangeSetCategorySchema,
    'qwen-commands': ChangeSetCategorySchema,
    'antigravity-workflows': ChangeSetCategorySchema,
});
export type ChangeSet = z.infer<typeof ChangeSetSchema>;

export const SyncPlanSchema = z.object({
    mode: SyncModeSchema,
    targets: z.array(z.string()),
});
export type SyncPlan = z.infer<typeof SyncPlanSchema>;

export const ManifestItemSchema = z.object({
    type: z.enum(['skill', 'hook', 'config', 'command']),
    name: z.string(),
    hash: z.string(),
    lastSync: z.string(),
    source: z.string(),
});
export type ManifestItem = z.infer<typeof ManifestItemSchema>;

export const ManifestSchema = z.object({
    version: z.string().optional().default('1'),
    lastSync: z.string(),
    items: z.number().optional().default(0),
});
export type Manifest = z.infer<typeof ManifestSchema>;
