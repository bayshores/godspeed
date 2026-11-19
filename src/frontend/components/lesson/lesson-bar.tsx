import type { RefObject } from "react";
import { useSessionFind } from "@/frontend/components/session-find";
import type { SessionScrollContext } from "@/frontend/components/session-navigation";
import { BarFind } from "@/frontend/components/top-bar/bar-find";
import { barWord } from "@/frontend/components/top-bar/bar-look";
import { BarActions, BarCrumb, CrumbName } from "@/frontend/components/top-bar/bar-slots";
import { LessonMore } from "./lesson-more";
import type { LessonUsage } from "./lesson-stats";
import { pluginWordTestId } from "./plugin-window";
import { useLessonSpace } from "./use-lesson-space";
import type { useTitleRename } from "./use-title-rename";

/**
 * THE OPEN LESSON IN THE TOP BAR: its name after the lit space tab (renames
 * in place on a click, or F2), and on the bar's right the plugins' words,
 * Find, the cheat sheet and More (the lesson menu, which holds Lesson stats).
 * Opening Find swaps the words for the find field.
 */
export function LessonBar({
	chatId,
	rename,
	spaceId,
	sheet,
	plugins,
	usage,
	scopeRef,
	scrollContextRef,
}: {
	chatId: string;
	rename: ReturnType<typeof useTitleRename>;
	spaceId: string | undefined;
	/** The cheat sheet beside the session (a session in a space). */
	sheet?: { open: boolean; onToggle: () => void };
	/** The plugins that show in lessons, each a word; `open` is the one whose window is open. */
	plugins: { words: readonly { id: string; label: string }[]; open: string | null; onToggle: (id: string) => void };
	/** What More's Lesson stats shows. */
	usage: LessonUsage;
	scopeRef: RefObject<HTMLDivElement | null>;
	scrollContextRef: RefObject<SessionScrollContext | null>;
}) {
	useLessonSpace(spaceId);
	const find = useSessionFind(scopeRef, scrollContextRef);
	const findBar = (
		<BarFind
			label="Find in lesson"
			testIds={{ key: "lesson-find", field: "session-find" }}
			open={find.open}
			onOpen={find.start}
			query={find.query}
			onQuery={find.setQuery}
			inputRef={find.inputRef}
			keyRef={find.keyRef}
			onKeyDown={find.onKeyDown}
			count={find.count}
			step={{ onStep: find.step, disabled: !find.canStep }}
			onClose={find.close}
		/>
	);
	return (
		<>
			<h1 className="sr-only">{rename.title}</h1>
			<BarCrumb>{rename.renaming ? <RenameInput rename={rename} /> : <TitleButton rename={rename} />}</BarCrumb>
			<BarActions>
				{find.open ? (
					findBar
				) : (
					<>
						{plugins.words.map((w) => (
							<button key={w.id} type="button" data-testid={pluginWordTestId(w.id)} aria-pressed={plugins.open === w.id} onClick={() => plugins.onToggle(w.id)} className={barWord(plugins.open === w.id)}>
								{w.label}
							</button>
						))}
						{findBar}
						{sheet && (
							<button type="button" data-testid="lesson-cheat-sheet" aria-pressed={sheet.open} onClick={sheet.onToggle} className={barWord(sheet.open)}>
								Cheat sheet
							</button>
						)}
						<LessonMore chatId={chatId} title={rename.title} spaceId={spaceId} usage={usage} onRename={rename.start} />
					</>
				)}
			</BarActions>
		</>
	);
}

function TitleButton({ rename }: { rename: ReturnType<typeof useTitleRename> }) {
	return (
		<button type="button" data-testid="lesson-title" title={rename.title} onClick={rename.start} className="flex cursor-text items-center self-stretch text-left">
			<CrumbName text={rename.title} />
		</button>
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
			className="min-w-[12ch] max-w-full shrink bg-transparent caret-current outline-none [field-sizing:content]"
		/>
	);
}
