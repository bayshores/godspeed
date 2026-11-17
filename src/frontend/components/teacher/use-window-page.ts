/**
 * The window tells the server which page it shows and in which space, so a
 * page the agent opens while the learner is already there tells the agent so.
 */
import { useEffect } from "react";
import { useServerResync } from "@/frontend/components/server-events";
import { jsonInit } from "@/frontend/lib/api";

// One after another, so an older page never lands after a newer one.
let saying: Promise<unknown> = Promise.resolve();
function sayPage(path: string | null, space: string | null) {
	saying = saying.then(() => fetch("/api/window-page", jsonInit("PUT", { path, space })).catch(() => undefined));
}

export function useWindowPage(path: string, space: string | null): void {
	useEffect(() => {
		sayPage(path, space);
	}, [path, space]);
	// A closed window shows nothing, so the agent never hears the learner is there.
	useEffect(() => {
		const gone = () => void fetch("/api/window-page", { ...jsonInit("PUT", { path: null, space: null }), keepalive: true }).catch(() => undefined);
		window.addEventListener("pagehide", gone);
		return () => window.removeEventListener("pagehide", gone);
	}, []);
	// A restarted server forgot the page.
	useServerResync(() => sayPage(path, space));
}
