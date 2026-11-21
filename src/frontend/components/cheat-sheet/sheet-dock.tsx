import { useCallback } from "react";
import { Link } from "react-router";
import { currentVersion } from "@/shared/core";
import { LoadFailed } from "@/frontend/components/load-failed";
import { DockPanel } from "@/frontend/components/lesson/lesson-dock";
import { SELECT, SELECT_ARROW } from "@/frontend/components/ui/field";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { makeTarget, pickSheet, sheetChoices } from "./dock-model";
import { SheetCanvas } from "./sheet-canvas";
import { versionLabel } from "./studio-states";
import { useSpaceSheets } from "./space-sheets";
import { sheetPdfPath, studioPath, useCheatSheet } from "./use-cheat-sheet";

/**
 * THE CHEAT SHEET BESIDE A LESSON, in the panel beside its page (DockPanel). It shows the
 * lesson's deadline's sheet, else the space's next one that has a sheet (a picker
 * when there are several), on the same canvas as the studio (pages one
 * under another, fit to width). It has no chat: asking about the sheet,
 * pointing at a part of it and making one all happen in the studio.
 */
export function SheetDock({
	spaceId,
	sessionDeadlineId,
	picked,
	onPick,
	onClose,
}: {
	spaceId: string;
	sessionDeadlineId: string | undefined;
	/** The deadline picked before in this session. */
	picked: string | undefined;
	onPick: (deadlineId: string) => void;
	onClose: () => void;
}) {
	const { view: cards, failed, reload } = useSpaceSheets(spaceId);
	const choices = cards ? sheetChoices(cards.cards) : [];
	const shown = cards ? pickSheet(cards.cards, sessionDeadlineId, picked) : null;
	const target = cards ? makeTarget(cards.cards, sessionDeadlineId) : null;
	const shownName = cards?.cards.find((c) => c.deadlineId === shown)?.name;

	return (
		<DockPanel
			testId="sheet-dock"
			label="Cheat sheet"
			onClose={onClose}
			header={
				choices.length > 1 && shown ? (
					<div className="relative min-w-0 flex-1">
						<select data-testid="sheet-dock-pick" aria-label="Which cheat sheet" value={shown} onChange={(e) => onPick(e.target.value)} className={SELECT}>
							{choices.map((c) => (
								<option key={c.deadlineId} value={c.deadlineId}>
									Cheat sheet for {c.name}
								</option>
							))}
						</select>
						<PixelIcon name="chevron" className={SELECT_ARROW} />
					</div>
				) : (
					<span className="min-w-0 flex-1 truncate px-1 text-[15px] font-medium text-ink">{shownName ? `Cheat sheet for ${shownName}` : "Cheat sheet"}</span>
				)
			}
		>
			{failed ? (
				<LoadFailed message="Couldn't load your cheat sheets." onRetry={() => void reload()} className="px-5 py-4" />
			) : !cards ? null : shown ? (
				<DockedSheet key={shown} spaceId={spaceId} deadlineId={shown} />
			) : (
				<div data-testid="sheet-dock-none" className="flex min-h-0 flex-1 flex-col items-start gap-3 px-4 pt-2 pb-5 text-[15px] text-ink-2">
					<p>No cheat sheet yet.</p>
					{target ? (
						<Link to={studioPath(target)} data-testid="sheet-dock-make" className="lh-btn lh-btn-main">
							Make one
						</Link>
					) : (
						<p>Add a deadline to this space to make one.</p>
					)}
				</div>
			)}
		</DockPanel>
	);
}

function DockedSheet({ spaceId, deadlineId }: { spaceId: string; deadlineId: string }) {
	const { view, loadError, reload } = useCheatSheet(spaceId, deadlineId);
	const pdfUrl = useCallback((n: number) => sheetPdfPath(spaceId, deadlineId, n), [spaceId, deadlineId]);
	if (loadError) return <LoadFailed message="Couldn't load this cheat sheet." onRetry={() => void reload()} className="px-5 py-4" />;
	if (!view) return null;
	const current = currentVersion(view.sheet);
	if (!current) return null;
	return (
		<SheetCanvas
			versions={[current]}
			pdfUrl={pdfUrl}
			labelFor={versionLabel}
			narrow
			foot={
				<div className="flex w-full flex-wrap items-center justify-between gap-2">
					{/* Pointing sends a picture with a message, so it happens where the chat is. */}
					<Link to={studioPath(deadlineId)} data-testid="sheet-dock-point" className="lh-btn">
						Point at the sheet
					</Link>
					<Link to={studioPath(deadlineId)} data-testid="sheet-dock-studio" className="lh-btn lh-btn-quiet">
						Open full size
					</Link>
				</div>
			}
		/>
	);
}
