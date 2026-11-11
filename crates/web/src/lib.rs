//! Web pages to markdown (Readability + Turndown, with the r.jina.ai fallback) and PDF downloads.

pub mod download;
pub mod fetch;
mod http;
mod jina;
mod markdown;

#[cfg(test)]
mod fetch_tests;
#[cfg(test)]
mod golden_tests;
#[cfg(test)]
mod test_server;
