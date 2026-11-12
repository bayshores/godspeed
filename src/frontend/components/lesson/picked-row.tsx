/** The answer list folded into one row while the learner writes: what
 *  they picked, how sure (set or changed right here), and Change to open
 *  the list again. */
export function PickedRow({
	marks,
	label,
	sure,
	onOpen,
}: {
	marks: React.ReactNode;
	label: React.ReactNode;
	/** The confidence squares (quiz answers only). */
	sure?: React.ReactNode;
	onOpen: () => void;
}) {
	return (
		<div data-testid="picked-row" className="flex w-full shrink-0 flex-wrap items-center gap-x-3 gap-y-1 bg-(--lh-pale) px-2.5 py-[9px]">
			<button type="button" data-testid="picked-open" onClick={onOpen} className="lh-press flex min-w-0 flex-1 items-center gap-3 text-left outline-none">
				<span className="flex shrink-0 gap-1">{marks}</span>
				<span className="min-w-0 flex-1 truncate font-prose text-[17px] text-ink">{label}</span>
			</button>
			{sure}
			<button type="button" data-testid="picked-change" onClick={onOpen} className="lh-press lh-btn shrink-0">
				Change
			</button>
		</div>
	);
}
