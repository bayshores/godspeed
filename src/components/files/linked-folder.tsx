import { useState } from "react";
import { FolderIcon } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import { shortenHome } from "./files-model";

/**
 * THE LINKED FOLDER ROW (Files page): the folder's path, "New files are
 * added as study material", and Unlink. Outside the desktop app (no
 * folder picker) "Link folder" opens this row as a path field instead.
 */
export function LinkedFolderRow({ path, disabled, onUnlink }: { path: string; disabled?: boolean; onUnlink: () => void }) {
	const short = shortenHome(path);
	return (
		<div data-testid="class-folder" className="flex w-full items-center gap-3 bg-panel px-3.5 py-3">
			<FolderIcon className="size-4 shrink-0 text-ink-2" aria-hidden />
			<div className="flex min-w-0 flex-1 items-center gap-2.5">
				<Tip title="Linked folder" body={<span className="break-all">{path}</span>} disabled={short === path} side="bottom" align="start">
					<span data-testid="class-folder-path" tabIndex={short === path ? undefined : 0} className="min-w-0 truncate text-sm font-semibold text-ink outline-none">
						{short}
					</span>
				</Tip>
				<span className="shrink-0 truncate text-[13px] text-ink-3">New files are added as study material</span>
			</div>
			<button
				type="button"
				data-testid="class-unlink-folder"
				disabled={disabled}
				onClick={onUnlink}
				className="lh-press shrink-0 text-[13.5px] font-bold text-ink-2 hover:text-ink disabled:opacity-50"
			>
				Unlink
			</button>
		</div>
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
			className="flex w-full items-center gap-3 bg-panel px-3.5 py-2.5"
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
				className="min-w-0 flex-1 bg-black px-2.5 py-1.5 text-sm text-ink border border-tone-2 placeholder:text-ink-3 focus:border-ink-3"
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
