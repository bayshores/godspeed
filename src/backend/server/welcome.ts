/**
 * The welcome screen shows on the first page load of each launch. The
 * desktop app starts a fresh server every launch, so "first load since
 * this server started" is "first load since the app opened". A server the
 * app restarted after a crash (LH_SERVER_RESTARTED) opens with a short
 * notice instead, so the reload doesn't look like a fresh launch. On
 * globalThis because Next compiles routes as separate module instances.
 */

const KEY = Symbol.for("lh.firstLoadDone");

/** What the first page load of this server process opens with, then null. */
export function firstLoadScreen(): "welcome" | "restarted" | null {
	const g = globalThis as Record<symbol, boolean | undefined>;
	if (g[KEY]) return null;
	g[KEY] = true;
	return process.env.LH_SERVER_RESTARTED === "1" ? "restarted" : "welcome";
}
