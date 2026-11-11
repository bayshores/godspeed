//! Every /api route (the route files under src/app/api), one module per area. Each
//! route is an `ApiRoute` (crate::http::route), so OPTIONS and wrong methods answer like Next.

mod app;
mod chats;
mod cheat_sheets;
mod classes;
mod graph;
mod jobs;
mod mcp;

use std::sync::Arc;

use axum::Router;
use gs_services::App;

pub fn api() -> Router<Arc<App>> {
	Router::new()
		.merge(app::routes())
		.merge(chats::routes())
		.merge(jobs::routes())
		.merge(classes::routes())
		.merge(cheat_sheets::routes())
		.merge(graph::routes())
		.merge(mcp::routes())
}
