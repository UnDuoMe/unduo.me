# @-/me.unduo.components.setup.plugin.entities

The messages between the setup page and its sandboxed Rust plugin: `SetupEvent`,
`SetupEffect`, `SetupView`, `SetupResult`, `DuoRequest`, `SetupAccountView`,
`SetupProgressStep` and the `SetupPlugin` call function. The plugin keeps its
own state, so the host never holds a model. They mirror the serde types in
`crates/setup/src/core.rs` and `request.rs`.
