"use client";

import { useState } from "react";
import Link from "next/link";
import { DEFAULT_TEACHER_NAME, isFirstRound, type SpaceRecord } from "@/shared/core";
import { useAgentStatus } from "@/frontend/components/agent-status";
import { BrailleSpinner } from "@/frontend/components/braille-spinner";
import { useMinute } from "@/frontend/components/countdown";
import { shortDate } from "@/frontend/components/deadline/deadline-model";
import { useSpaceRecord } from "@/frontend/components/files/space-files-api";
import { useHalley } from "@/frontend/components/halley/halley-context";
import { useSpaces } from "@/frontend/components/space-context";
import { Pane } from "@/frontend/components/ui/pane";
import { useProgress } from "@/frontend/components/use-progress";
import { hasWork, workDeadlines, workDetail, workFiles, workState, workTitle } from "./teacher-work-model";

/**
 * Under a space's head, on every tab: what the teacher is doing to the
 * space's files right now, then a summary of what it made until it is
 * closed. Nothing while there is nothing to say.
 */
export function TeacherWork() {
	const { active } = useSpaces();
	const { record } = useSpaceRecord(active);
	const nowMs = useMinute();
	if (!record || nowMs === null || !hasWork({ files: record.files, work: record.lastWork, nowMs })) return null;
	// A new round starts folded again.
	return <WorkStrip key={`${record.id}:${record.lastWork?.startedAt ?? ""}`} record={record} nowMs={nowMs} />;
}

function WorkStrip({ record, nowMs }: { record: SpaceRecord; nowMs: number }) {
	const progress = useProgress().data;
	const teaching = useAgentStatus()?.teaching ?? true;
	const teacher = useHalley()?.name ?? DEFAULT_TEACHER_NAME;
	// null: not picked yet, so a space being built starts unfolded.
	const [picked, setPicked] = useState<boolean | null>(null);
	const [closed, setClosed] = useState(false);
	const coverage = progress?.files ?? [];
	const deadlines = record.deadlines ?? [];
	const state = workState({ files: record.files, work: record.lastWork, deadlines, coverage, grouping: progress?.grouping ?? false, teaching, nowMs });
	if (!state || closed) return null;

	const detail = workDetail(state);
	const live = state.kind === "reading" || state.kind === "grouping";
	const foldable = state.kind !== "waiting";
	const unfolded = foldable && (picked ?? isFirstRound(record.files, record.lastWork));
	const made = workFiles(record.files, record.lastWork, coverage);
	const added = workDeadlines(deadlines, record.lastWork);
	const close = () => {
		setClosed(true);
		void fetch(`/api/spaces/${encodeURIComponent(record.id)}/work`, { method: "DELETE" });
	};

	return (
		<div className="mx-auto w-full max-w-[908px] shrink-0 px-6 pt-5">
			<Pane data-testid="teacher-work" data-state={state.kind} aria-label="The teacher's work on this space">
				<div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
					{live && <BrailleSpinner className="h-4 text-ink" label="Working" />}
					<div className="flex min-w-0 flex-1 basis-[260px] flex-col gap-0.5">
						<p data-testid="teacher-work-title" className="text-lg text-ink">
							{workTitle(state, teacher)}
						</p>
						{detail && (
							<p data-testid="teacher-work-detail" title={detail} className="truncate text-[15px] text-ink-2">
								{detail}
							</p>
						)}
					</div>
					{foldable && (
						<button type="button" data-testid="teacher-work-fold" aria-expanded={unfolded} onClick={() => setPicked(!unfolded)} className="lh-btn shrink-0">
							{unfolded ? "Hide what it made" : "Show what it made"}
						</button>
					)}
					{state.kind === "done" && (
						<button type="button" data-testid="teacher-work-close" onClick={close} className="lh-btn lh-btn-quiet shrink-0">
							Close
						</button>
					)}
				</div>
				{unfolded && (
					<div className="flex flex-wrap gap-3 border-t-2 border-line p-4">
						<div data-testid="teacher-work-files" className="flex min-w-0 flex-1 basis-[300px] flex-col gap-2 border border-edge bg-background p-3">
							<h3 className="text-base text-ink">Files</h3>
							{made.rows.length === 0 ? (
								<p className="text-[15px] text-ink-2">No file is read yet.</p>
							) : (
								<ul className="flex flex-col gap-1">
									{made.rows.map((row) => (
										<li key={row.id} className="flex items-baseline gap-3 text-[15px]">
											<span title={row.name} className="min-w-0 flex-1 truncate text-ink">
												{row.name}
											</span>
											<span className="shrink-0 text-ink-2">{row.note}</span>
										</li>
									))}
								</ul>
							)}
							{made.more > 0 && (
								<Link href="/space/files" data-testid="teacher-work-more-files" className="lh-press self-start text-[15px] text-ink-2 underline hover:text-ink">
									{made.more} more in Files
								</Link>
							)}
						</div>
						{added.length > 0 && (
							<div data-testid="teacher-work-deadlines" className="flex min-w-0 flex-1 basis-[300px] flex-col gap-2 border border-edge bg-background p-3">
								<h3 className="text-base text-ink">Deadlines</h3>
								<ul className="flex flex-col gap-1">
									{added.map((d) => (
										<li key={d.id} className="flex items-baseline gap-3 text-[15px]">
											<span title={d.name} className="min-w-0 flex-1 truncate text-ink">
												{d.name}
											</span>
											<span className="shrink-0 text-ink-2">{shortDate(d.date)}</span>
										</li>
									))}
								</ul>
								<Link href="/space/deadlines" className="lh-press self-start text-[15px] text-ink-2 underline hover:text-ink">
									Open Deadlines
								</Link>
							</div>
						)}
					</div>
				)}
			</Pane>
		</div>
	);
}
