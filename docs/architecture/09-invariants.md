## 9. Invariants

### Enforced by the build

| Rule | Gate |
|---|---|
| Import law (§2) | ESLint zone, `import/no-cycle`, Cargo |
| Time goes through the app clock (no `SystemTime::now`, no tokio timers), writes through atomic writers (no bare `fs::write`), nothing writes to stdout | `clippy.toml` |
| No `unsafe` outside shell's platform modules | `unsafe_code = "deny"` in workspace lints |
| Strict types, no silent indexing (`strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`) | `tsc --noEmit` |
| Rust warnings are errors; no crate declares an unused dependency | `cargo clippy -D warnings`, `cargo machete` (`npm run rust:check`) |
| No unused files, exports or packages | knip (`npm run deadcode`) |
| Prompt files are compiled into server | `include_str!` in `agent::teacher::prompts` |

### Kept by convention

| Rule |
|---|
| One composition root per concern: `App::new` with `Stores::new` for storage, `chat_handler` for a turn |
| One writer per store: merger for facts and chains (deletion and topic grouper are named exceptions, §6), job runner and wake pipeline for job records, spaces store for space records |
| Stores never decide: they persist and shape-guard; merging, deduping and derivation happen on reader's side, in core |
| Derived, never stored twice: snapshot, plan statuses, phases, costs, coverage are recomputed on read |
| Deterministic keys make reruns converge: steer ids, `arg_` chain ids, coverage fingerprints, source ids |
| Models judge, code does mechanics: grading, merging, fingerprints and layout are deterministic; a failed model step checkpoints nothing |
| Saved record is the only truth: agents are rebuilt from it each turn; no unanswered tool call reaches model |
| Side channels (extraction, usage, naming) swallow their own errors and never touch reply or save. The turn registry clears on every path |
| Absent is not zero: unreported tokens and missing levels show as absent, never made up |
| A model's tool input is checked against tool's JSON schema before tool runs (`engine::turn::validate`) |
| The learner's own notes are only read, except a note marked `godspeed: keep`. One writer, `services::vault::write`, writes the notes folder. Its record `vault-notes.json` is kept aside when damaged. A key or section the learner changed is never overwritten (§8.1.4) |
| Core barrel stays browser-safe (a doc comment, §2.1) |
| `window.lh` members are declared in `desktop-env.tsx` and `shim.js`, kept in step by hand |
