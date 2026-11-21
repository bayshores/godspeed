import { useCallback, useRef, useState } from "react";

/**
 * The lesson's book as the page lays it out. It opens and shuts only once a reply has landed in
 * the text: never while the teacher works (`busy`), nor while the desk is still leaving the text
 * (`deskUp`), so the page it is laid out on already holds the reply. Shutting takes a moment: the
 * task the right page kept (`held`) stays on it while it leaves (`shutting`), and the page says
 * when it is gone (`shut`). From the reply landing until the pages stand still (`rest`, said by
 * the page) the book is `turning`: the reply waits for that to print. `opens` is whether the
 * learner has something to work on now (bookOpen).
 */
export function useBook<T>(
	opens: boolean,
	held: T | null,
	busy: boolean,
	deskUp: boolean,
): { open: boolean; held: T | null; shutting: boolean; turning: boolean; shut: () => void; rest: () => void } {
	const [open, setOpen] = useState(opens);
	const [moving, setMoving] = useState(false);
	const [gone, setGone] = useState(false);
	const landed = !busy && !deskUp;
	const opening = opens && !open && !busy;
	const shutting = open && !opens && !busy;
	if (opening && landed) {
		setOpen(true);
		setMoving(true);
	}
	if (shutting && gone && landed) {
		setOpen(false);
		setMoving(true);
	}
	if (gone && !shutting) setGone(false);
	const last = useRef(held);
	if (!shutting) last.current = held;
	const shut = useCallback(() => setGone(true), []);
	const rest = useCallback(() => setMoving(false), []);
	return { open, held: shutting ? last.current : held, shutting, turning: opening || shutting || moving, shut, rest };
}
