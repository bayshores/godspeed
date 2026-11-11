//! Class search: the embedding model, BM25 keyword ranking, fusion and the stored index tables.
//! Servers call `index::Search`; the other public modules are its parts, kept public for parity tests.

pub mod chunks;
pub mod keyword;
pub mod fusion;
pub mod embed;
pub mod index;
mod passages;
mod facts;
mod log;
mod table;
