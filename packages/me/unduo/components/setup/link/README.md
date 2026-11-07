# @-/me.unduo.components.setup.link

The QR input step. `linkStep(page, school)` builds it from a `SetupPage` and the institution's details, whose `duoPrompt` picks the portal instructions. The root API exports the `LinkBusy` type from the nested `+entities` package. Pastes anywhere on the page, drops and uploads go to the setup page's host, which passes them to the plugin without parsing them; the plugin finds a copied image's `<img src>` in its HTML.
