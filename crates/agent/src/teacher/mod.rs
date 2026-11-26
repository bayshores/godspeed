//! The agents' prompts and construction: which parts of the shipped prompt each agent composes,
//! and the agents built from them.

pub mod prompt_segments;
mod prompts;
pub use prompts::SOURCE_MARKS;
pub mod teacher_agent;
