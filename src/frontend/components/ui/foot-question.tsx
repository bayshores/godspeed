/**
 * A dialog foot that asks before something is lost: the question, the way
 * back and the red way on. `quiet` draws the way on as a red word (throwing
 * away typed text); without it the button is filled (deleting something).
 */
export function FootQuestion({
	testid,
	line,
	note,
	keep,
	go,
	quiet = false,
	busy,
	onKeep,
	onGo,
}: {
	testid: string;
	line: string;
	note?: string;
	keep: string;
	go: string;
	quiet?: boolean;
	busy: boolean;
	onKeep: () => void;
	onGo: () => void;
}) {
	return (
		<div data-testid={testid} className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
			<span className="flex min-w-0 flex-1 basis-[200px] flex-col gap-px">
				<span className="text-[15px] break-words text-ink">{line}</span>
				{note && <span className="text-base text-ink-2">{note}</span>}
			</span>
			<button type="button" data-testid={`${testid}-keep`} disabled={busy} onClick={onKeep} className="lh-btn text-[15px]">
				{keep}
			</button>
			<button
				type="button"
				data-testid={`${testid}-go`}
				disabled={busy}
				onClick={onGo}
				className={quiet ? "lh-btn lh-btn-quiet text-[15px] text-ans-wrong hover:text-ans-wrong-hover" : "lh-btn lh-btn-danger text-[15px]"}
			>
				{go}
			</button>
		</div>
	);
}
