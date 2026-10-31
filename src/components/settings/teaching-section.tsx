/**
 * Settings → Teaching: one
 * card per teaching area. The left side says what the area is and opens
 * its full instructions; the right side holds its switches and the
 * learner's rules. The instructions panel (instructions-panel.tsx) slides
 * over the dialog.
 */

import { useCallback, useEffect, useState, type ComponentType } from "react";
import {
	ArrowRightIcon,
	FileTextIcon,
	GlobeIcon,
	ListChecksIcon,
	ListIcon,
	MessageCircleIcon,
	PenLineIcon,
	PlayIcon,
	RouteIcon,
	ShapesIcon,
	WaypointsIcon,
} from "lucide-react";
import { TEACHING_AREAS, type AgentSettings, type AreaId, type GraphSettings, type PromptSegmentInfo, type TeachingArea } from "@/core";
import { HalleyFace } from "@/components/halley/halley-face";
import { RuleChips } from "@/components/rule-chips";
import { cn } from "@/lib/utils";
import { Toggle } from "./controls.tsx";
import { InstructionsPanel } from "./instructions-panel.tsx";
import { areaParts, composeGraphTools, composeQuizStyle, composeRules, composeTool } from "./teaching-model.ts";

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

const AREA_ICONS: Record<AreaId, Icon> = {
	voice: MessageCircleIcon,
	teaching: RouteIcon,
	questions: ListChecksIcon,
	facts: GlobeIcon,
	demos: PlayIcon,
	files: FileTextIcon,
};

export function TeachingSection({
	agent,
	graph,
	teacherName,
	onSectionChange,
}: {
	agent: AgentSettings | undefined;
	/** Read only: the graph switch in General gates "Your graph". */
	graph: GraphSettings | undefined;
	teacherName: string;
	/** Writes the composed whole agent section. */
	onSectionChange: (next: AgentSettings) => void;
}) {
	const [segments, setSegments] = useState<PromptSegmentInfo[] | null>(null);
	const [openArea, setOpenArea] = useState<TeachingArea | null>(null);
	const readSegments = useCallback(() => {
		fetch("/api/settings/prompts")
			.then((r) => r.json())
			.then((body: { segments: PromptSegmentInfo[] }) => setSegments(body.segments))
			.catch(() => {});
	}, []);
	useEffect(readSegments, [readSegments]);

	const tools = agent?.tools ?? {};
	const graphOn = graph?.enabled ?? true;
	const toolRow = (icon: Icon, id: string, label: string, about: string) => (
		<SwitchRow icon={icon} label={label} about={about} on={tools[id] ?? true} onChange={(on) => onSectionChange(composeTool(agent, id, on))} />
	);
	const controls: Partial<Record<AreaId, React.ReactNode>> = {
		questions: <QuizStyle free={tools.explain === true} onPick={(style) => onSectionChange(composeQuizStyle(agent, style))} />,
		facts: (
			<SwitchGroup>
				{toolRow(GlobeIcon, "research", "Web research", "Looks things up while you read")}
				<SwitchRow
					icon={WaypointsIcon}
					label="Your graph"
					about={graphOn ? "Recalls what you learned in past lessons" : "Off while building the graph is off in General"}
					on={agent?.graphTools?.enabled ?? true}
					disabled={!graphOn}
					onChange={(on) => onSectionChange(composeGraphTools(agent, on))}
				/>
			</SwitchGroup>
		),
		demos: (
			<SwitchGroup>
				{toolRow(PlayIcon, "demo", "Demos", "Builds things you can play with")}
				{toolRow(ShapesIcon, "visual", "Figures", "Draws precise diagrams")}
			</SwitchGroup>
		),
		files: <SwitchGroup>{toolRow(FileTextIcon, "pdf", "PDF reading", "Reads your PDFs page by page")}</SwitchGroup>,
	};

	return (
		<>
			<p className="flex items-center gap-2.5 pb-1.5 text-[13.5px] text-ink-2">
				<HalleyFace mood="idle" still className="size-[22px] shrink-0" />
				How {teacherName} teaches you. Change a switch, add a rule, or rewrite the instructions.
			</p>
			<div className="flex flex-col gap-3">
				{TEACHING_AREAS.map((area) => {
					const AreaIcon = AREA_ICONS[area.id];
					const rules = agent?.rules?.[area.id] ?? [];
					const edited = segments !== null && areaParts(area, segments).some((s) => s.overrideText !== null);
					return (
						<section key={area.id} data-testid={`area-${area.id}`} aria-label={area.label} className="flex bg-tone">
							<div className="flex w-[236px] shrink-0 flex-col justify-between gap-3.5 p-[18px]">
								<div className="flex flex-col gap-2.5">
									<span className="flex size-[30px] items-center justify-center bg-background text-ink">
										<AreaIcon className="size-[15px]" aria-hidden />
									</span>
									<span>
										<h4 className="text-[15.5px] font-bold text-ink">{area.label}</h4>
										<span className="block text-[12.5px] leading-snug text-ink-2">{area.about.replace("{teacher}", teacherName)}</span>
									</span>
								</div>
								<button
									type="button"
									data-testid={`area-${area.id}-instructions`}
									disabled={segments === null}
									onClick={() => setOpenArea(area)}
									className="lh-press flex w-fit items-center gap-1.5 text-[12.5px] text-ink-2 hover:text-ink"
								>
									Full instructions
									<ArrowRightIcon className="size-3" aria-hidden />
									{edited && (
										<span className="flex items-center gap-1.5 pl-0.5 text-xs text-ink">
											<span className="size-1.5 rounded-full bg-ink" aria-hidden />
											edited
										</span>
									)}
								</button>
							</div>
							<div className="flex min-w-0 flex-1 flex-col gap-3 py-[18px] pr-[18px]">
								{controls[area.id]}
								<div className="flex flex-col gap-[7px]">
									<p className="text-xs font-bold text-ink-3">Your rules</p>
									<RuleChips
										rules={rules}
										addLabel={rules.length || controls[area.id] ? "Add a rule" : "Add a rule for this area"}
										onChange={(next) => onSectionChange(composeRules(agent, area.id, next))}
										testid={`rules-${area.id}`}
									/>
								</div>
							</div>
						</section>
					);
				})}
			</div>
			{openArea && segments && (
				<InstructionsPanel area={openArea} parts={areaParts(openArea, segments)} onChanged={readSegments} onClose={() => setOpenArea(null)} />
			)}
		</>
	);
}

function SwitchGroup({ children }: { children: React.ReactNode }) {
	return <div className="flex flex-col gap-0.5">{children}</div>;
}

function SwitchRow({
	icon: RowIcon,
	label,
	about,
	on,
	disabled,
	onChange,
}: {
	icon: Icon;
	label: string;
	about: string;
	on: boolean;
	disabled?: boolean;
	onChange: (on: boolean) => void;
}) {
	return (
		<div className={cn("flex items-center gap-2.5 bg-background px-3 py-[9px]", disabled && "opacity-40")}>
			<RowIcon className={cn("size-[15px] shrink-0", on ? "text-ink" : "text-ink-3")} aria-hidden />
			<span className="min-w-0 flex-1">
				<span className={cn("block text-[13.5px]", on ? "text-ink" : "text-ink-2")}>{label}</span>
				<span className="block text-xs text-ink-2">{about}</span>
			</span>
			<Toggle checked={on} disabled={disabled} label={label} onChange={onChange} />
		</div>
	);
}

function QuizStyle({ free, onPick }: { free: boolean; onPick: (style: "choice" | "free") => void }) {
	return (
		<div className="flex flex-col gap-[7px]">
			<p className="text-xs font-bold text-ink-3">Quiz style</p>
			<div role="radiogroup" aria-label="Quiz style" className="flex gap-[3px] bg-background p-[3px]">
				{(
					[
						["choice", ListIcon, "Multiple choice"],
						["free", PenLineIcon, "Free recall"],
					] as const
				).map(([style, StyleIcon, label]) => {
					const active = (style === "free") === free;
					return (
						<button
							key={style}
							type="button"
							role="radio"
							aria-checked={active}
							data-testid={`quiz-style-${style}`}
							onClick={() => onPick(style)}
							className={cn(
								"lh-press flex flex-1 items-center justify-center gap-2 px-2.5 py-[7px] text-[13.5px]",
								active ? "bg-tone-2 font-bold text-ink" : "text-ink-2 hover:text-ink",
							)}
						>
							<StyleIcon className="size-3.5" aria-hidden />
							{label}
						</button>
					);
				})}
			</div>
		</div>
	);
}
