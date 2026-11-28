//! How a service call that has no value to return ends: a refusal the route answers with its
//! status, or a throw.

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

pub(crate) fn refuse<T>(status: u16, error: impl Into<String>) -> Outcome<T> {
	Err(Stop::Refuse(status, error.into()))
}
