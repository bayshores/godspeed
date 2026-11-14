//! Mocks: practice runs of a space's exam, quiz or interview deadline. The teacher writes the
//! questions and grades the answers (one agent request each, `mock_runs`); the learner takes the
//! mock with no agent, with or without a time limit (`mocks`, `mock_end`), and runs code
//! answers on this computer (`mock_runner`).

pub mod mock_end;
pub mod mock_runner;
pub mod mock_runs;
#[allow(clippy::module_inception)]
pub mod mocks;

/// The live state inside `App`.
#[derive(Default)]
pub struct MocksState {
	pub(crate) runs: mock_runs::MockRunsState,
}

/// Why a call did not finish: a refusal the route answers with its status, or a throw (the
/// route's empty 500).
#[derive(Debug, PartialEq)]
pub enum Stop {
	Refuse(u16, String),
	Throw(String),
}

impl From<String> for Stop {
	fn from(message: String) -> Stop {
		Stop::Throw(message)
	}
}

pub type Outcome<T> = Result<T, Stop>;

pub fn fail<T>(status: u16, error: impl Into<String>) -> Outcome<T> {
	Err(Stop::Refuse(status, error.into()))
}
