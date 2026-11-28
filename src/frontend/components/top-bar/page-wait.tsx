import { useEffect, useLayoutEffect, useState } from "react";
import { useLocation, useNavigation } from "react-router";
import { BrailleSpinner } from "@/frontend/components/braille-spinner";
import { SLOW_MS, usePresence } from "@/frontend/components/presence";
import { hrefPage, pageBeingRead } from "./page-wait-model";

/**
 * A click that opens a page read first (a lesson, a deadline, a mock, a cheat sheet: the routes
 * with a loader) is answered at once, though the router keeps the old page until the read is done.
 * Every link that leads there stays pressed (data-pending, which the press rules of globals.css
 * take as :active), and a read that outlasts --lh-dur-slow shows the spinner in the slot the bar
 * gives it. Both go as the page changes; the old page's still copy (travel/still-copy.ts) keeps
 * the press, as the page looked when it left.
 */
export function PageWait() {
	const read = pageBeingRead(useNavigation(), useLocation().pathname);
	const page = read?.pathname ?? null;
	// On the links themselves, so no link has to know; before paint, so no frame shows them let go.
	useLayoutEffect(() => {
		if (!page) return;
		const held = [...document.querySelectorAll<HTMLElement>("a[href]")].filter((a) => hrefPage(a.getAttribute("href") ?? "") === page);
		for (const a of held) a.dataset.pending = "";
		return () => {
			for (const a of held) delete a.dataset.pending;
		};
	}, [page]);
	const mark = usePresence(useLate(read?.key ?? null));
	return mark.mounted ? (
		<span data-state={mark.state} className="lh-fade absolute inset-y-0 left-0 flex items-center">
			<BrailleSpinner label="Loading" className="h-3 text-current" />
		</span>
	) : null;
}

/** True once the read named `key` has run SLOW_MS, so a quick one shows no wait at all. */
function useLate(key: string | null): boolean {
	const [late, setLate] = useState<string | null>(null);
	useEffect(() => {
		if (!key) return;
		const timer = setTimeout(() => setLate(key), SLOW_MS);
		return () => clearTimeout(timer);
	}, [key]);
	return key !== null && late === key;
}
