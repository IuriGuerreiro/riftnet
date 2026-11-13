# Developers, SDKs and plugins (ideas)

## Official SDKs

Discord has official Social and Embedded App SDKs, but **no official bot SDKs**: those are all community-made. We ship official ones.

- Rust core with bindings: `napi-rs` (Node), `pyo3` (Python), `uniffi` (mobile), WASM, C FFI.
- Spec-first: public `.proto` / OpenAPI files → codegen for types and REST in any language.

## WASM plugins (our strongest differentiator)

- Run **inside the node**, sandboxed with `wasmtime`.
- Bot owners don't need their own server.

## Extras

- Visual editor to build bots without code.
- Marketplace for community plugins/bots (possible commission).
- `cli dev` local mode, interactive docs, themes/CSS as plugins.

## Open questions

- What APIs a plugin can call, and limits (CPU, memory, network).
- Custom CSS security: visual phishing, data leaks through URLs.
