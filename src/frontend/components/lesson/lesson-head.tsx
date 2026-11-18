import { useEffect, type ReactNode, type RefObject } from "react";
import { useSpaces } from "@/frontend/components/space-context";
import { SessionFind } from "@/frontend/components/session-find";
import type { SessionScrollContext } from "@/frontend/components/session-navigation";
import { Hint } from "@/frontend/components/ui/hint";
import { cn } from "@/frontend/lib/utils";
import { kbdEventForAction } from "@/shared/core";
import { pluginWordTestId } from "./plugin-window";
import type { useTitleRename } from "./use-title-rename";

/** A word in the line; marked while its panel is open, as Follow is. */
const WORD = "lh-btn lh-btn-quiet shrink-0";
const WORD_ON = "lh-btn shrink-0 [--lh-key:var(--lh-highlight)] [--lh-key-hover:var(--lh-highlight)]";

/**
 * THE LESSON'S TITLE LINE, under the app's top bar: the lesson's name
 * (renames in place on a click, or F2), then the homework file, the
 * plugins' words, the cheat sheet, Find and the lesson's size. Opening Find
 * swaps the words for the find field. The lesson's space is the bar's
 * selected tab, which is also the way back.
 */
export function LessonHead({
	rename,
	spaceId,
	sheet,
	plugins,
	file,
	page,
	stats,
	scopeRef,
	scrollContextRef,
}: {
	rename: ReturnType<typeof useTitleRename>;
	spaceId: string | undefined;
	/** The cheat sheet beside the session (a session in a space). */
	sheet?: { open: boolean; onToggle: () => void };
	/** The plugins that show in lessons, each a word left of the cheat sheet; `open` is the one whose window is open. */
	plugins: { words: readonly { id: string; label: string }[]; open: string | null; onToggle: (id: string) => void };
	/** A homework lesson's assignment file, opened on the desktop. */
	file?: { name: string; path: string | null };
	/** The page of the file the open homework problem is on. */
	page?: number;
	/** The lesson size button. */
	stats: ReactNode;
	scopeRef: RefObject<HTMLDivElement | null>;
	scrollContextRef: RefObject<SessionScrollContext | null>;
}) {
	// The bar marks the lesson's own space, even when it was opened from another one.
	const { active, setActive } = useSpaces();
	const lessonSpace = spaceId ?? null;
	useEffect(() => {
		if (lessonSpace !== active) setActive(lessonSpace);
		// Only when the lesson opens: the learner may pick another space after.
	}, [lessonSpace]);
	const desktop = typeof window !== "undefined" ? window.lh : undefined;
	const pdf = !!file && /\.pdf$/i.test(file.name);
	const openFile = file?.path && desktop ? (pdf ? desktop.openPath : desktop.showInFolder) : undefined;
	const fileWord = file && `${file.name}${page ? `, page ${page}` : ""}`;
	return (
		<div data-testid="lesson-head" className="lh-page flex min-h-14 shrink-0 items-center gap-3 pt-3">
			<h1 className="sr-only">{rename.title}</h1>
			<div className="flex min-w-0 shrink text-[22px] text-ink">{rename.renaming ? <RenameInput rename={rename} /> : <TitleButton rename={rename} />}</div>
			<div className="flex-1" aria-hidden />
			{file && openFile && (
				<button type="button" data-testid="lesson-assignment" title={fileWord} onClick={() => void openFile(file.path!)} className={cn(WORD, "max-w-[34ch]")}>
					<span className="flex min-w-0">
						<span className="truncate">{file.name}</span>
						{page && <span className="shrink-0">{`, page ${page}`}</span>}
					</span>
				</button>
			)}
			<SessionFind scopeRef={scopeRef} scrollContextRef={scrollContextRef}>
				{plugins.words.map((w) => (
					<button key={w.id} type="button" data-testid={pluginWordTestId(w.id)} aria-pressed={plugins.open === w.id} onClick={() => plugins.onToggle(w.id)} className={plugins.open === w.id ? WORD_ON : WORD}>
						{w.label}
					</button>
				))}
				{sheet && (
					<button type="button" data-testid="lesson-cheat-sheet" aria-pressed={sheet.open} onClick={sheet.onToggle} className={sheet.open ? WORD_ON : WORD}>
						Cheat sheet
					</button>
				)}
				<button type="button" data-testid="lesson-find" onClick={() => window.dispatchEvent(new CustomEvent(kbdEventForAction("find")))} className={WORD}>
					Find
				</button>
				{stats}
			</SessionFind>
		</div>
	);
}

function TitleButton({ rename }: { rename: ReturnType<typeof useTitleRename> }) {
	return (
		<Hint label="Rename lesson" side="bottom">
			<button type="button" data-testid="lesson-title" onClick={rename.start} className="min-w-0 shrink cursor-text truncate text-left">
				{rename.title}
			</button>
		</Hint>
	);
}

function RenameInput({ rename }: { rename: ReturnType<typeof useTitleRename> }) {
	return (
		<input
			ref={rename.inputRef}
			value={rename.draft}
			onChange={(e) => rename.setDraft(e.target.value)}
			onKeyDown={(e) => {
				if (e.key === "Enter") void rename.commit(rename.draft);
				else if (e.key === "Escape") {
					// The rename claims its Esc: closing it must not abort a turn.
					e.stopPropagation();
					rename.cancel();
				}
			}}
			onBlur={() => void rename.commit(rename.draft)}
			spellCheck={false}
			aria-label="Lesson name"
			className="min-w-[8ch] max-w-full shrink bg-transparent caret-current outline-none [field-sizing:content]"
		/>
	);
}
