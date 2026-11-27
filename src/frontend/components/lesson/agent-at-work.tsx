import { useCallback, useId, useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { LessonWork } from "@/shared/core";
import { jsonInit, send } from "@/frontend/lib/api";
import { useLitMarker } from "@/frontend/components/lit-marker";
import { usePresence } from "@/frontend/components/presence";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { useFold } from "@/frontend/components/use-fold";
import { cn } from "@/frontend/lib/utils";
import { ApprovalCards } from "./approval-card";
import type { Arrive } from "./arrivals";
import { PageStage } from "./page-stage";
import { PencilLine } from "./pencil-line";
import { deskPaper, deskRows, type DeskRow } from "./wait-model";

/**
 * THE DESK: what the teacher does while it works on a reply. One sentence says what it does; under
 * it, its plan or its steps in the server's words, the current one on a tile where the pencil
 * writes; then one sheet of paper with the page of the file it reads; then a card for each thing it
 * waits for the learner to allow. While its words come (`writing`) the sentence folds away and the
 * steps stay. `foot` rests under it: the lines typed to the teacher that wait for it. With `paper`
 * null the desk lays no paper: in the teacher panel, too narrow for it, and in a lesson whose page
 * shows the open problem's own sheet, which is the page the learner reads. With `room` (the lesson
 * page's right part, LessonScroll) the paper alone stays here, under the words, and the rest of the
 * desk rests on the writing row there, fading out there too while it is `closing`.
 */
export function AgentAtWork({
	chatId,
	head,
	writing,
	work,
	arrive,
	foot,
	paper,
	room,
	closing,
}: {
	chatId: string;
	head: string | null;
	writing: boolean;
	work: LessonWork;
	arrive: Arrive;
	foot: ReactNode;
	paper: ReturnType<typeof deskPaper>;
	room: HTMLElement | null;
	/** The turn has ended and the desk fades out. */
	closing: boolean;
}) {
	// Each desk's own arrival slots, so the next turn's desk steps in again.
	const slot = useId();
	// The file the desk opened on lies there at once; one the teacher turns to later steps in.
	const opened = useRef(paper?.reading.path);
	const { rows, under } = deskRows(work);
	const answer = useCallback(async (id: string, allow: boolean) => (await send(`/api/chats/${encodeURIComponent(chatId)}/approvals/${encodeURIComponent(id)}`, jsonInit("POST", { allow }))).error, [chatId]);
	const sheet = paper && <DeskSheet key={paper.reading.path} paper={paper} arrives={paper.reading.path !== opened.current} />;
	const steps = (
		<>
			<DeskHead head={head} writing={writing} slot={slot} arrive={arrive} />
			<div className="-ml-3 flex min-w-0 flex-col">
				<DeskRows rows={rows} under={under} slot={slot} arrive={arrive} />
			</div>
		</>
	);
	// The cards stand under the steps' tile, which hangs out past their marks. The paper gives way in a
	// low room, never the steps or the cards, whose folds would shrink to nothing.
	const cards = <ApprovalCards approvals={work.approvals} slot={slot} arrive={arrive} answer={answer} className="-ml-3 min-w-0 shrink-0" />;
	if (room)
		return (
			<>
				{sheet}
				{createPortal(
					<div data-testid="agent-at-work" data-state={closing ? "closed" : "open"} inert={closing} className={cn("lh-desk flex flex-col gap-6 pb-6", closing && "lh-fade")}>
						<div className="flex shrink-0 flex-col">{steps}</div>
						{cards}
						{foot}
					</div>,
					room,
				)}
			</>
		);
	return (
		<div data-testid="agent-at-work" className={cn("lh-desk flex flex-col gap-6", sheet && "flex-1")}>
			<div className="flex shrink-0 flex-col">{steps}</div>
			{sheet}
			{cards}
			{foot}
		</div>
	);
}

/** The desk's sentence, going while the teacher's words come. Its line is kept while it has
 *  no words, so nothing moves when they come. */
function DeskHead({ head, writing, slot, arrive }: { head: string | null; writing: boolean; slot: string; arrive: Arrive }) {
	// Going, it keeps the words it had: it fades out first, so they never lie over the rows, then its room folds shut.
	const last = useRef(head);
	if (!writing) last.current = head;
	const shown = writing ? last.current : head;
	const fade = usePresence(!writing);
	const fold = useFold(fade.mounted);
	if (!fold.mounted) return null;
	return (
		<div className="lh-collapse" data-state={fold.state}>
			<div data-state={fade.state} className={cn("pb-6", writing && "lh-fade")}>
				<p data-testid="desk-head" className="lh-card-title min-h-[1lh]">
					{shown && (
						<span key={shown} className={cn(arrive(`${slot}:head:${shown}`) && "lh-block-in")}>
							{shown}
						</span>
					)}
				</p>
			</div>
		</div>
	);
}

/** The paper: as tall as the room under the steps and over the cards, and at least a short page.
 *  Out of the flow, so the sheet takes the room its place has and never makes it taller. */
function DeskSheet({ paper, arrives }: { paper: NonNullable<ReturnType<typeof deskPaper>>; arrives: boolean }) {
	return (
		<div className="lh-desk relative min-h-[180px] flex-1">
			<div className="absolute inset-0 flex flex-col">
				<PageStage reading={paper.reading} still={paper.still} arrives={arrives} />
			</div>
		</div>
	);
}

/** The rows, each stepping in after the one above it. One tile lies under the current row and
 *  slides to the next one when the teacher moves on (useLitMarker); the newest step stands under
 *  the current plan item. The tile hangs out past the rows' marks, which stand under the sentence's
 *  first letter. */
function DeskRows({ rows, under, slot, arrive }: { rows: DeskRow[]; under: string | null; slot: string; arrive: Arrive }) {
	const list = useRef<HTMLOListElement>(null);
	const now = rows.find((row) => row.state === "now")?.key ?? null;
	const tile = useLitMarker(list, "[data-now]", now);
	return (
		<ol ref={list} data-testid="desk-plan" className="relative isolate flex min-w-0 flex-col gap-1">
			<div ref={tile} aria-hidden className="lh-lit-marker lh-sheet" />
			{rows.map((row, i) => (
				<li key={row.key} data-now={row.state === "now" || undefined} className={cn("flex gap-3 px-3 py-2.5", arrive(`${slot}:row:${row.key}`) && "lh-block-in")} style={{ "--lh-block-delay": `${i * 40}ms` } as CSSProperties}>
					{row.state === "now" && row.text === null ? (
						<PencilLine />
					) : (
						<>
							<Mark row={row} />
							<div className="flex min-w-0 flex-col gap-1.5">
								<RowText row={row} />
								{row.state === "now" && under && (
									<span key={under} className={cn("line-clamp-3 text-[14px] leading-5 break-words text-ink-2", arrive(`${slot}:under:${under}`) && "lh-block-in")} style={{ "--lh-block-delay": "60ms" } as CSSProperties}>
										{under}
									</span>
								)}
							</div>
						</>
					)}
				</li>
			))}
		</ol>
	);
}

/** Done: a check. Next: a small square. Now: the pencil, writing. */
function Mark({ row }: { row: DeskRow }) {
	return (
		<span className="flex h-5 w-5 shrink-0 items-center justify-center">
			{(row.state === "done" || row.state === "folded") && <PixelIcon name="check" className="text-ink-2" />}
			{row.state === "now" && (
				<span aria-hidden className="lh-pencil lh-pencil-mark">
					<PixelIcon name="pencil" className="lh-pencil-tip h-5" />
				</span>
			)}
			{row.state === "next" && <span className="size-2 bg-tone-2" />}
		</span>
	);
}

function RowText({ row }: { row: DeskRow }) {
	if (row.state === "folded") return <span className="font-count text-[15px] leading-5 text-ink-2">{row.count} done</span>;
	return (
		<span key={row.text} className={cn("line-clamp-2 text-[15px] leading-5 break-words", row.state === "now" ? "text-ink" : "text-ink-2")}>
			{row.text}
		</span>
	);
}
