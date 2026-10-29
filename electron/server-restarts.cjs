"use strict";

// A server that keeps crashing right after each restart won't be saved by
// more restarts, so the app gives up and asks the user instead.
const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 60_000;

/** The restart times to keep with `now` added, or null when the last minute
 * already had the most restarts allowed. */
function recordRestart(times, now) {
	const recent = times.filter((time) => now - time < RESTART_WINDOW_MS);
	return recent.length < MAX_RESTARTS ? [...recent, now] : null;
}

module.exports = { recordRestart };
