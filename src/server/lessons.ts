/**
 * LESSON CREATION — the one place a new lesson record is born (POST
 * /api/chats and MCP start_lesson both come through here, so a lesson in
 * a class always opens with its class card). Every new lesson is a study
 * session.
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
import { studyContextText, studyPlanTree } from "../core/study.ts";
import { classCardFor } from "./class-card.ts";
import { studyTopicsFor } from "./progress.ts";
import { graphStoreFor, stores } from "./stores.ts";

interface CreateLessonInput {
	title: string;
	classId: ClassScope;
	/** Facts picked from the class's graph. */
	picks?: GraphContextPick[];
}

type CreateLessonOutcome = { ok: true; chat: ChatRecord } | { ok: false; status: 404; code: "class_not_found"; error: string };

export function createLesson(input: CreateLessonInput): CreateLessonOutcome {
	const cls = input.classId === null ? null : stores.classStore.getClass(input.classId);
	if (input.classId !== null && !cls) {
		return { ok: false, status: 404, code: "class_not_found", error: "No such class" };
	}
	const chat = stores.chatStore.createChat(titleFromPrompt(input.title || "Untitled session"), "study", cls?.id);
	const messages: LhMessage[] = [];
	if (cls) messages.push(newClassContextMessage(classCardFor(cls)) as LhMessage);
	const picks = input.picks ?? [];
	if (picks.length > 0) {
		// The picks carry their own name/statement (what the learner saw);
		// the chains derive from the lesson's OWN class graph.
		// Merged snapshot: a chain re-asserted by another chat is one chain, not two lines.
		const { nodes, chains } = getGraph(graphStoreFor(input.classId));
		const byId = new Map(nodes.map((n) => [n.id, n]));
		const pickedNodes = picks.map((p) => byId.get(p.id)).filter((n) => n !== undefined);
		const chainLines = chainsForSelection(pickedNodes, chains).map((c) => formatChainLine(c, Object.fromEntries(byId)));
		messages.push(newGraphContextMessage(picks, chainLines) as LhMessage);
	}
	const topics = studyTopicsFor(input.classId, picks.map((p) => p.id), chat.title);
	messages.push(newStudyContextMessage(studyContextText(topics)) as LhMessage);
	stores.chatStore.saveMessages(chat.id, messages);
	stores.chatStore.saveTree(chat.id, studyPlanTree(topics));
	return { ok: true, chat: stores.chatStore.getChat(chat.id) ?? chat };
}
