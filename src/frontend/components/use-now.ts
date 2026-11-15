import { useEffect, useState } from "react";

/** The current time, ticking every `everyMs` (a second) while `active`, so
 *  elapsed figures count up without new data. It refreshes at once when
 *  `active` turns on. */
export function useNow(active: boolean, everyMs = 1000): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!active) return;
		setNow(Date.now());
		const t = setInterval(() => setNow(Date.now()), everyMs);
		return () => clearInterval(t);
	}, [active, everyMs]);
	return now;
}
