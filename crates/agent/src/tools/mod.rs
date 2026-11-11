//! The lesson agents' tools (src/backend/agent/tools.ts and tools/*.ts except the file, web and
//! PDF tools): each closes over small ports the services fill in, so no tool imports a service.

pub mod class;
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
pub mod work_plan;
