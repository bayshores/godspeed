/**
 * The parts a Study topic opens with, read from the record. A reply is one
 * assistant message; its topic is the nodeId its calls name (refused calls
 * aside), else the latest earlier reply's or shown opener's, else the
 * plan's first topic, where the lesson starts. A topic opens at its first
 * reply that is not reads alone. Its page is the first quoted source mark
 * in the shown opener's lead, else in the reply that opens it; later
 * replies never give one. The server keeps a Rust copy
 * (crates/core/src/study/topic_parts.rs); both replay
 * crates/core/tests/golden/topic_parts.json. Pure and browser-safe.
 */
import { replaceCiteMarks } from "./citations.ts";
import type { LhMessage } from "./native-messages.ts";
import { isQuestionTool } from "./pending.ts";
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

/** Every topic the lesson reached, in the order it reached them.
 *  `firstTopic` is the plan's first topic; with none, a reply has no topic
 *  until a call names one. */
export function topicParts(messages: readonly LhMessage[], firstTopic: string | null): TopicParts[] {
	const openers = shownOpeners(messages);
	const refused = new Set(messages.flatMap((m) => (m.role === "toolResult" && m.isError ? [m.toolCallId] : [])));
	const out: TopicParts[] = [];
	const opened = new Set<string>();
	let current = firstTopic;
	for (const m of messages) {
		const opener = m.role === "toolResult" ? openers.get(m.toolCallId) : undefined;
		const openerNode = opener?.quiz.nodeId;
		if (opener && typeof openerNode === "string" && !out.some((t) => t.nodeId === openerNode)) {
			out.push({ nodeId: openerNode, page: firstQuoted(opener.lead ?? "", { messageId: null, leadOf: opener.topicDoneCallId }) });
			current = openerNode;
			continue;
		}
		if (m.role !== "assistant") continue;
		const named = callTopic(m, refused);
		current = named ?? current;
		// A reply of reads alone opens no topic, so the reply after it still gives the page.
		if (current === null || (named === null && !isSeen(m, refused)) || opened.has(current)) continue;
		opened.add(current);
		let parts = out.find((t) => t.nodeId === current);
		if (!parts) out.push((parts = { nodeId: current, page: null }));
		for (const block of m.content) if (block.type === "text" && !parts.page) parts.page = firstQuoted(block.text, { messageId: m.id, leadOf: null });
	}
	return out;
}

/** A reply he sees: words, or a question or a plot that was not refused. */
function isSeen(m: Extract<LhMessage, { role: "assistant" }>, refused: ReadonlySet<string>): boolean {
	return m.content.some((block) =>
		block.type === "text" ? block.text.trim() !== "" : block.type === "toolCall" && (block.name === "plot" || isQuestionTool(block.name)) && !refused.has(block.id),
	);
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
