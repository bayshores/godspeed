import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { localDay, type MockSummary } from "@/shared/core";
import { useSpaces } from "@/frontend/components/space-context";
import { useMinute } from "@/frontend/components/countdown";
import { longDay } from "@/frontend/components/home-page/home-page-model";
import { LoadFailed } from "@/frontend/components/load-failed";
import { ROW, TITLE } from "@/frontend/components/overview/styles";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import { mockHref, mockLine, openMock } from "./mock-model";
import { formatLine } from "./prep-model";
import { removeMock, useTakeMock } from "./use-mock";
import { usePrep } from "./use-prep";

/** A prep's Mocks tab; any other space goes back to its first tab. */
export function PrepMocksTab() {
	const navigate = useNavigate();
	const { activeSpace, loaded } = useSpaces();
	const isPrep = !!activeSpace?.prep;
	useEffect(() => {
		if (loaded && !isPrep) navigate("/space", { replace: true });
	}, [loaded, isPrep, navigate]);
	return activeSpace?.prep ? <PrepMocks key={activeSpace.id} spaceId={activeSpace.id} /> : null;
}

/**
 * A PREP'S MOCKS: every mock, newest first, each with where it is or how
 * it went, and the button that takes the next one.
 */
function PrepMocks({ spaceId }: { spaceId: string }) {
	const { view, loadError, reload } = usePrep(spaceId);
	const take = useTakeMock(spaceId);
	const nowMs = useMinute() ?? 0;
	const [error, setError] = useState<string | null>(null);
	if (!view) return loadError ? <LoadFailed message="Couldn't load the mocks." onRetry={() => void reload()} /> : null;
	const mocks = [...view.mocks].reverse();
	const open = openMock(view.mocks);
	const format = view.prep.mock;
	const failed = error ?? take.error;
	return (
		<div data-testid="prep-mocks" className="mx-auto flex w-full max-w-[908px] flex-col gap-3 px-6 pt-7 pb-16">
			<div className={cn(TITLE, "flex flex-wrap items-center justify-between gap-x-4 gap-y-2")}>
				<h2>Mocks</h2>
				{format && !open && (
					<button type="button" data-testid="mocks-take" disabled={take.busy} onClick={() => void take.take()} className="lh-btn lh-btn-main mb-1 text-[15px]">
						<PixelIcon name="play" />
						Take a mock
					</button>
				)}
			</div>
			{format && <p className="text-[15px] text-ink-2">{formatLine(format)}</p>}
			{!format && <p className="text-[17px] text-ink-2">Mocks open once the prep sheet is written.</p>}
			{format && mocks.length === 0 && <p className="text-[17px] text-ink">None taken yet.</p>}
			{failed && (
				<p role="alert" className="text-[15px] text-ans-wrong">
					{failed}
				</p>
			)}
			<ul className="flex flex-col">
				{mocks.map((m) => (
					<MockRow key={m.id} spaceId={spaceId} mock={m} nowMs={nowMs} onRemove={() => void removeMock(spaceId, m.id).then(setError)} />
				))}
			</ul>
		</div>
	);
}

function MockRow({ spaceId, mock: m, nowMs, onRemove }: { spaceId: string; mock: MockSummary; nowMs: number; onRemove: () => void }) {
	const [removing, setRemoving] = useState(false);
	return (
		<li data-testid={`mock-row-${m.id}`} className="flex items-stretch border-b border-dotted border-edge last:border-b-0">
			<Link to={mockHref(spaceId, m.id)} className={cn(ROW, "min-w-0 flex-1 border-b-0 py-3")}>
				<span className="w-[92px] shrink-0 text-lg text-ink">Mock {m.n}</span>
				<span className="min-w-0 flex-1 truncate text-[15px] text-ink-2">{longDay(localDay(new Date(m.endedAt ?? m.createdAt)))}</span>
				<span data-testid="mock-row-line" className="shrink-0 text-[15px] text-ink">
					{mockLine(m, nowMs)}
				</span>
				<PixelIcon name="chevron" className="text-ink-3" />
			</Link>
			{removing ? (
				<span className="flex shrink-0 items-center gap-1.5 pl-2 text-[15px] text-ink">
					Delete it?
					<button type="button" data-testid="mock-row-remove-yes" onClick={onRemove} className="lh-btn h-[30px] px-2.5 text-[15px]">
						Delete
					</button>
					<button type="button" onClick={() => setRemoving(false)} className="lh-btn lh-btn-quiet h-[30px] text-[15px]">
						Keep
					</button>
				</span>
			) : (
				<button type="button" data-testid="mock-row-remove" aria-label={`Delete Mock ${m.n}`} title="Delete" onClick={() => setRemoving(true)} className="lh-press flex w-9 shrink-0 items-center justify-center text-ink-3 hover:bg-tone hover:text-ink">
					<PixelIcon name="close" className="h-[9px]" />
				</button>
			)}
		</li>
	);
}
