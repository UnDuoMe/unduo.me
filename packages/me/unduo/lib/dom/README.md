# @-/me.unduo.lib.dom

The elements and state the pages build their UI from, on VanJS. Import element functions such as `div` and `button`, and `van` for `van.state`, `van.derive` and `van.add`.

Read `state.val` only inside a function given as a property or child, or inside `van.derive`, because a function that reads it runs again when it changes. A function that builds a step must not read it directly, or every update would rebuild the step and lose its focus. Use `van.derive` for changing text, which replaces a text node only when the text differs. A child function must return a node or a string, because VanJS drops a binding that returns null.

VanJS sets a property where the element has one and otherwise calls `setAttribute`, so a null value doesn't remove an attribute. Give `aria-*` and `data-*` attributes a string for every state, and use the `hidden` property to hide an element, whose display rule beats the important utility classes.

Everything visible on a page is built this way, so a page's HTML holds only what the build must write. The build writes that with `attributes` and `escapeText` from `@-/me.unduo.lib.dom/server`, which the browser's script never contains.
