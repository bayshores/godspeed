import { memo, useCallback, useId, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Link } from "react-router";
import { isNewFolderFile, type SpaceFile, type FileCoverage, type FileWork } from "@/shared/core";
import { CopyButton } from "@/frontend/components/copy-button";
import { useMinute } from "@/frontend/components/countdown";
import { MENU_ITEM, MenuShell } from "@/frontend/components/menu-shell";
import { StepBlocks } from "@/frontend/components/overview/lesson-rows";
import { lessonHref, problemsDone } from "@/frontend/components/overview/overview-model";
import { SMALL_BTN } from "@/frontend/components/ui/card-parts";
import { chip } from "@/frontend/components/ui/chip";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { CheckBox } from "@/frontend/components/ui/check-row";
import { ProgressBar } from "@/frontend/components/ui/progress-bar";
import { Tip } from "@/frontend/components/ui/tooltip";
import { cn } from "@/frontend/lib/utils";
import { rowMotion } from "@/frontend/components/motion";
import type { Moves } from "@/frontend/components/presence";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";
import { canRemove, canRetry, fileState, fileType, kindTitle, studiedFill, type FileState } from "./files-model";
import { FULL_LINE } from "./files-pick-model";

/**
 * ONE FILE ROW (Files page): a tile with its type, dark for study
 * material; the name (New for a few days after a scan
 * found it; a linked folder's file names its path on hover), Study or
 * Info, the row's state ("8 of 12 facts studied" with its bar, "Building
 * facts", "Waiting", "Failed" with Retry) and More (Move to the
 * other kind, Retry, Show in Finder, Remove). A recording that needs the
 * speech tool gets a second line with the install command and Copy.
 * A file with a problem list shows its problems as blocks in the state, with
 * "5 of 12 problems done" in place of its facts, a link to its lesson when
 * it has one.
 *
 * The row is one button that picks the file to study: the row is lit and,
 * while picking, its tick box is ticked. Controls with their own click (a state with Retry
 * or the lesson link, More, the install line) sit beside it, never in it.
 * The hover tips inside it open on the pointer; for the keyboard and screen
 * readers the button carries their words as its description.
 * Memoized: a row redraws only when its own file, coverage, work or pick
 * changes. A removed file's row fades out (`leaving`), an added one steps in (`joined`).
 */

export interface FileRowActions {
	/** The menu's Move to the other kind (to Space info asks first). */
	onKind: (file: SpaceFile, kind: "study" | "info") => void;
	onRetry: (fileId: string) => void;
	/** Asks first. */
	onRemove: (file: SpaceFile) => void;
	/** "Show in Finder" (desktop app only): its label and action. */
	show?: { label: string; run: (fileId: string) => void };
}

/** The kind label's hover text. */
const KIND_HELP = {
	study: { title: "Study material", body: "Turned into facts for the graph." },
	info: { title: "Space info", body: "Schedules, rules and other details about the space. The teacher reads it, but it never becomes facts." },
	sorted: {
		title: "Space info",
		body: "Sorted as space info by {teacher} while reading it. If it's study material, pick Move to Study material in the More menu.",
	},
} as const;

const SLOT = "w-[236px] shrink-0";
const STATUS = `${SLOT} text-ui text-ink-2`;

/** How a row is picked: `held` when the lesson's file limit is reached and
 *  this row is not among the picks. */
export type RowPick = "picked" | "held" | "free";

/** The lesson a file's problem blocks open, with the link's words. */
interface BlocksLink {
	href: string;
	label: string;
}

export const FileRow = memo(function FileRow({
	file,
	source,
	coverage,
	work,
	pick,
	onPick,
	boxes,
	disabled,
	teacher,
	actions,
	leaving,
	joined,
}: Moves & {
	file: SpaceFile;
	/** The .tex this PDF is built from: one row, the PDF's. */
	source?: SpaceFile;
	coverage: FileCoverage | undefined;
	work: FileWork | undefined;
	pick: RowPick;
	/** `held`: the row is past the limit, so the click only asks why. */
	onPick: (fileId: string, held: boolean) => void;
	/** Show the tick box: while picking, and once any file is picked. */
	boxes: boolean;
	disabled?: boolean;
	/** The teacher's name, for the kind label's hover text. */
	teacher: string;
	actions: FileRowActions;
}) {
	const state = fileState(file, coverage);
	const install = state.kind === "failed" ? state.install : undefined;
	const help = KIND_HELP[file.sortedAsInfo && file.kind === "info" ? "sorted" : file.kind];
	const helpBody = help.body.replace("{teacher}", teacher);
	const minute = useMinute();
	const [menuOpen, setMenuOpen] = useState(false);
	const describedBy = useId();
	const picked = pick === "picked";
	const held = pick === "held";
	const problems = work?.problems;
	const link = work?.lessonId ? { href: lessonHref(work.lessonId), label: `${file.name}, ${problemsDone(work.problems)}` } : undefined;
	const slot = <RowState fileId={file.id} state={state} problems={problems} link={link} disabled={disabled} onRetry={actions.onRetry} />;
	// A state with a control of its own sits beside the button.
	const slotOutside = state.kind === "failed" || !!link;
	const name = (
		<span title={file.origin === "linked" ? undefined : file.name} className="min-w-0 truncate text-item text-ink">
			{file.name}
		</span>
	);
	return (
		<li
			data-testid={`space-file-${file.id}`}
			data-teacher-target={`file:${file.id}`}
			data-picked={picked || undefined}
			{...rowMotion(
				leaving,
				joined,
				cn(
					"-mx-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5 transition-colors duration-(--lh-dur) ease-(--lh-ease-out)",
					picked ? "bg-highlight" : cn("hover:bg-(--lh-well)", menuOpen && "bg-(--lh-well)"),
				),
			)}
		>
			<button
				type="button"
				data-testid={`space-file-pick-${file.id}`}
				aria-pressed={picked}
				aria-disabled={held || undefined}
				aria-describedby={describedBy}
				onClick={() => onPick(file.id, held)}
				className={cn(
					"flex min-w-0 flex-1 items-center gap-x-3 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink",
					held && "cursor-not-allowed",
				)}
			>
				{boxes && <CheckBox mark={picked ? "tick" : null} className={cn(held && "opacity-50")} />}
				{/* Study material, which makes the facts, is the dark tile. */}
				<span
					aria-hidden
					className={cn(
						"flex h-8 w-12 shrink-0 items-center justify-center lh-notch font-count text-sm transition-colors duration-(--lh-dur) ease-(--lh-ease-out)",
						file.kind === "study" ? "bg-ink text-(--background)" : "lh-well text-ink-2",
						held && "opacity-50",
					)}
				>
					{fileType(file.name)}
				</span>
				<span className={cn("flex min-w-0 flex-1 items-center gap-2", held && "opacity-50")}>
					{file.origin === "linked" ? (
						<Tip title="From your linked folder" body={<span className="break-all">{file.path}</span>} side="bottom" align="start">
							<span data-testid={`space-file-linked-${file.id}`} className="flex min-w-0">
								{name}
							</span>
						</Tip>
					) : (
						name
					)}
					{source && (
						<span data-testid={`space-file-source-${file.id}`} className="shrink-0 text-ui text-ink-2">
							.tex
						</span>
					)}
					{minute !== null && isNewFolderFile(file, minute) && (
						<span data-testid={`space-file-new-${file.id}`} className={chip(picked ? "well" : "lit", "tag")}>
							New
						</span>
					)}
				</span>
				<Tip title={help.title} body={helpBody} side="bottom" className="w-[240px]">
					<span data-testid={`space-file-kind-${file.id}`} className="w-10 shrink-0 text-ui text-ink-2">
						{file.kind === "study" ? "Study" : "Info"}
					</span>
				</Tip>
				{!slotOutside && slot}
			</button>
			<span id={describedBy} hidden>
				{help.title}. {helpBody}
				{file.origin === "linked" && ` From your linked folder: ${file.path}`}
				{held && ` ${FULL_LINE}`}
			</span>
			{slotOutside && slot}
			<RowMenu file={file} disabled={disabled} actions={actions} open={menuOpen} setOpen={setMenuOpen} />
			{install && <InstallLine fileId={file.id} command={install} />}
		</li>
	);
});

/** A file's problems as blocks, done ones inked, in the width of the facts' bar. */
function Blocks({ fileId, problems }: { fileId: string; problems: { done: number; total: number } }) {
	return (
		<span data-testid={`space-file-blocks-${fileId}`} className="flex w-20 shrink-0">
			<StepBlocks done={problems.done} total={problems.total} />
		</span>
	);
}

/** The row's state: a drawing, then words. A file's problems take the place
 *  of its facts; a state that needs the learner keeps its words, after the
 *  blocks. With a lesson, the blocks (and the problem words) link to it. */
function RowState({
	fileId,
	state,
	problems,
	link,
	disabled,
	onRetry,
}: {
	fileId: string;
	state: FileState;
	problems: { done: number; total: number } | undefined;
	link: BlocksLink | undefined;
	disabled?: boolean;
	onRetry: (fileId: string) => void;
}) {
	const needsLearner = state.kind === "failed" || state.kind === "building" || state.kind === "waiting";
	if (problems && !needsLearner) {
		const inner = (
			<>
				<Blocks fileId={fileId} problems={problems} />
				<span className="truncate">{problemsDone(problems)}</span>
			</>
		);
		const look = cn(STATUS, "flex items-center gap-2 whitespace-nowrap");
		return link ? (
			<Link to={link.href} data-testid={`space-file-status-${fileId}`} aria-label={link.label} className={cn(look, LINK)}>
				{inner}
			</Link>
		) : (
			<span data-testid={`space-file-status-${fileId}`} className={look}>
				{inner}
			</span>
		);
	}
	const lead: ReactNode =
		problems &&
		(link ? (
			<Link to={link.href} aria-label={link.label} className={cn("flex shrink-0", LINK)}>
				<Blocks fileId={fileId} problems={problems} />
			</Link>
		) : (
			<Blocks fileId={fileId} problems={problems} />
		));
	switch (state.kind) {
		case "coverage":
			if (state.facts === 0) {
				return (
					<span data-testid={`space-file-status-${fileId}`} className={STATUS}>
						No facts yet
					</span>
				);
			}
			return (
				<span data-testid={`space-file-status-${fileId}`} className={cn(STATUS, "flex items-center gap-2 whitespace-nowrap")}>
					<ProgressBar share={studiedFill(state)} className="w-20 shrink-0" />
					{state.inLessons} of {state.facts} facts studied
				</span>
			);
		case "building":
		case "waiting":
		case "transcript": {
			const label = state.kind === "building" ? "Building facts" : state.label;
			if (lead) {
				return (
					<span className={cn(SLOT, "flex items-center gap-2")}>
						{lead}
						<span data-testid={`space-file-status-${fileId}`} title={label} className="min-w-0 truncate text-ui text-ink-2">
							{label}
						</span>
					</span>
				);
			}
			return (
				<span data-testid={`space-file-status-${fileId}`} title={state.kind === "building" ? undefined : label} className={cn(STATUS, "truncate")}>
					{label}
				</span>
			);
		}
		case "failed": {
			const label = (
				<span data-testid={`space-file-status-${fileId}`} tabIndex={state.error ? 0 : undefined} className="min-w-0 truncate text-ui text-ans-wrong outline-none">
					{state.label}
				</span>
			);
			return (
				<span className={cn(SLOT, "flex items-center gap-2")}>
					{lead}
					{state.error ? (
						<Tip title={state.label} body={<span className="whitespace-pre-wrap break-words">{state.error}</span>} side="bottom">
							{label}
						</Tip>
					) : (
						label
					)}
					<button type="button" data-testid={`space-file-retry-${fileId}`} disabled={disabled} onClick={() => onRetry(fileId)} className={SMALL_BTN}>
						Retry
					</button>
				</span>
			);
		}
		case "none":
			// Keeps More in one column.
			return <span className={SLOT} aria-hidden />;
	}
}

/** The link from a file's problems to its lesson. */
const LINK = "lh-press outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

/** The speech tool's install step, under a recording that needs it. */
function InstallLine({ fileId, command }: { fileId: string; command: string }) {
	return (
		<span data-testid={`space-file-install-${fileId}`} className="flex basis-full flex-wrap items-center gap-x-2.5 gap-y-1.5 pt-0.5 pb-2 text-ui text-ink-2">
			<span className="min-w-0 flex-1 basis-[240px]">To turn recordings into text, run this in Terminal, then click Retry.</span>
			<code className="font-count flex h-8 items-center lh-well lh-notch px-2.5 text-sm text-ink">{command}</code>
			<CopyButton text={command} data-testid={`space-file-install-copy-${fileId}`} className={SMALL_BTN} />
		</span>
	);
}

/** More: Move to the other kind, Retry (stuck waiting), Show in Finder
 *  (desktop app) and Remove (the app's own copies). */
function RowMenu({
	file,
	disabled,
	actions,
	open,
	setOpen,
}: {
	file: SpaceFile;
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
				data-testid={`space-file-menu-${file.id}`}
				disabled={disabled}
				onClick={() => setOpen((o) => !o)}
				title="More"
				className="lh-press flex size-8 shrink-0 items-center justify-center text-ink-2 hover:bg-tone hover:text-ink aria-expanded:bg-tone aria-expanded:text-ink"
			>
				<PixelIcon name="more" size={3} />
			</button>
			<MenuShell
				open={open}
				anchorRef={anchorRef}
				testid={`space-file-menu-body-${file.id}`}
				preferredSide="down"
				align="right"
				menuClass="lh-popup flex w-[250px] flex-col p-1.5"
			>
				<button role="menuitem" type="button" data-testid={`space-file-move-${file.id}`} onClick={pick(() => actions.onKind(file, other))} className={MENU_ITEM}>
					Move to {kindTitle(other)}
				</button>
				{retry && (
					<button role="menuitem" type="button" data-testid={`space-file-menu-retry-${file.id}`} onClick={pick(() => actions.onRetry(file.id))} className={MENU_ITEM}>
						Retry
					</button>
				)}
				{show && (
					<button role="menuitem" type="button" data-testid={`space-file-show-${file.id}`} onClick={pick(() => show.run(file.id))} className={MENU_ITEM}>
						{show.label}
					</button>
				)}
				{remove && (
					<>
						<span className="h-1.5" aria-hidden />
						<button
							role="menuitem"
							type="button"
							data-testid={`space-file-remove-${file.id}`}
							aria-label={`Remove ${file.name}`}
							onClick={pick(() => actions.onRemove(file))}
							className={cn(MENU_ITEM, "text-ans-wrong")}
						>
							Remove
						</button>
					</>
				)}
			</MenuShell>
		</>
	);
}
