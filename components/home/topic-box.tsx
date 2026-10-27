import type { RefObject } from "react";
import { BookOpenIcon, CornerDownLeftIcon, DumbbellIcon, PlusIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type HomeMode = "teach" | "practice";

const MODES: { mode: HomeMode; label: string; Icon: typeof BookOpenIcon }[] = [
	{ mode: "teach", label: "Teach", Icon: BookOpenIcon },
	{ mode: "practice", label: "Practice", Icon: DumbbellIcon },
];

/** Enter starts the lesson; Shift+Enter is a new line, and an IME
 *  composition's Enter only confirms the text. */
export function isStartKey(e: { key: string; shiftKey: boolean; isComposing?: boolean }): boolean {
	return e.key === "Enter" && !e.shiftKey && !e.isComposing;
}

/** Teach / Practice: the selected mode is the white block. */
export function ModeSwitch({ mode, onMode }: { mode: HomeMode; onMode: (m: HomeMode) => void }) {
	return (
		<div data-testid="home-mode-switch" role="group" aria-label="Lesson type" className="flex gap-0.5">
			{MODES.map(({ mode: m, label, Icon }) => (
				<button
					key={m}
					type="button"
					data-testid={`home-mode-${m}`}
					aria-pressed={mode === m}
					onClick={() => onMode(m)}
					className={cn(
						"lh-press flex items-center gap-[7px] px-3.5 py-2 text-[13.5px] font-bold",
						mode === m ? "bg-ink text-black" : "bg-tone text-ink-2 hover:text-ink",
					)}
				>
					<Icon aria-hidden className="size-3.5" />
					{label}
				</button>
			))}
		</div>
	);
}

/**
 * The topic box: the learner's topic, then "Start from facts" (opens the
 * fact picker; with picks it shows the count and a clear button) and the
 * white "Start lesson ↵". Enter starts, Shift+Enter is a new line.
 */
export function TopicBox({
	text,
	onText,
	onStart,
	busy,
	inputRef,
	picks,
	canPick,
	onOpenPicker,
	onClearPicks,
}: {
	text: string;
	onText: (text: string) => void;
	onStart: () => void;
	busy: boolean;
	inputRef?: RefObject<HTMLTextAreaElement | null>;
	/** How many facts are picked. */
	picks: number;
	/** The class has facts to pick from. */
	canPick: boolean;
	onOpenPicker: () => void;
	onClearPicks: () => void;
}) {
	const empty = !text.trim();
	return (
		<form
			data-testid="home-topic-box"
			className="flex min-h-[132px] w-full flex-col justify-between bg-panel outline outline-1 -outline-offset-1 outline-tone-2 focus-within:outline-ink-3"
			onSubmit={(e) => {
				e.preventDefault();
				if (empty) inputRef?.current?.focus();
				else onStart();
			}}
		>
			<textarea
				ref={inputRef}
				data-testid="home-topic-input"
				aria-label="What do you want to learn?"
				value={text}
				onChange={(e) => onText(e.target.value)}
				onKeyDown={(e) => {
					if (isStartKey({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing })) {
						e.preventDefault();
						if (!empty) onStart();
					}
				}}
				placeholder="A topic, a homework method, or a question you're stuck on…"
				autoFocus
				rows={2}
				className="field-sizing-content lh-input max-h-60 min-h-[86px] w-full resize-none bg-transparent px-[18px] py-4 text-[17px] leading-snug text-ink outline-none placeholder:text-ink-3"
			/>
			<div className="flex items-center justify-between gap-3 pl-3.5">
				<div className="flex min-w-0 items-center gap-1">
					<button
						type="button"
						data-testid="practice-props-chip"
						disabled={!canPick && picks === 0}
						onClick={onOpenPicker}
						className="lh-press flex items-center gap-1.5 py-1 text-[13.5px] text-ink-2 hover:text-ink disabled:opacity-50 disabled:hover:text-ink-2"
					>
						<PlusIcon aria-hidden className="size-[13px]" />
						{picks > 0 ? (
							<span>
								<span className="font-mono tabular-nums">{picks}</span> {picks === 1 ? "fact" : "facts"} picked
							</span>
						) : (
							"Start from facts"
						)}
					</button>
					{picks > 0 && (
						<button
							type="button"
							data-testid="practice-props-clear"
							aria-label="Clear picked facts"
							onClick={onClearPicks}
							className="lh-press lh-fade flex size-6 items-center justify-center text-ink-3 hover:text-ink"
						>
							<XIcon aria-hidden className="size-3.5" />
						</button>
					)}
				</div>
				<button
					type="submit"
					data-testid="home-start"
					aria-disabled={empty || busy}
					disabled={busy}
					className="lh-press flex shrink-0 items-center gap-2 bg-ink px-[18px] py-3 text-[14.5px] font-extrabold text-black hover:bg-white disabled:opacity-60"
				>
					Start lesson
					<CornerDownLeftIcon aria-hidden className="size-3.5" />
				</button>
			</div>
		</form>
	);
}
