import { useEffect, useState } from "react";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { blurAfterPointerClick } from "@/frontend/components/focus-hygiene";
import { useFold } from "@/frontend/components/use-fold";
import { InlineMath } from "@/frontend/components/overview/inline-math";
import { cn } from "@/frontend/lib/utils";

/** The unified user-thinking row: ONE visual language for every surface
 *  where the learner's own thinking renders (practice thinking traces,
 *  the reading channel above the answered card, the quiz answer's
 *  thinking). It arrives as a trigger row with a pixel chevron; expanding
 *  opens the quote (rail, italics). Transcript rows sit in a card, in-card
 *  rows take no card (`inCard`). `defaultOpen` marks transcript rows, which
 *  arrive expanded so it is clear the thinking was sent.
 *
 *  ⌘T (toggle-user-thinking) sets EVERY row to one state via the module
 *  store below — one source of truth, no provider tree: rows subscribe on
 *  mount; explicit sets (and only those) stomp individual toggles. */

// ── The ⌘T store (module-scope, one per page load) ─────────────────────────
// null = "rows run their own defaults" (the pre-toggle state); the first ⌘T
// resolves from `true` (transcript rows default open) and then alternates.
let allUserThinkingOpen: boolean | null = null;
const userThinkingListeners = new Set<(open: boolean) => void>();

export function currentUserThinkingOpen(): boolean {
	return allUserThinkingOpen ?? true;
}

/** The row's starting state: an explicit ⌘T set wins over the row's own
 *  default (late mounts honor the last set — same path as the live sync,
 *  readable at render time so static SSR reflects the store too). */
function resolveUserThinkingOpen(defaultOpen: boolean): boolean {
	return allUserThinkingOpen ?? defaultOpen;
}

export function setAllUserThinkingOpen(open: boolean) {
	allUserThinkingOpen = open;
	for (const l of userThinkingListeners) l(open);
}

function subscribeUserThinking(fn: (open: boolean) => void): () => void {
	userThinkingListeners.add(fn);
	if (allUserThinkingOpen !== null) fn(allUserThinkingOpen); // late mounts honor the last set
	return () => userThinkingListeners.delete(fn);
}

export function ThinkingBlock({
	text,
	testId,
	dataCommit,
	defaultOpen = false,
	inCard = false,
}: {
	text: string;
	testId?: string;
	/** The practice marker's register flag (commit vs nudge). */
	dataCommit?: boolean;
	/** Transcript rows arrive expanded. */
	defaultOpen?: boolean;
	/** On the card's own background: no band (the accent read too light). */
	inCard?: boolean;
}) {
	const [open, setOpen] = useState(() => resolveUserThinkingOpen(defaultOpen));
	// ⌘T: an explicit global set overrides every row.
	useEffect(() => subscribeUserThinking(setOpen), []);
	// The text folds open/shut and stays
	// unmounted while closed.
	const fold = useFold(open);
	return (
		<div
			data-testid={testId}
			data-commit={dataCommit === undefined ? undefined : dataCommit ? "true" : "false"}
			// Arrival motion rides the transcript (lesson/arrivals.tsx), so a reopened lesson doesn't replay it per row.
			className={cn("w-full font-ui text-[15px]", inCard ? "py-1" : "my-1 rounded border border-border bg-background px-4 py-2.5")}
		>
			<button
				type="button"
				data-testid={testId ? `${testId}-trigger` : undefined}
				onClick={(e) => {
					setOpen((v) => !v);
					blurAfterPointerClick(e);
				}}
				aria-expanded={open}
				className="flex w-full items-center gap-2.5 text-left text-ink-2 transition-colors duration-(--lh-dur) ease-(--lh-ease-out) hover:text-ink"
			>
				<PixelIcon name="chevron" className={cn("transition-transform duration-(--lh-dur) ease-(--lh-ease-out)", open && "rotate-90")} />
				Your thinking
			</button>
			{fold.mounted && (
				<div className="lh-collapse" data-state={fold.state}>
					<div>
						<span className="mt-2 block whitespace-pre-wrap border-l-2 border-tone-2 pl-3 font-prose text-[16px] leading-normal italic text-ink-2">
							<InlineMath text={text} />
						</span>
					</div>
				</div>
			)}
		</div>
	);
}
