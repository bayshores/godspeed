import { useLayoutEffect, useRef, type RefObject } from "react";
import type { DeskFile, DeskReading } from "@/shared/core";
import { EASE_OUT, prefersReducedMotion } from "@/frontend/components/presence";
import { cn } from "@/frontend/lib/utils";
import { PageStage } from "./page-stage";

/**
 * THE STACK ON THE DESK: the files the teacher works from, as a straight stack of paper in the
 * desk's well. Each sheet's top edge shows its name; the front sheet's pages fill the rest. When
 * the teacher reads a file, it moves to the front and its pages drift to the place read; before
 * any read the front sheet lies still and dim. `files` come front first (deskStack).
 */
export function DeskStack({ files, reading }: { files: readonly DeskFile[]; reading: DeskReading | null }) {
	const edges = useRef<HTMLDivElement>(null);
	const front = files[0];
	useStackMove(edges, files.map((file) => file.path).join("\n"));
	if (!front) return null;
	const open = reading?.path === front.path ? reading : null;
	return (
		<div data-testid="desk-stack" data-open={open ? "" : undefined} className="lh-desk-well lh-sheet relative flex min-h-0 flex-1 flex-col overflow-hidden">
			{/* Back first, so each sheet lies over the one behind it and the front one is last. */}
			<div ref={edges} aria-hidden className="flex flex-col px-6 pt-6">
				{[...files].reverse().map((file) => (
					<div key={file.path} data-path={file.path} data-lifted={file === front && open ? "" : undefined} className={cn("lh-desk-edge lh-sheet lh-paper", file === front && "lh-desk-edge-front")}>
						<span className="truncate">{file.name}</span>
					</div>
				))}
			</div>
			<div className="relative min-h-0 flex-1">{front.kind !== "other" && <PageStage key={front.path} reading={open ?? { ...front, from: null, to: null, page: null }} still={!open} />}</div>
		</div>
	);
}

/** When the stack's order changes, each sheet glides from where it lay to its new place, the
 *  sheet brought to the front over the others; a sheet new to the stack fades in. The first
 *  drawing is simply there. */
function useStackMove(ref: RefObject<HTMLDivElement | null>, order: string) {
	const tops = useRef<Map<string, number> | null>(null);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const sheets = [...el.querySelectorAll<HTMLElement>("[data-path]")];
		const was = tops.current;
		tops.current = new Map(sheets.map((sheet) => [sheet.dataset.path!, sheet.offsetTop]));
		if (!was || prefersReducedMotion()) return;
		for (const sheet of sheets) {
			const from = was.get(sheet.dataset.path!);
			if (from === undefined) {
				sheet.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: EASE_OUT });
				continue;
			}
			const by = from - sheet.offsetTop;
			if (Math.abs(by) < 0.5) continue;
			sheet.animate([{ transform: `translateY(${by}px)` }, { transform: "none" }], { duration: Math.min(320, 220 + Math.abs(by) / 2), easing: EASE_OUT });
		}
	}, [ref, order]);
}
