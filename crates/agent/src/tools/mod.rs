//! The lesson agents' tools: each closes over small ports the services fill in, so no tool imports a service.

pub mod space;
pub mod fn_tool;
pub mod graph;
pub mod heal;
pub mod homework;
pub mod jobs;
pub mod lesson;
pub mod mermaid_plan;
pub mod plan;
pub mod ports;
pub mod practice;
pub mod probe;
pub mod questions;
pub mod rules;
pub mod side;
pub mod talk;
#[cfg(test)]
mod test_record;
pub mod topic_done;
pub mod work_plan;
