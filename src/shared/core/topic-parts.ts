/**
 * The parts a Study topic opens with, read from the record. A reply is one
 * assistant message; its topic is the nodeId its calls name (refused calls
 * aside), else the topic of the latest earlier reply. A topic's page is the
 * first quoted source mark in the shown opener's lead, else in the reply
 * that opens the topic; later replies never give one. The server keeps a
 * Rust copy (crates/core/src/study/topic_parts.rs); both replay
 * crates/core/tests/golden/topic_parts.json. Pure and browser-safe.
 */
import { replaceCiteMarks } from "./citations.ts";
import type { LhMessage } from "./native-messages.ts";
import { shownOpeners } from "./topic-end.ts";

/** A topic's page: the quoted mark, and where it sits: in a reply (its
 *  message id) or in the lead of the opener a topic_done stored (its call
 *  id). */
interface TopicPage {
	messageId: string | null;
	leadOf: string | null;
	fileId: string;
	range: string;
	name: string;
	quote: string;
}

/** One topic's parts. */
export interface TopicParts {
	nodeId: string;
	page: TopicPage | null;
}

/** Every topic the lesson reached, in the order it reached them. */
export function topicParts(messages: readonly LhMessage[]): TopicParts[] {
	const openers = shownOpeners(messages);
	const refused = new Set(messages.flatMap((m) => (m.role === "toolResult" && m.isError ? [m.toolCallId] : [])));
	const out: TopicParts[] = [];
	const opened = new Set<string>();
	let current: string | null = null;
	for (const m of messages) {
		const opener = m.role === "toolResult" ? openers.get(m.toolCallId) : undefined;
		const openerNode = opener?.quiz.nodeId;
		if (opener && typeof openerNode === "string" && !out.some((t) => t.nodeId === openerNode)) {
			out.push({ nodeId: openerNode, page: firstQuoted(opener.lead ?? "", { messageId: null, leadOf: opener.topicDoneCallId }) });
			continue;
		}
		if (m.role !== "assistant") continue;
		const nodeId: string | null = callTopic(m, refused) ?? current;
		current = nodeId;
		if (nodeId === null || opened.has(nodeId)) continue;
		opened.add(nodeId);
		let parts = out.find((t) => t.nodeId === nodeId);
		if (!parts) out.push((parts = { nodeId, page: null }));
		for (const block of m.content) if (block.type === "text" && !parts.page) parts.page = firstQuoted(block.text, { messageId: m.id, leadOf: null });
	}
	return out;
}

/** The topic a reply's calls name: the first call with a nodeId that was
 *  not refused. */
function callTopic(m: Extract<LhMessage, { role: "assistant" }>, refused: ReadonlySet<string>): string | null {
	for (const block of m.content) {
		if (block.type !== "toolCall" || refused.has(block.id)) continue;
		const nodeId = (block.arguments as { nodeId?: unknown } | undefined)?.nodeId;
		if (typeof nodeId === "string") return nodeId;
	}
	return null;
}

function firstQuoted(text: string, at: Pick<TopicPage, "messageId" | "leadOf">): TopicPage | null {
	let page: TopicPage | null = null;
	replaceCiteMarks(text, (mark) => {
		if (!page && mark.kind === "file" && mark.quote) page = { ...at, fileId: mark.fileId, range: mark.range, name: mark.name, quote: mark.quote };
		return "";
	});
	return page;
}
