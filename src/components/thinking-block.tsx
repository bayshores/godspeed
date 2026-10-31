import { useEffect, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { blurAfterPointerClick } from "@/components/focus-hygiene";
import { useFold } from "@/components/use-fold";
import { cn } from "@/lib/utils";

/** The unified user-thinking row: ONE visual language for every surface
 *  where the learner's own thinking renders (practice thinking traces,
 *  the reading channel above the answered card, the quiz answer's
 *  thinking). It arrives as a trigger row in the register of the agent's
 *  reasoning rows; expanding opens the quote block (rail, 50% opacity,
 *  italics). User thinking = rail + 50% italic; agent thinking = no rail.
 *
 *  User rows are full-width card-color bands (the authorship mark against
 *  the agent's transparent prose) with the rail along the left edge. The
 *  total inset stays 3ch so the chevrons align with the agent's flush
 *  rows. In-card rows take no band, rail only (`inCard`). `defaultOpen`
 *  marks transcript rows, which arrive expanded so it is clear the
 *  thinking was sent.
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
	label = "YOUR THINKING",
	text,
	testId,
	dataCommit,
	defaultOpen = false,
	inCard = false,
}: {
	label?: string;
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
		/* The rail IS THE MISSING CHARACTERS: the heading sits inside the
		   rail, and the rail's full width (border + padding) is exactly
		   three characters of the mono heading font. 'YOUR THINKING' is
		   three chars shorter than 'AGENT'S THINKING', so with the user row
		   offset by the rail and the agent row flush, the chevrons line up.
		   The heading uses the card eyebrows' small mono caps (text-xs). */
		<div
			data-testid={testId}
			data-commit={dataCommit === undefined ? undefined : dataCommit ? "true" : "false"}
			className={cn(
				// Total inset 3ch (chevron alignment): 14px gap, padding 4px,
				// pr-4 keeps the text off the band's right edge. In-card rows
				// take no band, rail only. Arrival motion rides the transcript
				// (lesson/arrivals.tsx), so a reopened lesson doesn't replay it per row.
				"my-2 w-full border-l-[calc(3ch-14px)] border-muted-foreground/30 py-1 pl-[14px] pr-4 font-ui text-xs",
				inCard ? "" : "bg-card",
			)}
		>
			<button
				type="button"
				data-testid={testId ? `${testId}-trigger` : undefined}
				onClick={(e) => {
					setOpen((v) => !v);
					blurAfterPointerClick(e);
				}}
				aria-expanded={open}
				className="flex w-full items-center gap-2 font-semibold text-muted-foreground transition-colors duration-(--lh-dur) ease-(--lh-ease-out) hover:text-foreground"
			>
				{label}
				<ChevronDownIcon className={cn("size-4 shrink-0 transition-transform duration-(--lh-dur) ease-(--lh-ease-out)", open ? "rotate-180" : "rotate-0")} />
			</button>
			{fold.mounted && (
				<div className="lh-collapse" data-state={fold.state}>
					<div>
						<span className="lh-prose mt-1.5 block whitespace-pre-wrap text-[15px] italic text-foreground/50">{text}</span>
					</div>
				</div>
			)}
		</div>
	);
}
