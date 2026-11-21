import type { ReactNode } from "react";
import { usePresence } from "@/frontend/components/presence";
import { KEY_ON_INK } from "@/frontend/components/ui/card-parts";
import { cn } from "@/frontend/lib/utils";

/** A key on the picked bar: a key in the paper color. */
export const ON_INK = cn("lh-btn shrink-0 text-[15px] text-background", KEY_ON_INK);

/** The bar's main key: the paper color itself, so it is the brightest thing on the bar. */
export const ON_INK_MAIN = cn(ON_INK, "text-ink [--lh-key:var(--background)] [--lh-key-hover:color-mix(in_srgb,var(--background)_90%,var(--foreground))]");

/** The column a scroller holds the list and its picked bar in: at least as
 *  tall as the scroller, so the bar rests at its foot under a short list. */
export const PICKED_COLUMN = "flex min-h-full flex-col";

/**
 * THE PICKED BAR: while something in a list is picked (the Graph's facts,
 * the Files page's files), a dark bar rises at the bottom of the list's
 * frame with what is picked, Clear and the list's own keys (`children`).
 * It is as wide as its line needs, from 560 to 880 points and never wider
 * than the room it is in; a longer line is cut with an ellipsis.
 * A failure takes the place of the line until the next pick. It is the
 * last thing in the list's scroller, in a PICKED_COLUMN after a list that
 * grows (`flex-1`), and sticks to the scroller's foot: its own room under
 * the list means scrolling to the end always brings the last row out from
 * under it. It fades out before it unmounts.
 */
export function PickedBar({
	open,
	line,
	failure,
	testids,
	onClear,
	children,
}: {
	open: boolean;
	line: string;
	failure?: string | null;
	testids: { bar: string; line: string; clear: string };
	onClear: () => void;
	children: ReactNode;
}) {
	const bar = usePresence(open);
	if (!bar.mounted) return null;
	return (
		<div className="pointer-events-none sticky bottom-0 z-10 flex justify-center px-4 pb-7">
			<div
				data-testid={testids.bar}
				data-state={bar.state}
				className="lh-pop pointer-events-auto flex min-h-14 w-fit max-w-[min(880px,100%)] min-w-[min(560px,100%)] items-center gap-2.5 rounded-sm bg-ink py-2 pr-2.5 pl-5 text-background"
			>
				{failure ? (
					<span role="alert" data-testid={`${testids.line}-failure`} className="line-clamp-2 min-w-0 flex-1 text-[15px]">
						{failure}
					</span>
				) : (
					<span data-testid={testids.line} className="min-w-0 flex-auto truncate text-lg font-medium">
						{line}
					</span>
				)}
				<button type="button" data-testid={testids.clear} onClick={onClear} className={ON_INK}>
					Clear
				</button>
				{children}
			</div>
		</div>
	);
}
