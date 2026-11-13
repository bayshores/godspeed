//! The address guard: which addresses pass, and that a redirect or the reader service cannot get
//! around it. Nothing here leaves this computer: refused addresses are never connected to.

use std::net::IpAddr;

use reqwest::Url;
use reqwest::dns::Resolve;

use super::{PublicOnly, REFUSED, check, is_private_or_local, was_refused};
use crate::fetch::extract;
use crate::test_server::{Route, serve};

#[test]
fn private_and_local_addresses_are_told_apart_from_public_ones() {
	let refused = [
		"127.0.0.1", "127.8.9.10", "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "0.1.2.3",
		"::1", "::", "fe80::1", "febf::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:192.168.0.1", "::ffff:169.254.169.254",
	];
	let allowed = ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "192.169.0.1", "169.255.0.1", "100.64.0.1", "2606:4700::1111", "fec0::1", "::ffff:8.8.8.8"];
	for ip in refused {
		assert!(is_private_or_local(ip.parse::<IpAddr>().unwrap()), "{ip} should be refused");
	}
	for ip in allowed {
		assert!(!is_private_or_local(ip.parse::<IpAddr>().unwrap()), "{ip} should be allowed");
	}
}

#[test]
fn addresses_are_checked_as_written() {
	let refused = [
		"http://localhost/",
		"http://LOCALHOST:8080/a",
		"http://localhost./",
		"http://app.localhost/",
		"http://10.0.0.1/",
		"http://[::1]:3000/",
		"http://[fd00::1]/",
		"http://[::ffff:7f00:2]/",
		// The URL parser reads these as 127.0.0.2 and 10.0.0.1.
		"http://2130706434/",
		"http://0x0a.0.0.1/",
		"http://127.0.0.2/",
		"ftp://example.com/a",
		"file:///etc/hosts",
	];
	for url in refused {
		assert!(check(&Url::parse(url).unwrap()).is_err(), "{url} should be refused");
	}
	for url in ["https://example.com/a", "http://8.8.8.8/", "https://[2606:4700::1111]/", "http://localhost.example.com/"] {
		assert!(check(&Url::parse(url).unwrap()).is_ok(), "{url} should be allowed");
	}
}

#[tokio::test]
async fn a_name_that_resolves_to_this_computer_is_refused() {
	let Err(err) = PublicOnly.resolve("localhost".parse().unwrap()).await else { panic!("localhost resolved") };
	assert!(was_refused(err.as_ref()));
}

#[tokio::test]
async fn the_resolver_refusal_reaches_the_caller_through_reqwest() {
	let client = reqwest::Client::builder().dns_resolver(PublicOnly).no_proxy().build().unwrap();
	let err = client.get("http://localhost:1/").send().await.unwrap_err();
	assert!(was_refused(&err));
}

#[tokio::test]
async fn a_redirect_to_a_local_address_is_refused() {
	let server = serve(|path| match path {
		"/loopback" => Some(Route::redirect("http://127.0.0.2:9/")),
		"/name" => Some(Route::redirect("http://localhost:9/")),
		"/lan" => Some(Route::redirect("http://192.168.1.1/")),
		"/file" => Some(Route::redirect("file:///etc/hosts")),
		_ => None,
	})
	.await;
	for path in ["/loopback", "/name", "/lan"] {
		assert_eq!(extract(&format!("{}{path}", server.origin), "http://127.0.0.1:1/").await.unwrap_err(), REFUSED, "{path}");
	}
	// reqwest refuses a redirect off http(s) by itself.
	assert!(extract(&format!("{}/file", server.origin), "http://127.0.0.1:1/").await.is_err());
}

#[tokio::test]
async fn a_refused_address_never_reaches_the_reader_service() {
	let server = serve(|_| Some(Route::ok("text/markdown", b"Markdown Content: anything"))).await;
	let reader = format!("{}/__jina/", server.origin);
	assert_eq!(extract("http://10.0.0.1/app", &reader).await.unwrap_err(), REFUSED);
	assert_eq!(extract("http://localhost:9/app", &reader).await.unwrap_err(), REFUSED);
	assert!(server.requests().is_empty());
}

#[tokio::test]
async fn the_pdf_download_is_guarded_too() {
	let error = crate::download::download_pdf("http://192.168.0.10/paper.pdf", std::path::Path::new("/nonexistent")).await.unwrap_err();
	assert_eq!(error, REFUSED);
}
