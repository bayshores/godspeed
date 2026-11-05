import { useCallback, useRef, useState } from "react";
import { FolderIcon, FolderOpenIcon, FolderSyncIcon, TriangleAlertIcon, UnlinkIcon } from "lucide-react";
import { MAX_LINKED_FILES, type FolderProblem, type FolderStatus } from "@/core";
import { MenuShell } from "@/components/menu-shell";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { folderStatusLine, skippedLines } from "./folder-status-model";
import { useMenuDismiss } from "@/components/use-menu-dismiss";
import { LABEL_TEXT } from "@/components/ui/label-text";

/** What the box says about each folder problem. */
const PROBLEM_LINE: Record<FolderProblem, string> = {
	missing: "Can't find this folder. It may have been moved, renamed or on a drive that isn't plugged in. Its files and facts are kept.",
	"not-responding": "This folder isn't answering right now, so nothing is removed. If it's on Google Drive, make sure Drive is open and not paused.",
	empty: "This folder shows no files right now, so nothing is removed. If you emptied it on purpose, unlink it.",
	"too-many-files": `Only the first ${MAX_LINKED_FILES} files were added. Link a smaller folder to choose which ones.`,
};

const BOX_BUTTON = "lh-press flex items-center gap-1.5 bg-tone px-2.5 py-1.5 text-[13.5px] font-bold text-ink hover:bg-tone-2 disabled:opacity-50";

/**
 * THE LINKED FOLDER (Files page, top bar): a live line, "Watching CSE 21
 * on Google Drive · 2 can't be read · checked just now", or a plain
 * warning when the folder is gone, looks empty, isn't responding or still
 * has files downloading. Clicking it opens a small box with the full path,
 * what the folder does (or what is wrong with it), which files it can't
 * read, and its buttons: Pick folder again
 * (the safe way to switch folders), Open in Finder (desktop app, while the
 * folder can be read) and Unlink,
 * which asks first.
 * (Tooltips here can't hold buttons, so the box opens on click.)
 */
export function LinkedFolderChip({
	path,
	status,
	now,
	disabled,
	open: openFolder,
	onPickAgain,
	onUnlink,
}: {
	path: string;
	status: FolderStatus;
	/** The current minute, for "checked 4 minutes ago" (null before the first render). */
	now: number | null;
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
	const line = folderStatusLine(path, status, now);
	const skipped = skippedLines(status.skipped);
	return (
		<>
			<Tip title="Linked folder" side="bottom" align="end">
				<button
					ref={anchorRef}
					type="button"
					data-testid="class-folder"
					data-problem={problem ?? undefined}
					aria-haspopup="dialog"
					aria-expanded={open}
					onClick={() => setOpen((o) => !o)}
					className={cn("lh-press flex min-w-0 items-center gap-[7px] px-2 py-1.5 hover:bg-tone", open && "bg-tone")}
				>
					{problem ? (
						<TriangleAlertIcon className="size-[13px] shrink-0 text-ans-wrong" aria-hidden />
					) : (
						<FolderSyncIcon className="size-[13px] shrink-0 text-ink-3" aria-hidden />
					)}
					<span data-testid="class-folder-status" className={cn("min-w-0 truncate text-[13px]", line.warn ? "font-bold text-ans-wrong" : "text-ink-2")}>
						{line.text}
					</span>
				</button>
			</Tip>
			<MenuShell
				open={open}
				anchorRef={anchorRef}
				testid="class-folder-box"
				role="dialog"
				label="Linked folder"
				preferredSide="down"
				menuClass="lh-popup flex w-[300px] flex-col gap-2 px-[13px] py-[11px]"
			>
				<div className={LABEL_TEXT}>Linked folder</div>
				<div className="break-all font-mono text-xs leading-[1.4] text-ink-2">{path}</div>
				{problem ? (
					<div data-testid="class-folder-problem" className="text-[12.5px] text-ans-wrong">
						{PROBLEM_LINE[problem]}
					</div>
				) : (
					<div className="text-[12.5px] text-ink-2">New files in it are added and sorted into study material or course info as your agent reads them.</div>
				)}
				{skipped.length > 0 && (
					<div data-testid="class-folder-skipped" className="flex flex-col gap-1 text-[12.5px] text-ink-2">
						{skipped.map((text) => (
							<p key={text} className="break-words">
								{text}
							</p>
						))}
					</div>
				)}
				<div className="flex flex-wrap gap-2 pt-1">
					<button type="button" data-testid="class-folder-pick-again" disabled={disabled} onClick={pick(onPickAgain)} className={BOX_BUTTON}>
						<FolderSyncIcon className="size-[13px]" aria-hidden />
						Pick folder again
					</button>
					{openFolder && !unreadable && (
						<button type="button" data-testid="class-folder-open" onClick={pick(openFolder.run)} className={BOX_BUTTON}>
							<FolderOpenIcon className="size-[13px]" aria-hidden />
							{openFolder.label}
						</button>
					)}
					<button type="button" data-testid="class-unlink-folder" disabled={disabled} onClick={pick(onUnlink)} className={BOX_BUTTON}>
						<UnlinkIcon className="size-[13px]" aria-hidden />
						Unlink
					</button>
				</div>
			</MenuShell>
		</>
	);
}

/** "Link folder" (no folder linked yet): a quiet header button. */
export function LinkFolderButton({ disabled, onClick }: { disabled?: boolean; onClick: () => void }) {
	return (
		<button
			type="button"
			data-testid="class-pick-folder"
			disabled={disabled}
			onClick={onClick}
			className="lh-press flex items-center gap-1.5 px-2.5 py-1.5 text-[13.5px] font-bold text-ink-2 hover:bg-tone hover:text-ink disabled:opacity-60"
		>
			<FolderSyncIcon className="size-[13px]" aria-hidden />
			Link folder
		</button>
	);
}

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
			data-testid="class-folder-form"
			className="flex w-full items-center gap-3 px-3 pb-2.5"
			onSubmit={(e) => {
				e.preventDefault();
				if (ready) onLink(value);
			}}
		>
			<FolderIcon className="size-4 shrink-0 text-ink-2" aria-hidden />
			<input
				type="text"
				data-testid="class-folder-input"
				aria-label="Folder path"
				value={value}
				onChange={(e) => setValue(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						e.stopPropagation();
						onCancel();
					}
				}}
				placeholder="/Users/you/School/MATH20C"
				autoFocus
				className="min-w-0 flex-1 border border-edge bg-background px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:border-ink"
			/>
			<button type="button" onClick={onCancel} className="lh-press shrink-0 text-[13.5px] font-bold text-ink-2 hover:text-ink">
				Cancel
			</button>
			<button
				type="submit"
				data-testid="class-link-folder"
				disabled={disabled || !ready}
				className="lh-press shrink-0 bg-ink px-3 py-1.5 text-[13.5px] font-bold text-background hover:bg-ink-max disabled:opacity-50"
			>
				Link
			</button>
		</form>
	);
}
