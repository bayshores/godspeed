import { useCallback, useRef, useState } from "react";
import { FolderIcon, FolderSyncIcon, UnlinkIcon } from "lucide-react";
import { MenuShell } from "@/components/menu-shell";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { shortenHome } from "./files-model";
import { useMenuDismiss } from "./use-menu-dismiss";

/**
 * THE LINKED FOLDER (Files page, in the Study material header): a chip
 * with the folder's short path. Clicking it opens a small box with the
 * full path, "New files in it are added as study material." and Unlink.
 * (Tooltips here can't hold buttons, so the box opens on click.)
 */
export function LinkedFolderChip({ path, disabled, onUnlink }: { path: string; disabled?: boolean; onUnlink: () => void }) {
	const [open, setOpen] = useState(false);
	const anchorRef = useRef<HTMLButtonElement>(null);
	const close = useCallback(() => setOpen(false), []);
	useMenuDismiss(open, close, anchorRef);
	return (
		<>
			<Tip title="Linked folder" hint="Click to see the folder or unlink it" side="bottom" align="end">
				<button
					ref={anchorRef}
					type="button"
					data-testid="class-folder"
					aria-haspopup="dialog"
					aria-expanded={open}
					onClick={() => setOpen((o) => !o)}
					className={cn("lh-press flex min-w-0 items-center gap-[7px] px-2 py-1.5 hover:bg-tone", open && "bg-tone")}
				>
					<FolderSyncIcon className="size-[13px] shrink-0 text-ink-3" aria-hidden />
					<span data-testid="class-folder-path" className="min-w-0 truncate text-[13px] text-ink-2">
						{shortenHome(path)}
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
				<div className="text-[12.5px] text-ink-2">New files in it are added as study material.</div>
				<div className="pt-1">
					<button
						type="button"
						data-testid="class-unlink-folder"
						disabled={disabled}
						onClick={() => {
							setOpen(false);
							onUnlink();
						}}
						className="lh-press flex items-center gap-1.5 bg-tone px-2.5 py-1.5 text-[13.5px] font-bold text-ink hover:bg-tone-2 disabled:opacity-50"
					>
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
				className="min-w-0 flex-1 border border-tone-2 bg-black px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:border-ink-3"
			/>
			<button type="button" onClick={onCancel} className="lh-press shrink-0 text-[13.5px] font-bold text-ink-2 hover:text-ink">
				Cancel
			</button>
			<button
				type="submit"
				data-testid="class-link-folder"
				disabled={disabled || !ready}
				className="lh-press shrink-0 bg-ink px-3 py-1.5 text-[13.5px] font-bold text-black hover:bg-white disabled:opacity-50"
			>
				Link
			</button>
		</form>
	);
}
