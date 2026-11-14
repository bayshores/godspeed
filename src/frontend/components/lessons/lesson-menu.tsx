import type { RefObject } from "react";
import { MenuShell } from "@/frontend/components/menu-shell";
import { CoverageMenuBlock } from "@/frontend/components/extraction-coverage";
import { dispositionFileName, saveBlob } from "@/frontend/components/artifacts/download";

/**
 * THE LESSON MENU (a lesson row's More button or a right-click): Rename,
 * Export as Markdown, Move to another space, Delete (the destructive
 * action last), then below a dotted rule the extraction coverage block. MenuShell owns
 * placement, focus and arrow keys; the list owns dismissal.
 */

const ITEM = "lh-press flex items-center px-3 py-2 text-left hover:bg-accent";

/** Saves the lesson as a markdown file. A fetch, not a link: the server only answers requests
 *  the page itself makes. A failed export shows nothing, as a failed download did. */
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
	onDelete,
	onClose,
}: {
	chatId: string;
	open: boolean;
	anchorRef: RefObject<HTMLElement | null>;
	onRename: () => void;
	onMove: () => void;
	onDelete: () => void;
	onClose: () => void;
}) {
	return (
		<MenuShell
			open={open}
			anchorRef={anchorRef}
			testid="session-context-menu"
			preferredSide="down"
			menuClass="lh-popup flex w-[250px] flex-col p-1.5 text-[15px]"
		>
			<button role="menuitem" type="button" data-testid="ctx-rename" onClick={onRename} className={`${ITEM} text-ink`}>
				Rename
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
			<button role="menuitem" type="button" data-testid="ctx-delete" onClick={onDelete} className={`${ITEM} text-ans-wrong`}>
				Delete
			</button>
			<div className="mx-3 my-1.5 border-t border-dotted border-edge" aria-hidden="true" />
			<CoverageMenuBlock chatId={chatId} />
		</MenuShell>
	);
}
