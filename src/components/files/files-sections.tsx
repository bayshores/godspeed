import { memo, useRef, type DragEvent, type ReactNode } from "react";
import { ArrowDownToLineIcon, ArrowRightLeftIcon, PlusIcon } from "lucide-react";
import type { ClassFile, FileCoverage } from "@/core";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { FileRow, type FileRowActions } from "./file-row";
import { CLASS_FILE_ACCEPT, dropCopy, FILE_DRAG_TYPE, kindTitle } from "./files-model";

/** The two sections' help tooltips (on the section title). */
const SECTION_HELP = {
	study: { title: "Study material", body: "Turned into facts for the graph. Course info is only read by the teacher." },
	info: { title: "Course info", body: "Syllabus, assignments and other class details. Only read by the teacher; never turned into facts." },
} as const;

/** The empty section's two lines. */
const EMPTY = {
	study: { line: "Drop lecture notes, readings or recordings", sub: "PDF · Markdown · text · VTT/SRT · audio · video" },
	info: { line: "Drop the syllabus or assignments", sub: "Read by the teacher, never turned into facts" },
} as const;

/** What is being dragged over a section right now. */
export type SectionDrag = { type: "finder"; count: number } | { type: "row"; file: ClassFile };

/**
 * ONE SECTION (Files page):
 * a dark panel with its header (title, count, the header extras, Add) and
 * its rows. The panel is a drop zone: files from Finder are added here as
 * this kind; a row dragged from the other section is moved here. While
 * something is over it, the panel lights up and its last line says what
 * the drop will do.
 */
export const FileSection = memo(function FileSection({
	kind,
	files,
	coverage,
	disabled,
	flashId,
	agentTeaching,
	actions,
	headerExtra,
	beforeRows,
	draggingId,
	over,
	dim,
	onAddFiles,
	onDragOverSection,
	onDragLeaveSection,
	onMoveHere,
}: {
	kind: "study" | "info";
	files: readonly ClassFile[];
	coverage: ReadonlyMap<string, FileCoverage>;
	disabled?: boolean;
	flashId: string | null;
	agentTeaching: boolean;
	actions: FileRowActions;
	/** Header items before Add (the linked folder or Link folder). */
	headerExtra?: ReactNode;
	/** Shown between the header and the rows (the folder path field). */
	beforeRows?: ReactNode;
	/** The row being dragged, if any (it fades). */
	draggingId: string | null;
	/** What is over this panel right now (null: nothing). */
	over: SectionDrag | null;
	/** Faded while files from Finder are over the other panel. */
	dim?: boolean;
	onAddFiles: (files: File[]) => void;
	/** Something droppable is over the panel; null when it can't drop here. */
	onDragOverSection: (kind: "study" | "info", drag: { type: "finder"; count: number } | { type: "row" }) => boolean;
	onDragLeaveSection: (kind: "study" | "info") => void;
	onMoveHere: (kind: "study" | "info") => void;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const help = SECTION_HELP[kind];

	const onDragOver = (e: DragEvent<HTMLElement>) => {
		if (disabled) return;
		const types = Array.from(e.dataTransfer.types);
		const drag = types.includes(FILE_DRAG_TYPE) ? ({ type: "row" } as const) : types.includes("Files") ? ({ type: "finder", count: e.dataTransfer.items.length } as const) : null;
		if (!drag || !onDragOverSection(kind, drag)) return;
		e.preventDefault();
		e.stopPropagation();
		e.dataTransfer.dropEffect = drag.type === "row" ? "move" : "copy";
	};
	const onDragLeave = (e: DragEvent<HTMLElement>) => {
		if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
		onDragLeaveSection(kind);
	};
	const onDrop = (e: DragEvent<HTMLElement>) => {
		if (!over) return;
		e.preventDefault();
		e.stopPropagation();
		if (over.type === "row") onMoveHere(kind);
		else {
			const dropped = Array.from(e.dataTransfer.files);
			onDragLeaveSection(kind);
			if (dropped.length > 0) onAddFiles(dropped);
		}
	};

	const target = over ? dropCopy(kind, over.type === "finder" ? over : { type: "row", facts: coverage.get(over.file.id)?.facts ?? null }) : null;

	return (
		<section
			data-testid={`files-section-${kind}`}
			data-over={over ? "true" : undefined}
			aria-label={kindTitle(kind)}
			onDragOver={onDragOver}
			onDragLeave={onDragLeave}
			onDrop={onDrop}
			className={cn(
				"flex w-full flex-col px-1.5 pt-3 pb-1.5 outline outline-1 -outline-offset-1 transition-[background-color,outline-color,opacity] duration-(--lh-dur)",
				over ? "bg-tone outline-ink-2" : "bg-panel outline-transparent",
				dim && "opacity-45",
			)}
		>
			<header className="flex items-center gap-2.5 pt-1 pr-1.5 pb-2.5 pl-3">
				<Tip title={help.title} body={<span className="text-xs text-ink-2">{help.body}</span>} side="bottom" align="start" className="w-[250px]">
					<h2 tabIndex={0} className="text-[15px] font-bold text-ink outline-none">
						{help.title}
					</h2>
				</Tip>
				<span data-testid={`files-count-${kind}`} className="font-mono text-[12.5px] tabular-nums text-ink-3">
					{files.length}
				</span>
				<span className="flex-1" />
				{headerExtra}
				<input
					ref={inputRef}
					type="file"
					multiple
					accept={CLASS_FILE_ACCEPT}
					className="hidden"
					data-testid={`class-file-input-${kind}`}
					onChange={(e) => {
						const picked = Array.from(e.target.files ?? []);
						e.target.value = "";
						if (picked.length > 0) onAddFiles(picked);
					}}
				/>
				<button
					type="button"
					data-testid={`class-add-${kind}`}
					aria-label={`Add ${kindTitle(kind).toLowerCase()}`}
					disabled={disabled}
					onClick={() => inputRef.current?.click()}
					className="lh-press flex shrink-0 items-center gap-1.5 bg-tone px-2.5 py-1.5 text-[13.5px] font-bold text-ink hover:bg-tone-2 disabled:opacity-60"
				>
					<PlusIcon className="size-[13px]" aria-hidden />
					Add
				</button>
			</header>
			{beforeRows}
			{files.length > 0 ? (
				<>
					<ul className="flex flex-col">
						{files.map((file) => (
							<FileRow
								key={file.id}
								file={file}
								coverage={coverage.get(file.id)}
								disabled={disabled}
								flash={flashId === file.id}
								dragging={draggingId === file.id}
								agentTeaching={agentTeaching}
								actions={actions}
							/>
						))}
					</ul>
					{target ? (
						<DropTarget title={target.title} detail={target.detail} move={over?.type === "row"} />
					) : (
						<div className="flex items-center gap-2 px-3 pt-3 pb-2 text-[13px] text-ink-3">
							<ArrowDownToLineIcon className="size-[13px]" aria-hidden />
							Drop files here
						</div>
					)}
				</>
			) : target ? (
				<DropTarget title={target.title} detail={target.detail} move={over?.type === "row"} />
			) : (
				<div
					data-testid={`files-empty-${kind}`}
					className={cn("flex flex-col items-center justify-center gap-2 border border-tone-2 p-4 text-center", kind === "study" ? "h-[180px]" : "h-[140px]")}
				>
					<ArrowDownToLineIcon className="size-5 text-ink-3" aria-hidden />
					<span className="text-[14.5px] text-ink-2">{EMPTY[kind].line}</span>
					<span className="text-[12.5px] text-ink-2">{EMPTY[kind].sub}</span>
				</div>
			)}
		</section>
	);
});

/** The panel's last line while something droppable is over it. */
function DropTarget({ title, detail, move }: { title: string; detail?: string; move?: boolean }) {
	const Icon = move ? ArrowRightLeftIcon : ArrowDownToLineIcon;
	return (
		<div data-testid="files-drop-target" className="flex flex-col gap-1 bg-tone-2 p-3">
			<span className="flex items-center gap-[9px] text-sm font-bold text-ink">
				<Icon className="size-3.5 shrink-0" aria-hidden />
				{title}
			</span>
			{detail && <span className="text-[12.5px] leading-[1.35] text-ink-2">{detail}</span>}
		</div>
	);
}
