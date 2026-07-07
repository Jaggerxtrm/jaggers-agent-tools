import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import autoSessionNameExtension from "./extensions/auto-session-name.ts";
import autoUpdateExtension from "./extensions/auto-update.ts";
import beadsExtension from "./extensions/beads.ts";
import compactHeaderExtension from "./extensions/compact-header.ts";
import customFooterExtension from "./extensions/custom-footer.ts";
import customProviderQwenCliExtension from "./extensions/custom-provider-qwen-cli.ts";
import gitCheckpointExtension from "./extensions/git-checkpoint.ts";
import lspBootstrapExtension from "./extensions/lsp-bootstrap.ts";
import serenaPoolExtension from "./extensions/serena-pool.ts";
import qualityGatesExtension from "./extensions/quality-gates.ts";
import serviceSkillsExtension from "./extensions/service-skills.ts";
import sessionFlowExtension from "./extensions/session-flow.ts";
import spTerminalOverlayExtension from "./extensions/sp-terminal-overlay.ts";
import xtrmLoaderExtension from "./extensions/xtrm-loader.ts";
import xtrmUiExtension from "./extensions/xtrm-ui.ts";
import xtpromptExtension from "./extensions/xtprompt/index.ts";

export type ManagedPiExtension = {
  readonly id: string;
  readonly register: (pi: ExtensionAPI) => void;
};

const allManagedPiExtensions: readonly ManagedPiExtension[] = [
  { id: "auto-session-name", register: autoSessionNameExtension },
  { id: "auto-update", register: autoUpdateExtension },
  { id: "beads", register: beadsExtension },
  { id: "compact-header", register: compactHeaderExtension },
  { id: "custom-footer", register: customFooterExtension },
  { id: "custom-provider-qwen-cli", register: customProviderQwenCliExtension },
  { id: "git-checkpoint", register: gitCheckpointExtension },
  { id: "serena-pool", register: serenaPoolExtension },
  { id: "lsp-bootstrap", register: lspBootstrapExtension },
  { id: "quality-gates", register: qualityGatesExtension },
  { id: "service-skills", register: serviceSkillsExtension },
  { id: "session-flow", register: sessionFlowExtension },
  { id: "sp-terminal-overlay", register: spTerminalOverlayExtension },
  { id: "xtrm-loader", register: xtrmLoaderExtension },
  { id: "xtrm-ui", register: xtrmUiExtension },
  { id: "xtprompt", register: xtpromptExtension },
];

// Extensions disabled by default. Source preserved in ./extensions/ — remove an
// id from this set to re-enable. (xtrm-e2vkn)
// - quality-gates: hook-script lookup (.claude/hooks/quality-check.*) is broken
//   under the managed .xtrm/hooks layout, so it never fires. Disabled until
const DISABLED_EXTENSIONS = new Set<string>(["quality-gates"]);

export const managedPiExtensions: readonly ManagedPiExtension[] = allManagedPiExtensions.filter(
    (extension) => !DISABLED_EXTENSIONS.has(extension.id),
);

function registerManagedExtension(pi: ExtensionAPI, extension: ManagedPiExtension): void {
  try {
    extension.register(pi);
  } catch (error) {
    console.warn(`[pi-extensions] Failed to register '${extension.id}':`, error);
  }
}

export function registerManagedPiExtensions(pi: ExtensionAPI): void {
  for (const extension of managedPiExtensions) {
    registerManagedExtension(pi, extension);
  }
}
