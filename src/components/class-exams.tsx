import { memo, useMemo } from "react";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, PlusIcon } from "lucide-react";
import type { ClassFile } from "@/core";
import { cn } from "@/lib/utils";
import { examDateLabel, filesLabel, toggleFile, type ExamDraft } from "./class-exams-model";

/**
 * EXAMS (Edit class dialog — docs/design/exports/edit-class-exams.html): the
 * class's exams as rows ("Midterm 1 · Thu Oct 29 · 3 files"). One opens at
 * a time: its name and date become fields, then a checkbox per study file
 * and "Remove exam". Edits stay drafts until the dialog's Save.
 */
export function ExamsEditor({
	drafts,
	files,
	openKey,
	disabled,
	onOpen,
	onChange,
	onAdd,
	onRemove,
}: {
	drafts: readonly ExamDraft[];
	/** Every class file, in class order. */
	files: readonly ClassFile[];
	openKey: string | null;
	disabled?: boolean;
	onOpen: (key: string | null) => void;
	onChange: (key: string, patch: Partial<Pick<ExamDraft, "name" | "date" | "fileIds">>) => void;
	onAdd: () => void;
	onRemove: (key: string) => void;
}) {
	const order = useMemo(() => files.map((f) => f.id), [files]);
	return (
		<section data-testid="class-exams" className="flex flex-col gap-1.5">
			<div className="flex items-center justify-between">
				<span className="text-[13px] font-bold text-ink-2">Exams</span>
				<button
					type="button"
					data-testid="class-add-exam"
					disabled={disabled}
					onClick={onAdd}
					className="lh-press flex items-center gap-[5px] text-[13.5px] font-bold text-ink hover:text-white disabled:opacity-50"
				>
					<PlusIcon className="size-[13px]" aria-hidden />
					Add exam
				</button>
			</div>
			{drafts.map((d) => (
				<ExamRow
					key={d.key}
					draft={d}
					files={files}
					order={order}
					open={openKey === d.key}
					disabled={disabled}
					onOpen={onOpen}
					onChange={onChange}
					onRemove={onRemove}
				/>
			))}
		</section>
	);
}

const ExamRow = memo(function ExamRow({
	draft,
	files,
	order,
	open,
	disabled,
	onOpen,
	onChange,
	onRemove,
}: {
	draft: ExamDraft;
	files: readonly ClassFile[];
	order: readonly string[];
	open: boolean;
	disabled?: boolean;
	onOpen: (key: string | null) => void;
	onChange: (key: string, patch: Partial<Pick<ExamDraft, "name" | "date" | "fileIds">>) => void;
	onRemove: (key: string) => void;
}) {
	const count = <span className="shrink-0 text-[13px] text-ink-3">{filesLabel(draft.fileIds.length)}</span>;
	if (!open) {
		return (
			<button
				type="button"
				data-testid={`class-exam-${draft.key}`}
				aria-expanded={false}
				onClick={() => onOpen(draft.key)}
				className="lh-press flex w-full items-center gap-3 bg-tone px-3 py-2.5 text-left hover:bg-tone-2"
			>
				<span className="min-w-0 flex-1 truncate text-[14.5px] font-bold text-ink">{draft.name || "New exam"}</span>
				<span className="shrink-0 font-mono text-[12.5px] text-ink-2">{examDateLabel(draft.date)}</span>
				{count}
				<ChevronDownIcon className="size-3.5 shrink-0 text-ink-2" aria-hidden />
			</button>
		);
	}
	// The exam's own study files, plus any other file it already lists.
	const shown = files.filter((f) => f.kind === "study" || draft.fileIds.includes(f.id));
	return (
		<div data-testid={`class-exam-${draft.key}`} className="flex w-full flex-col gap-2.5 bg-tone px-3 py-2.5">
			<div className="flex items-center gap-3">
				<input
					type="text"
					data-testid="class-exam-name"
					aria-label="Exam name"
					value={draft.name}
					placeholder="Midterm 1"
					autoFocus={draft.id === undefined}
					onChange={(e) => onChange(draft.key, { name: e.target.value })}
					className="min-w-0 flex-1 bg-transparent text-[14.5px] font-bold text-ink outline-none placeholder:font-normal placeholder:text-ink-3 focus-visible:underline focus-visible:decoration-tone-2 focus-visible:underline-offset-4"
				/>
				<input
					type="date"
					data-testid="class-exam-date"
					aria-label="Exam date"
					value={draft.date}
					onChange={(e) => onChange(draft.key, { date: e.target.value })}
					className="shrink-0 bg-transparent font-mono text-[12.5px] text-ink-2 outline-none [color-scheme:dark] focus-visible:text-ink"
				/>
				{count}
				<button type="button" aria-label="Collapse exam" aria-expanded onClick={() => onOpen(null)} className="lh-press shrink-0 text-ink-2 hover:text-ink">
					<ChevronUpIcon className="size-3.5" aria-hidden />
				</button>
			</div>
			{shown.length > 0 && (
				<div className="flex flex-col gap-0.5" role="group" aria-label={`Files ${draft.name || "the exam"} covers`}>
					{shown.map((f) => (
						<FileCheck
							key={f.id}
							file={f}
							checked={draft.fileIds.includes(f.id)}
							disabled={disabled}
							onToggle={() => onChange(draft.key, { fileIds: toggleFile(draft.fileIds, f.id, order) })}
						/>
					))}
				</div>
			)}
			<button
				type="button"
				data-testid="class-exam-remove"
				disabled={disabled}
				onClick={() => onRemove(draft.key)}
				className="lh-press self-start text-[13px] font-bold text-ans-wrong hover:text-red-400 disabled:opacity-50"
			>
				Remove exam
			</button>
		</div>
	);
});

function FileCheck({ file, checked, disabled, onToggle }: { file: ClassFile; checked: boolean; disabled?: boolean; onToggle: () => void }) {
	return (
		<label className="flex cursor-pointer items-center gap-2.5 px-0.5 py-[5px]">
			<input
				type="checkbox"
				data-testid={`class-exam-file-${file.id}`}
				checked={checked}
				disabled={disabled}
				onChange={onToggle}
				className="peer sr-only"
			/>
			<span
				aria-hidden
				className={cn(
					"flex size-3.5 shrink-0 items-center justify-center peer-focus-visible:outline peer-focus-visible:outline-1 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink",
					checked ? "bg-ink text-black" : "outline outline-1 -outline-offset-1 outline-ink-3",
				)}
			>
				{checked && <CheckIcon className="size-[11px]" strokeWidth={3} />}
			</span>
			<span className={cn("min-w-0 truncate text-[13.5px]", checked ? "text-ink" : "text-ink-2")}>{file.name}</span>
		</label>
	);
}
