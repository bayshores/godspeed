import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { localDay, type MockSummary } from "@/shared/core";
import { mockHref, mockLine, openMock, openMockLabel } from "@/frontend/components/mock/mock-model";
import { FootQuestion } from "@/frontend/components/ui/foot-question";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { shortDate } from "./deadline-model";
import { MockBox } from "./mock-box";

const WIDE = "lh-btn h-11 w-full justify-center text-[15px]";

/**
 * A DEADLINE'S MOCKS, under Study in its Path sheet: "Take a mock" (off,
 * with the reason, when there is nothing to write one from), or "Continue
 * Mock 3" while one is open; then every mock, newest first, with where it
 * is or how it went. A row opens the mock; its cross asks before removing it.
 */
export function PathMocks({
	spaceId,
	mocks,
	failed,
	done,
	offReason,
	nowMs,
	onRetry,
	onWrite,
	onRemove,
}: {
	spaceId: string;
	/** Newest first; null until read. */
	mocks: readonly MockSummary[] | null;
	/** The last read failed. */
	failed: boolean;
	/** The deadline is done: no new mock. */
	done: boolean;
	/** Why "Take a mock" is off; null when it is on. */
	offReason: string | null;
	nowMs: number;
	onRetry: () => void;
	onWrite: (questions: number, minutes: number | null) => Promise<string | null>;
	onRemove: (mockId: string) => Promise<string | null>;
}) {
	const takeRef = useRef<HTMLButtonElement>(null);
	const [boxOpen, setBoxOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const open = mocks ? openMock(mocks) : undefined;
	const remove = async (mockId: string) => {
		const failedWith = await onRemove(mockId);
		setError(failedWith);
		if (!failedWith) takeRef.current?.focus();
		return failedWith === null;
	};
	return (
		<div data-testid="deadline-mocks" className="flex flex-col gap-2">
			{open ? (
				<Link to={mockHref(spaceId, open.id)} data-testid="deadline-mock-continue" className={WIDE}>
					{openMockLabel(open)}
				</Link>
			) : (
				!done && (
					<button
						ref={takeRef}
						type="button"
						data-testid="deadline-mock-take"
						aria-haspopup="dialog"
						aria-expanded={boxOpen}
						disabled={mocks === null || offReason !== null}
						onClick={() => setBoxOpen((v) => !v)}
						className={WIDE}
					>
						Take a mock
					</button>
				)
			)}
			{!open && !done && offReason && (
				<p data-testid="deadline-mock-off" className="text-base text-ink-2">
					{offReason}
				</p>
			)}
			{failed && (
				<div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2">
					<p className="min-w-0 flex-1 text-[15px] text-ink">Couldn&apos;t load the mocks.</p>
					<button type="button" data-testid="deadline-mocks-retry" onClick={onRetry} className="lh-btn text-[15px]">
						Try again
					</button>
				</div>
			)}
			{mocks && mocks.length > 0 && (
				<ul data-testid="deadline-mock-list" className="mt-1 flex flex-col border-t-2 border-dotted border-edge pt-1">
					{mocks.map((m) => (
						<MockRow key={m.id} spaceId={spaceId} mock={m} nowMs={nowMs} onRemove={() => remove(m.id)} />
					))}
				</ul>
			)}
			{error && (
				<p role="alert" data-testid="deadline-mocks-error" className="text-[15px] text-ans-wrong">
					{error}
				</p>
			)}
			<MockBox open={boxOpen} anchorRef={takeRef} onClose={() => setBoxOpen(false)} onWrite={onWrite} />
		</div>
	);
}

/** One mock: its number, its day, where it is or how it went, and the
 *  chevron; beside them the cross that asks "Remove it?". */
function MockRow({ spaceId, mock: m, nowMs, onRemove }: { spaceId: string; mock: MockSummary; nowMs: number; onRemove: () => Promise<boolean> }) {
	const [asking, setAsking] = useState(false);
	const [busy, setBusy] = useState(false);
	const rowRef = useRef<HTMLLIElement>(null);
	const crossRef = useRef<HTMLButtonElement>(null);
	// The question takes the focus, and gives it back to the cross on Keep.
	const wasAsking = useRef(false);
	useEffect(() => {
		if (asking) rowRef.current?.querySelector<HTMLButtonElement>("[data-testid='deadline-mock-remove-confirm-keep']")?.focus();
		else if (wasAsking.current) crossRef.current?.focus();
		wasAsking.current = asking;
	}, [asking]);
	return (
		<li ref={rowRef} data-testid={`deadline-mock-${m.id}`} className="flex min-h-[38px] min-w-0 items-center gap-2.5 border-b border-dotted border-edge last:border-b-0">
			{asking ? (
				<>
					<span className="w-[64px] shrink-0 text-[15px] text-ink">Mock {m.n}</span>
					<FootQuestion
						testid="deadline-mock-remove-confirm"
						line="Remove it?"
						keep="Keep"
						go="Remove"
						busy={busy}
						onKeep={() => setAsking(false)}
						onGo={() => {
							setBusy(true);
							void onRemove().then((removed) => {
								if (!removed) {
									setBusy(false);
									setAsking(false);
								}
							});
						}}
					/>
				</>
			) : (
				<>
					<Link to={mockHref(spaceId, m.id)} className="lh-press flex min-w-0 flex-1 items-center gap-2.5 py-2 hover:text-ink">
						<span className="w-[64px] shrink-0 text-[15px] text-ink">Mock {m.n}</span>
						<span className="min-w-0 flex-1 truncate font-count text-base text-ink-2">{shortDate(localDay(new Date(m.endedAt ?? m.createdAt)))}</span>
						<span data-testid="deadline-mock-line" className="shrink-0 text-[15px] text-ink">
							{mockLine(m, nowMs)}
						</span>
						<PixelIcon name="chevron" className="h-3 text-ink" />
					</Link>
					<button
						ref={crossRef}
						type="button"
						data-testid="deadline-mock-remove"
						aria-label={`Remove Mock ${m.n}`}
						title="Remove"
						onClick={() => setAsking(true)}
						className="lh-press flex size-8 shrink-0 items-center justify-center text-ink-3 hover:bg-tone hover:text-ink"
					>
						<PixelIcon name="close" className="h-[9px]" />
					</button>
				</>
			)}
		</li>
	);
}
