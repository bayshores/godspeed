/**
 * The welcome screen shows on the first page load of each launch. The
 * desktop app starts a fresh server every launch, so "first load since
 * this server started" is "first load since the app opened". On
 * globalThis because Next compiles routes as separate module instances.
 */

const KEY = Symbol.for("lh.welcomeShown");

/** True the first time it's asked in this server process, then false. */
export function welcomeNeeded(): boolean {
	const g = globalThis as Record<symbol, boolean | undefined>;
	if (g[KEY]) return false;
	g[KEY] = true;
	return true;
}
