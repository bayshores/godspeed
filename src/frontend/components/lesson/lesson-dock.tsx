import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Pane } from "@/frontend/components/ui/pane";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { readStorage, writeStorage } from "@/frontend/lib/storage";
import { OPEN_SHEET_EVENT } from "@/frontend/components/teacher/follow";
import { DOCK_DEFAULT_W, dockStateKey, dockWidth, parseDockState, type DockState } from "./lesson-dock-model";

/** The width keeps the cheat sheet's old key, so a width dragged before still holds. */
const WIDTH_KEY = "lh:sheet-dock-width";

/** The panel beside a lesson and what it shows, kept per lesson in this browser. It starts
 *  closed and reads storage after mount. The agent opening the lesson's own deadline's cheat
 *  sheet opens it here. */
export function useLessonDock(chatId: string, deadlineId: string | undefined) {
	const [state, setState] = useState<DockState>({ panel: null });
	const key = dockStateKey(chatId);
	useEffect(() => setState(parseDockState(readStorage(key))), [key]);
	const update = useCallback(
		(patch: Partial<DockState>) =>
			setState((s) => {
				const next = { ...s, ...patch };
				writeStorage(key, JSON.stringify(next));
				return next;
			}),
		[key],
	);
	useEffect(() => {
		if (!deadlineId) return;
		const opened = (e: Event) => {
			if ((e as CustomEvent<string>).detail !== deadlineId) return;
			e.preventDefault();
			update({ panel: "sheet", deadlineId });
		};
		window.addEventListener(OPEN_SHEET_EVENT, opened);
		return () => window.removeEventListener(OPEN_SHEET_EVENT, opened);
	}, [deadlineId, update]);
	return { state, update };
}

/**
 * A PANEL BESIDE THE LESSON: a column beside the lesson's page, as wide as the learner drags it
 * (one width for every panel; `defaultWidth` until the learner drags it), with its header row (what the panel puts there, then Close) over
 * what it shows. The cheat sheet and the Document panel are both one.
 */
export function DockPanel({
	testId,
	label,
	defaultWidth = DOCK_DEFAULT_W,
	header,
	onClose,
	children,
}: {
	testId: string;
	label: string;
	defaultWidth?: number;
	header: ReactNode;
	onClose: () => void;
	children: ReactNode;
}) {
	const [width, setWidth] = useState(defaultWidth);
	useEffect(() => {
		const saved = Number(readStorage(WIDTH_KEY));
		setWidth(dockWidth(saved > 0 ? saved : defaultWidth, window.innerWidth));
	}, [defaultWidth]);
	const drag = useRef<{ x: number; w: number } | null>(null);

	return (
		<Pane data-testid={testId} aria-label={label} style={{ "--lh-dock-w": `${width}px` } as React.CSSProperties} className="lh-lesson-dock flex h-full min-h-0 shrink-0 flex-col">
			<div
				role="separator"
				aria-orientation="vertical"
				aria-label={`Drag to resize the ${label.toLowerCase()}`}
				data-testid={`${testId}-resize`}
				className="lh-dock-resize absolute top-0 bottom-0 -left-3 z-10 w-3 cursor-col-resize hover:bg-tone-2"
				onPointerDown={(e) => {
					e.currentTarget.setPointerCapture(e.pointerId);
					drag.current = { x: e.clientX, w: width };
				}}
				onPointerMove={(e) => {
					const d = drag.current;
					if (d) setWidth(dockWidth(d.w + d.x - e.clientX, window.innerWidth));
				}}
				onPointerUp={() => {
					drag.current = null;
					writeStorage(WIDTH_KEY, String(width));
				}}
			/>
			{/* Close stays level with the header's first line when what is before it wraps. */}
			<header className="flex shrink-0 items-start gap-2 py-2.5 pr-2 pl-3">
				{header}
				<button type="button" data-testid={`${testId}-close`} onClick={onClose} className="lh-btn lh-btn-quiet shrink-0 text-[15px]">
					<PixelIcon name="close" />
					Close
				</button>
			</header>
			{children}
		</Pane>
	);
}
