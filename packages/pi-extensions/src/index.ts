import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerManagedPiExtensions } from "./registry.ts";

export { managedPiExtensions, registerManagedPiExtensions } from "./registry.ts";

export default function registerXtrmPiExtensions(pi: ExtensionAPI): void {
  registerManagedPiExtensions(pi);
}
