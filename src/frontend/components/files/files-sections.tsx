import { memo } from "react";
import { dayLabel, type FileCoverage, type FileGroup } from "@/shared/core";
import { Pane } from "@/frontend/components/ui/pane";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { useFold } from "@/frontend/components/use-fold";
import { cn } from "@/frontend/lib/utils";
import { FileRow, type FileRowActions } from "./file-row";

/** A section's header, the top of its sheet: the chevron (right when folded),
 *  its name and a note after it ("28 files"). Clicking it folds the section. */
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
		<button type="button" aria-expanded={!collapsed} data-testid={testid} onClick={onClick} className="lh-press flex min-h-10 w-full items-center gap-3 text-left">
			<PixelIcon name="chevron" className={cn("h-[10.5px] text-ink transition-transform duration-(--lh-dur) ease-(--lh-ease-out)", !collapsed && "rotate-90")} />
			<h2 className="lh-card-title">{label}</h2>
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
	collapsed,
	onToggle,
	coverage,
	disabled,
	teacher,
	actions,
}: {
	group: FileGroup;
	collapsed: boolean;
	onToggle: (key: string) => void;
	coverage: ReadonlyMap<string, FileCoverage>;
	disabled?: boolean;
	teacher: string;
	actions: FileRowActions;
}) {
	const fold = useFold(!collapsed);
	const row = (file: FileGroup["items"][number]["files"][number]) => (
		<FileRow key={file.id} file={file} coverage={coverage.get(file.id)} disabled={disabled} teacher={teacher} actions={actions} />
	);
	return (
		<Pane data-testid={`files-group-${group.key}`} aria-label={group.label} className="lh-card gap-1.5 pb-5">
			<SectionToggle
				label={group.label}
				note={`${group.count} ${group.count === 1 ? "file" : "files"}`}
				collapsed={collapsed}
				testid={`files-group-toggle-${group.key}`}
				noteTestid={`files-count-${group.key}`}
				onClick={() => onToggle(group.key)}
			/>
			{fold.mounted && (
				<div className="lh-collapse" data-state={fold.state}>
					<div>
						<ul className="flex flex-col">
							{group.items.map((item) =>
								item.label === null ? (
									row(item.files[0]!)
								) : (
									<li key={item.key} data-testid={`files-item-${item.key}`} className="flex items-start gap-3 py-[5px]">
										<div className="flex w-[110px] shrink-0 flex-col pt-1.5">
											<span title={item.label} className="truncate text-[15px] font-medium text-ink">
												{item.label}
											</span>
											{item.date && <span className="font-count text-sm text-ink-2">{dayLabel(item.date)}</span>}
										</div>
										<ul className="flex min-w-0 flex-1 flex-col">{item.files.map(row)}</ul>
									</li>
								),
							)}
						</ul>
					</div>
				</div>
			)}
		</Pane>
	);
});
