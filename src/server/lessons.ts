/**
 * LESSON CREATION — the one place a new lesson record is born (classes
 * wave, 2026-10-26: POST /api/chats and MCP start_lesson both come
 * through here, so a lesson in a class always opens with its class card).
 *
 * Message order at birth: [class card] → [graph-context picks] → the
 * learner's first message (sent by the client / the MCP tool).
 */

import { chainsForSelection, formatChainLine } from "../core/chains.ts";
import type { ChatRecord, ChatSettings, ClassScope } from "../core/contracts.ts";
import { titleFromPrompt } from "../core/contracts.ts";
import { newClassContextMessage, newGraphContextMessage, type GraphContextPick, type LhMessage } from "../core/native-messages.ts";
import { classCardFor } from "./class-card.ts";
import { graphStoreFor, stores } from "./stores.ts";

interface CreateLessonInput {
	title: string;
	kind?: "practice";
	classId: ClassScope;
	/** Practice picks from the class's graph. */
	picks?: GraphContextPick[];
	/** The session model (absent = the strong slot, stamped by the caller). */
	settings?: ChatSettings;
}

type CreateLessonOutcome = { ok: true; chat: ChatRecord } | { ok: false; status: 404; code: "class_not_found"; error: string };

export function createLesson(input: CreateLessonInput): CreateLessonOutcome {
	const cls = input.classId === null ? null : stores.classStore.getClass(input.classId);
	if (input.classId !== null && !cls) {
		return { ok: false, status: 404, code: "class_not_found", error: "No such class" };
	}
	const chat = stores.chatStore.createChat(titleFromPrompt(input.title || "Untitled session"), input.kind, cls?.id);
	if (input.settings) stores.chatStore.saveSettings(chat.id, input.settings);
	const messages: LhMessage[] = [];
	if (cls) messages.push(newClassContextMessage(classCardFor(cls)) as LhMessage);
	const picks = input.picks ?? [];
	if (picks.length > 0) {
		// The picks carry their own name/statement (what the learner saw);
		// the chains derive from the lesson's OWN class graph.
		const graph = graphStoreFor(input.classId);
		const byId = new Map(graph.readNodes().map((n) => [n.id, n]));
		const pickedNodes = picks.map((p) => byId.get(p.id)).filter((n) => n !== undefined);
		const chainLines = chainsForSelection(pickedNodes, graph.readChains()).map((c) => formatChainLine(c, Object.fromEntries(byId)));
		messages.push(newGraphContextMessage(picks, chainLines) as LhMessage);
	}
	if (messages.length > 0) stores.chatStore.saveMessages(chat.id, messages);
	return { ok: true, chat: stores.chatStore.getChat(chat.id) ?? chat };
}
