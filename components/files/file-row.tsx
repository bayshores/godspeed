import { memo, useCallback, useRef, useState, type DragEvent } from "react";
import { ArrowRightLeftIcon, CaptionsIcon, CircleXIcon, EllipsisIcon, FileTextIcon, GripVerticalIcon, LoaderIcon, RotateCwIcon, Trash2Icon } from "lucide-react";
import type { ClassFile, FileCoverage } from "@/src/core";
import { MenuShell } from "@/components/menu-shell";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useMenuDismiss } from "./use-menu-dismiss";
import { canRemove, canRetry, FILE_DRAG_TYPE, fileAnchorId, fileState, kindTitle, studiedFill, type FileState } from "./files-model";

/**
 * ONE FILE ROW (Files page, design/godspeed-redesign.pen "Files — panels"):
 * drag grip (on hover), icon, name, the row's state ("12/31 facts studied"
 * with its bar, "Building facts…", "Waiting", "Failed · Retry") and the ⋯
 * menu (Move to the other section, Retry, Remove). The row has no box of
 * its own; the one under the mouse lights up. Drag it into the other
 * section to switch its kind. Memoized: a row redraws only when its own
 * file, coverage, flash or drag state changes.
 */

export interface FileRowActions {
	onKind: (fileId: string, kind: "study" | "info") => void;
	onRetry: (fileId: string) => void;
	onRemove: (fileId: string) => void;
	/** A row drag started (null: it ended). */
	onDrag?: (file: ClassFile | null) => void;
}

const RECORDING = /\.(vtt|srt|mp3|m4a|wav|mp4|mov)$/i;

export const FileRow = memo(function FileRow({
	file,
	coverage,
	disabled,
	flash,
	dragging,
	actions,
}: {
	file: ClassFile;
	coverage: FileCoverage | undefined;
	disabled?: boolean;
	/** Briefly outlined: the row a "#file-<id>" link landed on. */
	flash?: boolean;
	/** This row is being dragged: it fades in place. */
	dragging?: boolean;
	actions: FileRowActions;
}) {
	const state = fileState(file, coverage);
	const Icon = RECORDING.test(file.name) ? CaptionsIcon : FileTextIcon;
	const { onDrag } = actions;
	const onDragStart = useCallback(
		(e: DragEvent<HTMLLIElement>) => {
			e.dataTransfer.setData(FILE_DRAG_TYPE, file.id);
			e.dataTransfer.effectAllowed = "move";
			onDrag?.(file);
		},
		[file, onDrag],
	);
	return (
		<li
			id={fileAnchorId(file.id)}
			data-testid={`class-file-${file.id}`}
			data-flash={flash || undefined}
			draggable={!disabled}
			onDragStart={onDragStart}
			onDragEnd={() => onDrag?.(null)}
			className={cn(
				"group flex scroll-m-6 items-center gap-2.5 py-2.5 pr-3 pl-2 outline-offset-[-1px] transition-[outline-color,opacity] duration-(--lh-dur-slow) hover:bg-tone",
				flash ? "outline outline-1 outline-ink" : "outline outline-1 outline-transparent",
				dragging && "opacity-30",
			)}
		>
			<GripVerticalIcon className="size-3.5 shrink-0 cursor-grab text-ink-3 opacity-0 group-hover:opacity-100" aria-hidden />
			<Icon className="size-[15px] shrink-0 text-ink-2" aria-hidden />
			{file.origin === "linked" && file.path !== file.name ? (
				<Tip title="Linked folder" body={<span className="break-all">{file.path}</span>} side="bottom" align="start">
					<span tabIndex={0} className="min-w-0 flex-1 truncate text-[14.5px] text-ink outline-none">
						{file.name}
					</span>
				</Tip>
			) : (
				<span className="min-w-0 flex-1 truncate text-[14.5px] text-ink">{file.name}</span>
			)}
			<RowState fileId={file.id} state={state} disabled={disabled} onRetry={actions.onRetry} />
			<RowMenu file={file} disabled={disabled} actions={actions} />
		</li>
	);
});

function RowState({
	fileId,
	state,
	disabled,
	onRetry,
}: {
	fileId: string;
	state: FileState;
	disabled?: boolean;
	onRetry: (fileId: string) => void;
}) {
	switch (state.kind) {
		case "coverage":
			return <CoverageCell fileId={fileId} state={state} />;
		case "building":
			return (
				<span data-testid={`class-file-status-${fileId}`} className="flex w-[216px] shrink-0 items-center gap-2 text-[13px] text-ink-2">
					<LoaderIcon className="size-[13px] animate-spin motion-reduce:animate-none" aria-hidden />
					Building facts…
				</span>
			);
		case "waiting":
			return (
				<span data-testid={`class-file-status-${fileId}`} className="w-[216px] shrink-0 text-[13px] text-ink-2">
					Waiting
				</span>
			);
		case "failed": {
			const label = (
				<span data-testid={`class-file-status-${fileId}`} tabIndex={state.error ? 0 : undefined} className="text-[13px] font-bold text-ans-wrong outline-none">
					{state.label}
				</span>
			);
			return (
				<span className="flex w-[216px] shrink-0 items-center gap-2">
					<CircleXIcon className="size-[13px] shrink-0 text-ans-wrong" aria-hidden />
					{state.error ? (
						<Tip title={state.label} body={<span className="whitespace-pre-wrap break-words">{state.error}</span>} side="bottom">
							{label}
						</Tip>
					) : (
						label
					)}
					<button
						type="button"
						data-testid={`class-file-retry-${fileId}`}
						disabled={disabled}
						onClick={() => onRetry(fileId)}
						className="lh-press ml-1 text-[13px] font-bold text-ink hover:text-white disabled:opacity-50"
					>
						Retry
					</button>
				</span>
			);
		}
		case "none":
			return null;
	}
}

/** "12/31 facts studied" with its bar: the fill is the share of the file's
 *  facts that came up in a lesson. */
function CoverageCell({ fileId, state }: { fileId: string; state: Extract<FileState, { kind: "coverage" }> }) {
	const fill = studiedFill(state);
	return (
		<span data-testid={`class-file-status-${fileId}`} className="flex w-[216px] shrink-0 items-center gap-2.5">
			<span className="flex h-[5px] w-[72px] shrink-0 bg-tone-2" aria-hidden>
				{fill > 0 && <span data-testid="file-coverage-fill" className="h-full bg-ink-2" style={{ width: `${Math.round(fill * 100)}%` }} />}
			</span>
			<span className="flex items-baseline gap-[5px] whitespace-nowrap">
				<span className={cn("font-mono text-[12.5px] tabular-nums", state.inLessons > 0 ? "text-ink-2" : "text-ink-3")}>
					{state.inLessons}/{state.facts}
				</span>
				<span className="text-[13px] text-ink-3">facts studied</span>
			</span>
		</span>
	);
}

const MENU_ITEM = "lh-press flex items-center gap-[9px] px-2.5 py-[7px] text-left hover:bg-tone";

/** The ⋯ menu: Move to the other section, Retry (stuck or failed) and
 *  Remove (the app's own copies). */
function RowMenu({ file, disabled, actions }: { file: ClassFile; disabled?: boolean; actions: FileRowActions }) {
	const [open, setOpen] = useState(false);
	const anchorRef = useRef<HTMLButtonElement>(null);
	const retry = canRetry(file);
	const remove = canRemove(file);
	const other = file.kind === "study" ? "info" : "study";

	const close = useCallback(() => setOpen(false), []);
	useMenuDismiss(open, close, anchorRef);
	const pick = (act: () => void) => () => {
		setOpen(false);
		act();
	};

	return (
		<>
			<button
				ref={anchorRef}
				type="button"
				aria-label={`More for ${file.name}`}
				aria-haspopup="menu"
				aria-expanded={open}
				data-testid={`class-file-menu-${file.id}`}
				disabled={disabled}
				onClick={() => setOpen((o) => !o)}
				className={cn("lh-press shrink-0 hover:text-ink disabled:opacity-50", open ? "text-ink" : "text-ink-3 group-hover:text-ink-2")}
			>
				<EllipsisIcon className="size-[15px]" aria-hidden />
			</button>
			<MenuShell
				open={open}
				anchorRef={anchorRef}
				testid={`class-file-menu-body-${file.id}`}
				preferredSide="down"
				menuClass="flex w-[196px] flex-col gap-0.5 border border-tone-2 bg-panel p-1.5 text-[13.5px] shadow-xl"
			>
				<button type="button" data-testid={`class-file-move-${file.id}`} onClick={pick(() => actions.onKind(file.id, other))} className={`${MENU_ITEM} text-ink`}>
					<ArrowRightLeftIcon className="size-3.5 shrink-0" aria-hidden />
					Move to {kindTitle(other)}
				</button>
				{retry && (
					<button type="button" data-testid={`class-file-menu-retry-${file.id}`} onClick={pick(() => actions.onRetry(file.id))} className={`${MENU_ITEM} text-ink`}>
						<RotateCwIcon className="size-3.5 shrink-0" aria-hidden />
						Retry
					</button>
				)}
				{remove && (
					<>
						<span className="my-0.5 h-px bg-tone-2" aria-hidden />
						<button
							type="button"
							data-testid={`class-file-remove-${file.id}`}
							aria-label={`Remove ${file.name}`}
							onClick={pick(() => actions.onRemove(file.id))}
							className={`${MENU_ITEM} text-ans-wrong`}
						>
							<Trash2Icon className="size-3.5 shrink-0" aria-hidden />
							Remove
						</button>
					</>
				)}
			</MenuShell>
		</>
	);
}
