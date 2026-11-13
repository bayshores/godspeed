//! Web pages to markdown (Readability + Turndown, with the r.jina.ai fallback), PDF downloads,
//! and Tavily search.

pub mod download;
pub mod fetch;
mod guard;
mod http;
mod jina;
mod markdown;
pub mod tavily;

#[cfg(test)]
mod fetch_tests;
#[cfg(test)]
mod golden_tests;
#[cfg(test)]
mod test_server;
