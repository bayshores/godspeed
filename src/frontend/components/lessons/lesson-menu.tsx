import type { RefObject } from "react";
import { MenuShell } from "@/frontend/components/menu-shell";
import { KeyHint, keyShortcutProps } from "@/frontend/components/ui/key-hint";
import { CoverageMenuBlock } from "@/frontend/components/extraction-coverage";
import { dispositionFileName, saveBlob } from "@/frontend/components/artifacts/download";

/**
 * THE LESSON MENU (a Progress row's More button, and the open lesson's More): the way out of a
 * waiting question or problem (the open lesson only), Rename,
 * Export as Markdown, Move to another space, Lesson stats (the open lesson only), Delete (the destructive
 * action last), then below a gap the extraction coverage block. MenuShell owns
 * placement, focus and arrow keys; the list owns dismissal. From the open
 * lesson's More in the top bar (`bar`) it hangs from the bar and Rename shows
 * its key.
 */

const ITEM = "lh-press flex items-center px-3 py-2 text-left hover:bg-accent";

/** Saves the lesson as a markdown file. A raw fetch, not a link: the server only answers requests
 *  the page itself makes, and the body is a download, not JSON. A failed export shows nothing, as a failed download did. */
async function exportMarkdown(chatId: string): Promise<void> {
	try {
		const res = await fetch(`/api/chats/${chatId}/markdown`);
		if (res.ok) saveBlob(dispositionFileName(res.headers.get("content-disposition")) ?? "lesson.md", await res.blob());
	} catch {
		// nothing to save
	}
}

export function LessonMenu({
	chatId,
	open,
	anchorRef,
	onRename,
	onMove,
	onStats,
	onDelete,
	onClose,
	bar,
	exit,
}: {
	chatId: string;
	open: boolean;
	anchorRef: RefObject<HTMLElement | null>;
	onRename: () => void;
	onMove: () => void;
	/** Only the open lesson's menu has stats to show. */
	onStats?: () => void;
	onDelete: () => void;
	onClose: () => void;
	bar?: boolean;
	/** The way out of what waits in the open lesson: "Skip question" or "Discard problem". */
	exit?: { label: string; testId: string; onPick: () => void };
}) {
	return (
		<MenuShell
			open={open}
			anchorRef={anchorRef}
			testid="lesson-menu"
			preferredSide="down"
			hang={bar}
			menuClass="lh-popup flex w-[250px] flex-col p-1.5 text-[15px]"
		>
			{exit && (
				<button role="menuitem" type="button" data-testid={exit.testId} onClick={exit.onPick} className={`${ITEM} text-ink`}>
					{exit.label}
				</button>
			)}
			<button role="menuitem" type="button" data-testid="ctx-rename" onClick={onRename} {...(bar && keyShortcutProps("rename-session"))} className={`${ITEM} justify-between gap-2 text-ink`}>
				Rename
				{bar && <KeyHint action="rename-session" />}
			</button>
			<button
				role="menuitem"
				type="button"
				data-testid="ctx-export-md"
				onClick={() => {
					onClose();
					void exportMarkdown(chatId);
				}}
				className={`${ITEM} text-ink`}
			>
				Export as Markdown
			</button>
			<button role="menuitem" type="button" data-testid="ctx-move-space" onClick={onMove} className={`${ITEM} text-ink`}>
				Move to another space
			</button>
			{onStats && (
				<button role="menuitem" type="button" data-testid="ctx-stats" onClick={onStats} className={`${ITEM} text-ink`}>
					Lesson stats
				</button>
			)}
			<button role="menuitem" type="button" data-testid="ctx-delete" onClick={onDelete} className={`${ITEM} text-ans-wrong`}>
				Delete
			</button>
			<div className="h-1.5" aria-hidden="true" />
			<CoverageMenuBlock chatId={chatId} />
		</MenuShell>
	);
}
