import fs from 'fs-extra';
import { z } from 'zod';
import { SKILLS_STATE_SCHEMA_VERSION, type SkillsRuntime, resolveDefaultTierRoot, resolveOptionalTierRoot, resolveStateFilePath, resolveUserPacksRoot } from './skills-layout.js';

const runtimeEnabledPacksSchema = z.object({
  claude: z.array(z.string().min(1)).default([]),
  pi: z.array(z.string().min(1)).default([]),
});

export function isSafeRuntimeLinkName(name: string): boolean {
  if (name.length === 0 || name.includes('\0') || /[\\/]/.test(name)) return false;
  return name !== '.' && name !== '..';
}

export function assertSafeRuntimeLinkName(name: string): void {
  if (!isSafeRuntimeLinkName(name)) {
    throw new Error(`Unsafe runtime skill name '${name}': expected a single path basename.`);
  }
}

const managedLinksMapSchema = z.record(z.string(), z.string()).superRefine((links, context) => {
  for (const name of Object.keys(links)) {
    if (!isSafeRuntimeLinkName(name)) {
      context.addIssue({
        code: 'custom',
        path: [name],
        message: 'must be a single path basename without separators, dot segments, or NUL bytes',
      });
    }
  }
});
const managedLinksSchema = z.object({
  claude: managedLinksMapSchema.default({}),
  pi: managedLinksMapSchema.default({}),
});
const skillsStateSchema = z.object({
  schemaVersion: z.union([z.literal('1'), z.literal(SKILLS_STATE_SCHEMA_VERSION)]),
  enabledPacks: runtimeEnabledPacksSchema,
  managedLinks: managedLinksSchema.default({ claude: {}, pi: {} }),
  installedVersion: z.string().min(1).optional(),
  installedFrom: z.string().min(1).optional(),
  installedAt: z.string().datetime().optional(),
});

export type ManagedLinks = { claude: Record<string, string>; pi: Record<string, string> };
export type SkillsState = z.infer<typeof skillsStateSchema>;

function normalizePackList(names: readonly string[]): string[] {
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}
type SkillsStateInput = Omit<SkillsState, 'managedLinks'> & { managedLinks?: ManagedLinks };

function normalizeState(state: SkillsStateInput): SkillsState {
  return {
    ...state,
    schemaVersion: SKILLS_STATE_SCHEMA_VERSION,
    enabledPacks: { claude: normalizePackList(state.enabledPacks.claude), pi: normalizePackList(state.enabledPacks.pi) },
    managedLinks: { claude: { ...(state.managedLinks?.claude ?? {}) }, pi: { ...(state.managedLinks?.pi ?? {}) } },
  };
}

export function createDefaultSkillsState(): SkillsState {
  return { schemaVersion: SKILLS_STATE_SCHEMA_VERSION, enabledPacks: { claude: [], pi: [] }, managedLinks: { claude: {}, pi: {} } };
}

export async function ensureSkillsTreeStructure(skillsRoot: string): Promise<void> {
  await fs.ensureDir(resolveDefaultTierRoot(skillsRoot));
  await fs.ensureDir(resolveOptionalTierRoot(skillsRoot));
  await fs.ensureDir(resolveUserPacksRoot(skillsRoot));
}

export async function writeSkillsState(skillsRoot: string, state: SkillsStateInput): Promise<SkillsState> {
  const validated = normalizeState(skillsStateSchema.parse(state));
  await ensureSkillsTreeStructure(skillsRoot);
  const statePath = resolveStateFilePath(skillsRoot);
  await fs.writeJson(statePath, validated, { spaces: 2 });
  await fs.appendFile(statePath, '\n');
  return validated;
}

export async function readSkillsState(skillsRoot: string): Promise<SkillsState> {
  const statePath = resolveStateFilePath(skillsRoot);
  if (!await fs.pathExists(statePath)) return writeSkillsState(skillsRoot, createDefaultSkillsState());
  const raw = await fs.readJson(statePath);
  const parsed = skillsStateSchema.safeParse(raw);
  if (parsed.success) {
    await ensureSkillsTreeStructure(skillsRoot);
    return normalizeState(parsed.data);
  }
  const hasManagedLinks = typeof raw === 'object' && raw !== null && Object.prototype.hasOwnProperty.call(raw, 'managedLinks');
  const legacy = z.object({ schemaVersion: z.union([z.literal('1'), z.literal(SKILLS_STATE_SCHEMA_VERSION)]), enabledPacks: runtimeEnabledPacksSchema }).safeParse(raw);
  if (hasManagedLinks || !legacy.success) throw new Error(`Invalid skills state at ${statePath}: ${parsed.error.message}`);
  return writeSkillsState(skillsRoot, { schemaVersion: SKILLS_STATE_SCHEMA_VERSION, enabledPacks: legacy.data.enabledPacks, managedLinks: { claude: {}, pi: {} } });
}

export async function setRuntimeEnabledPacks(skillsRoot: string, runtime: SkillsRuntime, packNames: readonly string[]): Promise<SkillsState> {
  const state = await readSkillsState(skillsRoot);
  return writeSkillsState(skillsRoot, { ...state, enabledPacks: { ...state.enabledPacks, [runtime]: normalizePackList(packNames) } });
}
