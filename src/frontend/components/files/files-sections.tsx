import { memo, useState, type DragEvent } from "react";
import type { FileCoverage, FileGroup } from "@/shared/core";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import { FileRow, type FileRowActions } from "./file-row";
import { dropTitle, kindNote, shortDate } from "./files-model";

/** The line above a section of the file list (from listRules). */
type ListRule = "solid" | "dotted" | null;

const RULE_ABOVE: Record<"solid" | "dotted", string> = {
	solid: "border-t-[1.5px] border-ink",
	dotted: "border-t-2 border-dotted border-edge",
};

/** A section's header: the chevron (right when folded), its name and a
 *  note after it ("28 files"). Clicking it folds the section. */
export function SectionToggle({
	label,
	note,
	collapsed,
	testid,
	noteTestid,
	onClick,
}: {
	label: string;
	note: string;
	collapsed: boolean;
	testid: string;
	noteTestid?: string;
	onClick: () => void;
}) {
	return (
		<button type="button" aria-expanded={!collapsed} data-testid={testid} onClick={onClick} className="lh-press flex w-full items-center gap-2.5 px-1 py-[9px] text-left">
			<PixelIcon name="chevron" className={cn("h-[10.5px] text-ink", !collapsed && "rotate-90")} />
			<h2 className="text-[17px] font-medium text-ink">{label}</h2>
			<span data-testid={noteTestid} className="font-count text-[15px] text-ink-2 tabular-nums">
				{note}
			</span>
		</button>
	);
}

/**
 * ONE GROUP (Files page): a series found in the file names ("Lecture",
 * "Week, Discussion") or Other. Its header folds it; each entry shows its
 * number and date on the left and its files (a lecture's notes and its
 * transcript together) as rows on the right.
 */
export const FileGroupSection = memo(function FileGroupSection({
	group,
	rule,
	collapsed,
	onToggle,
	coverage,
	disabled,
	agentTeaching,
	actions,
}: {
	group: FileGroup;
	rule: ListRule;
	collapsed: boolean;
	onToggle: (key: string) => void;
	coverage: ReadonlyMap<string, FileCoverage>;
	disabled?: boolean;
	agentTeaching: boolean;
	actions: FileRowActions;
}) {
	const row = (file: FileGroup["items"][number]["files"][number]) => (
		<FileRow key={file.id} file={file} coverage={coverage.get(file.id)} disabled={disabled} agentTeaching={agentTeaching} actions={actions} />
	);
	return (
		<section data-testid={`files-group-${group.key}`} aria-label={group.label} className={cn("flex w-full flex-col", rule && RULE_ABOVE[rule])}>
			<SectionToggle
				label={group.label}
				note={`${group.count} ${group.count === 1 ? "file" : "files"}`}
				collapsed={collapsed}
				testid={`files-group-toggle-${group.key}`}
				noteTestid={`files-count-${group.key}`}
				onClick={() => onToggle(group.key)}
			/>
			{!collapsed && (
				<ul className={cn("flex flex-col", RULE_ABOVE.solid)}>
					{group.items.map((item, i) =>
						item.label === null ? (
							row(item.files[0]!)
						) : (
							<li key={item.key} data-testid={`files-item-${item.key}`} className={cn("flex items-start gap-3 px-1 py-[5px]", i > 0 && RULE_ABOVE.dotted)}>
								<div className="flex w-[110px] shrink-0 flex-col pt-1.5">
									<span title={item.label} className="truncate text-[15px] font-medium text-ink">
										{item.label}
									</span>
									{item.date && <span className="font-count text-sm text-ink-2">{shortDate(item.date)}</span>}
								</div>
								<ul className="flex min-w-0 flex-1 flex-col">{item.files.map(row)}</ul>
							</li>
						),
					)}
				</ul>
			)}
		</section>
	);
});

/** The two places to drop files from Finder while they are over the page. */
export function FinderDropTargets({ count, onDrop }: { count: number; onDrop: (kind: "study" | "info", files: File[]) => void }) {
	const [over, setOver] = useState<"study" | "info" | null>(null);
	const target = (kind: "study" | "info") => ({
		onDragOver: (e: DragEvent<HTMLElement>) => {
			e.preventDefault();
			e.stopPropagation();
			e.dataTransfer.dropEffect = "copy";
			setOver(kind);
		},
		onDragLeave: () => setOver((o) => (o === kind ? null : o)),
		onDrop: (e: DragEvent<HTMLElement>) => {
			e.preventDefault();
			e.stopPropagation();
			setOver(null);
			const files = Array.from(e.dataTransfer.files);
			if (files.length > 0) onDrop(kind, files);
		},
	});
	return (
		<div data-testid="files-drop-targets" className="flex gap-3.5">
			{(["study", "info"] as const).map((kind) => (
				<div
					key={kind}
					data-testid={`files-drop-${kind}`}
					data-over={over === kind || undefined}
					{...target(kind)}
					className={cn(
						"flex h-[110px] flex-1 flex-col items-center justify-center gap-0.5 rounded border-[1.5px] border-ink px-4 text-center transition-colors duration-(--lh-dur)",
						over === kind ? "bg-highlight" : "bg-panel",
					)}
				>
					<span data-testid={`files-drop-${kind}-title`} className="text-[17px] font-medium text-ink">
						{dropTitle(kind, count)}
					</span>
					<span className="text-base text-ink-2">{kindNote(kind)}</span>
				</div>
			))}
		</div>
	);
}
