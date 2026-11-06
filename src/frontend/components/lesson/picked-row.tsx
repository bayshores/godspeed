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
		<div data-testid="picked-row" className="mt-[18px] flex w-full shrink-0 items-center gap-3 bg-tone px-3 py-2.5">
			<button
				type="button"
				data-testid="picked-open"
				onClick={onOpen}
				className="lh-press flex min-w-0 flex-1 items-center gap-3 text-left outline-none"
			>
				<span className="flex shrink-0 gap-1">{marks}</span>
				<span className="min-w-0 flex-1 truncate text-[15px] text-ink">{label}</span>
			</button>
			{sure}
			<button type="button" data-testid="picked-change" onClick={onOpen} className="lh-press shrink-0 text-[13px] text-ink-2 hover:text-ink">
				Change
			</button>
		</div>
	);
}
