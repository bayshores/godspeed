//! The knowledge graph: merging ledgers, chains, clusters, coverage, deletion and topics.

pub mod chains;
pub mod clusters;
pub mod coverage;
pub mod duplicates;
#[expect(clippy::module_inception, reason = "the file that holds the folder's main job carries the folder's name")]
pub mod graph;
pub mod graph_deletion;
pub mod ledger_lines;
#[cfg(feature = "test-support")]
pub mod memory;
mod merge;
mod ordered;
pub mod ports;
pub mod session_clusters;
mod simplify;
pub mod topics;
