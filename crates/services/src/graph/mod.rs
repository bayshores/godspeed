//! The graph services: the
//! one extraction pipeline and its run registry, the graph reads and node deletion, topic-grouping
//! scheduling, and the progress payload.

pub mod extraction;
pub mod extraction_runs;
#[expect(clippy::module_inception, reason = "the file that holds the folder's main job carries the folder's name")]
pub mod graph;
pub mod progress;
pub mod study_start;
pub mod topics;

use gs_agent::extraction::extraction::ExtractionState;

/// The graph services' live state inside `App`.
#[derive(Default)]
pub struct GraphState {
	/// The pipeline's run registry and its graph lock.
	extraction: ExtractionState,
	topics: topics::TopicGrouping,
	/// Each lesson's progress readout while its record file is unchanged.
	readouts: progress::Readouts,
}
