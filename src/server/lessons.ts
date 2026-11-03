/**
 * LESSON CREATION — the one place a new lesson record is born (POST
 * /api/chats and MCP start_lesson both come through here, so a lesson in
 * a class always opens with its class card). Every new lesson is a study
 * session.
 *
 * A start names a typed topic (its title, with any facts picked for it),
 * some of the class's topics, or a deadline. On topics or a deadline this
 * picks the session's topics and writes its title, which the caller sends
 * as the first message.
 *
 * Message order at birth: [class card] → [graph-context picks] → [study
 * plan] → the learner's first message (sent by the client / the MCP tool).
 * The plan tree is written from the study's topics.
 */

import { chainsForSelection, formatChainLine } from "../core/chains.ts";
import type { ChatRecord, ClassScope } from "../core/contracts.ts";
import { titleFromPrompt } from "../core/contracts.ts";
import { getGraph } from "../core/graph.ts";
import {
	newClassContextMessage,
	newGraphContextMessage,
	newStudyContextMessage,
	type GraphContextPick,
	type LhMessage,
} from "../core/native-messages.ts";
import { MAX_STUDY_FACTS, studyContextText, studyPlanTree, studyTitle, type StudyTopic } from "../core/study.ts";
import { classCardFor } from "./class-card.ts";
import { deadlineStudyFor, studyTopicsFor, topicStudyFor } from "./progress.ts";
import { graphStoreFor, stores } from "./stores.ts";

type CreateLessonInput = { classId: ClassScope } & (
	| {
			title: string;
			/** Facts picked from the class's graph. */
			picks?: GraphContextPick[];
	  }
	| { topicIds: string[] }
	| { deadlineId: string }
);

type NotFound = { code: "topics_not_found" | "deadline_not_found"; error: string };

type CreateLessonOutcome =
	/** `title` is the whole title (the record's may be shortened): the first message. */
	| { ok: true; chat: ChatRecord; title: string }
	| ({ ok: false; status: 404 } & (NotFound | { code: "class_not_found"; error: string }));

interface Start {
	title: string;
	picks: GraphContextPick[];
	topics: StudyTopic[];
}

export function createLesson(input: CreateLessonInput): CreateLessonOutcome {
	const cls = input.classId === null ? null : stores.classStore.getClass(input.classId);
	if (input.classId !== null && !cls) {
		return { ok: false, status: 404, code: "class_not_found", error: "No such class" };
	}
	const start = startOf(input);
	if ("error" in start) return { ok: false, status: 404, ...start };
	const chat = stores.chatStore.createChat(titleFromPrompt(start.title), "study", cls?.id);
	const messages: LhMessage[] = [];
	if (cls) messages.push(newClassContextMessage(classCardFor(cls)) as LhMessage);
	if (start.picks.length > 0) {
		// The picks carry their own name/statement (what the learner saw);
		// the chains derive from the lesson's OWN class graph.
		// Merged snapshot: a chain re-asserted by another chat is one chain, not two lines.
		const { nodes, chains } = getGraph(graphStoreFor(input.classId));
		const byId = new Map(nodes.map((n) => [n.id, n]));
		const pickedNodes = start.picks.map((p) => byId.get(p.id)).filter((n) => n !== undefined);
		const chainLines = chainsForSelection(pickedNodes, chains).map((c) => formatChainLine(c, Object.fromEntries(byId)));
		messages.push(newGraphContextMessage(start.picks, chainLines) as LhMessage);
	}
	messages.push(newStudyContextMessage(studyContextText(start.topics)) as LhMessage);
	stores.chatStore.saveMessages(chat.id, messages);
	stores.chatStore.saveTree(chat.id, studyPlanTree(start.topics));
	return { ok: true, chat: stores.chatStore.getChat(chat.id) ?? chat, title: start.title };
}

/** The session's title, picks and topics for each kind of start. */
function startOf(input: CreateLessonInput): Start | NotFound {
	if ("topicIds" in input) {
		const { topics, picks } = topicStudyFor(input.classId, input.topicIds);
		if (topics.length === 0) return { code: "topics_not_found", error: "No such topics" };
		return { title: studyTitle(topics), picks, topics };
	}
	if ("deadlineId" in input) {
		const deadline = input.classId === null ? null : deadlineStudyFor(input.classId, input.deadlineId);
		if (!deadline) return { code: "deadline_not_found", error: "No such deadline" };
		// A deadline with no topics yet is studied by name.
		if (deadline.topics.length === 0) return typed(input.classId, `Study for ${deadline.name}`, []);
		return { title: studyTitle(deadline.topics), picks: deadline.picks, topics: deadline.topics };
	}
	return typed(input.classId, input.title || "Untitled session", (input.picks ?? []).slice(0, MAX_STUDY_FACTS));
}

/** A typed topic: its picked facts grouped into topics, or the one topic it names. */
function typed(classId: ClassScope, title: string, picks: GraphContextPick[]): Start {
	return { title, picks, topics: studyTopicsFor(classId, picks.map((p) => p.id), titleFromPrompt(title)) };
}
