//! The constants and checks from src/shared/core/contracts/{chat,class,graph}.ts that every part
//! uses. Record shapes stay `Json` (see docs/rust-server.md); contracts/jobs.ts, plan.ts and
//! probe.ts functions live with the session logic (crate::session).

pub mod chat;
pub mod class;
pub mod graph;
