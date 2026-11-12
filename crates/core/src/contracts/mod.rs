//! The constants and checks from src/shared/core/contracts/{chat,space,graph}.ts that every part
//! uses. Record shapes stay `Json` (see docs/rust-server.md); contracts/jobs.ts, plan.ts and
//! probe.ts functions live with the session logic (crate::session).

pub mod chat;
pub mod space;
pub mod graph;
