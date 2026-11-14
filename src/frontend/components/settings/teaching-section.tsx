/**
 * Settings → Teaching: the teaching areas (and the notes the agent
 * remembered) in a list on the left, the picked one's sheet on the right.
 * An area's full instructions take the whole page (instructions-panel.tsx).
 */

import { useCallback, useEffect, useState } from "react";
import { savedTimes, TEACHING_AREAS, type AgentSettings, type AreaId, type GraphSettings, type PromptSegmentInfo, type TeachingArea } from "@/shared/core";
import { LoadFailed } from "@/frontend/components/load-failed";
import { useSavedRules } from "@/frontend/components/use-saved-rules";
import { Pane } from "@/frontend/components/ui/pane";
import { cn } from "@/frontend/lib/utils";
import { AreaDetail } from "./area-detail.tsx";
import { InstructionsPanel } from "./instructions-panel.tsx";
import { RememberedNotes } from "./remembered-notes.tsx";
import { areaEdited, areaParts } from "./teaching-model.ts";

type AreaPick = AreaId | "remembered";

export function TeachingSection({
	agent,
	graph,
	onGraphChange,
	teacherName,
	onSectionChange,
	onFullPage,
}: {
	agent: AgentSettings | undefined;
	/** The graph switch, shown with "Your graph" in Facts and research. */
	graph: GraphSettings | undefined;
	onGraphChange: (next: GraphSettings) => void;
	teacherName: string;
	/** Writes the composed whole agent section. */
	onSectionChange: (next: AgentSettings) => void;
	/** Tells the page when an area's instructions fill it, so the page hides its own heading. */
	onFullPage: (open: boolean) => void;
}) {
	const [segments, setSegments] = useState<PromptSegmentInfo[] | null>(null);
	const [segmentsFailed, setSegmentsFailed] = useState(false);
	const [pick, setPick] = useState<AreaPick>(TEACHING_AREAS[0]!.id);
	const [openArea, setOpenArea] = useState<TeachingArea | null>(null);
	const savedRules = useSavedRules(agent?.rules);
	const readSegments = useCallback(() => {
		fetch("/api/settings/prompts")
			.then((r) => {
				if (!r.ok) throw new Error(String(r.status));
				return r.json() as Promise<{ segments: PromptSegmentInfo[] }>;
			})
			.then((body) => setSegments(body.segments))
			.catch(() => setSegmentsFailed(true));
	}, []);
	useEffect(readSegments, [readSegments]);
	useEffect(() => {
		onFullPage(openArea !== null);
		return () => onFullPage(false);
	}, [openArea, onFullPage]);

	if (openArea && segments) {
		return (
			<InstructionsPanel
				area={openArea}
				parts={areaParts(openArea, segments)}
				teacherName={teacherName}
				onChanged={readSegments}
				onClose={() => setOpenArea(null)}
			/>
		);
	}

	const area = TEACHING_AREAS.find((a) => a.id === pick);
	return (
		<>
			<p className="pb-6 text-lg text-ink-2">How {teacherName} teaches you. Change a switch, add a rule, or rewrite the instructions.</p>
			{segments === null && segmentsFailed && <LoadFailed message="Couldn't load the instructions." onRetry={readSegments} className="pb-6" />}
			<div className="flex items-start gap-5">
				<Pane aria-label="Teaching areas" className="flex w-[260px] shrink-0 flex-col p-2">
					{TEACHING_AREAS.map((a) => (
						<AreaButton key={a.id} id={a.id} label={a.label} on={pick === a.id} onPick={() => setPick(a.id)} />
					))}
					<div className="my-2 h-[1.5px] bg-ink" aria-hidden />
					<AreaButton id="remembered" label="Remembered" on={pick === "remembered"} onPick={() => setPick("remembered")} />
				</Pane>
				<div className="min-w-0 flex-1">
					{area ? (
						<AreaDetail
							area={area}
							agent={agent}
							graphOn={graph?.enabled ?? true}
							onGraphChange={(on) => onGraphChange({ enabled: on })}
							teacherName={teacherName}
							savedAt={savedTimes(savedRules, { area: area.id })}
							edited={segments !== null && areaEdited(area, segments)}
							instructionsReady={segments !== null}
							onSectionChange={onSectionChange}
							onOpenInstructions={() => setOpenArea(area)}
						/>
					) : (
						<RememberedNotes />
					)}
				</div>
			</div>
		</>
	);
}

function AreaButton({ id, label, on, onPick }: { id: AreaPick; label: string; on: boolean; onPick: () => void }) {
	return (
		<button
			type="button"
			data-testid={`area-${id}`}
			aria-current={on}
			onClick={onPick}
			className={cn("lh-press rounded-sm px-3 py-2.5 text-left text-[15px] text-ink", on ? "bg-highlight font-medium" : "hover:bg-tone")}
		>
			{label}
		</button>
	);
}
