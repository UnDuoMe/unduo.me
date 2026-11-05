//! unduo's setup flow as a sandboxed Extism plugin. Its only imports are
//! Extism's kernel functions, so it can only return values. Its one export,
//! `update`, gets browser events as JSON, with the text of the QR codes the page
//! read itself rather than pixels. The page's guard (`components/setup/plugin/setup-plugin.ts`) checks every
//! output, including the URL hash, the Duo form and the authenticator link.

pub mod activation;
pub mod core;
pub mod html;
#[cfg(feature = "qr-reader")]
pub mod qr;
pub mod request;
pub mod response;
pub mod state;

#[cfg(target_arch = "wasm32")]
mod exports {
    use crate::core::{Event, Model, Output};
    use extism_pdk::{FnResult, Json, plugin_fn};
    use std::sync::Mutex;

    /// The page's state lives here, in the plugin's own memory, between calls.
    static MODEL: Mutex<Option<Model>> = Mutex::new(None);

    fn with_model(apply: impl FnOnce(&mut Model) -> Output) -> Output {
        let mut model = MODEL.lock().unwrap();
        apply(model.get_or_insert_with(Model::default))
    }

    /// A browser event as JSON → `{ view, effects }`.
    #[plugin_fn]
    pub fn update(Json(event): Json<Event>) -> FnResult<Json<Output>> {
        Ok(Json(with_model(|model| crate::core::update(model, event))))
    }

    /// Width and height as little-endian u32s, then one byte of gray per pixel
    /// → the text of each QR code in it. The pixels are wiped once read. Only
    /// with the `qr-reader` feature: the published module doesn't have it.
    #[cfg(feature = "qr-reader")]
    #[plugin_fn]
    pub fn read(mut input: Vec<u8>) -> FnResult<Json<Vec<String>>> {
        let texts = crate::qr::read_input(&input);
        input.fill(0);
        Ok(Json(texts))
    }
}
