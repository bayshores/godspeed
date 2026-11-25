import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { LessonBox } from "@/frontend/components/lesson/lesson-box";
import type { BoxView } from "@/frontend/components/lesson/lesson-box-model";
import { usePresence } from "@/frontend/components/presence";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";
import { cn } from "@/frontend/lib/utils";
import { IdeaList } from "./idea-list";
import type { BoxPage, IdeaGroup } from "./starter-model";
import type { Box } from "./use-talk-box";

/** The box's look in the panel: its keys stand on their own line under it, drawn by the row. */
const PANEL_BOX = (canSend: boolean, busy: boolean): BoxView => ({ placeholder: "Ask anything", keys: [], enter: canSend ? "send" : null, attach: !busy, help: null });

/**
 * The writing row pinned at the panel's foot: an error row, the box (the attach glyph in its well),
 * then its keys on their own line, so the row never changes height: Ideas once the chat is used,
 * the model key, Stop while a reply runs, and Send, the bright key only while the box holds
 * something to send. A line sent while the teacher works steers it, and a steer carries no files.
 * On a page with its own box the row is one quiet line instead, with Stop while a reply runs; the
 * two fade into each other's place as the learner moves between pages.
 */
export function WritingRow({ name, page, box, focus, busy, error, ideas, model, onSend, onLine, onStop }: {
	name: string;
	page: BoxPage | null;
	box: Box;
	focus: boolean;
	busy: boolean;
	error: { text: string; detail?: string; onRetry: (() => void) | null } | null;
	ideas: readonly IdeaGroup[] | null;
	model: ReactNode;
	onSend: () => void;
	/** Sends a line from the Ideas list as if typed. */
	onLine: (line: string) => void;
	onStop: (() => void) | null;
}) {
	const boxRef = useRef<{ focus(): void }>(null);
	useEffect(() => {
		if (focus) boxRef.current?.focus();
	}, [focus]);
	const hasText = box.text.trim().length > 0;
	const hasFiles = box.files.files.length > 0;
	const canSend = (hasText || hasFiles) && !(busy && hasFiles);
	const stop = usePresence(busy && !!onStop);
	const [list, setList] = useState(false);
	const row = useRef<HTMLDivElement>(null);
	useMenuDismiss(list, useCallback(() => setList(false), []), row);
	const stopKey = stop.mounted && (
		<button type="button" data-testid="talk-stop" data-state={stop.state} onClick={() => onStop?.()} className="lh-btn lh-fade shrink-0">
			Stop
		</button>
	);
	// One main key: Try again, unless the box holds words to send.
	const errorRow = error && (
		<div data-testid="talk-error" className="lh-rise flex flex-wrap items-center justify-between gap-x-4 gap-y-2 lh-well px-4 py-3 text-[15px]">
			<span title={error.detail} className="text-ans-wrong">
				{error.text}
			</span>
			{error.onRetry && (
				<button type="button" data-testid="talk-retry" onClick={error.onRetry} className={cn("lh-btn lh-btn-small shrink-0", !canSend && "lh-btn-main")}>
					Try again
				</button>
			)}
		</div>
	);
	if (page)
		return (
			<div data-testid="talk-gives-way" className="lh-fade flex shrink-0 flex-col gap-2.5 px-[18px] pt-2.5 pb-[18px]">
				{errorRow}
				<div className="flex min-h-10 items-center justify-between gap-3">
					<p className="text-[15px] text-ink-2">{page === "lesson" ? "Type in the lesson's box." : "Type in the cheat sheet's box."}</p>
					{stopKey}
				</div>
			</div>
		);
	return (
		<div ref={row} data-testid="talk-writing" className="lh-fade relative flex shrink-0 flex-col gap-2.5 px-[18px] pt-2.5 pb-[18px]">
			{ideas && (
				<IdeaList
					groups={list ? ideas : null}
					label={`Everything ${name} can do`}
					onSend={(line) => {
						setList(false);
						onLine(line);
					}}
				/>
			)}
			{errorRow}
			<LessonBox view={PANEL_BOX(canSend, busy)} value={box.text} onChange={box.setText} onAct={onSend} attachments={box.files} boxRef={boxRef} />
			<div className="flex min-h-10 flex-wrap items-center justify-end gap-x-3 gap-y-2">
				{ideas && (
					<button type="button" data-testid="talk-ideas" aria-expanded={list} onClick={() => setList((v) => !v)} className="lh-btn shrink-0">
						Ideas
					</button>
				)}
				{model}
				{stopKey}
				<button type="button" data-testid="talk-send" disabled={!canSend} onClick={onSend} className={cn("lh-btn shrink-0", canSend && "lh-btn-main")}>
					Send
				</button>
			</div>
		</div>
	);
}
