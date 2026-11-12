import { useState } from "react";
import Link from "next/link";
import type { DeadlineProgress } from "@/shared/core";
import { Pane } from "@/frontend/components/ui/pane";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { Tip } from "@/frontend/components/ui/tooltip";
import { cn } from "@/frontend/lib/utils";
import { materialSummary, shortDate, type Day, type DayState, type Material } from "./deadline-model";
import { RULE, SHEET, SHEET_TITLE } from "./styles";

const SMALL = "lh-btn h-[29px] px-2.5 text-[15px]";

/**
 * WHAT'S ON IT: the deadline's days by week, the days before it
 * that it doesn't cover yet (to add or leave out), and the ones left out.
 */
export function CoversSheet({
	deadline: d,
	material: m,
	source,
	teacherName,
	saving,
	onEdit,
	onAsk,
	onAdd,
	onLeaveOut,
}: {
	deadline: DeadlineProgress;
	/** Null while the space's files load. */
	material: Material | null;
	source: string | undefined;
	teacherName: string;
	saving: boolean;
	onEdit: () => void;
	onAsk: () => void;
	onAdd: (fileIds: string[]) => void;
	onLeaveOut: (fileIds: string[]) => void;
}) {
	const [showLeftOut, setShowLeftOut] = useState(false);
	const before = d.kind === "exam" ? "before the exam" : "before it's due";
	if (m && d.files.length === 0) {
		return (
			<Pane data-testid="deadline-material" className={SHEET}>
				<h2 className={SHEET_TITLE}>What&apos;s on it</h2>
				<div data-testid="deadline-no-files" className="flex flex-col items-start gap-4">
					<p className="text-lg text-ink-2">
						Nothing is linked yet. {teacherName} can work it out from your files, like a practice exam or the syllabus.
					</p>
					<div className="flex flex-wrap gap-2.5">
						<button type="button" data-testid="deadline-ask" onClick={onAsk} className="lh-btn lh-btn-main px-[18px] text-[15px]">
							Ask {teacherName}
						</button>
						<button type="button" data-testid="deadline-edit-files" onClick={onEdit} className="lh-btn text-[15px]">
							Pick files
						</button>
					</div>
				</div>
			</Pane>
		);
	}
	return (
		<Pane data-testid="deadline-material" className={SHEET}>
			<div className="flex items-center gap-2">
				<h2 className={SHEET_TITLE}>What&apos;s on it</h2>
				<button type="button" data-testid="deadline-edit-files" onClick={onEdit} className="lh-btn lh-btn-quiet text-[15px]">
					Pick files
				</button>
			</div>
			{!m ? (
				<div className="h-40 w-full bg-tone" aria-hidden />
			) : (
				<>
					<p data-testid="deadline-material-summary" className="text-[15px] text-ink-2">
						{materialSummary(m)}
						{source && (
							<>
								{". From "}
								<span data-testid="deadline-source">{source}</span>
							</>
						)}
					</p>
					<span className={RULE} />
					<div className="flex flex-col divide-y-2 divide-dotted divide-edge">
						{m.weeks.map((w) => (
							<Days key={w.number} testid="deadline-week" label={`Week ${w.number}`} days={w.days} />
						))}
						{m.undated.length > 0 && <Days testid="deadline-undated" label="Other" days={m.undated} />}
					</div>
					{m.notIncluded.length > 0 && (
						<div data-testid="deadline-not-included" className="flex flex-col gap-1 bg-highlight px-4 pt-3 pb-2.5">
							<div className="flex items-center gap-2">
								<p className="min-w-0 flex-1 text-lg text-ink">Not on it, but {before}</p>
								{m.notIncluded.length > 1 && (
									<button type="button" disabled={saving} onClick={() => onLeaveOut(m.notIncluded.flatMap((x) => x.fileIds))} className={SMALL}>
										Leave all out
									</button>
								)}
							</div>
							<ul>
								{m.notIncluded.map((day) => (
									<DayRow key={day.key} day={day} open>
										<button type="button" disabled={saving} onClick={() => onAdd(day.fileIds)} className={SMALL}>
											Add
										</button>
										<button type="button" disabled={saving} onClick={() => onLeaveOut(day.fileIds)} className={SMALL}>
											Leave out
										</button>
									</DayRow>
								))}
							</ul>
						</div>
					)}
					<span className={RULE} />
					{m.notIncluded.length === 0 && (
						<p data-testid="deadline-all-accounted" className="flex items-center gap-2.5 text-[15px] text-ink-2">
							<DayMark state="ready" open={false} />
							Every day {before} is on it or left out.
						</p>
					)}
					<div className="flex flex-wrap items-center gap-2.5">
						{m.leftOut.length > 0 && (
							<button type="button" data-testid="deadline-left-out-toggle" aria-expanded={showLeftOut} onClick={() => setShowLeftOut((v) => !v)} className="lh-btn lh-btn-quiet -ml-1 text-[15px]">
								{m.leftOut.length} left out, {showLeftOut ? "Hide" : "Show"}
							</button>
						)}
						<span className="flex-1" />
						<Link href="/space/files" data-testid="deadline-add-files" className="lh-btn text-[15px]">
							Add files
						</Link>
						<button type="button" data-testid="deadline-ask" onClick={onAsk} className="lh-btn text-[15px]">
							Ask {teacherName} to check
						</button>
					</div>
					{showLeftOut && m.leftOut.length > 0 && (
						<ul data-testid="deadline-left-out">
							{m.leftOut.map((day) => (
								<DayRow key={day.key} day={day} open>
									<button type="button" disabled={saving} onClick={() => onAdd(day.fileIds)} className={SMALL}>
										Add back
									</button>
								</DayRow>
							))}
						</ul>
					)}
				</>
			)}
		</Pane>
	);
}

/** A week's (or the undated files') days beside its label. */
function Days({ testid, label, days }: { testid: string; label: string; days: readonly Day[] }) {
	return (
		<div data-testid={testid} className="flex gap-2 py-1">
			<span className="w-[70px] shrink-0 py-[5px] font-count text-base text-ink">{label}</span>
			<ul className="min-w-0 flex-1">
				{days.map((day) => (
					<DayRow key={day.key} day={day} />
				))}
			</ul>
		</div>
	);
}

const MARK = "flex size-4 shrink-0 items-center justify-center";

/** A state is a shape, not only a color: read is a check, being read a
 *  half-filled box, couldn't be read a cross, and space info or a day
 *  that isn't on it an empty box. */
function DayMark({ state, open }: { state: DayState; open: boolean }) {
	if (open || state === "info") return <span aria-hidden className={cn(MARK, "bg-background")} />;
	if (state === "ready")
		return (
			<span aria-hidden className={cn(MARK, "bg-ans-right text-on-space")}>
				<PixelIcon name="check" className="h-2" />
			</span>
		);
	if (state === "failed")
		return (
			<span aria-hidden className={cn(MARK, "bg-ans-wrong text-background")}>
				<PixelIcon name="close" className="h-2" />
			</span>
		);
	return <span aria-hidden className={cn(MARK, "border-[1.5px] border-ink bg-[linear-gradient(to_right,var(--color-ink)_50%,transparent_50%)]")} />;
}

const STATE_WORD: Record<DayState, string> = { ready: "read", reading: "being read", failed: "couldn't be read", info: "space info, no facts" };

function DayRow({ day, open = false, children }: { day: Day; open?: boolean; children?: React.ReactNode }) {
	return (
		<li data-testid="deadline-day-row" data-state={open ? "open" : day.state} className="flex min-w-0 items-center gap-2.5 py-[5px]">
			<DayMark state={day.state} open={open} />
			{day.date && <span className="w-14 shrink-0 font-count text-base text-ink-2">{shortDate(day.date)}</span>}
			<Tip title={day.title} body={<span className="text-sm text-ink-2">{`${day.names.join(", ")}, ${STATE_WORD[day.state]}`}</span>}>
				<span tabIndex={0} className="min-w-0 truncate text-[15px] text-ink">
					{day.title}
				</span>
			</Tip>
			<span className={cn("min-w-0 flex-[1_9999_auto] truncate text-right text-base", day.state === "failed" ? "text-ans-wrong" : "text-ink-2")}>
				{day.state === "failed" ? STATE_WORD.failed : day.state === "info" && day.parts.length === 0 ? STATE_WORD.info : day.parts.join(", ")}
			</span>
			{children && <span className="flex shrink-0 items-center gap-2">{children}</span>}
		</li>
	);
}
