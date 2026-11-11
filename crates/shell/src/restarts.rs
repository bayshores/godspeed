//! A server that keeps crashing right after each restart won't be saved by more restarts, so the
//! shell gives up and asks the user instead.

const MAX_RESTARTS: usize = 3;
const RESTART_WINDOW_MS: i64 = 60_000;

/// The restart times to keep with `now` added, or None when the last minute already had the
/// most restarts allowed.
pub fn record(times: &[i64], now: i64) -> Option<Vec<i64>> {
	let mut recent: Vec<i64> = times.iter().copied().filter(|time| now - time < RESTART_WINDOW_MS).collect();
	(recent.len() < MAX_RESTARTS).then(|| {
		recent.push(now);
		recent
	})
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn allows_three_restarts_within_a_minute_and_refuses_the_fourth() {
		let mut times = Vec::new();
		for now in [0, 1_000, 2_000] {
			times = record(&times, now).unwrap();
		}
		assert_eq!(times, [0, 1_000, 2_000]);
		assert_eq!(record(&times, 59_999), None);
	}

	#[test]
	fn forgets_restarts_older_than_a_minute() {
		assert_eq!(record(&[0, 1_000, 2_000], 60_000).unwrap(), [1_000, 2_000, 60_000]);
		assert_eq!(record(&[0, 1_000, 2_000], 200_000).unwrap(), [200_000]);
	}
}
