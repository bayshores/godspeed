import { useCallback, useRef, useState } from "react";
import { MAX_LINKED_FILES, type FolderProblem, type FolderStatus } from "@/shared/core";
import { MenuShell } from "@/frontend/components/menu-shell";
import { cn } from "@/frontend/lib/utils";
import { folderStatusLine, skippedLines } from "./folder-status-model";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";

/** What the box says about each folder problem. */
const PROBLEM_LINE: Record<FolderProblem, string> = {
	missing: "Can't find this folder. It may have been moved, renamed or on a drive that isn't plugged in. Its files and facts are kept.",
	"not-responding": "This folder isn't answering right now, so nothing is removed. If it's on Google Drive, make sure Drive is open and not paused.",
	empty: "This folder shows no files right now, so nothing is removed. If you emptied it on purpose, unlink it.",
	"too-many-files": `Only the first ${MAX_LINKED_FILES} files were added. Link a smaller folder to choose which ones.`,
};

/** A plain button in the Files page's top row and the folder box. */
export const ROW_BUTTON = "lh-btn h-[38px] shrink-0 bg-panel text-[15px]";

/**
 * "Linked folder" (Files page): opens a box with the full path, what the
 * folder does (or what is wrong with it), which files it can't read, and
 * its buttons: Pick folder again (the safe way to switch folders), Open
 * in Finder (desktop app, while the folder can be read) and Unlink, which
 * asks first.
 */
export function LinkedFolderButton({
	path,
	status,
	disabled,
	open: openFolder,
	onPickAgain,
	onUnlink,
}: {
	path: string;
	status: FolderStatus;
	disabled?: boolean;
	/** "Open in Finder" (desktop app only): its label and action. */
	open?: { label: string; run: () => void };
	onPickAgain: () => void;
	onUnlink: () => void;
}) {
	const [open, setOpen] = useState(false);
	const anchorRef = useRef<HTMLButtonElement>(null);
	const close = useCallback(() => setOpen(false), []);
	useMenuDismiss(open, close, anchorRef);
	const pick = (act: () => void) => () => {
		setOpen(false);
		act();
	};
	const { problem } = status;
	const unreadable = problem === "missing" || problem === "not-responding";
	const skipped = skippedLines(status.skipped);
	return (
		<>
			<button
				ref={anchorRef}
				type="button"
				data-testid="space-folder"
				data-problem={problem ?? undefined}
				aria-haspopup="dialog"
				aria-expanded={open}
				onClick={() => setOpen((o) => !o)}
				className={cn(ROW_BUTTON, open && "bg-tone")}
			>
				Linked folder
			</button>
			<MenuShell
				open={open}
				anchorRef={anchorRef}
				testid="space-folder-box"
				role="dialog"
				label="Linked folder"
				preferredSide="down"
				align="right"
				menuClass="lh-popup flex w-[400px] max-w-[calc(100vw-2rem)] flex-col gap-2.5 px-[18px] py-3.5"
			>
				<h2 className="text-xl text-ink">Linked folder</h2>
				<p className="font-count text-base break-all text-ink">{path}</p>
				{problem ? (
					<p data-testid="space-folder-problem" className="text-[15px] text-ans-wrong">
						{PROBLEM_LINE[problem]}
					</p>
				) : (
					<p className="text-[15px] text-ink-2">New files in it are added and sorted into study material or space info as your agent reads them.</p>
				)}
				{skipped.length > 0 && (
					<p data-testid="space-folder-skipped" className="text-[15px] break-words text-ink-2">
						{skipped.join(" ")}
					</p>
				)}
				<div className="flex flex-wrap items-center gap-2 pt-1">
					<button type="button" data-testid="space-folder-pick-again" disabled={disabled} onClick={pick(onPickAgain)} className={ROW_BUTTON}>
						Pick folder again
					</button>
					{openFolder && !unreadable && (
						<button type="button" data-testid="space-folder-open" onClick={pick(openFolder.run)} className={ROW_BUTTON}>
							{openFolder.label}
						</button>
					)}
					<span className="flex-1" />
					<button type="button" data-testid="space-unlink-folder" disabled={disabled} onClick={pick(onUnlink)} className="lh-btn lh-btn-quiet text-[15px] text-ans-wrong hover:text-ans-wrong-hover">
						Unlink
					</button>
				</div>
			</MenuShell>
		</>
	);
}

/** Under the summary: a square (red for a problem) and the folder's live
 *  line, "Watching CSE 21 on Google Drive, checked 2 minutes ago", or a
 *  plain warning. */
export function FolderStatusLine({ path, status, now }: { path: string; status: FolderStatus; now: number | null }) {
	const line = folderStatusLine(path, status, now);
	return (
		<p className="flex items-center gap-2 text-[15px]">
			<span aria-hidden className={cn("size-2.5 shrink-0", line.warn ? "bg-ans-wrong" : "bg-ans-right")} />
			<span data-testid="space-folder-status" className={cn("min-w-0", line.warn ? "text-ans-wrong" : "text-ink-2")}>
				{line.text}
			</span>
		</p>
	);
}

/** "Link a folder" (no folder linked yet). */
export function LinkFolderButton({ disabled, onClick }: { disabled?: boolean; onClick: () => void }) {
	return (
		<button type="button" data-testid="space-pick-folder" disabled={disabled} onClick={onClick} className={ROW_BUTTON}>
			Link a folder
		</button>
	);
}

const FIELD = "h-10 min-w-0 flex-1 rounded border-[1.5px] border-ink bg-background px-3 text-[15px] text-ink placeholder:text-ink-3";

/** The path field (no native folder picker): type a folder, Link. */
export function LinkFolderField({
	initial,
	disabled,
	onLink,
	onCancel,
}: {
	initial: string;
	disabled?: boolean;
	onLink: (path: string) => void;
	onCancel: () => void;
}) {
	const [value, setValue] = useState(initial);
	const ready = value.trim() !== "" && value.trim() !== initial;
	return (
		<form
			data-testid="space-folder-form"
			className="flex w-full items-center gap-2.5"
			onSubmit={(e) => {
				e.preventDefault();
				if (ready) onLink(value);
			}}
		>
			<input
				type="text"
				data-testid="space-folder-input"
				aria-label="Folder path"
				value={value}
				onChange={(e) => setValue(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						e.stopPropagation();
						onCancel();
					}
				}}
				placeholder="/Users/you/Documents/MATH20C"
				autoFocus
				className={FIELD}
			/>
			<button type="button" onClick={onCancel} className={ROW_BUTTON}>
				Cancel
			</button>
			<button type="submit" data-testid="space-link-folder" disabled={disabled || !ready} className="lh-btn lh-btn-main h-[38px] shrink-0 text-[15px]">
				Link
			</button>
		</form>
	);
}
