//! The graph services (src/backend/server/extraction.ts, graph.ts, topics.ts, progress.ts): the
//! one extraction pipeline and its run registry, the graph reads and node deletion, topic-grouping
//! scheduling, and the progress payload.

pub mod extraction;
pub mod extraction_runs;
#[allow(clippy::module_inception)]
pub mod graph;
pub mod progress;
pub mod topics;

use gs_agent::extraction::extraction::ExtractionState;
use gs_agent::subagents::bg_llm_semaphore::BgLlmSlots;

/// The graph services' live state inside `App`.
#[derive(Default)]
pub struct GraphState {
	/// The pipeline's run registry and its graph lock.
	extraction: ExtractionState,
	/// The background-model permits topic grouping runs under.
	bg_llm: BgLlmSlots,
	topics: topics::TopicGrouping,
	/// Each lesson's progress readout while its record file is unchanged.
	readouts: progress::Readouts,
}
