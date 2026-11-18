import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import { useBarFindOpen } from "@/frontend/components/session-find";

/**
 * The state of a page's Find in the top bar (BarFind) for a page that
 * filters its own list: Esc or Close clears the query and closes it.
 * `enabled` is false where the page has nothing to find.
 */
export function useBarFind(enabled: boolean) {
	const [query, setQuery] = useState("");
	const clear = useCallback(() => setQuery(""), []);
	const { open, start, close, inputRef, keyRef } = useBarFindOpen(enabled, clear);

	// The page loses what it found (every fact deleted): close rather than keep a field over nothing.
	useEffect(() => {
		if (!enabled && open) close();
	}, [enabled, open, close]);

	const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
		if (event.key !== "Escape") return;
		// Claimed, so the page's panel keeps its pick and no turn is aborted.
		event.preventDefault();
		event.stopPropagation();
		close();
	};

	return { open, start, close, query, setQuery, inputRef, keyRef, onKeyDown };
}
