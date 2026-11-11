//! One route path with its methods, answering the other methods the way a Next route file does:
//! OPTIONS is a 204 with `Allow` (sorted, HEAD with GET), any other missing method an empty 405
//! with no `Allow`. HEAD runs GET and drops the body. A handler that panics answers an empty 500,
//! like a route that throws, and the server keeps going.

use std::panic::AssertUnwindSafe;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Request, State};
use axum::handler::Handler;
use axum::http::{HeaderValue, Method, header};
use axum::response::Response;
use axum::routing::MethodRouter;
use futures_util::FutureExt;
use futures_util::future::BoxFuture;
use gs_services::App;

use super::reply;

type Call = Arc<dyn Fn(Request, Arc<App>) -> BoxFuture<'static, Response> + Send + Sync>;

#[derive(Default)]
pub struct ApiRoute {
	calls: Vec<(Method, Call)>,
}

impl ApiRoute {
	pub fn new() -> ApiRoute {
		ApiRoute::default()
	}

	pub fn get<H: Handler<T, Arc<App>>, T: 'static>(self, handler: H) -> ApiRoute {
		self.on(Method::GET, handler)
	}

	pub fn post<H: Handler<T, Arc<App>>, T: 'static>(self, handler: H) -> ApiRoute {
		self.on(Method::POST, handler)
	}

	pub fn put<H: Handler<T, Arc<App>>, T: 'static>(self, handler: H) -> ApiRoute {
		self.on(Method::PUT, handler)
	}

	pub fn delete<H: Handler<T, Arc<App>>, T: 'static>(self, handler: H) -> ApiRoute {
		self.on(Method::DELETE, handler)
	}

	fn on<H: Handler<T, Arc<App>>, T: 'static>(mut self, method: Method, handler: H) -> ApiRoute {
		let call: Call = Arc::new(move |req, app| Box::pin(handler.clone().call(req, app)));
		self.calls.push((method, call));
		self
	}

	/// The `Allow` list: the methods, HEAD with GET, and OPTIONS, sorted.
	fn allow(&self) -> String {
		let mut names: Vec<&str> = self.calls.iter().map(|(m, _)| m.as_str()).collect();
		if names.contains(&"GET") {
			names.push("HEAD");
		}
		names.push("OPTIONS");
		names.sort_unstable();
		names.join(", ")
	}

	/// For `Router::route`, or `Router::fallback` for the catch-all.
	pub fn into_route(self) -> MethodRouter<Arc<App>> {
		let allow = HeaderValue::from_str(&self.allow()).unwrap_or(HeaderValue::from_static("OPTIONS"));
		let calls = Arc::new(self.calls);
		axum::routing::any(move |State(app): State<Arc<App>>, req: Request| {
			let calls = calls.clone();
			let allow = allow.clone();
			async move {
				let head = req.method() == Method::HEAD;
				if req.method() == Method::OPTIONS {
					let mut res = reply::empty(204);
					res.headers_mut().insert(header::ALLOW, allow);
					return res;
				}
				let wanted = if head { Method::GET } else { req.method().clone() };
				let Some((_, call)) = calls.iter().find(|(m, _)| *m == wanted) else { return reply::empty(405) };
				let res = AssertUnwindSafe(call(req, app)).catch_unwind().await.unwrap_or_else(|_| reply::empty(500));
				if head {
					let (parts, _) = res.into_parts();
					return Response::from_parts(parts, Body::empty());
				}
				res
			}
		})
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	async fn ok() -> &'static str {
		"ok"
	}

	#[test]
	fn allow_lists_match_next() {
		assert_eq!(ApiRoute::new().get(ok).allow(), "GET, HEAD, OPTIONS");
		assert_eq!(ApiRoute::new().post(ok).allow(), "OPTIONS, POST");
		assert_eq!(ApiRoute::new().get(ok).put(ok).delete(ok).allow(), "DELETE, GET, HEAD, OPTIONS, PUT");
		assert_eq!(ApiRoute::new().post(ok).delete(ok).allow(), "DELETE, OPTIONS, POST");
	}
}
