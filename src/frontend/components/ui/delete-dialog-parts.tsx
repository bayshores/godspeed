/** The foot of a delete dialog: Cancel and Delete, the test ids set by each dialog. */
export function DeleteFoot({
	cancelTestid,
	confirmTestid,
	busy,
	onClose,
	onRun,
}: {
	cancelTestid: string;
	confirmTestid: string;
	busy: boolean;
	onClose: () => void;
	onRun: () => void;
}) {
	return (
		<>
			<span className="flex-1" />
			<button type="button" data-testid={cancelTestid} onClick={onClose} disabled={busy} className="lh-btn">
				Cancel
			</button>
			<button type="button" data-testid={confirmTestid} onClick={onRun} disabled={busy} className="lh-btn lh-btn-danger">
				{busy ? "Deleting…" : "Delete"}
			</button>
		</>
	);
}

/** The server's line for a delete that didn't go through, with "Try again". */
export function FailureRow({
	testid,
	retryTestid,
	failure,
	busy,
	onRun,
}: {
	testid: string;
	retryTestid: string;
	failure: string;
	busy: boolean;
	onRun: () => void;
}) {
	return (
		<div role="alert" data-testid={testid} className="flex flex-wrap items-center gap-2.5">
			<span className="min-w-0 flex-1 basis-[200px] text-[15px] text-ans-wrong">{failure}</span>
			<button type="button" data-testid={retryTestid} onClick={onRun} disabled={busy} className="lh-btn">
				Try again
			</button>
		</div>
	);
}
