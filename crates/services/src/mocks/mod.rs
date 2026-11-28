//! Mocks: practice runs of a space's exam, quiz or interview deadline. The teacher writes the
//! questions and grades the answers (one agent request each, `mock_runs`); the learner takes the
//! mock with no agent, with or without a time limit (`mocks`, `mock_end`), and runs code
//! answers on this computer (`mock_runner`).

pub mod mock_end;
pub mod mock_runner;
pub mod mock_runs;
#[expect(clippy::module_inception, reason = "modules are named after their TypeScript files, so graph/graph.ts is graph::graph")]
pub mod mocks;

/// The live state inside `App`.
#[derive(Default)]
pub struct MocksState {
	pub(crate) runs: mock_runs::MockRunsState,
}
