//! Preps (preps.ts, prep-runs.ts and the mocks): a space made to get ready for one thing, its
//! prep sheet, its timed mocks, and the agent requests behind them.

pub mod mock_end;
pub mod mock_runner;
pub mod mocks;
pub mod prep_runs;
#[allow(clippy::module_inception)]
pub mod preps;

/// The live state inside `App`.
#[derive(Default)]
pub struct PrepsState {
	pub(crate) runs: prep_runs::PrepRunsState,
}
