/** The answer list folded into one row while the learner writes: what
 *  they picked, how sure, and Change to open the list again. */
export function PickedRow({
	marks,
	label,
	sure,
	onOpen,
}: {
	marks: React.ReactNode;
	label: React.ReactNode;
	sure: number | null;
	onOpen: () => void;
}) {
	return (
		<button
			type="button"
			data-testid="picked-row"
			onClick={onOpen}
			className="lh-press mt-4 flex w-full shrink-0 items-center gap-3 bg-tone px-3.5 py-2.5 text-left outline-none transition-colors duration-(--lh-dur) ease-(--lh-ease-out) hover:bg-tone-2/60"
		>
			<span className="flex shrink-0 gap-1">{marks}</span>
			<span className="min-w-0 flex-1 truncate text-[15px] text-ink">{label}</span>
			{sure !== null && <span className="shrink-0 text-[13px] font-bold text-ink-2">Sure {sure}</span>}
			<span className="shrink-0 text-[13px] font-bold text-ink underline underline-offset-2">Change</span>
		</button>
	);
}
