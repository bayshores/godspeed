//! The learner-filesystem tools (read, ls, find, grep), the researcher's web and PDF tools, and
//! what they share.

pub mod find;
pub mod fs_shared;
mod glob;
pub mod grep;
pub mod ls;
pub mod pdf_read;
pub mod read;
mod walk;
pub mod web;

#[cfg(test)]
mod tests;
