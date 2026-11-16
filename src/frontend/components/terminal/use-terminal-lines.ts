/**
 * A page that takes the learner's terminal lines (a lesson, a cheat sheet):
 * while it is shown, a line typed in the teacher's terminal comes here
 * instead of to the agent (the folder's typed.mjs hook), and the page sends
 * it the way its own box would. The page answers whether it sent the line;
 * a line it can't take goes on to the agent.
 */
import { useEffect, useRef } from "react";
import { useServerEvent, useServerResync } from "@/frontend/components/server-events";
import { jsonInit } from "@/frontend/lib/api";
import type { ChatAttachment } from "@/shared/core";

type TalkPage = "lesson" | "cheat sheet";

// One after another, so a page that closes never overtakes the one that opens.
let saying: Promise<unknown> = Promise.resolve();
function sayPage(page: TalkPage | null) {
	saying = saying.then(() => fetch("/api/talk-page", jsonInit("PUT", { page })).catch(() => undefined));
}

export function useTerminalLines(page: TalkPage, onLine: (text: string, attachments: ChatAttachment[]) => Promise<boolean>): void {
	useEffect(() => {
		sayPage(page);
		return () => sayPage(null);
	}, [page]);
	// A restarted server forgot the page.
	useServerResync(() => sayPage(page));
	const onLineRef = useRef(onLine);
	onLineRef.current = onLine;
	useServerEvent("terminal-line", ({ id, text, attachments }) => {
		void onLineRef
			.current(text, attachments)
			.catch(() => false)
			.then((sent) => fetch(`/api/terminal-lines/${id}`, jsonInit("POST", { sent })))
			.catch(() => undefined);
	});
}
