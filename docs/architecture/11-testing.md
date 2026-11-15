## 11. Testing

Tests are deterministic and use no network.

- Model is injected: `engine::turn::faux` scripts its replies.
- App clock (`gs_base::clock`) can be moved.
- Pure logic gets in-memory ports (`core::graph::memory`); service tests run real stores over a scratch data folder.
- Where Rust and TypeScript share a rule, both replay one golden file in `crates/core/tests/golden/`.

Test layout, golden files and contract scenarios: [development.md](../development.md) and [rust-server.md](../rust-server.md). `npm run check` must pass before a change is done.
