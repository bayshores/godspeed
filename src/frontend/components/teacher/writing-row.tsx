import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { LessonBox } from "@/frontend/components/lesson/lesson-box";
import type { BoxView } from "@/frontend/components/lesson/lesson-box-model";
import { usePresence } from "@/frontend/components/presence";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";
import { cn } from "@/frontend/lib/utils";
import { IdeaList } from "./idea-list";
import type { IdeaGroup } from "./starter-model";
import type { Box } from "./use-talk-box";
import { AFTER_GLIDE_MS } from "./use-thread-scroll";

/** The box's look in the panel: its keys stand on their own line under it, drawn by the row. */
const PANEL_BOX = (canSend: boolean, busy: boolean): BoxView => ({ placeholder: "Ask anything", keys: [], enter: canSend ? "send" : null, attach: !busy, help: null });

/**
 * The writing row pinned at the panel's foot: an error row, the box (the attach glyph in its well),
 * then its keys on their own line, so the row never changes height: Ideas once the chat is used,
 * the model key, Stop while a reply runs, and Send, the bright key only while the box holds
 * something to send. A line sent while the teacher works steers it, and a steer carries no files.
 * On a page with its own box (`noBox`) the chat is there only for its card: the row keeps the error
 * row and Stop, and the two fade into each other's place as the learner moves between pages.
 */
export function WritingRow({ name, noBox, box, focus, busy, error, ideas, made, model, onSend, onLine, onStop }: {
	name: string;
	noBox: boolean;
	box: Box;
	focus: boolean;
	busy: boolean;
	error: { text: string; detail?: string; onRetry: (() => void) | null } | null;
	ideas: readonly IdeaGroup[] | null;
	/** The chat was made by the line just sent, so Ideas comes now. */
	made: boolean;
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
	// Stop comes once the desk has opened, and never for a reply that lands before.
	const stop = usePresence(useHeld(busy && !!onStop, AFTER_GLIDE_MS));
	// Ideas fades in when it comes; in a chat opened with it, it is there at rest.
	const [ideasAtRest] = useState(!!ideas && !made);
	// The row fades only when it swaps with the boxless one, never as it is first drawn.
	const [shown, setShown] = useState({ noBox, swapped: false });
	if (shown.noBox !== noBox) setShown({ noBox, swapped: true });
	const swap = shown.swapped && "lh-fade";
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
	if (noBox)
		return (
			<div key="no-box" data-testid="talk-no-box" className={cn("flex shrink-0 flex-col gap-2.5 px-[18px] pt-2.5 pb-[18px]", swap)}>
				{errorRow}
				<div className="flex min-h-10 items-center justify-end">{stopKey}</div>
			</div>
		);
	return (
		<div key="writing" ref={row} data-testid="talk-writing" className={cn("relative flex shrink-0 flex-col gap-2.5 px-[18px] pt-2.5 pb-[18px]", swap)}>
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
					<button type="button" data-testid="talk-ideas" aria-expanded={list} onClick={() => setList((v) => !v)} className={cn("lh-btn shrink-0", !ideasAtRest && "lh-fade")}>
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

/** True once `on` has held for `ms`; false as soon as it ends. */
function useHeld(on: boolean, ms: number): boolean {
	const [held, setHeld] = useState(false);
	if (!on && held) setHeld(false);
	useEffect(() => {
		if (!on) return;
		const timer = setTimeout(() => setHeld(true), ms);
		return () => clearTimeout(timer);
	}, [on, ms]);
	return on && held;
}
