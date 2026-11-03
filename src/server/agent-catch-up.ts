/**
 * What godspeed hands an agent by itself once it is waiting, so the learner
 * never has to ask: lessons whose last stretch never reached the graph
 * (queued runs don't survive a restart), and deadlines with nothing linked
 * (a request from godspeed in Talk). Never under tests: scripted chats are
 * fixtures.
 */
import { TALK_CHAT_ID } from "../core/contracts.ts";
import { coverageOf } from "../core/coverage.ts";
import { askedDeadlineIds, coverageRequest, unlinkedDeadlines } from "../core/deadline-requests.ts";
import { localDay } from "../core/today-note.ts";
import { agentTeaching } from "../agent/agent-bridge.ts";
import { handleChatInput } from "./chat-handler.ts";
import { extraction } from "./extraction.ts";
import { effectiveSettings, graphStoreFor, stores } from "./stores.ts";
import { isTurnRunning } from "./turn-liveness.ts";
import { LEFTOVER_IDLE_MS } from "./turn-service.ts";

const G = globalThis as typeof globalThis & { __lhLessonsCaughtUp?: boolean; __lhAskingDeadlines?: boolean };

/** Once per app run: extract what each idle lesson has left. */
function catchUpLessons(now: number): void {
	if (G.__lhLessonsCaughtUp) return;
	G.__lhLessonsCaughtUp = true;
	if (!effectiveSettings().graph.enabled) return;
	const archived = new Set(stores.classStore.listClasses().filter((c) => c.archived).map((c) => c.id));
	for (const { id } of stores.chatStore.listChats()) {
		const record = stores.chatStore.getChat(id);
		// Practice and Talk carry a kind and write no facts; a lesson has none.
		if (!record || record.kind || (record.classId && archived.has(record.classId))) continue;
		if (isTurnRunning(id) || now - Date.parse(record.updatedAt) < LEFTOVER_IDLE_MS) continue;
		if (coverageOf(record.messages, graphStoreFor(record.classId ?? null).readCoverage(), id).uncoveredTokens === 0) continue;
		void extraction.runExtraction(id).catch((err: unknown) => console.error(`[catch-up] extraction failed for ${id}:`, err));
	}
}

/** Ask in Talk about deadlines with nothing linked (each once), unless Talk is busy. */
function askAboutDeadlines(now: number): void {
	if (G.__lhAskingDeadlines || isTurnRunning(TALK_CHAT_ID)) return;
	const talk = stores.chatStore.getChat(TALK_CHAT_ID);
	const deadlines = unlinkedDeadlines(stores.classStore.listClassRecords(), localDay(now), askedDeadlineIds(talk?.messages ?? []));
	if (deadlines.length === 0) return;
	if (!talk) stores.chatStore.createChat("Talk", "talk");
	G.__lhAskingDeadlines = true;
	void handleChatInput(TALK_CHAT_ID, { type: "steers", steers: [coverageRequest(deadlines)] })
		.then(async (res) => {
			if (!res.ok) console.info(`[catch-up] deadline request not sent (${res.status}): ${await res.text()}`);
		})
		.catch((err: unknown) => console.error("[catch-up] deadline request failed:", err))
		.finally(() => {
			G.__lhAskingDeadlines = false;
		});
}

/** The agent started waiting for work. */
export function catchUpForAgent(now = Date.now()): void {
	if (process.env.NODE_ENV === "test") return;
	try {
		catchUpLessons(now);
		askAboutDeadlines(now);
	} catch (err) {
		console.error("[catch-up] failed:", err);
	}
}

/** A deadline was added: ask about it now if an agent is working. */
export function askAboutNewDeadlines(now = Date.now()): void {
	if (process.env.NODE_ENV === "test" || !agentTeaching(now)) return;
	try {
		askAboutDeadlines(now);
	} catch (err) {
		console.error("[catch-up] failed:", err);
	}
}
