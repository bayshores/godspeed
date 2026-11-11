"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { pageSizeLabel, whenLabel, type SheetCard } from "@/shared/core";
import { useAgentStatus } from "@/frontend/components/agent-status";
import { BrailleSpinner } from "@/frontend/components/braille-spinner";
import { useClasses } from "@/frontend/components/class-context";
import { kindLabel } from "@/frontend/components/class-deadlines-model";
import { useMinute } from "@/frontend/components/countdown";
import { dueAtMs } from "@/frontend/components/countdown-model";
import { fileBrowserName } from "@/frontend/components/files/files-model";
import { LoadFailed } from "@/frontend/components/load-failed";
import { PickClass } from "@/frontend/components/pick-class";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { PdfThumb } from "./pdf-thumb";
import { remakeSheet, sheetPdfPath, showSheetPdf, studioPath, useClassSheets } from "./use-cheat-sheet";

/** The small page beside a row: a made sheet's first page fits inside it. */
const THUMB_W = 48;
const THUMB_H = 62;

const madeAt = (at: string) => new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * THE CLASS'S CHEAT SHEETS TAB: every deadline of the class you're in as a
 * row, coming up first, then past ones, each saying whether it has a
 * sheet. A made sheet shows its first page (drawn from the real PDF once
 * the row is in view), its paper and when it was made; a row opens the
 * deadline's cheat sheet.
 */
export function ClassSheetsPage() {
	const { active } = useClasses();
	const { view, failed, reload } = useClassSheets(active);
	const agentName = useAgentStatus()?.name ?? "Your agent";
	const [error, setError] = useState<string | null>(null);
	const minute = useMinute();
	// A deadline whose time went by today is past too, not coming up.
	const isPast = (c: SheetCard) => c.past || (minute !== null && dueAtMs(c) <= minute);
	const upcoming = view?.cards.filter((c) => !isPast(c)) ?? [];
	const past = view?.cards.filter(isPast) ?? [];
	const made = view?.cards.filter((c) => c.version).length ?? 0;
	const remake = (deadlineId: string) => active && void remakeSheet(active, deadlineId).then(setError);
	const fileBrowser = typeof window !== "undefined" && window.lh?.showInFolder ? fileBrowserName(window.lh.platform) : null;
	const summary = view && view.cards.length > 0 && (
		<p data-testid="cheat-sheets-summary" className="shrink-0 text-[15px] text-ink-2">
			{made} of {view.cards.length} {view.cards.length === 1 ? "deadline has" : "deadlines have"} a sheet
		</p>
	);
	const list = (title: string, cards: readonly SheetCard[], aside: ReactNode) =>
		cards.length > 0 && (
			<section className="flex flex-col">
				<div className="flex items-baseline gap-3 border-b-[1.5px] border-ink pb-2.5">
					<h2 className="min-w-0 flex-1 text-xl leading-tight text-ink">{title}</h2>
					{aside}
				</div>
				<ul>
					{cards.map((c) => (
						<SheetCardView
							key={c.deadlineId}
							card={c}
							classId={active!}
							agentName={agentName}
							onRemake={() => remake(c.deadlineId)}
							show={fileBrowser && c.version ? { label: `Show in ${fileBrowser}`, run: () => void showSheetPdf(active!, c.deadlineId, c.version!.n).then(setError) } : null}
						/>
					))}
				</ul>
			</section>
		);

	return (
		<div data-testid="cheat-sheets-page" className="h-full overflow-y-auto">
			<div className="mx-auto flex w-full max-w-[908px] flex-col gap-9 px-6 py-9">
				{!active && <PickClass line="Pick a class to see its cheat sheets." />}
				{active && !view && failed && <LoadFailed message="Couldn't load this class's cheat sheets." onRetry={() => void reload()} />}
				{view?.cards.length === 0 && (
					<p data-testid="cheat-sheets-summary" className="text-[15px] text-ink-2">
						No deadlines yet. Add one to make a cheat sheet for it.
					</p>
				)}
				{error && (
					<p role="alert" className="text-[15px] text-ans-wrong">
						{error}
					</p>
				)}
				{list("Coming up", upcoming, summary)}
				{list("Past", past, upcoming.length === 0 && summary)}
			</div>
		</div>
	);
}

/** One deadline's row: its small page (the sheet's first page, or blank),
 *  its name and due day, where its sheet is, and that state's button. The
 *  whole row opens the cheat sheet. */
export function SheetCardView({
	card,
	classId,
	agentName,
	onRemake,
	show,
}: {
	card: SheetCard;
	classId: string;
	agentName: string;
	onRemake: () => void;
	/** Show in Finder for a made sheet (desktop only). */
	show: { label: string; run: () => void } | null;
}) {
	const first = card.version?.pages[0];
	const width = first ? Math.round(Math.min(THUMB_W, (THUMB_H * first.widthPt) / first.heightPt)) : 0;
	return (
		<li data-testid="cheat-sheet-card" data-status={card.status} className="relative flex items-center gap-4 border-b border-dotted border-edge px-1 py-3.5 transition-colors last:border-b-0 hover:bg-tone">
			<span aria-hidden className="flex shrink-0 items-center justify-center border border-border bg-background" style={{ width: THUMB_W, height: THUMB_H }}>
				{card.version && first && <PdfThumb url={sheetPdfPath(classId, card.deadlineId, card.version.n)} page={first} width={width} />}
			</span>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<h3 className="truncate text-[17px] leading-tight text-ink">
					{/* Stretched over the row, so a click anywhere opens the cheat sheet. */}
					<Link href={studioPath(card.deadlineId)} title={card.name} className="after:absolute after:inset-0">
						{card.name}
					</Link>
				</h3>
				<span className="truncate text-base text-ink-2">
					{kindLabel(card.kind)}, {whenLabel(card)}
				</span>
				<Status card={card} agentName={agentName} />
			</span>
			{show && card.status === "made" && (
				<button type="button" data-testid="cheat-sheet-show-file" onClick={show.run} className={ACTION}>
					{show.label}
				</button>
			)}
			{card.status === "older" && (
				<button type="button" data-testid="cheat-sheet-remake" onClick={onRemake} className={ACTION}>
					Make it again
				</button>
			)}
			{card.status === "none" && (
				<Link href={studioPath(card.deadlineId)} data-testid="cheat-sheet-make" className={ACTION}>
					Make one
				</Link>
			)}
			<PixelIcon name="chevron" className="h-3.5 shrink-0 text-ink" />
		</li>
	);
}

/** Above the row's stretched link. */
const ACTION = "lh-btn relative shrink-0 text-[15px]";

/** Where the deadline's sheet is, in one line. */
function Status({ card, agentName }: { card: SheetCard; agentName: string }) {
	switch (card.status) {
		case "made":
			return (
				<span className="truncate text-base text-ink-2">
					{pageSizeLabel(card.version!.pages)}, made {madeAt(card.version!.at)}
				</span>
			);
		case "making":
			return (
				<span className="flex items-center gap-2 text-base text-ink">
					<BrailleSpinner className="h-3 text-ink" />
					{card.version ? `${agentName} is on it` : `${agentName} is making it`}
				</span>
			);
		case "older":
			return <span className="text-base text-ink-2">Made by an older godspeed and can&apos;t be shown anymore.</span>;
		case "newer":
			return <span className="text-base text-ink-2">Made by a newer godspeed. Update godspeed to see it.</span>;
		case "none":
			return <span className="text-base text-ink-2">No cheat sheet yet</span>;
	}
}
