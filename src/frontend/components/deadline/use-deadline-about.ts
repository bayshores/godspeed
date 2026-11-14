import { useCallback, useEffect, useRef, useState } from "react";
import { send } from "@/frontend/components/files/space-files-api";

/** What it's like, as its sheet shows it. */
export type About = { state: "loading" } | { state: "failed" } | { state: "ready"; text: string };

/**
 * A deadline's "What it's like" (GET /api/spaces/:id/deadlines/:did/about),
 * read again when `version` changes (its file's id and fingerprint, so a
 * rewrite shows); null when the deadline has none.
 */
export function useDeadlineAbout(spaceId: string, deadlineId: string, version: string | null): { about: About | null; reload: () => void } {
	const [about, setAbout] = useState<About | null>(null);
	const request = useRef(0);
	const reload = useCallback(async () => {
		const id = ++request.current;
		if (version === null) return setAbout(null);
		setAbout((now) => (now?.state === "ready" ? now : { state: "loading" }));
		const { error, body } = await send(`/api/spaces/${encodeURIComponent(spaceId)}/deadlines/${encodeURIComponent(deadlineId)}/about`, { method: "GET" });
		if (id !== request.current) return;
		setAbout(error ? { state: "failed" } : { state: "ready", text: (body as { text: string }).text });
	}, [spaceId, deadlineId, version]);
	useEffect(() => {
		void reload();
	}, [reload]);
	return { about, reload: () => void reload() };
}
