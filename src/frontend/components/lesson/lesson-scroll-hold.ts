/**
 * While the teacher works the lesson's page never gets shorter. WebKit lays the page out between
 * a row leaving and the row that replaces it arriving (the desk taking Stop, the reply's steps,
 * the desk leaving before the reply), and would pull the page up by the gap. `page` is the
 * lesson's column, not the page around it. A lesson room of another size (the
 * app's window, the Text size, the teacher's panel) lays the page out anew, so there the hold
 * starts over: kept, the old height would leave empty room to scroll into. Returns what ends the
 * watching; the height held stays on `page` until the caller takes it off.
 */
export function holdPageHeight(page: HTMLElement, room: HTMLElement): () => void {
	const windowSize = () => `${room.clientWidth} ${room.clientHeight}`;
	let held = windowSize();
	const ro = new ResizeObserver(() => {
		const now = windowSize();
		if (now !== held) page.style.minHeight = "";
		held = now;
		page.style.minHeight = `${page.offsetHeight}px`;
	});
	ro.observe(page);
	ro.observe(room);
	return () => ro.disconnect();
}
