import { useEffect, useRef, useState } from "react";
import { draggedWidth, keyedWidth, storedWidth, type PaneBounds } from "./pane-width-model";

const storageKey = (key: string) => `lh:pane-width:${key}`;

/** A pane's width, remembered across restarts. Starts at the default so the
 *  server render matches, then picks up the stored width. `bounds` must be
 *  a module constant. */
export function usePaneWidth(key: string, bounds: PaneBounds): [number, (width: number) => void] {
	const [width, setWidth] = useState(bounds.initial);
	useEffect(() => {
		try {
			setWidth(storedWidth(localStorage.getItem(storageKey(key)), bounds));
		} catch {
			// No storage: the default width stands.
		}
	}, [key, bounds]);
	return [width, setWidth];
}

function saveWidth(key: string, width: number | null) {
	try {
		if (width === null) localStorage.removeItem(storageKey(key));
		else localStorage.setItem(storageKey(key), String(width));
	} catch {
		// No storage: the width lasts until the window closes.
	}
}

/**
 * The drag strip over a pane's border line. Dragging sets the width, the
 * width is saved when the drag ends, and a double-click puts back the
 * default. From the keyboard the arrows, Home and End move it
 * (keyedWidth). While dragging, `data-lh-resizing` on the page turns off the
 * pane's slide so the pane follows the pointer.
 */
export function ResizeHandle({
	paneKey,
	width,
	bounds,
	onWidth,
	label,
}: {
	paneKey: string;
	width: number;
	bounds: PaneBounds;
	onWidth: (width: number) => void;
	label: string;
}) {
	const drag = useRef<{ startX: number; startWidth: number; last: number } | null>(null);
	const [dragging, setDragging] = useState(false);

	const end = () => {
		const d = drag.current;
		if (!d) return;
		drag.current = null;
		setDragging(false);
		document.documentElement.removeAttribute("data-lh-resizing");
		saveWidth(paneKey, d.last);
	};

	return (
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label={label}
			aria-valuenow={width}
			aria-valuemin={bounds.min}
			aria-valuemax={bounds.max}
			tabIndex={0}
			onKeyDown={(e) => {
				const next = keyedWidth(width, e.key, bounds);
				if (next === null) return;
				e.preventDefault();
				e.stopPropagation();
				onWidth(next);
				saveWidth(paneKey, next);
			}}
			data-testid={`resize-${paneKey}`}
			data-dragging={dragging || undefined}
			onPointerDown={(e) => {
				if (e.button !== 0) return;
				e.preventDefault();
				e.currentTarget.setPointerCapture(e.pointerId);
				drag.current = { startX: e.clientX, startWidth: width, last: width };
				setDragging(true);
				document.documentElement.setAttribute("data-lh-resizing", "");
			}}
			onPointerMove={(e) => {
				const d = drag.current;
				if (!d) return;
				d.last = draggedWidth(d.startWidth, d.startX, e.clientX, bounds);
				onWidth(d.last);
			}}
			onPointerUp={end}
			onPointerCancel={end}
			onDoubleClick={() => {
				onWidth(bounds.initial);
				saveWidth(paneKey, null);
			}}
			className="group lh-no-drag absolute inset-y-0 left-0 z-20 w-1.5 cursor-col-resize touch-none"
		>
			<span
				aria-hidden
				className="absolute inset-y-0 left-0 w-px transition-colors duration-(--lh-dur) group-hover:bg-ink-3 group-focus-visible:bg-ink-2 group-data-[dragging]:bg-ink-2"
			/>
		</div>
	);
}
