import { memo } from "react";
import { dayLabel, type FileCoverage, type FileGroup, type FileWork, type SpaceFile } from "@/shared/core";
import { rowMotion } from "@/frontend/components/motion";
import type { Moves } from "@/frontend/components/presence";
import { Pane } from "@/frontend/components/ui/pane";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { useFold } from "@/frontend/components/use-fold";
import { cn } from "@/frontend/lib/utils";
import { FileRow, type FileRowActions, type RowPick } from "./file-row";
import { entryRows } from "./files-model";

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
			<PixelIcon name="chevron" className={cn("text-ink transition-transform duration-(--lh-dur) ease-(--lh-ease-out)", !collapsed && "rotate-90")} />
			<h2 className="lh-card-title">{label}</h2>
			<span data-testid={noteTestid} className="font-count text-ui text-ink-2 tabular-nums">
				{note}
			</span>
		</button>
	);
}

/** How each file's row moves, by file id (useListMotion). */
type FileMoves = ReadonlyMap<string, Moves>;

/** A part of the list (a group, an entry, a row) leaves or joins when all its files do, unless the
 *  part that holds it (the files of `outer`) moves with them, so one fade plays, not two. */
function partMoves(files: readonly SpaceFile[], moves: FileMoves, outer?: readonly SpaceFile[]): Moves {
	const all = (of: readonly SpaceFile[], on: keyof Moves) => of.every((f) => moves.get(f.id)?.[on]);
	return {
		leaving: all(files, "leaving") && !(outer && all(outer, "leaving")),
		joined: all(files, "joined") && !(outer && all(outer, "joined")),
	};
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
	work,
	pickOf,
	onPick,
	boxes,
	disabled,
	teacher,
	actions,
	moves,
}: {
	group: FileGroup;
	collapsed: boolean;
	onToggle: (key: string) => void;
	coverage: ReadonlyMap<string, FileCoverage>;
	work: ReadonlyMap<string, FileWork>;
	pickOf: (fileId: string) => RowPick;
	onPick: (fileId: string, held: boolean) => void;
	/** Rows show their tick boxes. */
	boxes: boolean;
	disabled?: boolean;
	teacher: string;
	actions: FileRowActions;
	moves: FileMoves;
}) {
	const fold = useFold(!collapsed);
	const groupFiles = group.items.flatMap((i) => i.files);
	const whole = partMoves(groupFiles, moves);
	const rows = (files: FileGroup["items"][number]["files"], outer: readonly SpaceFile[]) =>
		entryRows(files).map(({ file, source }) => (
			<FileRow
				key={file.id}
				{...partMoves(source ? [file, source] : [file], moves, outer)}
				file={file}
				source={source}
				coverage={coverage.get(file.id)}
				work={work.get(file.id)}
				pick={pickOf(file.id)}
				onPick={onPick}
				boxes={boxes}
				disabled={disabled}
				teacher={teacher}
				actions={actions}
			/>
		));
	return (
		<Pane data-testid={`files-group-${group.key}`} aria-label={group.label} {...rowMotion(whole.leaving, whole.joined, "lh-card gap-1.5")}>
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
							{group.items.map((item) => {
								if (item.label === null) return rows(item.files, groupFiles);
								const entry = partMoves(item.files, moves, groupFiles);
								return (
									<li key={item.key} data-testid={`files-item-${item.key}`} {...rowMotion(entry.leaving, entry.joined, "flex items-start gap-3 py-[5px]")}>
										<div className="flex w-[110px] shrink-0 flex-col pt-1.5">
											<span title={item.label} className="truncate text-ui font-medium text-ink">
												{item.label}
											</span>
											{item.date && <span className="font-count text-sm text-ink-2">{dayLabel(item.date)}</span>}
										</div>
										<ul className="flex min-w-0 flex-1 flex-col">{rows(item.files, item.files)}</ul>
									</li>
								);
							})}
						</ul>
					</div>
				</div>
			)}
		</Pane>
	);
});
