//! Graph extraction (src/backend/agent/subagents/extraction.ts, extraction-runs.ts,
//! submit-agent.ts, topic-grouper.ts): the extractor and its pipeline, the run registry, the
//! single-submit agent seam, the topic grouper, and the graph ports over the stores.

mod context;
#[allow(clippy::module_inception)]
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

