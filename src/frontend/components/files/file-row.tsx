import { memo, useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { isNewFolderFile, type ClassFile, type FileCoverage } from "@/shared/core";
import { CopyButton } from "@/frontend/components/copy-button";
import { useMinute } from "@/frontend/components/countdown";
import { MenuShell } from "@/frontend/components/menu-shell";
import { ProgressBar } from "@/frontend/components/ui/progress-bar";
import { Tip } from "@/frontend/components/ui/tooltip";
import { cn } from "@/frontend/lib/utils";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";
import { canRemove, canRetry, fileState, kindTitle, studiedFill, type FileState } from "./files-model";

/**
 * ONE FILE ROW (Files page): the name (New for a few days after a scan
 * found it; a linked folder's file names its path on hover), Study or
 * Info, the row's state ("8 of 12 facts studied" with its bar, "Building
 * facts", "Waiting", "Failed" with Retry) and, on hover, More (Move to the
 * other kind, Retry, Show in Finder, Remove). A recording that needs the
 * speech tool gets a second line with the install command and Copy.
 * Memoized: a row redraws only when its own file or coverage changes.
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

/** The kind label's hover text. */
const KIND_HELP = {
	study: { title: "Study material", body: "Turned into facts for the graph." },
	info: { title: "Course info", body: "Syllabus, assignments and other class details. The teacher reads it, but it never becomes facts." },
	sorted: {
		title: "Course info",
		body: "Sorted as course info by your agent while reading it. If it's study material, pick Move to Study material in the More menu.",
	},
} as const;

const STATUS = "w-[236px] shrink-0 text-base text-ink-2";
const SMALL_BTN = "lh-btn h-7 shrink-0 bg-panel px-2.5 text-[15px]";

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
	const help = KIND_HELP[file.sortedAsInfo && file.kind === "info" ? "sorted" : file.kind];
	const minute = useMinute();
	const [menuOpen, setMenuOpen] = useState(false);
	const name = (
		<span title={file.origin === "linked" ? undefined : file.name} className="min-w-0 truncate text-[15px] text-ink">
			{file.name}
		</span>
	);
	return (
		<li
			data-testid={`class-file-${file.id}`}
			data-halley-target={`file:${file.id}`}
			className={cn("group flex flex-wrap items-center gap-x-3 gap-y-1 px-1 py-[7px] hover:bg-panel", menuOpen && "bg-panel")}
		>
			<span className="flex min-w-0 flex-1 items-center gap-2">
				{file.origin === "linked" ? (
					<Tip title="From your linked folder" body={<span className="break-all">{file.path}</span>} side="bottom" align="start">
						<span tabIndex={0} data-testid={`class-file-linked-${file.id}`} className="flex min-w-0 outline-none">
							{name}
						</span>
					</Tip>
				) : (
					name
				)}
				{minute !== null && isNewFolderFile(file, minute) && (
					<span data-testid={`class-file-new-${file.id}`} className="shrink-0 bg-highlight px-1.5 text-xs font-medium text-ink">
						New
					</span>
				)}
			</span>
			<Tip title={help.title} body={<span className="text-xs text-ink-2">{help.body}</span>} side="bottom" className="w-[240px]">
				<span tabIndex={0} data-testid={`class-file-kind-${file.id}`} className="w-10 shrink-0 text-base text-ink-2 outline-none">
					{file.kind === "study" ? "Study" : "Info"}
				</span>
			</Tip>
			<RowState fileId={file.id} state={state} disabled={disabled} onRetry={actions.onRetry} />
			<RowMenu file={file} disabled={disabled} actions={actions} open={menuOpen} setOpen={setMenuOpen} />
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
			if (state.facts === 0) {
				return (
					<span data-testid={`class-file-status-${fileId}`} className={STATUS}>
						No facts yet
					</span>
				);
			}
			return (
				<span data-testid={`class-file-status-${fileId}`} className={cn(STATUS, "flex items-center gap-2 whitespace-nowrap")}>
					<ProgressBar share={studiedFill(state)} className="w-14 shrink-0" />
					{state.inLessons} of {state.facts} facts studied
				</span>
			);
		case "building":
			return (
				<span data-testid={`class-file-status-${fileId}`} className={STATUS}>
					Building facts
				</span>
			);
		case "waiting":
		case "transcript":
			return (
				<span data-testid={`class-file-status-${fileId}`} title={state.label} className={cn(STATUS, "truncate")}>
					{state.label}
				</span>
			);
		case "failed": {
			const label = (
				<span data-testid={`class-file-status-${fileId}`} tabIndex={state.error ? 0 : undefined} className="min-w-0 truncate text-base text-ans-wrong outline-none">
					{state.label}
				</span>
			);
			return (
				<span className="flex w-[236px] shrink-0 items-center gap-2">
					{state.error ? (
						<Tip title={state.label} body={<span className="whitespace-pre-wrap break-words">{state.error}</span>} side="bottom">
							{label}
						</Tip>
					) : (
						label
					)}
					<button type="button" data-testid={`class-file-retry-${fileId}`} disabled={disabled} onClick={() => onRetry(fileId)} className={SMALL_BTN}>
						Retry
					</button>
				</span>
			);
		}
		case "none":
			// Keeps More in one column.
			return <span className="w-[236px] shrink-0" aria-hidden />;
	}
}

/** The speech tool's install step, under a recording that needs it. */
function InstallLine({ fileId, command }: { fileId: string; command: string }) {
	return (
		<span data-testid={`class-file-install-${fileId}`} className="flex basis-full flex-wrap items-center gap-x-2.5 gap-y-1.5 pt-0.5 pb-2 text-base text-ink-2">
			<span className="min-w-0 flex-1 basis-[240px]">To turn recordings into text, run this in Terminal, then click Retry.</span>
			<code className="font-count flex h-8 items-center rounded border border-border bg-background px-2.5 text-sm text-ink">{command}</code>
			<CopyButton text={command} data-testid={`class-file-install-copy-${fileId}`} className={SMALL_BTN} />
		</span>
	);
}

const MENU_ITEM = "lh-press px-[18px] py-[11px] text-left hover:bg-tone";

/** More: Move to the other kind, Retry (stuck waiting), Show in Finder
 *  (desktop app) and Remove (the app's own copies). Shown on hover. */
function RowMenu({
	file,
	disabled,
	actions,
	open,
	setOpen,
}: {
	file: ClassFile;
	disabled?: boolean;
	actions: FileRowActions;
	open: boolean;
	setOpen: Dispatch<SetStateAction<boolean>>;
}) {
	const anchorRef = useRef<HTMLButtonElement>(null);
	const retry = canRetry(file);
	const remove = canRemove(file);
	const show = actions.show;
	const other = file.kind === "study" ? "info" : "study";

	const close = useCallback(() => setOpen(false), [setOpen]);
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
				className={cn("lh-btn lh-btn-quiet h-7 shrink-0 text-[15px] focus-visible:opacity-100 group-hover:opacity-100", !open && "opacity-0")}
			>
				More
			</button>
			<MenuShell
				open={open}
				anchorRef={anchorRef}
				testid={`class-file-menu-body-${file.id}`}
				preferredSide="down"
				align="right"
				menuClass="lh-popup flex w-[250px] flex-col py-1.5 text-lg"
			>
				<button role="menuitem" type="button" data-testid={`class-file-move-${file.id}`} onClick={pick(() => actions.onKind(file, other))} className={`${MENU_ITEM} text-ink`}>
					Move to {kindTitle(other)}
				</button>
				{retry && (
					<button role="menuitem" type="button" data-testid={`class-file-menu-retry-${file.id}`} onClick={pick(() => actions.onRetry(file.id))} className={`${MENU_ITEM} text-ink`}>
						Retry
					</button>
				)}
				{show && (
					<button role="menuitem" type="button" data-testid={`class-file-show-${file.id}`} onClick={pick(() => show.run(file.id))} className={`${MENU_ITEM} text-ink`}>
						{show.label}
					</button>
				)}
				{remove && (
					<>
						<span className="mx-[18px] my-1 border-t-2 border-dotted border-edge" aria-hidden />
						<button
							role="menuitem"
							type="button"
							data-testid={`class-file-remove-${file.id}`}
							aria-label={`Remove ${file.name}`}
							onClick={pick(() => actions.onRemove(file))}
							className={`${MENU_ITEM} text-ans-wrong`}
						>
							Remove
						</button>
					</>
				)}
			</MenuShell>
		</>
	);
}
