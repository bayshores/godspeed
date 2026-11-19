/**
 * What the window shows, as the server knows it (PUT /api/talk-page):
 *  - the page itself and its space, so a page the agent opens while the
 *    learner is already there tells the agent so;
 *  - a page that takes the learner's terminal lines (a lesson, a cheat
 *    sheet): while it is shown, a line typed in the teacher's terminal
 *    comes here instead of to the agent (the folder's typed.mjs hook), and
 *    the page sends it the way its own box would. The page answers whether
 *    it sent the line; a line it can't take goes on to the agent.
 */
import { useEffect, useRef } from "react";
import { useServerEvent, useServerResync } from "@/frontend/components/server-events";
import { jsonInit, send } from "@/frontend/lib/api";
import type { ChatAttachment } from "@/shared/core";

type TalkPage = "lesson" | "cheat sheet";

const shown: { page: TalkPage | null; path: string | null; space: string | null } = { page: null, path: null, space: null };

// One report for changes made together (a route change mounts and unmounts
// pages), sent one after another, so an older report never lands last.
let saying: Promise<unknown> = Promise.resolve();
let queued = false;
function say() {
	if (queued) return;
	queued = true;
	saying = saying.then(() => {
		queued = false;
		return send("/api/talk-page", jsonInit("PUT", { ...shown }));
	});
}

/** The app shell reports the page on screen and its space. */
export function useWindowPage(path: string, space: string | null): void {
	useEffect(() => {
		shown.path = path;
		shown.space = space;
		say();
	}, [path, space]);
	// A closed window shows nothing, so the agent never hears the learner is there.
	useEffect(() => {
		const gone = () => void send("/api/talk-page", { ...jsonInit("PUT", { page: null, path: null, space: null }), keepalive: true });
		window.addEventListener("pagehide", gone);
		return () => window.removeEventListener("pagehide", gone);
	}, []);
	// A restarted server forgot it.
	useServerResync(say);
}

export function useTerminalLines(page: TalkPage, onLine: (text: string, attachments: ChatAttachment[]) => Promise<boolean>): void {
	useEffect(() => {
		shown.page = page;
		say();
		return () => {
			shown.page = null;
			say();
		};
	}, [page]);
	// A restarted server forgot the page.
	useServerResync(say);
	const onLineRef = useRef(onLine);
	onLineRef.current = onLine;
	useServerEvent("terminal-line", ({ id, text, attachments }) => {
		void onLineRef
			.current(text, attachments)
			.catch(() => false)
			.then((sent) => send(`/api/terminal-lines/${id}`, jsonInit("POST", { sent })));
	});
}
