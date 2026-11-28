//! The server's pure logic. Records are `Json`; see docs/rust-server.md.

#![expect(clippy::module_inception, reason = "modules are named after their TypeScript files, so graph/graph.ts is graph::graph")]

pub mod contracts;
pub mod records;
pub mod messages;
pub mod session;
pub mod graph;
pub mod spaces;
pub mod study;
pub mod vault;
pub mod mocks;
