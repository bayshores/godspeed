import { memo, useState, type DragEvent } from "react";
import { ArrowDownToLineIcon, ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import type { FileCoverage, FileGroup } from "@/core";
import { cn } from "@/lib/utils";
import { FileRow, type FileRowActions } from "./file-row";
import { dropTitle, shortDate } from "./files-model";

/**
 * ONE GROUP (Files page): a series found in the file names ("Lecture",
 * "Week · Discussion") or Other. Its header folds it; each entry shows
 * its number and date on the left and its files (a lecture's notes and
 * its transcript together) as rows on the right.
 */
export const FileGroupSection = memo(function FileGroupSection({
	group,
	collapsed,
	onToggle,
	coverage,
	disabled,
	agentTeaching,
	actions,
}: {
	group: FileGroup;
	collapsed: boolean;
	onToggle: (key: string) => void;
	coverage: ReadonlyMap<string, FileCoverage>;
	disabled?: boolean;
	agentTeaching: boolean;
	actions: FileRowActions;
}) {
	const Chevron = collapsed ? ChevronRightIcon : ChevronDownIcon;
	const row = (file: FileGroup["items"][number]["files"][number]) => (
		<FileRow
			key={file.id}
			file={file}
			coverage={coverage.get(file.id)}
			disabled={disabled}
			agentTeaching={agentTeaching}
			actions={actions}
		/>
	);
	return (
		<section data-testid={`files-group-${group.key}`} aria-label={group.label} className="@container flex w-full flex-col bg-panel px-1.5 pt-1.5 pb-1.5">
			<button
				type="button"
				aria-expanded={!collapsed}
				data-testid={`files-group-toggle-${group.key}`}
				onClick={() => onToggle(group.key)}
				className="lh-press flex items-center gap-2 px-2.5 py-2.5 text-left hover:bg-tone"
			>
				<Chevron className="size-3.5 shrink-0 text-ink-3" aria-hidden />
				<h2 className="text-[15px] font-bold text-ink">{group.label}</h2>
				<span data-testid={`files-count-${group.key}`} className="font-mono text-[12.5px] tabular-nums text-ink-3">
					{group.count}
				</span>
			</button>
			{!collapsed && (
				<ul className="flex flex-col">
					{group.items.map((item) =>
						item.label === null ? (
							row(item.files[0]!)
						) : (
							<li key={item.key} data-testid={`files-item-${item.key}`} className="flex items-start border-t border-tone first:border-t-0">
								<div className="flex w-[96px] shrink-0 flex-col gap-0.5 py-2 pl-2.5 @3xl:w-[124px]">
									<span title={item.label} className="truncate text-[13.5px] font-bold text-ink">{item.label}</span>
									{item.date && <span className="text-[12.5px] text-ink-3">{shortDate(item.date)}</span>}
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
		<div data-testid="files-drop-targets" className="flex gap-3">
			{(["study", "info"] as const).map((kind) => (
				<div
					key={kind}
					data-testid={`files-drop-${kind}`}
					data-over={over === kind || undefined}
					{...target(kind)}
					className={cn(
						"flex h-24 flex-1 items-center justify-center gap-2.5 outline outline-1 -outline-offset-1 transition-colors duration-(--lh-dur)",
						over === kind ? "bg-tone-2 text-ink outline-ink-2" : "bg-panel text-ink-2 outline-tone-2",
					)}
				>
					<ArrowDownToLineIcon className="size-4 shrink-0" aria-hidden />
					<span className="text-sm font-bold">{dropTitle(kind, count)}</span>
				</div>
			))}
		</div>
	);
}
