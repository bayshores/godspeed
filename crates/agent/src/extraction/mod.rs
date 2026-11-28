//! Graph extraction: the extractor and its pipeline, the run registry, the
//! single-submit agent seam, the topic grouper, and the graph ports over the stores.

mod context;
mod duplicate_check;
#[expect(clippy::module_inception, reason = "mod.rs only lists the folder's modules and re-exports, so the folder's main job sits in a file of its own")]
pub mod extraction;
pub mod extraction_runs;
mod findings;
#[cfg(test)]
mod golden_tests;
#[cfg(test)]
mod pipeline_tests;
pub mod ledgers;
pub mod submit_agent;
pub mod topic_grouper;

pub use extraction::NotesImportError;

