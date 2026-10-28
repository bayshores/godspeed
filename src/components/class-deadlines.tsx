import { memo, useMemo } from "react";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, PlusIcon, XIcon } from "lucide-react";
import type { ClassFile, DeadlineKind } from "@/core";
import { cn } from "@/lib/utils";
import { dueLabel, filesLabel, KIND_OPTIONS, kindLabel, toggleFile, type DeadlineDraft } from "./class-deadlines-model";

type DraftPatch = Partial<Pick<DeadlineDraft, "kind" | "name" | "date" | "time" | "fileIds" | "done">>;

/**
 * DEADLINES (Edit class dialog; exams before 2026-10-28): the class's
 * deadlines as rows ("Homework 5 · Homework · Fri Oct 30, 11:59 PM · 3
 * files"). One opens at a time: its kind, name, date and time become
 * fields, then a checkbox per study file, Done and "Remove deadline". Edits
 * stay drafts until the dialog's Save.
 */
export function DeadlinesEditor({
	drafts,
	files,
	openKey,
	disabled,
	onOpen,
	onChange,
	onAdd,
	onRemove,
}: {
	drafts: readonly DeadlineDraft[];
	/** Every class file, in class order. */
	files: readonly ClassFile[];
	openKey: string | null;
	disabled?: boolean;
	onOpen: (key: string | null) => void;
	onChange: (key: string, patch: DraftPatch) => void;
	onAdd: () => void;
	onRemove: (key: string) => void;
}) {
	const order = useMemo(() => files.map((f) => f.id), [files]);
	return (
		<section data-testid="class-deadlines" className="flex flex-col gap-1.5">
			<div className="flex items-center justify-between">
				<span className="text-[13px] font-bold text-ink-2">Deadlines</span>
				<button
					type="button"
					data-testid="class-add-deadline"
					disabled={disabled}
					onClick={onAdd}
					className="lh-press flex items-center gap-[5px] text-[13.5px] font-bold text-ink hover:text-white disabled:opacity-50"
				>
					<PlusIcon className="size-[13px]" aria-hidden />
					Add deadline
				</button>
			</div>
			{drafts.map((d) => (
				<DeadlineRow
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

const DeadlineRow = memo(function DeadlineRow({
	draft,
	files,
	order,
	open,
	disabled,
	onOpen,
	onChange,
	onRemove,
}: {
	draft: DeadlineDraft;
	files: readonly ClassFile[];
	order: readonly string[];
	open: boolean;
	disabled?: boolean;
	onOpen: (key: string | null) => void;
	onChange: (key: string, patch: DraftPatch) => void;
	onRemove: (key: string) => void;
}) {
	const count = <span className="shrink-0 text-[13px] text-ink-3">{filesLabel(draft.fileIds.length)}</span>;
	if (!open) {
		return (
			<button
				type="button"
				data-testid={`class-deadline-${draft.key}`}
				data-done={draft.done || undefined}
				aria-expanded={false}
				onClick={() => onOpen(draft.key)}
				className="lh-press flex w-full items-center gap-3 bg-tone px-3 py-2.5 text-left hover:bg-tone-2"
			>
				{draft.done && <CheckIcon data-testid="class-deadline-done-tick" className="size-3.5 shrink-0 text-ink-3" strokeWidth={3} aria-label="Done" />}
				<span className={cn("min-w-0 flex-1 truncate text-[14.5px] font-bold", draft.done ? "text-ink-3" : "text-ink")}>{draft.name || "New deadline"}</span>
				<span className={cn("shrink-0 text-[13px]", draft.done ? "text-ink-3" : "text-ink-2")}>{kindLabel(draft.kind)}</span>
				<span className={cn("shrink-0 font-mono text-[12.5px]", draft.done ? "text-ink-3" : "text-ink-2")}>{dueLabel(draft.date, draft.time || undefined)}</span>
				{count}
				<ChevronDownIcon className="size-3.5 shrink-0 text-ink-2" aria-hidden />
			</button>
		);
	}
	// The deadline's own study files, plus any other file it already lists.
	const shown = files.filter((f) => f.kind === "study" || draft.fileIds.includes(f.id));
	return (
		<div data-testid={`class-deadline-${draft.key}`} className="flex w-full flex-col gap-2.5 bg-tone px-3 py-2.5">
			<div className="flex items-center gap-3">
				<select
					data-testid="class-deadline-kind"
					aria-label="Deadline kind"
					value={draft.kind}
					disabled={disabled}
					onChange={(e) => onChange(draft.key, { kind: e.target.value as DeadlineKind })}
					className="shrink-0 bg-transparent text-[13px] text-ink-2 outline-none [color-scheme:dark] focus-visible:text-ink"
				>
					{KIND_OPTIONS.map((o) => (
						<option key={o.kind} value={o.kind}>
							{o.label}
						</option>
					))}
				</select>
				<input
					type="text"
					data-testid="class-deadline-name"
					aria-label="Deadline name"
					value={draft.name}
					placeholder="Homework 5"
					autoFocus={draft.id === undefined}
					onChange={(e) => onChange(draft.key, { name: e.target.value })}
					className="min-w-0 flex-1 bg-transparent text-[14.5px] font-bold text-ink outline-none placeholder:font-normal placeholder:text-ink-3 focus-visible:underline focus-visible:decoration-tone-2 focus-visible:underline-offset-4"
				/>
				<input
					type="date"
					data-testid="class-deadline-date"
					aria-label="Deadline date"
					value={draft.date}
					onChange={(e) => onChange(draft.key, { date: e.target.value })}
					className="shrink-0 bg-transparent font-mono text-[12.5px] text-ink-2 outline-none [color-scheme:dark] focus-visible:text-ink"
				/>
				<span className="flex shrink-0 items-center gap-1">
					<input
						type="time"
						data-testid="class-deadline-time"
						aria-label="Deadline time (optional)"
						value={draft.time}
						onChange={(e) => onChange(draft.key, { time: e.target.value })}
						className="bg-transparent font-mono text-[12.5px] text-ink-2 outline-none [color-scheme:dark] focus-visible:text-ink"
					/>
					{draft.time !== "" && (
						<button
							type="button"
							data-testid="class-deadline-time-clear"
							aria-label="Clear time"
							onClick={() => onChange(draft.key, { time: "" })}
							className="lh-press text-ink-3 hover:text-ink"
						>
							<XIcon className="size-3" aria-hidden />
						</button>
					)}
				</span>
				{count}
				<button type="button" aria-label="Collapse deadline" aria-expanded onClick={() => onOpen(null)} className="lh-press shrink-0 text-ink-2 hover:text-ink">
					<ChevronUpIcon className="size-3.5" aria-hidden />
				</button>
			</div>
			{shown.length > 0 && (
				<div className="flex flex-col gap-0.5" role="group" aria-label={`Files ${draft.name || "the deadline"} covers`}>
					{shown.map((f) => (
						<Check
							key={f.id}
							testid={`class-deadline-file-${f.id}`}
							label={f.name}
							checked={draft.fileIds.includes(f.id)}
							disabled={disabled}
							onToggle={() => onChange(draft.key, { fileIds: toggleFile(draft.fileIds, f.id, order) })}
						/>
					))}
				</div>
			)}
			<Check testid="class-deadline-done" label="Done" checked={draft.done} disabled={disabled} onToggle={() => onChange(draft.key, { done: !draft.done })} />
			<button
				type="button"
				data-testid="class-deadline-remove"
				disabled={disabled}
				onClick={() => onRemove(draft.key)}
				className="lh-press self-start text-[13px] font-bold text-ans-wrong hover:text-red-400 disabled:opacity-50"
			>
				Remove deadline
			</button>
		</div>
	);
});

function Check({
	testid,
	label,
	checked,
	disabled,
	onToggle,
}: {
	testid: string;
	label: string;
	checked: boolean;
	disabled?: boolean;
	onToggle: () => void;
}) {
	return (
		<label className="flex cursor-pointer items-center gap-2.5 px-0.5 py-[5px]">
			<input type="checkbox" data-testid={testid} checked={checked} disabled={disabled} onChange={onToggle} className="peer sr-only" />
			<span
				aria-hidden
				className={cn(
					"flex size-3.5 shrink-0 items-center justify-center peer-focus-visible:outline peer-focus-visible:outline-1 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink",
					checked ? "bg-ink text-black" : "outline outline-1 -outline-offset-1 outline-ink-3",
				)}
			>
				{checked && <CheckIcon className="size-[11px]" strokeWidth={3} />}
			</span>
			<span className={cn("min-w-0 truncate text-[13.5px]", checked ? "text-ink" : "text-ink-2")}>{label}</span>
		</label>
	);
}
