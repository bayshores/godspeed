import type { RefObject } from "react";
import { MenuShell } from "@/components/menu-shell";
import { CoverageMenuBlock } from "@/components/extraction-coverage";

/**
 * THE LESSON MENU (right-click a lesson row): Rename, Export as
 * Markdown, Move to class, Delete (the destructive action last), then
 * below a hairline the extraction coverage block. MenuShell owns
 * placement, focus and arrow keys; the list owns dismissal.
 */

const ITEM = "lh-press flex items-center px-2.5 py-1.5 text-left hover:bg-tone";

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
			menuClass="flex w-52 flex-col gap-0.5 border border-tone-2 bg-panel p-1.5 text-[13px] shadow-xl"
		>
			<button type="button" data-testid="ctx-rename" onClick={onRename} className={`${ITEM} text-ink`}>
				Rename
			</button>
			<button
				type="button"
				data-testid="ctx-export-md"
				onClick={() => {
					onClose();
					// Same-origin download; the route's Content-Disposition names the file.
					const a = document.createElement("a");
					a.href = `/api/chats/${chatId}/markdown`;
					a.download = "";
					document.body.appendChild(a);
					a.click();
					a.remove();
				}}
				className={`${ITEM} text-ink`}
			>
				Export as Markdown…
			</button>
			<button type="button" data-testid="ctx-move-class" onClick={onMove} className={`${ITEM} text-ink`}>
				Move to class…
			</button>
			<button type="button" data-testid="ctx-delete" onClick={onDelete} className={`${ITEM} text-ink-2 hover:text-ink`}>
				Delete…
			</button>
			<div className="my-0.5 border-t border-tone-2" aria-hidden="true" />
			<CoverageMenuBlock chatId={chatId} />
		</MenuShell>
	);
}
