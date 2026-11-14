/**
 * One teaching area's sheet: what it is, its switches, the learner's rules
 * and the button that opens its full instructions. Facts and research also
 * holds who searches the web and the graph's own switch.
 */

import { TOOL_SWITCH_LABELS, type AgentSettings, type TeachingArea, type ToggleableTool } from "@/shared/core";
import { RuleChips } from "@/frontend/components/rule-chips";
import { Segmented } from "@/frontend/components/ui/segmented";
import { SMALL_KEY, SettingsGroup, SettingsRow, Toggle } from "./controls.tsx";
import { composeGraphTools, composeQuizStyle, composeRules, composeTool } from "./teaching-model.ts";
import { WebSearch } from "./web-search.tsx";

const QUIZ_STYLES = [
	{ value: "choice", label: "Multiple choice" },
	{ value: "free", label: "Free recall" },
] as const;

export function AreaDetail({
	area,
	agent,
	graphOn,
	onGraphChange,
	teacherName,
	savedAt,
	edited,
	instructionsReady,
	onSectionChange,
	onOpenInstructions,
}: {
	area: TeachingArea;
	agent: AgentSettings | undefined;
	/** The graph switch: "Your graph" can't be on without it. */
	graphOn: boolean;
	onGraphChange: (on: boolean) => void;
	teacherName: string;
	/** When the agent saved each of this area's rules, by rule text. */
	savedAt: Record<string, string>;
	/** The learner saved their own version of some of these instructions. */
	edited: boolean;
	/** The instruction texts have loaded. */
	instructionsReady: boolean;
	/** Writes the composed whole agent section. */
	onSectionChange: (next: AgentSettings) => void;
	onOpenInstructions: () => void;
}) {
	const tools = agent?.tools ?? {};
	// The research tool is the "Web search" the learner sees, with who searches under it.
	const switchRow = (id: ToggleableTool, about: string, label = TOOL_SWITCH_LABELS[id]) => (
		<SettingsRow label={label} hint={about}>
			<Toggle checked={tools[id] ?? true} label={label} onChange={(on) => onSectionChange(composeTool(agent, id, on))} />
		</SettingsRow>
	);
	return (
		<SettingsGroup label={area.label} about={area.about.replace("{teacher}", teacherName)} testid="area-detail">
			{area.id === "questions" && (
				<SettingsRow label="Quiz style">
					<Segmented
						label="Quiz style"
						testid="quiz-style"
						options={QUIZ_STYLES}
						value={tools.explain === true ? "free" : "choice"}
						disabled={false}
						onChange={(style) => onSectionChange(composeQuizStyle(agent, style))}
					/>
				</SettingsRow>
			)}
			{area.id === "facts" && (
				<>
					{switchRow("research", "Looks things up online while you read", "Web search")}
					{(tools.research ?? true) && <WebSearch />}
					<SettingsRow label="Build the graph from lessons" hint="Off: the graph stops growing" testid="graph-row-enabled">
						<Toggle checked={graphOn} label="Build the graph from lessons" onChange={onGraphChange} />
					</SettingsRow>
					{graphOn && (
						<SettingsRow label="Your graph" hint="Recalls what you learned in past lessons">
							<Toggle checked={agent?.graphTools?.enabled ?? true} label="Your graph" onChange={(on) => onSectionChange(composeGraphTools(agent, on))} />
						</SettingsRow>
					)}
				</>
			)}
			{area.id === "demos" && (
				<>
					{switchRow("demo", "Builds things you can play with")}
					{switchRow("visual", "Draws precise diagrams")}
				</>
			)}
			{area.id === "files" && switchRow("pdf", "Reads your PDFs page by page")}
			<div className="flex flex-col gap-2 py-3">
				<p className="text-lg font-medium text-ink">Your rules</p>
				<RuleChips
					rules={agent?.rules?.[area.id] ?? []}
					onChange={(next) => onSectionChange(composeRules(agent, area.id, next))}
					testid={`rules-${area.id}`}
					saved={savedAt}
					teacherName={teacherName}
				/>
			</div>
			<SettingsRow label="Full instructions" hint={`What ${teacherName} reads before every lesson.${edited ? " You changed these." : ""}`}>
				<button type="button" data-testid={`area-${area.id}-instructions`} disabled={!instructionsReady} onClick={onOpenInstructions} className={SMALL_KEY}>
					Edit full instructions
				</button>
			</SettingsRow>
		</SettingsGroup>
	);
}
