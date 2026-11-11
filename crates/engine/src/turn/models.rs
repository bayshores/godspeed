//! The engine every lesson, job and pipeline stage runs on (src/backend/agent/models.ts): the
//! outside agent. The agent picks its own model and effort in its own harness.

use super::faux::Engine;
use crate::bridge::{Bridge, agent_model};

/// The outside-agent engine: requests become work items on `bridge`.
pub fn agent_engine(bridge: &Bridge) -> Engine {
	Engine { model: agent_model(), respond: bridge.responder() }
}
