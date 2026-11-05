import { startSetupPage } from "@-/me.unduo.components.setup";
import { loadJsSetupPlugin, loadSetupPlugin } from "@-/me.unduo.components.setup.plugin";

// An experimental build (UNDUO_JS_PLUGIN=1) runs the TypeScript port of the setup
// logic in this script and loads no WebAssembly; the bundler drops the loader it doesn't use.
const { pluginUrl, pluginIntegrity } = import.meta.env.UNDUO_JS_PLUGIN
  ? {}
  : document.getElementById("root")!.dataset;
// Start fetching the plugin while the page renders; Advanced can reload it with other limits.
startSetupPage(
  import.meta.env.UNDUO_JS_PLUGIN
    ? loadJsSetupPlugin
    : (limits) => loadSetupPlugin(pluginUrl!, pluginIntegrity!, limits),
);
