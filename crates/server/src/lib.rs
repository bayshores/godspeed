//! The HTTP server: the layer Next provided (`http`) and the /api routes (`routes`). The binary
//! in main.rs only starts it.

pub mod data_lock;
pub mod http;
pub mod mcp;
pub mod routes;
