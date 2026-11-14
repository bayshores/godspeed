//! The server's pure logic. Records are `Json`; see docs/rust-server.md.

// Modules are named after their TS files, so graph/graph.ts is graph::graph.
#![allow(clippy::module_inception)]

pub mod contracts;
pub mod records;
pub mod messages;
pub mod session;
pub mod graph;
pub mod spaces;
pub mod study;
pub mod mocks;
