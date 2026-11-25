//! Parity with the TypeScript /api/mcp handler (tests/golden/mcp.json, first recorded from the Node
//! server's synthetic requests): refusals, both eras' entry ladders, the older transport's checks,
//! tools/call request errors and zod's argument texts, byte for byte. `GS_RECORD_GOLDEN=1 cargo
//! test -p gs-server --test mcp_golden` writes the answers as they are now.

use std::sync::Arc;

use axum::http::{HeaderMap, HeaderName, HeaderValue, Method};
use gs_base::config::{Paths, VERSION};
use gs_base::{fsx, ids};
use gs_json::{Json, parse, stringify_pretty};
use gs_server::mcp::handle_mcp_request;
use gs_services::App;
use http_body_util::BodyExt;

const TOKEN: &str = "abababababababababababababababababababababababababababababababab";

fn app() -> Arc<App> {
	let dir = std::env::temp_dir().join(format!("gs-mcp-golden-{}", ids::uuid()));
	let data = dir.join("data");
	std::fs::create_dir_all(&data).unwrap();
	fsx::write_atomic(&data.join("mcp-token"), TOKEN.as_bytes(), Some(0o600)).unwrap();
	App::new(Paths::new(data, dir.join("home"), dir.join("tmp"), dir), None)
}

#[tokio::test]
async fn answers_like_the_ts_handler() {
	const GOLDEN: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/mcp.json");
	// The recording names the release it was made on; the server names the one it was built from.
	let (recorded, built) = (r#""name":"godspeed","version":"0.5.50""#, format!(r#""name":"godspeed","version":"{VERSION}""#));
	let recording = std::env::var_os("GS_RECORD_GOLDEN").is_some();
	let mut golden = parse(&std::fs::read_to_string(GOLDEN).unwrap()).unwrap();
	let app = app();
	for case in golden.as_arr_mut().unwrap() {
		let name = case["name"].as_str().unwrap();
		let expected = &case["output"];
		let request = &expected["request"];
		let method = Method::from_bytes(request["method"].as_str().unwrap().as_bytes()).unwrap();
		let mut headers = HeaderMap::new();
		for (key, value) in request["headers"].as_obj().unwrap().iter() {
			headers.insert(HeaderName::from_bytes(key.as_bytes()).unwrap(), HeaderValue::from_str(value.as_str().unwrap()).unwrap());
		}
		let body = request["body"].str_or_empty();
		let res = handle_mcp_request(&app, &method, &headers, body.as_bytes()).await;
		let header = |key: &str| res.headers().get(key).map_or(Json::Null, |v| Json::from(v.to_str().unwrap()));
		let (status, kind, allow) = (res.status().as_u16(), header("content-type"), header("allow"));
		let sse = kind.as_str().is_some_and(|t| t.starts_with("text/event-stream"));
		let text = if sse { String::new() } else { String::from_utf8(res.into_body().collect().await.unwrap().to_bytes().to_vec()).unwrap() };
		if recording {
			let output = case.as_obj_mut().unwrap().get_mut("output").unwrap().as_obj_mut().unwrap();
			output.insert("status", f64::from(status));
			output.insert("type", kind);
			output.insert("allow", allow);
			output.insert("body", text.replace(&built, recorded));
			continue;
		}
		assert_eq!(status as f64, expected["status"].as_f64().unwrap(), "{name}: status");
		assert_eq!(kind, expected["type"], "{name}: content-type");
		assert_eq!(allow, expected["allow"], "{name}: allow");
		let body = expected["body"].as_str().unwrap().replace(recorded, &built);
		assert_eq!(text, body, "{name}: body");
	}
	if recording {
		gs_base::fsx::write_text_atomic(std::path::Path::new(GOLDEN), &format!("{}\n", stringify_pretty(&golden, "\t"))).unwrap();
	}
}
