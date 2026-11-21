import type { CSSProperties } from "react";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import { nameSize, noteMark, type VaultNote } from "./note-pages-model";
import { browserName, canOpenNote, openNote } from "./open-note";
import { openLabel } from "./vault-model";

/**
 * One note as a portrait page with a folded corner: its name, the question that brings the idea
 * back, a band in the topic's color and the crystal. A click opens the note where it is read.
 * A page still being written is its outline, which inks in once written. `landing` is the delay
 * (ms) before the page steps in; left out, it is simply there. `asked` lights the page a question
 * below is about.
 */
export function NotePage({ note, obsidian, asked, landing }: { note: VaultNote; obsidian: boolean; asked?: boolean; landing?: number }) {
	const enter = landing === undefined ? undefined : "lh-block-in";
	const style = landing === undefined ? undefined : ({ "--lh-block-delay": `${landing}ms` } as CSSProperties);
	if (note.saving || !note.path) {
		return (
			<div data-testid="note-page" data-saving className={cn("lh-note-page lh-note-page-saving flex flex-col gap-2 p-4", enter)} style={style}>
				<span className={cn("shrink-0 leading-snug break-words text-ink-2", nameSize(note.name))}>{note.name}</span>
				<span className="sr-only">Saving</span>
				<span aria-hidden className="absolute bottom-0 left-0 h-2 w-1/2 bg-tone-2" />
			</div>
		);
	}
	const lit = asked && "shadow-[inset_0_0_0_2px_var(--color-ink)]";
	const mark = noteMark(note);
	const label = openLabel(obsidian, browserName());
	const body = (
		<>
			<span className={cn("shrink-0 leading-snug break-words text-ink", nameSize(note.name))}>{note.name}</span>
			{note.recall && <span className="line-clamp-3 shrink-0 text-[15px] leading-snug text-ink-2">{note.recall}</span>}
			<span className="mt-auto flex items-end justify-between gap-2 pb-1.5">
				<span className="text-[15px] text-ink-2">
					{mark && <span className="group-hover:hidden group-focus-visible:hidden">{mark}</span>}
					<span className={cn("text-ink underline underline-offset-2", mark ? "hidden group-hover:inline group-focus-visible:inline" : "invisible group-hover:visible group-focus-visible:visible")}>{label}</span>
				</span>
				<PixelIcon name="crystal" className="h-[18px] text-ink" />
			</span>
		</>
	);
	const band = <span aria-hidden className="absolute inset-x-0 bottom-0 h-2" style={{ background: note.color }} />;
	if (!canOpenNote(obsidian)) {
		return (
			<div data-testid="note-page" className={cn("lh-note-page flex flex-col gap-2 p-4", lit, enter)} style={style}>
				{body}
				{band}
			</div>
		);
	}
	return (
		<button type="button" data-testid="note-page" title={label} onClick={() => openNote(note.path!, obsidian)} className={cn("group lh-note-page flex flex-col gap-2 p-4 text-left", lit, enter)} style={style}>
			{body}
			{band}
		</button>
	);
}
