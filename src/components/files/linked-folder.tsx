import { useCallback, useRef, useState } from "react";
import { FolderIcon, FolderOpenIcon, FolderSyncIcon, TriangleAlertIcon, UnlinkIcon } from "lucide-react";
import { MAX_LINKED_FILES, type FolderProblem } from "@/core";
import { MenuShell } from "@/components/menu-shell";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { shortenHome } from "./files-model";
import { useMenuDismiss } from "./use-menu-dismiss";

/** What the box says about each folder problem. */
const PROBLEM_LINE: Record<FolderProblem, string> = {
	missing: "Can't find this folder. It may have been moved, renamed or on a drive that isn't plugged in. Its files and facts are kept.",
	"too-many-files": `Only the first ${MAX_LINKED_FILES} files were added. Link a smaller folder to choose which ones.`,
};

const BOX_BUTTON = "lh-press flex items-center gap-1.5 bg-tone px-2.5 py-1.5 text-[13.5px] font-bold text-ink hover:bg-tone-2 disabled:opacity-50";

/**
 * THE LINKED FOLDER (Files page, in the Study material header): a chip
 * with the folder's short path, or "Can't find this folder" when it is
 * gone. Clicking it opens a small box with the full path, what the folder
 * does (or what is wrong with it), and its buttons: Pick folder again
 * (folder missing), Open in Finder (desktop app) and Unlink.
 * (Tooltips here can't hold buttons, so the box opens on click.)
 */
export function LinkedFolderChip({
	path,
	problem,
	disabled,
	open: openFolder,
	onPickAgain,
	onUnlink,
}: {
	path: string;
	problem: FolderProblem | null;
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
	const missing = problem === "missing";
	return (
		<>
			<Tip title="Linked folder" hint="Click to see the folder or unlink it" side="bottom" align="end">
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
					<span data-testid="class-folder-path" className={cn("min-w-0 truncate text-[13px]", missing ? "font-bold text-ans-wrong" : "text-ink-2")}>
						{missing ? "Can't find this folder" : shortenHome(path)}
					</span>
				</button>
			</Tip>
			<MenuShell
				open={open}
				anchorRef={anchorRef}
				testid="class-folder-box"
				preferredSide="down"
				menuClass="flex w-[300px] flex-col gap-2 border border-tone-2 bg-tip px-[13px] py-[11px] shadow-[0_0_28px_#000000e6]"
			>
				<div className="text-sm font-bold text-ink">Linked folder</div>
				<div className="break-all font-mono text-xs leading-[1.4] text-ink-2">{path}</div>
				{problem ? (
					<div data-testid="class-folder-problem" className="text-[12.5px] text-ans-wrong">
						{PROBLEM_LINE[problem]}
					</div>
				) : (
					<div className="text-[12.5px] text-ink-2">New files in it are added as study material.</div>
				)}
				<div className="flex flex-wrap gap-2 pt-1">
					{missing && (
						<button type="button" data-testid="class-folder-pick-again" disabled={disabled} onClick={pick(onPickAgain)} className={BOX_BUTTON}>
							<FolderSyncIcon className="size-[13px]" aria-hidden />
							Pick folder again
						</button>
					)}
					{openFolder && !missing && (
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
				className="min-w-0 flex-1 border border-tone-2 bg-background px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:border-ink-3"
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
