"use client";

import { useState } from "react";
import Link from "next/link";
import { FileTextIcon } from "lucide-react";
import { pageSizeLabel, whenLabel, type SheetCard } from "@/shared/core";
import { useAgentStatus } from "@/frontend/components/agent-status";
import { BrailleSpinner } from "@/frontend/components/braille-spinner";
import { useClasses } from "@/frontend/components/class-context";
import { kindLabel } from "@/frontend/components/class-deadlines-model";
import { useMinute } from "@/frontend/components/countdown";
import { dueAtMs } from "@/frontend/components/countdown-model";
import { LoadFailed } from "@/frontend/components/load-failed";
import { PickClass } from "@/frontend/components/pick-class";
import { TopBar } from "@/frontend/components/app-bar";
import { PdfThumb } from "./pdf-thumb";
import { fileBrowserName } from "@/frontend/components/files/files-model";
import { remakeSheet, sheetPdfPath, showSheetPdf, studioPath, useClassSheets } from "./use-cheat-sheet";
import { LABEL_TEXT } from "@/frontend/components/ui/label-text";
import { Decode } from "@/frontend/components/ui/decode";

/** The preview's box: the first page fits inside it. */
const THUMB_W = 150;
const THUMB_H = 190;

const madeAt = (at: string) => new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * THE CLASS'S CHEAT SHEETS: every deadline of the class you're in as a
 * card, coming up first, then past ones, each saying whether it has a
 * sheet. A made sheet shows its first page (drawn from the real PDF once
 * the card is in view), its paper and when it was made; a card opens the
 * deadline's studio.
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
	const section = (title: string, cards: readonly SheetCard[]) =>
		cards.length > 0 && (
			<section className="flex flex-col gap-3">
				<h2 className={LABEL_TEXT}>{title}</h2>
				<div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
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
				</div>
			</section>
		);

	return (
		<div className="flex h-full flex-col" data-testid="cheat-sheets-page">
			<TopBar path={[{ label: "cheat sheets", href: null }]} />
			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
				{!active && (
					<div className="m-auto px-[52px]">
						<PickClass line="Pick a class to see its cheat sheets." />
					</div>
				)}
				{active && !view && !failed && <p className="m-auto text-sm text-ink-2">Loading…</p>}
				{active && !view && failed && <LoadFailed message="Couldn't load this class's cheat sheets." onRetry={() => void reload()} className="m-auto" />}
				{view && (
					<div className="flex w-full flex-col gap-8 px-[52px] pb-8">
						<header className="flex flex-col gap-2 py-6">
							<h1 className="font-bold text-[40px] leading-[48px] tracking-tight text-ink">
								<Decode text="Cheat sheets" />
							</h1>
							<p data-testid="cheat-sheets-summary" className="text-base leading-6 text-ink-2">
								{view.cards.length === 0 ? "No deadlines yet. Add one to make a cheat sheet for it." : `${made} of ${view.cards.length} ${view.cards.length === 1 ? "deadline has" : "deadlines have"} a sheet`}
							</p>
						</header>
						{error && (
							<p role="alert" className="text-[13px] text-ans-wrong">
								{error}
							</p>
						)}
						{section("Coming up", upcoming)}
						{section("Past", past)}
					</div>
				)}
			</div>
		</div>
	);
}

/** One deadline's card: its preview (or an empty page), its name and due
 *  day, and where its sheet is. */
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
		<article data-testid="cheat-sheet-card" data-status={card.status} className="flex flex-col bg-panel outline outline-1 -outline-offset-1 outline-tone-2">
			<Link href={studioPath(card.deadlineId)} className="lh-press group flex flex-col hover:bg-tone">
				<div className="flex items-center justify-center bg-tone py-4 group-hover:bg-tone-2" style={{ height: THUMB_H + 32 }}>
					{card.version && first ? (
						<PdfThumb url={sheetPdfPath(classId, card.deadlineId, card.version.n)} page={first} width={width} />
					) : (
						<div className="flex items-center justify-center outline outline-1 -outline-offset-1 outline-dashed outline-ink-3" style={{ width: THUMB_H * 0.72, height: THUMB_H }}>
							<FileTextIcon className="size-6 text-ink-3" aria-hidden />
						</div>
					)}
				</div>
				<div className="flex flex-col gap-0.5 px-3.5 pt-3">
					<h3 className="truncate text-[15px] font-bold text-ink">{card.name}</h3>
					<p className="text-[13px] text-ink-2">
						{kindLabel(card.kind)}, {whenLabel(card)}
					</p>
				</div>
			</Link>
			<div className="flex min-h-[44px] flex-wrap items-center gap-x-3 gap-y-2 px-3.5 pt-1.5 pb-3.5 text-[13px]">
				<Status card={card} agentName={agentName} onRemake={onRemake} />
				{show && card.status === "made" && (
					<button type="button" data-testid="cheat-sheet-show-file" onClick={show.run} className={ACTION}>
						{show.label}
					</button>
				)}
			</div>
		</article>
	);
}

const ACTION = "lh-btn";

function Status({ card, agentName, onRemake }: { card: SheetCard; agentName: string; onRemake: () => void }) {
	switch (card.status) {
		case "made":
			return (
				<span className="text-ink-2">
					{pageSizeLabel(card.version!.pages)}, made {madeAt(card.version!.at)}
				</span>
			);
		case "making":
			return (
				<span className="flex items-center gap-2 font-bold text-ink">
					<BrailleSpinner className="h-3 text-ink" />
					{card.version ? `${agentName} is on it` : `${agentName} is making it`}
				</span>
			);
		case "older":
			return (
				<>
					<span className="text-ink-2">Made by an older godspeed and can&apos;t be shown anymore.</span>
					<button type="button" data-testid="cheat-sheet-remake" onClick={onRemake} className={ACTION}>
						Make it again
					</button>
				</>
			);
		case "newer":
			return <span className="text-ink-2">Made by a newer godspeed. Update godspeed to see it.</span>;
		case "none":
			return (
				<>
					<span className="text-ink-2">No cheat sheet yet</span>
					<Link href={studioPath(card.deadlineId)} data-testid="cheat-sheet-make" className={ACTION}>
						Make one
					</Link>
				</>
			);
	}
}

