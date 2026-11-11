import { memo } from "react";
import { rampColor, type DeadlineProgress, type PlanDay } from "@/shared/core";
import { isOverdue } from "@/frontend/components/deadlines-model";
import { progressShare, progressWords } from "@/frontend/components/overview/overview-model";
import { ProgressBar } from "@/frontend/components/ui/progress-bar";
import { Tip } from "@/frontend/components/ui/tooltip";
import { CoversSheet } from "./covers-sheet";
import { DeadlineBlock } from "./deadline-block";
import { rightLabel, whenLine, type Material, type TopicTally } from "./deadline-model";
import { PathSheet } from "./path-sheet";

/**
 * ONE DEADLINE'S PAGE (pure view, the render-test seam): the time left,
 * when, the name and how far it is; its topics as a strip colored by how
 * you do; a homework's problems; What's on it and the path to it.
 */

interface DeadlineBodyProps {
	deadline: DeadlineProgress;
	/** The class's color. */
	color: string;
	/** The class's topics, for each one's "2 of 5 right". */
	topics: readonly TopicTally[];
	/** Null while the class's files load. */
	material: Material | null;
	plan: readonly PlanDay[];
	nowMs: number;
	busy: boolean;
	/** Why the last Study start failed. */
	startError: string | null;
	onStart: () => void;
	/** Opens "Edit deadline". */
	onEdit: () => void;
	/** Where the agent found what it covers. */
	source: string | undefined;
	teacherName: string;
	/** An Add or Leave out is being saved. */
	saving: boolean;
	onAsk: () => void;
	onAdd: (fileIds: string[]) => void;
	onLeaveOut: (fileIds: string[]) => void;
	/** Opens the cheat sheet studio. */
	onCheatSheet: () => void;
	/** A homework or project's problems (homework-card.tsx). */
	homework?: React.ReactNode;
}

const LEGEND: { key: keyof DeadlineProgress["counts"]; label: string; rate: number | null }[] = [
	{ key: "strong", label: "strong", rate: 0.9 },
	{ key: "shaky", label: "shaky", rate: 0.7 },
	{ key: "weak", label: "weak", rate: 0.3 },
	{ key: "untested", label: "not tested", rate: null },
];

export const DeadlineBody = memo(function DeadlineBody(props: DeadlineBodyProps) {
	const { deadline: d, nowMs } = props;
	const past = !d.done && isOverdue(d, nowMs);
	const tallies = new Map(props.topics.map((t) => [t.id, t]));
	const share = progressShare(d);
	return (
		<div data-testid="deadline-page" className="@container flex w-full flex-col gap-[22px]">
			<header className="flex flex-wrap items-center gap-x-6 gap-y-3">
				<DeadlineBlock deadline={d} color={props.color} nowMs={nowMs} size="head" />
				<div className="flex min-w-0 flex-1 basis-[280px] flex-col gap-1.5">
					<p data-testid="deadline-when" className="font-count text-lg text-ink-2">
						{whenLine(d)}
					</p>
					<h1 data-testid="deadline-name" className="text-[44px] leading-[1.2] break-words text-ink">
						{d.name}
					</h1>
					<div data-testid="deadline-progress" className="flex items-center gap-3">
						{share !== null && <ProgressBar share={share} className="w-[320px] max-w-[50%] shrink-0" />}
						<span className="text-[15px] text-ink-2">{progressWords(d) ?? "Not measured yet"}</span>
					</div>
				</div>
				<button type="button" data-testid="deadline-cheat-sheet" onClick={props.onCheatSheet} className="lh-btn shrink-0 text-[15px]">
					Cheat sheet
				</button>
				<button type="button" data-testid="deadline-edit" onClick={props.onEdit} className="lh-btn shrink-0 text-[15px]">
					Edit deadline
				</button>
			</header>

			{d.topics.length > 0 && <TopicStrip deadline={d} tallies={tallies} />}

			<div className="flex flex-col items-start gap-5 @4xl:flex-row">
				<div className="flex w-full min-w-0 flex-1 flex-col gap-5">
					{props.homework}
					<CoversSheet
						deadline={d}
						material={props.material}
						source={props.source}
						teacherName={props.teacherName}
						saving={props.saving}
						onEdit={props.onEdit}
						onAsk={props.onAsk}
						onAdd={props.onAdd}
						onLeaveOut={props.onLeaveOut}
					/>
				</div>
				<div className="w-full @4xl:w-[400px] @4xl:shrink-0">
					<PathSheet deadline={d} plan={props.plan} material={props.material} tallies={tallies} past={past} busy={props.busy} startError={props.startError} onStart={props.onStart} />
				</div>
			</div>
		</div>
	);
});

function TopicStrip({ deadline: d, tallies }: { deadline: DeadlineProgress; tallies: ReadonlyMap<string, TopicTally> }) {
	return (
		<div className="flex flex-col gap-2">
			<div data-testid="deadline-topics" className="flex h-2.5 w-full gap-[3px]">
				{d.topics.map((t) => (
					<Tip key={t.id} title={t.name} body={<span className="text-sm text-ink-2">{rightLabel(tallies.get(t.id))}</span>}>
						{/* Focusable and named, so the tip isn't for the mouse only. */}
						<span
							data-testid="deadline-topic"
							role="img"
							tabIndex={0}
							aria-label={`${t.name}: ${rightLabel(tallies.get(t.id))}`}
							className="h-full min-w-1 flex-1"
							style={{ background: rampColor(t.rate) }}
						/>
					</Tip>
				))}
			</div>
			<div className="flex flex-wrap items-center gap-x-[18px] gap-y-1 text-base text-ink-2">
				{LEGEND.filter((l) => d.counts[l.key] > 0).map((l) => (
					<span key={l.key} data-testid={`deadline-count-${l.key}`} className="flex items-center gap-1.5">
						<span className="size-2.5 shrink-0" style={{ background: rampColor(l.rate) }} aria-hidden />
						{d.counts[l.key]} {l.label}
					</span>
				))}
			</div>
		</div>
	);
}
