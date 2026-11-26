/**
 * The page the window shows and its space, as the server knows it (PUT
 * /api/window-page), so a page the agent opens while the learner is already
 * there tells the agent so.
 */
import { useEffect, useRef } from "react";
import { useServerResync } from "@/frontend/components/server-events";
import { jsonInit, send } from "@/frontend/lib/api";

type Shown = { path: string | null; space: string | null };

// Reports go one after another, so an older one never lands last.
let saying: Promise<unknown> = Promise.resolve();
function report(shown: Shown) {
	saying = saying.then(() => send("/api/window-page", jsonInit("PUT", shown)));
}

/** The app shell reports the page on screen and its space. */
export function useWindowPage(path: string, space: string | null): void {
	const shown = useRef<Shown>({ path, space });
	shown.current = { path, space };
	useEffect(() => report({ path, space }), [path, space]);
	// A closed window shows nothing, so the agent never hears the learner is there.
	useEffect(() => {
		const gone = () => void send("/api/window-page", { ...jsonInit("PUT", { path: null, space: null }), keepalive: true });
		window.addEventListener("pagehide", gone);
		return () => window.removeEventListener("pagehide", gone);
	}, []);
	// A restarted server forgot it.
	useServerResync(() => report(shown.current));
}
