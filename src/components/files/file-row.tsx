import { memo, useCallback, useRef, useState } from "react";
import {
	ArrowRightLeftIcon,
	CaptionsIcon,
	CircleXIcon,
	EllipsisIcon,
	FileCodeIcon,
	FileTextIcon,
	FolderIcon,
	FolderSearchIcon,
	LoaderIcon,
	PresentationIcon,
	RotateCwIcon,
	Trash2Icon,
} from "lucide-react";
import { extensionOf, isCodeFile, isNewFolderFile, isRecordingOrCaptions, type ClassFile, type FileCoverage } from "@/core";
import { CopyButton } from "@/components/copy-button";
import { useMinute } from "@/components/countdown";
import { MenuShell } from "@/components/menu-shell";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useMenuDismiss } from "@/components/use-menu-dismiss";
import { canRemove, canRetry, fileState, kindTitle, studiedFill, type FileState } from "./files-model";

/**
 * ONE FILE ROW (Files page): icon, name (a folder mark when it comes from
 * the linked folder, and New for a few days after a scan found it), Study or Info, the row's state ("12/31 facts
 * studied" with its bar, "Building facts…", "Waiting", "Failed · Retry")
 * and the ⋯ menu (Move to the other kind, Retry, Show in Finder, Remove).
 * A recording that needs the speech tool gets a second line with the
 * install command and Copy. The row has no box of its own; the one under
 * the mouse lights up. Memoized: a row redraws only when its own file or
 * coverage changes.
 */

export interface FileRowActions {
	/** The menu's Move to the other kind (to Course info asks first). */
	onKind: (file: ClassFile, kind: "study" | "info") => void;
	onRetry: (fileId: string) => void;
	/** Asks first. */
	onRemove: (file: ClassFile) => void;
	/** "Show in Finder" (desktop app only): its label and action. */
	show?: { label: string; run: (fileId: string) => void };
}

/** The row's icon by file type. */
function fileIcon(name: string) {
	if (isRecordingOrCaptions(name)) return CaptionsIcon;
	if (isCodeFile(name)) return FileCodeIcon;
	return extensionOf(name) === ".pptx" ? PresentationIcon : FileTextIcon;
}

/** The kind label's hover text. */
const KIND_HELP = {
	study: { title: "Study material", body: "Turned into facts for the graph." },
	info: { title: "Course info", body: "Syllabus, assignments and other class details. The teacher reads it, but it never becomes facts." },
	sorted: {
		title: "Course info",
		body: "Sorted as course info by your agent while reading it. If it's study material, pick Move to Study material in the ⋯ menu.",
	},
} as const;

export const FileRow = memo(function FileRow({
	file,
	coverage,
	disabled,
	agentTeaching,
	actions,
}: {
	file: ClassFile;
	coverage: FileCoverage | undefined;
	disabled?: boolean;
	/** An agent is running the work loop (a waiting file says who it waits for). */
	agentTeaching: boolean;
	actions: FileRowActions;
}) {
	const state = fileState(file, coverage, agentTeaching);
	const install = state.kind === "failed" ? state.install : undefined;
	const Icon = fileIcon(file.name);
	const help = KIND_HELP[file.sortedAsInfo && file.kind === "info" ? "sorted" : file.kind];
	const minute = useMinute();
	return (
		<li data-testid={`class-file-${file.id}`} data-halley-target={`file:${file.id}`} className="group flex flex-wrap items-center gap-x-2.5 gap-y-1.5 py-2 pr-3 pl-2 hover:bg-tone">
			<Icon className="size-[15px] shrink-0 text-ink-2" aria-hidden />
			<span className="flex min-w-0 flex-1 items-center gap-1.5">
				<span title={file.name} className="min-w-0 truncate text-[14.5px] text-ink">
					{file.name}
				</span>
				{file.origin === "linked" && (
					<Tip title="From your linked folder" body={<span className="break-all">{file.path}</span>} side="bottom" align="start">
						<span tabIndex={0} data-testid={`class-file-linked-${file.id}`} className="shrink-0 text-ink-3 outline-none">
							<FolderIcon className="size-3" aria-label="From your linked folder" />
						</span>
					</Tip>
				)}
				{minute !== null && isNewFolderFile(file, minute) && (
					<span data-testid={`class-file-new-${file.id}`} className="shrink-0 bg-tone px-1.5 text-[11.5px] font-bold text-ink">
						New
					</span>
				)}
			</span>
			<Tip title={help.title} body={<span className="text-xs text-ink-2">{help.body}</span>} side="bottom" className="w-[240px]">
				<span tabIndex={0} data-testid={`class-file-kind-${file.id}`} className="w-9 shrink-0 text-[12.5px] text-ink-3 outline-none">
					{file.kind === "study" ? "Study" : "Info"}
				</span>
			</Tip>
			<RowState fileId={file.id} state={state} disabled={disabled} onRetry={actions.onRetry} />
			<RowMenu file={file} disabled={disabled} actions={actions} />
			{install && <InstallLine fileId={file.id} command={install} />}
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
				<span data-testid={`class-file-status-${fileId}`} className="flex w-[150px] shrink-0 @3xl:w-[216px] items-center gap-2 text-[13px] text-ink-2">
					<LoaderIcon className="size-[13px] animate-spin motion-reduce:animate-none" aria-hidden />
					Building facts…
				</span>
			);
		case "waiting":
			return (
				<span data-testid={`class-file-status-${fileId}`} className="w-[150px] shrink-0 @3xl:w-[216px] text-[13px] text-ink-2">
					{state.label}
				</span>
			);
		case "failed": {
			const label = (
				<span data-testid={`class-file-status-${fileId}`} tabIndex={state.error ? 0 : undefined} className="text-[13px] text-ans-wrong outline-none">
					{state.label}
				</span>
			);
			return (
				<span className="flex w-[150px] shrink-0 @3xl:w-[216px] items-center gap-2">
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
						className="lh-press ml-1 text-[13px] font-bold text-ink hover:text-ink-max disabled:opacity-50"
					>
						Retry
					</button>
				</span>
			);
		}
		case "transcript":
			return (
				<span data-testid={`class-file-status-${fileId}`} title={state.label} className="w-[150px] shrink-0 @3xl:w-[216px] truncate text-[13px] text-ink-2">
					{state.label}
				</span>
			);
		case "none":
			// Keeps the menus in one column.
			return <span className="w-[150px] shrink-0 @3xl:w-[216px]" aria-hidden />;
	}
}

/** The speech tool's install step, under a recording that needs it. */
function InstallLine({ fileId, command }: { fileId: string; command: string }) {
	return (
		<span data-testid={`class-file-install-${fileId}`} className="flex basis-full flex-wrap items-center gap-x-2.5 gap-y-1 pl-[25px] text-[12.5px] text-ink-2">
			To turn recordings into text, run this in Terminal, then click Retry.
			<span className="flex items-center gap-2">
				<code className="bg-tone px-1.5 py-0.5 font-mono text-[12.5px] text-ink">{command}</code>
				<CopyButton
					text={command}
					data-testid={`class-file-install-copy-${fileId}`}
					className="lh-press text-[12.5px] font-bold text-ink hover:text-ink-max"
				/>
			</span>
		</span>
	);
}

/** "12/31 facts studied" with its bar: the fill is the share of the file's
 *  facts that came up in a lesson. A file with no facts says so instead. */
function CoverageCell({ fileId, state }: { fileId: string; state: Extract<FileState, { kind: "coverage" }> }) {
	const fill = studiedFill(state);
	if (state.facts === 0) {
		return (
			<span data-testid={`class-file-status-${fileId}`} className="w-[216px] shrink-0 text-[13px] text-ink-3">
				No facts yet
			</span>
		);
	}
	return (
		<span data-testid={`class-file-status-${fileId}`} className="flex w-[150px] shrink-0 @3xl:w-[216px] items-center gap-2.5">
			<span className="hidden h-[5px] w-[72px] shrink-0 bg-tone-2 @3xl:flex" aria-hidden>
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

/** The ⋯ menu: Move to the other kind, Retry (stuck waiting), Show
 *  in Finder (desktop app) and Remove (the app's own copies). */
function RowMenu({ file, disabled, actions }: { file: ClassFile; disabled?: boolean; actions: FileRowActions }) {
	const [open, setOpen] = useState(false);
	const anchorRef = useRef<HTMLButtonElement>(null);
	const retry = canRetry(file);
	const remove = canRemove(file);
	const show = actions.show;
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
				menuClass="lh-popup flex w-[196px] flex-col gap-0.5 p-1.5 text-[13.5px]"
			>
				<button role="menuitem" type="button" data-testid={`class-file-move-${file.id}`} onClick={pick(() => actions.onKind(file, other))} className={`${MENU_ITEM} text-ink`}>
					<ArrowRightLeftIcon className="size-3.5 shrink-0" aria-hidden />
					Move to {kindTitle(other)}
				</button>
				{retry && (
					<button role="menuitem" type="button" data-testid={`class-file-menu-retry-${file.id}`} onClick={pick(() => actions.onRetry(file.id))} className={`${MENU_ITEM} text-ink`}>
						<RotateCwIcon className="size-3.5 shrink-0" aria-hidden />
						Retry
					</button>
				)}
				{show && (
					<button role="menuitem" type="button" data-testid={`class-file-show-${file.id}`} onClick={pick(() => show.run(file.id))} className={`${MENU_ITEM} text-ink`}>
						<FolderSearchIcon className="size-3.5 shrink-0" aria-hidden />
						{show.label}
					</button>
				)}
				{remove && (
					<>
						<span className="my-0.5 h-px bg-tone-2" aria-hidden />
						<button
							role="menuitem"
							type="button"
							data-testid={`class-file-remove-${file.id}`}
							aria-label={`Remove ${file.name}`}
							onClick={pick(() => actions.onRemove(file))}
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
