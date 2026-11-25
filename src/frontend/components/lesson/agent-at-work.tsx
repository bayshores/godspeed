import { useCallback, useContext, useId, useRef, type CSSProperties, type ReactNode } from "react";
import type { LessonWork } from "@/shared/core";
import { ChatActionsContext } from "@/frontend/components/chat-actions-context";
import { jsonInit, send } from "@/frontend/lib/api";
import { useLitMarker } from "@/frontend/components/lit-marker";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import { ApprovalCards } from "./approval-card";
import type { Arrive } from "./arrivals";
import { DeskStack } from "./desk-stack";
import { PencilLine } from "./pencil-line";
import { deskReading, deskRows, deskStack, type DeskRow } from "./wait-model";

/**
 * THE DESK: the lesson text's newest sheet while the teacher works on a reply. One sentence says
 * what the teacher does; under it, its plan or its steps in the server's words, the current one on
 * a tile where the pencil writes, and under them a card for each thing it waits for the learner to
 * allow; beside them, the files it works from as a stack of paper, the one it reads in front.
 * `foot` rests under it: the lines typed to the teacher that wait for it. With no files the rows
 * stand alone in the middle of the sheet.
 */
export function AgentAtWork({ head, work, arrive, foot }: { head: string | null; work: LessonWork; arrive: Arrive; foot: ReactNode }) {
	// Each desk's own arrival slots, so the next turn's desk steps in again.
	const slot = useId();
	const reading = deskReading(work);
	const stack = deskStack(work.files, reading);
	const { rows, under } = deskRows(work);
	const chatId = useContext(ChatActionsContext)?.chatId;
	const answer = useCallback(
		async (id: string, allow: boolean) => (chatId ? (await send(`/api/chats/${encodeURIComponent(chatId)}/approvals/${encodeURIComponent(id)}`, jsonInit("POST", { allow }))).error : null),
		[chatId],
	);
	return (
		<div data-testid="agent-at-work" className="lh-desk @container/desk flex flex-1 flex-col gap-6">
			{/* The sentence's line is kept while it has no words, so nothing moves when they come. */}
			<p data-testid="desk-head" className="lh-card-title min-h-[1lh]">
				{head && (
					<span key={head} className={cn(arrive(`${slot}:head:${head}`) && "lh-block-in")}>
						{head}
					</span>
				)}
			</p>
			<div className={cn("flex flex-1 gap-7 @max-[440px]/desk:flex-col", stack.length > 0 ? "min-h-[320px] @max-[440px]/desk:min-h-0" : "items-center justify-center")}>
				<div className={cn("flex min-w-0 flex-col", stack.length > 0 ? "flex-1" : "w-full max-w-[420px]")}>
					<DeskRows rows={rows} under={under} slot={slot} arrive={arrive} />
					<ApprovalCards approvals={work.approvals} slot={slot} arrive={arrive} answer={answer} />
				</div>
				{stack.length > 0 && (
					<div className="flex w-[44%] max-w-[300px] shrink-0 flex-col @max-[440px]/desk:h-[220px] @max-[440px]/desk:w-full @max-[440px]/desk:max-w-none @max-[360px]/desk:hidden">
						<DeskStack files={stack} reading={reading} />
					</div>
				)}
			</div>
			{foot}
		</div>
	);
}

/** The rows, each stepping in after the one above it. One tile lies under the current row and
 *  slides to the next one when the teacher moves on (useLitMarker); the newest step stands under
 *  the current plan item. */
function DeskRows({ rows, under, slot, arrive }: { rows: DeskRow[]; under: string | null; slot: string; arrive: Arrive }) {
	const list = useRef<HTMLOListElement>(null);
	const now = rows.find((row) => row.state === "now")?.key ?? null;
	const tile = useLitMarker(list, "[data-now]", now);
	return (
		<ol ref={list} data-testid="desk-plan" className="relative isolate flex min-w-0 flex-col gap-1">
			<div ref={tile} aria-hidden className="lh-lit-marker lh-desk-well lh-sheet" />
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
