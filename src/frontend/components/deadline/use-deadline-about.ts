import { useCallback, useEffect, useRef, useState } from "react";
import { send } from "@/frontend/lib/api";

/** What it's like, as its sheet shows it. */
export type About = { state: "loading" } | { state: "failed" } | { state: "ready"; text: string };

/** GET a deadline's "What it's like": `{ text }`. */
export const deadlineAboutUrl = (spaceId: string, deadlineId: string) => `/api/spaces/${encodeURIComponent(spaceId)}/deadlines/${encodeURIComponent(deadlineId)}/about`;

/**
 * A deadline's "What it's like" (GET deadlineAboutUrl), read again when
 * `version` changes (its file's id and fingerprint, so a rewrite shows);
 * null when the deadline has none. `initial` is the text the page's loader
 * read, shown at once and not read again.
 */
export function useDeadlineAbout(spaceId: string, deadlineId: string, version: string | null, initial?: string): { about: About | null; reload: () => void } {
	const given = initial !== undefined && version !== null;
	const [about, setAbout] = useState<About | null>(given ? { state: "ready", text: initial } : null);
	const skip = useRef(given);
	const request = useRef(0);
	const reload = useCallback(async () => {
		const id = ++request.current;
		if (version === null) return setAbout(null);
		setAbout((now) => (now?.state === "ready" ? now : { state: "loading" }));
		const { error, body } = await send(deadlineAboutUrl(spaceId, deadlineId), { method: "GET" });
		if (id !== request.current) return;
		setAbout(error ? { state: "failed" } : { state: "ready", text: (body as { text: string }).text });
	}, [spaceId, deadlineId, version]);
	useEffect(() => {
		if (skip.current) {
			skip.current = false;
			return;
		}
		void reload();
	}, [reload]);
	return { about, reload: () => void reload() };
}
