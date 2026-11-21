//! Every /api route, one module per area. Each
//! route is an `ApiRoute` (crate::http::route), so OPTIONS and wrong methods answer like Next.

mod app;
mod chats;
mod cheat_sheets;
mod deadline_requests;
mod spaces;
mod graph;
mod jobs;
mod mcp;
mod mocks;
mod plugins;
mod terminal_lines;
mod vault;
mod web_search;

use std::sync::Arc;

use axum::Router;
use gs_services::App;

pub fn api() -> Router<Arc<App>> {
	Router::new()
		.merge(app::routes())
		.merge(chats::routes())
		.merge(jobs::routes())
		.merge(spaces::routes())
		.merge(cheat_sheets::routes())
		.merge(deadline_requests::routes())
		.merge(graph::routes())
		.merge(mcp::routes())
		.merge(mocks::routes())
		.merge(plugins::routes())
		.merge(terminal_lines::routes())
		.merge(vault::routes())
		.merge(web_search::routes())
}
