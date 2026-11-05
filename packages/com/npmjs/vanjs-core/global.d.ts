import type { Van } from "vanjs-core";

declare global {
  /**
   * VanJS, which the page's own vanjs script element sets as `window.van` before
   * the page's code runs, in the dev server as in a build. Code uses it without
   * importing it, so no page's script holds a second copy of VanJS.
   */
  var van: Van;
}
