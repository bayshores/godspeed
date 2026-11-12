/**
 * THE TOPIC GROUPER: one model
 * call that groups a space graph's facts into the topics a learner would
 * name. Built on the extractor's single-submit seam (runSubmitAgent): the
 * model reads the facts and the current topics, then calls submit_topics
 * once. Runs on the outside agent, so the connected agent gets it as a
 * work item labeled "Topic grouping: <space>".
 *
 * This file only talks to the model. The deterministic rules — names 1–4
 * words (checked here, so the model retries), every fact in exactly one
 * topic (repaired after: core/topics.ts repairTopics) — and the scheduling
 * (server/topics.ts) live elsewhere.
 */
import type { Usage } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import type { PiEngine } from "../models.ts";
import { TOPIC_MATERIALS, type GraphChain, type GraphTopic } from "../../../shared/core/contracts.ts";
import { repairTopics, topicNameProblem, type TopicDraft } from "../../../shared/core/topics.ts";
import { runSubmitAgent } from "./submit-agent.ts";

/** The core grouping instruction, approved word for word: keep the wording. */
export const TOPIC_GROUPING_RULE =
	'Group these facts into the topics a learner would name when studying this space: 4–20 facts per topic, a 1–4 word name in the space\'s own terms ("Expected value", "Conditional probability"). Keep existing topics and names stable; only add, split, or merge when facts don\'t fit. Every fact goes in exactly one topic.';

export const TOPIC_GROUPER_INSTRUCTIONS = `You are the topic grouper of a learning app. You receive the facts of one space's knowledge graph (id, name, statement) and the space's current topics, if any.

${TOPIC_GROUPING_RULE}

Also give each topic its material, the main work it asks of a learner: term (definitions, names, notation or values to know by heart), procedure (a method run in steps to reach an answer), concept (an idea to understand and tell apart from look-alikes) or proof (arguments to follow and write).

Submit the whole grouping with one submit_topics call. For a topic that already exists, keep its id; leave id out for a new topic. Members are fact ids from the list.`;

const topicSchema = Type.Object({
	id: Type.Optional(Type.String({ description: "The existing topic's id (tpc_…) when keeping a topic; leave out for a new one." })),
	name: Type.String({ description: "1–4 words, in the space's own terms." }),
	members: Type.Array(Type.String(), { description: "The ids of the facts in this topic." }),
	// Any string, so one off-list label can't bounce the whole grouping; drafts() keeps the known ones.
	material: Type.Optional(Type.String({ description: "The main work this topic asks: term, procedure, concept or proof." })),
});

const submitSchema = Type.Object({
	topics: Type.Array(topicSchema, { description: "Every topic. Every fact id appears in exactly one topic." }),
});

type TopicsSubmit = Static<typeof submitSchema>;

interface TopicFact {
	id: string;
	name: string;
	statement: string;
}

interface TopicGrouperInput {
	/** The space's display name (prompt context + the work-item label). */
	spaceName: string;
	facts: readonly TopicFact[];
	chains: ReadonlyArray<Pick<GraphChain, "premises" | "conclusion">>;
	/** The current topics, members already limited to live facts. */
	current: readonly GraphTopic[];
	engine: PiEngine | undefined;
	signal?: AbortSignal;
	onStep?: (usage: Usage, model: string, step: number) => void;
	/** New topic ids ("tpc_" + 10 hex by default). */
	newId?: () => string;
}

/** The submitted topics, each with its material only when it is one of the four. */
function drafts(raw: TopicsSubmit): TopicDraft[] {
	return raw.topics.map(({ material, ...topic }) => {
		const known = TOPIC_MATERIALS.find((m) => m === material?.trim().toLowerCase());
		return known ? { ...topic, material: known } : topic;
	});
}

const defaultNewId = () => `tpc_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;

/** The prompt: facts one per line, then the current topics as JSON. */
function topicGrouperPrompt(input: Pick<TopicGrouperInput, "spaceName" | "facts" | "current">): string {
	const facts = input.facts.map((f) => `${f.id} | ${f.name} | ${f.statement.replace(/\s+/g, " ")}`).join("\n");
	const current =
		input.current.length > 0
			? JSON.stringify(input.current.map((t) => ({ id: t.id, name: t.name, members: t.members })), null, 1)
			: "(none yet — this is the first grouping)";
	return `Space: ${input.spaceName}\n\nFacts (${input.facts.length}) — id | name | statement:\n${facts}\n\nCurrent topics:\n${current}`;
}

/** Ask the model for a grouping, then repair it so every current fact is
 *  in exactly one topic. Throws when the model never submits. */
export async function groupTopics(input: TopicGrouperInput): Promise<GraphTopic[]> {
	const submitted = await runSubmitAgent<TopicsSubmit>({
		taskLabel: `Topic grouping: ${input.spaceName}`,
		toolName: "submit_topics",
		toolDescription: "Submit the full topic grouping for the space's facts.",
		parameters: submitSchema,
		fill: (raw: TopicsSubmit) => raw,
		validate: (value) => {
			const problems = value.topics.map((t) => topicNameProblem(t.name)).filter((p): p is string => p !== null);
			if (value.topics.length === 0) problems.push("Submit at least one topic.");
			return problems.length > 0 ? problems.join(" ") : null;
		},
		systemPrompt: TOPIC_GROUPER_INSTRUCTIONS,
		prompt: topicGrouperPrompt(input),
		engine: input.engine,
		signal: input.signal,
		onStep: (usage, model, step) => input.onStep?.(usage, model, step),
		neverSubmitted: "the topic grouper never submitted topics",
	});
	return repairTopics(
		drafts(submitted),
		input.facts.map((f) => f.id),
		input.chains,
		input.current,
		input.newId ?? defaultNewId,
	);
}
