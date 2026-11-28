//! Graph extraction: the extractor and its pipeline, the run registry, the
//! single-submit agent seam, the topic grouper, and the graph ports over the stores.

mod context;
mod duplicate_check;
#[expect(clippy::module_inception, reason = "modules are named after their TypeScript files, so graph/graph.ts is graph::graph")]
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

