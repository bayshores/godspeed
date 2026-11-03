import { useState } from "react";
import { ArrowUpIcon, GripVerticalIcon, PinIcon, PinOffIcon, RefreshCwIcon, ShrinkIcon, Trash2Icon } from "lucide-react";
import type { CheatSheetBlock } from "@/core";
import { fieldKeys } from "@/components/lesson/panel-parts";
import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/utils";

const ICON = "lh-press flex size-8 items-center justify-center text-ink-2 hover:bg-tone-2 hover:text-ink disabled:opacity-50";
const WORD = "lh-press flex h-8 items-center gap-2 px-2.5 text-[13.5px] font-bold text-ink hover:bg-tone-2 disabled:opacity-50";

/** The clicked block's toolbar: drag to move, pin, Tighten, Redo, remove. */
export function BlockToolbar({
	block,
	busy,
	onPin,
	onTighten,
	onRedo,
	onRemove,
}: {
	block: CheatSheetBlock;
	/** The agent is working: Tighten and Redo wait. */
	busy: boolean;
	onPin: () => void;
	onTighten: () => void;
	onRedo: () => void;
	onRemove: () => void;
}) {
	return (
		<div data-testid="block-toolbar" role="toolbar" aria-label={`${block.title} block`} className="flex items-center gap-0.5 bg-panel p-1 shadow-[0_4px_16px_#000000b3] outline outline-1 -outline-offset-1 outline-tone-2">
			<Hint label="Drag to move">
				<span
					draggable
					onDragStart={(e) => {
						e.dataTransfer.setData("text/x-sheet-block", block.id);
						e.dataTransfer.effectAllowed = "move";
					}}
					className={cn(ICON, "cursor-grab")}
				>
					<GripVerticalIcon className="size-4" aria-hidden />
				</span>
			</Hint>
			<Hint label={block.pinned ? "Unpin" : "Pin: keep it when the sheet is made again"}>
				<button type="button" aria-label={block.pinned ? "Unpin" : "Pin"} aria-pressed={!!block.pinned} onClick={onPin} className={ICON}>
					{block.pinned ? <PinOffIcon className="size-4" aria-hidden /> : <PinIcon className="size-4" aria-hidden />}
				</button>
			</Hint>
			<span className="mx-1 h-5 w-px bg-tone-2" aria-hidden />
			<button type="button" data-testid="block-tighten" disabled={busy} onClick={onTighten} className={WORD}>
				<ShrinkIcon className="size-4 text-ink-2" aria-hidden />
				Tighten
			</button>
			<button type="button" data-testid="block-redo" disabled={busy} onClick={onRedo} className={WORD}>
				<RefreshCwIcon className="size-4 text-ink-2" aria-hidden />
				Redo
			</button>
			<span className="mx-1 h-5 w-px bg-tone-2" aria-hidden />
			<Hint label="Remove">
				<button type="button" aria-label="Remove" onClick={onRemove} className={ICON}>
					<Trash2Icon className="size-4" aria-hidden />
				</button>
			</Hint>
		</div>
	);
}

/** Beside the clicked block: why it says what it says, and a box to ask
 *  for a change to it. Enter sends; the text stays until the request goes
 *  through. */
export function AskPanel({
	block,
	color,
	busy,
	onAsk,
}: {
	block: CheatSheetBlock;
	color: string;
	busy: boolean;
	/** Resolves to the error line, or null once the request went through. */
	onAsk: (text: string) => Promise<string | null>;
}) {
	const [text, setText] = useState("");
	const [sending, setSending] = useState(false);
	const send = () => {
		if (!text.trim() || busy || sending) return;
		setSending(true);
		void onAsk(text.trim()).then((error) => {
			setSending(false);
			if (!error) setText("");
		});
	};
	return (
		<div data-testid="block-ask" className="flex w-[245px] flex-col gap-3 bg-panel p-4 shadow-[0_4px_16px_#000000b3] outline outline-1 -outline-offset-1 outline-tone-2">
			<p className="flex items-center gap-2.5 text-sm font-bold text-ink">
				<span className="size-2.5 shrink-0" style={{ background: color }} aria-hidden />
				{block.reason}
			</p>
			{block.why && <p className="font-prose text-[14px] leading-5 text-ink-2">{block.why}</p>}
			<div className="relative">
				<textarea
					aria-label="Ask for a change to this block"
					value={text}
					rows={3}
					maxLength={400}
					placeholder="Ask for a change to this block"
					onChange={(e) => setText(e.target.value)}
					onKeyDown={(e) => fieldKeys(e, send)}
					className="lh-input w-full resize-none border border-edge bg-background px-3 py-2.5 pr-11 text-[14px] text-ink placeholder:text-ink-3 focus:border-ink"
				/>
				<button
					type="button"
					aria-label="Send"
					data-testid="block-ask-send"
					disabled={!text.trim() || busy || sending}
					onClick={send}
					className="lh-press absolute right-2 bottom-2.5 flex size-7 items-center justify-center bg-ink text-background hover:bg-ink-max disabled:opacity-40"
				>
					<ArrowUpIcon className="size-4" aria-hidden />
				</button>
			</div>
			<p className="text-[12px] text-ink-3">Changes only this block.</p>
		</div>
	);
}
