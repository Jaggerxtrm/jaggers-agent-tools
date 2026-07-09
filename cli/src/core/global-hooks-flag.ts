export function shouldUseGlobalHooks(): boolean {
  return process.env.XTRM_GLOBAL_HOOKS === '1';
}
