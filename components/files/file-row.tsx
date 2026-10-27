import { memo, useCallback, useRef, useState } from "react";
import { CaptionsIcon, EllipsisIcon, FileTextIcon, LoaderIcon } from "lucide-react";
import type { ClassFile, FileCoverage } from "@/src/core";
import { MenuShell } from "@/components/menu-shell";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useMenuDismiss } from "./use-menu-dismiss";
import { canRemove, canRetry, coverageBar, factsLabel, fileAnchorId, fileState, type FileState } from "./files-model";

/**
 * ONE FILE ROW (Files page, design/exports/files.html): icon, name, the
 * row's state (coverage bar + fact count, "Building facts…", "Waiting",
 * "Failed · Retry"), the Study/Info toggle and the ⋯ menu (Retry,
 * Remove). Memoized: a row redraws only when its own file, coverage or
 * flash changes.
 */

export interface FileRowActions {
	onKind: (fileId: string, kind: "study" | "info") => void;
	onRetry: (fileId: string) => void;
	onRemove: (fileId: string) => void;
}

const RECORDING = /\.(vtt|srt|mp3|m4a|wav|mp4|mov)$/i;

export const FileRow = memo(function FileRow({
	file,
	coverage,
	disabled,
	flash,
	actions,
}: {
	file: ClassFile;
	coverage: FileCoverage | undefined;
	disabled?: boolean;
	/** Briefly outlined: the row a "#file-<id>" link landed on. */
	flash?: boolean;
	actions: FileRowActions;
}) {
	const state = fileState(file, coverage);
	const Icon = RECORDING.test(file.name) ? CaptionsIcon : FileTextIcon;
	const name = <span className="min-w-0 flex-1 truncate text-[14.5px] text-ink">{file.name}</span>;
	return (
		<li
			id={fileAnchorId(file.id)}
			data-testid={`class-file-${file.id}`}
			data-flash={flash || undefined}
			className={cn(
				"flex scroll-m-6 items-center gap-3.5 bg-tone px-3.5 py-2.5 outline-offset-[-1px] transition-[outline-color] duration-(--lh-dur-slow)",
				flash ? "outline outline-1 outline-ink" : "outline outline-1 outline-transparent",
			)}
		>
			<Icon className="size-[15px] shrink-0 text-ink-2" aria-hidden />
			{file.origin === "linked" && file.path !== file.name ? (
				<Tip title="Linked folder" body={<span className="break-all">{file.path}</span>} side="bottom" align="start">
					<span tabIndex={0} className="min-w-0 flex-1 truncate text-[14.5px] text-ink outline-none">
						{file.name}
					</span>
				</Tip>
			) : (
				name
			)}
			<RowState fileId={file.id} state={state} disabled={disabled} onRetry={actions.onRetry} />
			<KindToggle file={file} disabled={disabled} onKind={actions.onKind} />
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
				<span data-testid={`class-file-status-${fileId}`} className="flex shrink-0 items-center gap-1.5 text-[13px] text-ink-2">
					<LoaderIcon className="size-[13px] animate-spin motion-reduce:animate-none" aria-hidden />
					Building facts…
				</span>
			);
		case "waiting":
			return (
				<span data-testid={`class-file-status-${fileId}`} className="shrink-0 text-[13px] text-ink-2">
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
				<span className="flex shrink-0 items-center gap-2">
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
						className="lh-press text-[13px] font-bold text-ink hover:text-white disabled:opacity-50"
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

function CoverageCell({ fileId, state }: { fileId: string; state: Extract<FileState, { kind: "coverage" }> }) {
	const bar = coverageBar(state);
	return (
		<Tip
			side="bottom"
			body={
				<span className="text-xs text-ink-2">
					{state.inLessons} of {state.facts} facts came up in lessons
				</span>
			}
			disabled={state.facts === 0}
		>
			<span data-testid={`class-file-status-${fileId}`} tabIndex={state.facts > 0 ? 0 : undefined} className="flex shrink-0 items-center gap-2.5 outline-none">
				<span className={cn("flex h-1.5 w-20", bar.unstudied ? "bg-ink" : "bg-tone-2")} aria-hidden>
					{!bar.unstudied && bar.fill > 0 && <span data-testid="file-coverage-fill" className="h-full bg-ink-3" style={{ width: `${Math.round(bar.fill * 100)}%` }} />}
				</span>
				<span className="w-16 text-end font-mono text-[12.5px] tabular-nums text-ink-3">{factsLabel(state.facts)}</span>
			</span>
		</Tip>
	);
}

/** Study / Info: two segments; the file's kind is the lit one. */
function KindToggle({ file, disabled, onKind }: { file: ClassFile; disabled?: boolean; onKind: (fileId: string, kind: "study" | "info") => void }) {
	return (
		<span role="group" aria-label={`${file.name} kind`} className="flex shrink-0 outline outline-1 -outline-offset-1 outline-tone-2">
			{(["study", "info"] as const).map((kind) => {
				const on = file.kind === kind;
				return (
					<button
						key={kind}
						type="button"
						aria-pressed={on}
						data-testid={`class-file-kind-${file.id}-${kind}`}
						disabled={disabled}
						onClick={() => {
							if (!on) onKind(file.id, kind);
						}}
						className={cn(
							"lh-press px-2.5 py-1 text-[12.5px] font-bold",
							on ? "bg-tone-2 text-ink" : "text-ink-3 hover:text-ink-2",
						)}
					>
						{kind === "study" ? "Study" : "Info"}
					</button>
				);
			})}
		</span>
	);
}

const MENU_ITEM = "lh-press flex items-center px-2.5 py-1.5 text-left hover:bg-tone";

/** The ⋯ menu: Retry (stuck or failed) and Remove (the app's own copies).
 *  A file with neither keeps the space so the rows stay aligned. */
function RowMenu({ file, disabled, actions }: { file: ClassFile; disabled?: boolean; actions: FileRowActions }) {
	const [open, setOpen] = useState(false);
	const anchorRef = useRef<HTMLButtonElement>(null);
	const retry = canRetry(file);
	const remove = canRemove(file);

	const close = useCallback(() => setOpen(false), []);
	useMenuDismiss(open, close, anchorRef);

	if (!retry && !remove) return <span className="size-[15px] shrink-0" aria-hidden />;
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
				className="lh-press shrink-0 text-ink-2 hover:text-ink disabled:opacity-50"
			>
				<EllipsisIcon className="size-[15px]" aria-hidden />
			</button>
			<MenuShell
				open={open}
				anchorRef={anchorRef}
				testid={`class-file-menu-body-${file.id}`}
				preferredSide="down"
				menuClass="flex w-40 flex-col gap-0.5 border border-tone-2 bg-panel p-1.5 text-[13px] shadow-xl"
			>
				{retry && (
					<button
						type="button"
						data-testid={`class-file-menu-retry-${file.id}`}
						onClick={() => {
							setOpen(false);
							actions.onRetry(file.id);
						}}
						className={`${MENU_ITEM} text-ink`}
					>
						Retry
					</button>
				)}
				{remove && (
					<button
						type="button"
						data-testid={`class-file-remove-${file.id}`}
						aria-label={`Remove ${file.name}`}
						onClick={() => {
							setOpen(false);
							actions.onRemove(file.id);
						}}
						className={`${MENU_ITEM} text-ans-wrong`}
					>
						Remove
					</button>
				)}
			</MenuShell>
		</>
	);
}
