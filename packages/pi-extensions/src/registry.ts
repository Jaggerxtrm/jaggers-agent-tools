import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import manifest from "./manifest.json" with { type: "json" };
import autoSessionNameExtension from "./extensions/auto-session-name.ts";
import beadsExtension from "./extensions/beads.ts";
import compactHeaderExtension from "./extensions/compact-header.ts";
import customFooterExtension from "./extensions/custom-footer.ts";
import customProviderQwenCliExtension from "./extensions/custom-provider-qwen-cli.ts";
import gitCheckpointExtension from "./extensions/git-checkpoint.ts";
import lspBootstrapExtension from "./extensions/lsp-bootstrap.ts";
import pythonKernelExtension from "./extensions/python-kernel.ts";
import piSerenaCompactExtension from "./extensions/pi-serena-compact.ts";
import serenaPoolExtension from "./extensions/serena-pool.ts";
import qualityGatesExtension from "./extensions/quality-gates.ts";
import readLineNumbersExtension from "./extensions/read-line-numbers.ts";
import serviceSkillsExtension from "./extensions/service-skills.ts";
import sessionFlowExtension from "./extensions/session-flow.ts";
import spTerminalOverlayExtension from "./extensions/sp-terminal-overlay.ts";
import xtrmLoaderExtension from "./extensions/xtrm-loader.ts";
import xtrmUiExtension from "./extensions/xtrm-ui.ts";
import xtpromptExtension from "./extensions/xtprompt.ts";

export type ManagedPiExtension = {
  readonly id: string;
  readonly register: (pi: ExtensionAPI) => void;
};

const availableManagedPiExtensions: readonly ManagedPiExtension[] = [
  { id: "auto-session-name", register: autoSessionNameExtension },
  { id: "beads", register: beadsExtension },
  { id: "compact-header", register: compactHeaderExtension },
  { id: "custom-footer", register: customFooterExtension },
  { id: "custom-provider-qwen-cli", register: customProviderQwenCliExtension },
  { id: "git-checkpoint", register: gitCheckpointExtension },
  { id: "lsp-bootstrap", register: lspBootstrapExtension },
  { id: "python-kernel", register: pythonKernelExtension },
  { id: "pi-serena-compact", register: piSerenaCompactExtension },
  { id: "quality-gates", register: qualityGatesExtension },
  { id: "read-line-numbers", register: readLineNumbersExtension },
  { id: "serena-pool", register: serenaPoolExtension },
  { id: "service-skills", register: serviceSkillsExtension },
  { id: "session-flow", register: sessionFlowExtension },
  { id: "sp-terminal-overlay", register: spTerminalOverlayExtension },
  { id: "xtrm-loader", register: xtrmLoaderExtension },
  { id: "xtrm-ui", register: xtrmUiExtension },
  { id: "xtprompt", register: xtpromptExtension },
];

const extensionsById = new Map(availableManagedPiExtensions.map((extension) => [extension.id, extension]));

export const managedPiExtensions: readonly ManagedPiExtension[] = manifest.active.map(({ id }) => {
  const extension = extensionsById.get(id);
  if (!extension) {
    throw new Error(`[pi-extensions] Active manifest entry '${id}' has no registry entry`);
  }
  return extension;
});

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
