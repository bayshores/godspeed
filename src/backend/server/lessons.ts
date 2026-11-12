/**
 * LESSON CREATION — the one place a new lesson record is born (POST
 * /api/chats and MCP start_lesson both come through here, so a lesson in
 * a space always opens with its space card). Every new lesson is a study
 * session.
 *
 * A start names a typed topic (its title, with any facts picked for it),
 * picked facts alone, some of the space's topics, or a deadline. On
 * picked facts alone, topics or a deadline this picks the session's
 * topics and writes its title, which the caller sends as the first
 * message.
 *
 * Message order at birth: [space card] → [graph-context picks] → [study
 * plan] → the learner's first message (sent by the client / the MCP tool).
 * The plan tree is written from the study's topics. A start from a
 * deadline is recorded on the chat, so that deadline's Study button can
 * reopen it (core/continue-study.ts).
 */

import { chainsForSelection, formatChainLine } from "../../shared/core/chains.ts";
import type { ChatRecord, SpaceScope } from "../../shared/core/contracts.ts";
import { titleFromPrompt } from "../../shared/core/contracts.ts";
import { getGraph } from "../../shared/core/graph.ts";
import {
	newSpaceContextMessage,
	newGraphContextMessage,
	newStudyContextMessage,
	type GraphContextPick,
	type LhMessage,
} from "../../shared/core/native-messages.ts";
import { MAX_STUDY_FACTS, studyContextText, studyPlanTree, studyTitle, type StudyTopic } from "../../shared/core/study.ts";
import { spaceCardFor } from "./space-card.ts";
import { deadlineStudyFor, studyTopicsFor, topicStudyFor } from "./progress.ts";
import { graphStoreFor, stores } from "./stores.ts";

type CreateLessonInput = { spaceId: SpaceScope } & (
	| {
			title: string;
			/** Facts picked from the space's graph. */
			picks?: GraphContextPick[];
	  }
	| { topicIds: string[] }
	| { deadlineId: string }
);

type NotFound = { code: "topics_not_found" | "deadline_not_found"; error: string };

type CreateLessonOutcome =
	/** `title` is the whole title (the record's may be shortened): the first message. */
	| { ok: true; chat: ChatRecord; title: string }
	| ({ ok: false; status: 404 } & (NotFound | { code: "space_not_found"; error: string }));

interface Start {
	title: string;
	picks: GraphContextPick[];
	topics: StudyTopic[];
}

export function createLesson(input: CreateLessonInput): CreateLessonOutcome {
	const space = input.spaceId === null ? null : stores.spaceStore.getSpace(input.spaceId);
	if (input.spaceId !== null && !space) {
		return { ok: false, status: 404, code: "space_not_found", error: "No such space" };
	}
	const start = startOf(input);
	if ("error" in start) return { ok: false, status: 404, ...start };
	const chat = stores.chatStore.createChat(titleFromPrompt(start.title), "study", space?.id, "deadlineId" in input ? input.deadlineId : undefined);
	const messages: LhMessage[] = [];
	if (space) messages.push(newSpaceContextMessage(spaceCardFor(space)) as LhMessage);
	if (start.picks.length > 0) {
		// The picks carry their own name/statement (what the learner saw);
		// the chains derive from the lesson's OWN space graph.
		// Merged snapshot: a chain re-asserted by another chat is one chain, not two lines.
		const { nodes, chains } = getGraph(graphStoreFor(input.spaceId));
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
		const { topics, picks } = topicStudyFor(input.spaceId, input.topicIds);
		if (topics.length === 0) return { code: "topics_not_found", error: "No such topics" };
		return { title: studyTitle(topics), picks, topics };
	}
	if ("deadlineId" in input) {
		const deadline = input.spaceId === null ? null : deadlineStudyFor(input.spaceId, input.deadlineId);
		if (!deadline) return { code: "deadline_not_found", error: "No such deadline" };
		// A deadline with no topics yet is studied by name.
		if (deadline.topics.length === 0) return typed(input.spaceId, `Study for ${deadline.name}`, []);
		return { title: studyTitle(deadline.topics), picks: deadline.picks, topics: deadline.topics };
	}
	return typed(input.spaceId, input.title.trim(), (input.picks ?? []).slice(0, MAX_STUDY_FACTS));
}

/** A typed topic: its picked facts grouped into topics, or the one topic
 *  it names. Picked facts with nothing typed are titled after their topics. */
function typed(spaceId: SpaceScope, title: string, picks: GraphContextPick[]): Start {
	const topics = studyTopicsFor(spaceId, picks.map((p) => p.id), titleFromPrompt(title || "Untitled session"));
	return { title: title || (picks.length > 0 ? studyTitle(topics) : "Untitled session"), picks, topics };
}
