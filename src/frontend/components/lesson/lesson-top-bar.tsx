import type { RefObject } from "react";
import { Link } from "react-router";
import { useSpaces } from "@/frontend/components/space-context";
import { SessionFind } from "@/frontend/components/session-find";
import type { SessionScrollContext } from "@/frontend/components/session-navigation";
import { Hint } from "@/frontend/components/ui/hint";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import { kbdEventForAction } from "@/shared/core";
import type { useTitleRename } from "./use-title-rename";

/** A button on the dark lesson bar: outlined in the bar's own ink. */
const BAR_BUTTON = "lh-btn lh-btn-bar lh-no-drag";
/** A plain word on the bar, as tall as the bar; lit when its panel is open. */
const NAV_WORD = "lh-no-drag h-12 shrink-0 px-4 text-[15px] text-bar-ink hover:bg-bar-ink/10";

/**
 * THE LESSON'S OWN BAR, in place of the app's top bar: the way back to the
 * space's lessons, the lesson's name (renames in place on a click, or F2),
 * then the homework file, the cheat sheet and Find. Opening Find swaps the
 * cheat sheet and Find words for the find field.
 */
export function LessonTopBar({
	rename,
	spaceId,
	sheet,
	file,
	scopeRef,
	scrollContextRef,
}: {
	rename: ReturnType<typeof useTitleRename>;
	spaceId: string | undefined;
	/** The cheat sheet beside the session (a session in a space). */
	sheet?: { open: boolean; onToggle: () => void };
	/** A homework lesson's assignment file, opened on the desktop. */
	file?: { name: string; path: string | null };
	scopeRef: RefObject<HTMLDivElement | null>;
	scrollContextRef: RefObject<SessionScrollContext | null>;
}) {
	const { spaces, active, setActive } = useSpaces();
	const backLabel = spaces.find((c) => c.id === spaceId)?.name ?? "Lessons";
	// A lesson opened from another space's page goes back to its own space.
	const lessonSpace = spaceId ?? null;
	const toOwnSpace = () => {
		if (lessonSpace !== active) setActive(lessonSpace);
	};
	const desktop = typeof window !== "undefined" ? window.lh : undefined;
	const pdf = !!file && /\.pdf$/i.test(file.name);
	const openFile = file?.path && desktop ? (pdf ? desktop.openPath : desktop.showInFolder) : undefined;
	return (
		<div data-testid="lesson-bar" className="lh-own-bar lh-drag lh-lights-gutter lh-wco-gutter flex h-12 shrink-0 select-none items-center gap-4 bg-bar px-6 text-bar-ink">
			<Link to="/space/lessons" data-testid="page-back" onClick={toOwnSpace} className={`${BAR_BUTTON} max-w-[28ch] px-3`}>
				<PixelIcon name="chevron" className="-scale-x-100" />
				<span className="truncate">{backLabel}</span>
			</Link>
			<h1 className="sr-only">{rename.title}</h1>
			<div className="flex min-w-0 shrink text-lg font-medium">{rename.renaming ? <RenameInput rename={rename} /> : <TitleButton rename={rename} />}</div>
			<div className="flex-1" aria-hidden />
			{file && openFile && (
				<button type="button" data-testid="lesson-assignment" title={file.name} onClick={() => void openFile(file.path!)} className={`${BAR_BUTTON} max-w-[24ch]`}>
					<span className="truncate">{file.name}</span>
				</button>
			)}
			<SessionFind scopeRef={scopeRef} scrollContextRef={scrollContextRef}>
				{sheet && (
					<button type="button" data-testid="lesson-cheat-sheet" aria-pressed={sheet.open} onClick={sheet.onToggle} className={cn(NAV_WORD, sheet.open && "bg-bar-ink font-medium text-bar hover:bg-bar-ink")}>
						Cheat sheet
					</button>
				)}
				<button type="button" data-testid="lesson-find" onClick={() => window.dispatchEvent(new CustomEvent(kbdEventForAction("find")))} className={NAV_WORD}>
					Find
				</button>
			</SessionFind>
		</div>
	);
}

function TitleButton({ rename }: { rename: ReturnType<typeof useTitleRename> }) {
	return (
		<Hint label="Rename lesson" side="bottom">
			<button
				type="button"
				data-testid="lesson-title"
				onClick={rename.start}
				className="lh-no-drag min-w-0 shrink cursor-text truncate text-left"
			>
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
			className="lh-no-drag min-w-[8ch] max-w-full shrink bg-transparent caret-current outline-none [field-sizing:content]"
		/>
	);
}
