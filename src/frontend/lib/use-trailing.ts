import { useCallback, useEffect, useRef } from "react";

/** `fn` run once, `ms` after the last of a burst of calls. Always the
 *  latest `fn`; a pending run is dropped on unmount. */
export function useTrailing(fn: () => void, ms: number): () => void {
	const latest = useRef(fn);
	latest.current = fn;
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => () => clearTimeout(timer.current), []);
	return useCallback(() => {
		clearTimeout(timer.current);
		timer.current = setTimeout(() => latest.current(), ms);
	}, [ms]);
}
