import { startSetupPage } from "@-/me.unduo.components.setup";
import { loadSetupPlugin } from "@-/me.unduo.components.setup.plugin";

const { pluginUrl, pluginIntegrity } = document.getElementById("root")!.dataset;
// Start fetching the plugin while the page renders; Advanced can reload it with other limits.
startSetupPage((limits) => loadSetupPlugin(pluginUrl!, pluginIntegrity!, limits));
