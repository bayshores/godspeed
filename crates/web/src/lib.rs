//! Web pages to markdown (Readability + Turndown, with the r.jina.ai fallback), PDF downloads,
//! Tavily search, and plugin zips and godspeed's plugin list from GitHub.

pub mod download;
pub mod fetch;
mod guard;
mod http;
mod jina;
mod markdown;
pub mod plugin_list;
pub mod tavily;
pub mod zip_download;

#[cfg(test)]
mod fetch_tests;
#[cfg(test)]
mod golden_tests;
#[cfg(test)]
mod test_server;
