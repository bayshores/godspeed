import { useRef, useState, type PointerEvent } from "react";
import { readStorage, writeStorage } from "@/frontend/lib/storage";
import { saveWidth } from "@/frontend/components/ui/resize-handle";
import { draggedWidth } from "@/frontend/components/ui/pane-width-model";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { PANEL_HEIGHT, PANEL_WIDTH, draggedHeight, keyedHeight, storedHeight, type PanelHeight } from "./dock-model";

const HEIGHT_KEY = "lh:pane-height:teacher";
const saveHeight = (height: PanelHeight | null) => writeStorage(HEIGHT_KEY, height === null ? null : String(height));

/** The panel's height, remembered across restarts. */
export function usePanelHeight(): [PanelHeight, (height: PanelHeight) => void] {
	return useState(() => storedHeight(readStorage(HEIGHT_KEY)));
}

/**
 * The panel's bottom edge and its bottom left corner. Dragging the edge
 * sets the height; the corner sets width and height together. Dragged to
 * the window's bottom the panel docks, and dragged back up it is a window
 * again. The size is saved when the drag ends, and a double-click puts
 * back the default. From the keyboard the edge takes the up and down
 * arrows, Home and End (keyedHeight). `shown` is the height drawn now and
 * `room` the room under the top bar.
 */
export function PanelSize({
	width,
	shown,
	room,
	onWidth,
	onHeight,
	label,
}: {
	width: number;
	shown: number;
	room: number;
	onWidth: (width: number) => void;
	onHeight: (height: PanelHeight) => void;
	label: string;
}) {
	const drag = useRef<{ both: boolean; x: number; y: number; width: number; height: number; last: { width: number; height: PanelHeight } } | null>(null);

	const start = (both: boolean) => (e: PointerEvent<HTMLDivElement>) => {
		if (e.button !== 0) return;
		e.preventDefault();
		e.currentTarget.setPointerCapture(e.pointerId);
		drag.current = { both, x: e.clientX, y: e.clientY, width, height: shown, last: { width, height: shown } };
		document.documentElement.setAttribute("data-lh-resizing", "");
	};
	const move = (e: PointerEvent<HTMLDivElement>) => {
		const d = drag.current;
		if (!d) return;
		d.last.height = draggedHeight(d.height, d.y, e.clientY, room);
		onHeight(d.last.height);
		if (!d.both) return;
		d.last.width = draggedWidth(d.width, d.x, e.clientX, PANEL_WIDTH);
		onWidth(d.last.width);
	};
	const end = () => {
		const d = drag.current;
		if (!d) return;
		drag.current = null;
		document.documentElement.removeAttribute("data-lh-resizing");
		saveHeight(d.last.height);
		if (d.both) saveWidth("teacher", d.last.width);
	};
	const defaultHeight = () => {
		onHeight(PANEL_HEIGHT.initial);
		saveHeight(null);
	};
	const pointer = { onPointerMove: move, onPointerUp: end, onPointerCancel: end };

	return (
		<>
			<div
				role="separator"
				aria-orientation="horizontal"
				aria-label={label}
				aria-valuenow={shown}
				aria-valuemin={PANEL_HEIGHT.min}
				aria-valuemax={room}
				tabIndex={0}
				data-testid="resize-teacher-height"
				onKeyDown={(e) => {
					const next = keyedHeight(shown, e.key, room);
					if (next === null) return;
					e.preventDefault();
					e.stopPropagation();
					onHeight(next);
					saveHeight(next);
				}}
				onPointerDown={start(false)}
				{...pointer}
				onDoubleClick={defaultHeight}
				className="lh-no-drag absolute inset-x-0 bottom-0 z-20 h-1.5 cursor-row-resize touch-none"
			/>
			<div
				aria-hidden
				data-testid="resize-teacher-corner"
				onPointerDown={start(true)}
				{...pointer}
				onDoubleClick={() => {
					defaultHeight();
					onWidth(PANEL_WIDTH.initial);
					saveWidth("teacher", null);
				}}
				className="lh-no-drag absolute bottom-0 left-0 z-30 flex size-5 cursor-nesw-resize touch-none items-end p-[5px] text-ink-3 hover:text-ink"
			>
				<PixelIcon name="grip" className="h-[9px]" />
			</div>
		</>
	);
}
