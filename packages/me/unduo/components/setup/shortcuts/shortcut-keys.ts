import type { SetupPage } from "@-/me.unduo.components.setup.entities";
import { kbd, span } from "@-/me.unduo.lib.dom";

/** A keyboard shortcut: this device's modifier key, then `letter`. */
export function shortcutKeys({ view }: SetupPage, letter: string) {
  return kbd({ class: "key" }, span(van.derive(() => view.val.shortcut)), letter);
}
