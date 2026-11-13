//! Keeps web_fetch and the PDF download on the public web, so a page or a search result cannot
//! point them at this computer or the home network. The address is checked as written, on every
//! redirect, and once its name is resolved, against every address it resolves to.

use std::error::Error;
use std::fmt;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};

use reqwest::Url;
use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use reqwest::redirect::Policy;

pub(crate) const REFUSED: &str = "That address is on this computer or a private network, and godspeed only reads public web pages.";

#[derive(Debug)]
pub(crate) struct Refused;

impl fmt::Display for Refused {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		f.write_str(REFUSED)
	}
}

impl Error for Refused {}

/// Loopback, the private ranges, link-local, unique-local and "this network" addresses, also
/// when an IPv6 address carries an IPv4 one.
pub(crate) fn is_private_or_local(ip: IpAddr) -> bool {
	match ip {
		IpAddr::V4(v4) => v4.octets()[0] == 0 || v4.is_loopback() || v4.is_private() || v4.is_link_local(),
		IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
			Some(v4) => is_private_or_local(IpAddr::V4(v4)),
			None => v6.is_unspecified() || v6.is_loopback() || v6.is_unicast_link_local() || v6.is_unique_local(),
		},
	}
}

/// Ok when `url` may be asked for as written: http(s), not localhost, not a private address.
pub(crate) fn check(url: &Url) -> Result<(), Refused> {
	if !matches!(url.scheme(), "http" | "https") {
		return Err(Refused);
	}
	let host = url.host_str().unwrap_or_default().trim_end_matches('.').to_ascii_lowercase();
	if host == "localhost" || host.ends_with(".localhost") {
		return Err(Refused);
	}
	match host.trim_start_matches('[').trim_end_matches(']').parse::<IpAddr>() {
		Ok(ip) if is_private_or_local(ip) && !test_server(ip) => Err(Refused),
		_ => Ok(()),
	}
}

/// The tests' local servers listen on 127.0.0.1; every other local address stays refused there.
fn test_server(ip: IpAddr) -> bool {
	cfg!(feature = "test-support") && ip == IpAddr::V4(Ipv4Addr::LOCALHOST)
}

/// Follows up to `max` redirects, each one checked like the first address.
pub(crate) fn redirects(max: usize) -> Policy {
	let limited = Policy::limited(max);
	Policy::custom(move |attempt| match check(attempt.url()) {
		Ok(()) => limited.redirect(attempt),
		Err(refused) => attempt.error(refused),
	})
}

/// The system resolver, refusing a name when any address it gives is private or local, so a
/// public-looking name cannot lead to this computer.
pub(crate) struct PublicOnly;

impl Resolve for PublicOnly {
	fn resolve(&self, name: Name) -> Resolving {
		let host = name.as_str().to_owned();
		Box::pin(async move {
			let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), 0)).await?.collect();
			if addrs.iter().any(|addr| is_private_or_local(addr.ip())) {
				return Err(Box::new(Refused) as Box<dyn Error + Send + Sync>);
			}
			Ok(Box::new(addrs.into_iter()) as Addrs)
		})
	}
}

/// Whether a request failed because the guard refused an address.
pub(crate) fn was_refused(err: &(dyn Error + 'static)) -> bool {
	let mut next = Some(err);
	while let Some(err) = next {
		if err.is::<Refused>() {
			return true;
		}
		next = err.source();
	}
	false
}

#[cfg(test)]
#[path = "guard_tests.rs"]
mod tests;
