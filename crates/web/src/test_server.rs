//! A tiny HTTP/1.1 server on 127.0.0.1 for the tests, so nothing touches the network.

use std::sync::{Arc, Mutex};

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};

#[derive(Clone, Default)]
pub struct Route {
	pub status: u16,
	pub reason: String,
	pub headers: Vec<(String, String)>,
	pub body: Vec<u8>,
	/// Sent as Content-Length instead of the body's size (the body is then cut short).
	pub content_length: Option<usize>,
}

impl Route {
	pub fn ok(content_type: &str, body: &[u8]) -> Route {
		Route { status: 200, reason: "OK".into(), headers: vec![("Content-Type".into(), content_type.into())], body: body.to_vec(), content_length: None }
	}

	pub fn redirect(location: &str) -> Route {
		Route { status: 302, reason: "Found".into(), headers: vec![("Location".into(), location.into())], ..Route::default() }
	}

	pub fn status(status: u16, reason: &str) -> Route {
		Route { status, reason: reason.into(), ..Route::default() }
	}
}

/// What a request sent, lowercased header names.
#[derive(Clone, Debug)]
pub struct Seen {
	pub path: String,
	pub headers: Vec<(String, String)>,
}

impl Seen {
	pub fn header(&self, name: &str) -> Option<&str> {
		self.headers.iter().find(|(n, _)| n == name).map(|(_, v)| v.as_str())
	}
}

pub struct TestServer {
	/// `http://127.0.0.1:<port>`
	pub origin: String,
	seen: Arc<Mutex<Vec<Seen>>>,
}

impl TestServer {
	pub fn requests(&self) -> Vec<Seen> {
		self.seen.lock().unwrap().clone()
	}
}

/// Answers each request with `route(path)`, or a plain 404 when it returns None.
pub async fn serve(route: impl Fn(&str) -> Option<Route> + Send + Sync + 'static) -> TestServer {
	let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
	let origin = format!("http://{}", listener.local_addr().unwrap());
	let seen = Arc::new(Mutex::new(Vec::new()));
	let route = Arc::new(route);
	let log = seen.clone();
	tokio::spawn(async move {
		loop {
			let Ok((stream, _)) = listener.accept().await else { return };
			tokio::spawn(answer(stream, route.clone(), log.clone()));
		}
	});
	TestServer { origin, seen }
}

async fn answer(stream: TcpStream, route: Arc<impl Fn(&str) -> Option<Route>>, log: Arc<Mutex<Vec<Seen>>>) {
	let mut reader = BufReader::new(stream);
	let mut line = String::new();
	if reader.read_line(&mut line).await.unwrap_or(0) == 0 {
		return;
	}
	let path = line.split(' ').nth(1).unwrap_or("/").to_owned();
	let mut headers = Vec::new();
	loop {
		line.clear();
		if reader.read_line(&mut line).await.unwrap_or(0) == 0 || line == "\r\n" {
			break;
		}
		if let Some((name, value)) = line.trim_end().split_once(':') {
			headers.push((name.to_ascii_lowercase(), value.trim().to_owned()));
		}
	}
	log.lock().unwrap().push(Seen { path: path.clone(), headers });

	let route = route(&path).unwrap_or_else(|| Route { status: 404, reason: "Not Found".into(), headers: vec![("Content-Type".into(), "text/plain".into())], body: b"no such fixture".to_vec(), content_length: None });
	let mut head = format!("HTTP/1.1 {} {}\r\nConnection: close\r\nContent-Length: {}\r\n", route.status, route.reason, route.content_length.unwrap_or(route.body.len()));
	for (name, value) in &route.headers {
		head.push_str(&format!("{name}: {value}\r\n"));
	}
	head.push_str("\r\n");
	let mut stream = reader.into_inner();
	let _ = stream.write_all(head.as_bytes()).await;
	let _ = stream.write_all(&route.body).await;
	let _ = stream.shutdown().await;
}
