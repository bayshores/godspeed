/**
 * THE TOPIC GROUPER (redesign plan, owner-approved 2026-10-27): one model
 * call that groups a class graph's facts into the topics a student would
 * name. Built on the extractor's single-submit seam (runSubmitAgent): the
 * model reads the facts and the current topics, then calls submit_topics
 * once. Runs on the auditor's model setting (the background "cheap" slot),
 * so an "Outside agent (MCP)" choice reaches the connected agent as a
 * work item labeled "Topic grouping · <class>".
 *
 * This file only talks to the model. The deterministic rules — names 1–4
 * words (checked here, so the model retries), every fact in exactly one
 * topic (repaired after: core/topics.ts repairTopics) — and the scheduling
 * (server/topics.ts) live elsewhere.
 */
import type { Usage } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import type { PiEngine } from "../models.ts";
import type { GraphChain, GraphTopic } from "../../core/contracts.ts";
import { repairTopics, topicNameProblem, type TopicDraft } from "../../core/topics.ts";
import { runSubmitAgent } from "./submit-agent.ts";

/** The approved core instruction (owner, 2026-10-27) — verbatim. */
export const TOPIC_GROUPING_RULE =
	'Group these facts into the topics a student would name when studying this course: 4–20 facts per topic, a 1–4 word name in the course\'s own terms ("Expected value", "Conditional probability"). Keep existing topics and names stable; only add, split, or merge when facts don\'t fit. Every fact goes in exactly one topic.';

export const TOPIC_GROUPER_INSTRUCTIONS = `You are the topic grouper of a learning app. You receive the facts of one course's knowledge graph (id, name, statement) and the course's current topics, if any.

${TOPIC_GROUPING_RULE}

Submit the whole grouping with one submit_topics call. For a topic that already exists, keep its id; leave id out for a new topic. Members are fact ids from the list.`;

const topicSchema = Type.Object({
	id: Type.Optional(Type.String({ description: "The existing topic's id (tpc_…) when keeping a topic; leave out for a new one." })),
	name: Type.String({ description: "1–4 words, in the course's own terms." }),
	members: Type.Array(Type.String(), { description: "The ids of the facts in this topic." }),
});

const submitSchema = Type.Object({
	topics: Type.Array(topicSchema, { description: "Every topic. Every fact id appears in exactly one topic." }),
});

type TopicsSubmit = Static<typeof submitSchema>;

/** Weak-model heal: `topics` sent as one JSON string instead of an array. */
function healTopicsString(raw: unknown): unknown {
	if (typeof raw !== "object" || raw === null) return raw;
	const out: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
	if (typeof out.topics === "string") {
		try {
			const parsed: unknown = JSON.parse(out.topics);
			if (Array.isArray(parsed)) out.topics = parsed;
		} catch {
			/* leave it for validation */
		}
	}
	return out;
}

interface TopicFact {
	id: string;
	name: string;
	statement: string;
}

interface TopicGrouperInput {
	/** The class's display name (prompt context + the work-item label). */
	className: string;
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

const defaultNewId = () => `tpc_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;

/** The prompt: facts one per line, then the current topics as JSON. */
function topicGrouperPrompt(input: Pick<TopicGrouperInput, "className" | "facts" | "current">): string {
	const facts = input.facts.map((f) => `${f.id} | ${f.name} | ${f.statement.replace(/\s+/g, " ")}`).join("\n");
	const current =
		input.current.length > 0
			? JSON.stringify(input.current.map((t) => ({ id: t.id, name: t.name, members: t.members })), null, 1)
			: "(none yet — this is the first grouping)";
	return `Course: ${input.className}\n\nFacts (${input.facts.length}) — id | name | statement:\n${facts}\n\nCurrent topics:\n${current}`;
}

/** Ask the model for a grouping, then repair it so every current fact is
 *  in exactly one topic. Throws when the model never submits. */
export async function groupTopics(input: TopicGrouperInput): Promise<GraphTopic[]> {
	const submitted = await runSubmitAgent<TopicsSubmit>({
		role: "auditor",
		taskLabel: `Topic grouping · ${input.className}`,
		toolName: "submit_topics",
		toolDescription: "Submit the full topic grouping for the course's facts.",
		parameters: submitSchema,
		fill: (raw: TopicsSubmit) => ({ topics: raw.topics.map((t) => ({ ...t, members: t.members ?? [] })) }),
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
		prepareArguments: healTopicsString,
	});
	const drafts: TopicDraft[] = submitted.topics;
	return repairTopics(
		drafts,
		input.facts.map((f) => f.id),
		input.chains,
		input.current,
		input.newId ?? defaultNewId,
	);
}
