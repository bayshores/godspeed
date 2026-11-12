// Hand-made ledgers, findings, messages and topic drafts for graph.golden.ts. Each one packs the
// edge cases of its area: repeated ids, shared and foreign lines, dangling and legacy chains,
// deleted chats, empty phrasings and ties.
import { type Ledgers, ledgers } from "./graph-support.ts";

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";
const T3 = "2026-01-03T00:00:00.000Z";

const point = (chatId: string, messageId = "") => ({ chatId, messageId });
const points = (chats: (string | { chatId: string; messageId: string })[]) => chats.map((c) => (typeof c === "string" ? point(c) : c));

export function node(id: string, name: string, statement: string, chats: (string | { chatId: string; messageId: string })[], extra: { aliases?: string[]; at?: string } = {}) {
	return { id, name, statement, aliases: extra.aliases ?? [], createdAt: extra.at ?? T1, provenance: points(chats) };
}

export function chain(id: string, premises: string[], conclusion: string, chats: (string | { chatId: string; messageId: string })[], at = T1) {
	return { id, premises, conclusion, createdAt: at, provenance: points(chats) };
}

const entry = (chatId: string, fp: string, tokens = 3) => ({ chatId, fp, tokens, foldedAt: T2 });

const CHATS = [
	{ id: "chat_c1", title: "Lesson one", createdAt: T1, updatedAt: T3 },
	{ id: "chat_c2", title: "Lesson two", createdAt: T2, updatedAt: T3 },
	{ id: "chat_c4", title: "Lesson four", createdAt: T1, updatedAt: T1 },
	{ id: "chat_unused", title: "Never extracted", createdAt: T1, updatedAt: T2 },
];

/** Repeated node ids, shared and foreign lines, dangling and legacy chains, deleted chats. */
export const shared: Ledgers = ledgers({
	nodes: [
		node("n_a", "Alpha", "Alpha holds.", ["chat_c1"]),
		node("n_b", "Beta", "Beta holds.", ["chat_c1"]),
		node("n_c", "Gamma", "Gamma holds.", ["chat_c1"]),
		node("n_d", "Delta", "Delta holds.", ["chat_c2"]),
		node("n_a", "Alpha", "Alpha, said again.", ["chat_c2"], { aliases: ["Alpha prime", "Alpha, said again.", "Alpha holds."] }),
		node("n_e", "Epsilon", "Epsilon holds.", [point("chat_c1", "msg_1")]),
		node("n_e", "Epsilon", "Epsilon holds.", [point("src_f1"), point("chat_c1", "msg_1"), point("chat_c1", "msg_2")]),
		node("n_f", "Foreign", "No provenance at all.", []),
		node("n_b", "Beta", "", ["chat_c4"], { aliases: ["", " Beta alias"] }),
		node("n_c", "Gamma", "Gamma holds.", ["chat_c4"], { aliases: ["Gamma holds."] }),
		node("n_g", "Gone-chat fact", "Born in a deleted lesson.", ["chat_gone"]),
		node("n_h", "Hotel", "Born in a notes file.", ["src_f1"]),
		node("n_i", "India", "Born in a file with no record.", ["src_f9"]),
		node("n_j", "Juliet", "Also from the file.", ["src_f1"]),
		node("n_k", "Kilo", "Also from the file.", ["src_f1"]),
		node("n_l", "Lima \u{1F600}", "Wide characters count once.", ["chat_c4"]),
	],
	chains: [
		chain("arg_1", ["n_a", "n_b"], "n_c", ["chat_c1"]),
		chain("arg_1b", ["n_b", "n_a"], "n_c", ["chat_c2", "chat_c1"], T2),
		chain("arg_2", ["n_c"], "n_d", ["chat_c2"], T2),
		chain("arg_3", ["n_d", "n_e"], "n_a", [point("chat_c1"), point("src_f1")], T3),
		chain("arg_4", ["n_a", "n_ghost"], "n_c", ["chat_c1"]),
		chain("arg_5", [], "n_a", ["chat_c1"]),
		chain("arg_6", ["n_f", "n_a", "n_b"], "n_e", ["src_f1"]),
		chain("arg_7", ["n_a", "n_b"], "n_d", []),
		chain("arg_8", ["n_h", "n_j"], "n_k", ["src_f1"]),
		chain("arg_9", ["n_g"], "n_h", ["chat_gone"]),
	],
	coverage: [entry("chat_c1", "f1"), entry("chat_c2", "f2"), entry("chat_c1", "f3"), entry("chat_gone", "f4"), entry("chat_c4", "f5")],
	checkpoints: [
		{ chatId: "chat_c1", foldedAt: T2 },
		{ chatId: "src_f1", foldedAt: T2 },
		{ chatId: "chat_c2", foldedAt: T3 },
		{ chatId: "chat_c1", foldedAt: T3 },
	],
	sources: [
		{ id: "src_f1", filePath: "notes/week1.pdf", importedAt: T2 },
		{ id: "src_f2", filePath: "notes/unused.md", importedAt: T3 },
	],
	chats: CHATS,
	topics: [{ at: T1, topics: [{ id: "tpc_1", name: "Letters", members: ["n_a", "n_b", "n_old"] }] }, { at: T2, topics: [{ id: "tpc_1", name: "Letters", members: ["n_a", "n_b", "n_old"] }, { id: "tpc_2", name: "More", members: ["n_b", "n_c", "n_d"] }] }],
});

/** A simple graph two sessions share, for the merge scenarios. */
export const base: Ledgers = ledgers({
	nodes: [
		node("n_a", "Alpha", "Alpha holds.", ["chat_old"]),
		node("n_b", "Beta", "Beta holds.", ["chat_old"]),
		node("n_c", "Gamma", "Gamma holds.", ["chat_old"]),
		node("n_c", "Gamma", "Gamma holds.", [point("chat_new", "msg_9")]),
		node("n_d", "Delta", "Delta holds.", ["chat_old"]),
		node("n_e", "Epsilon", "Epsilon holds.", ["chat_old"]),
	],
	chains: [chain("arg_old1", ["n_a", "n_b"], "n_c", ["chat_old"], T1), chain("arg_old2", ["n_c", "n_d"], "n_e", ["chat_old"], T2)],
	coverage: [entry("chat_old", "old1")],
	checkpoints: [{ chatId: "src_done", foldedAt: T1 }],
	sources: [{ id: "src_done", filePath: "done.pdf", importedAt: T1 }],
	chats: [{ id: "chat_old", title: "Old lesson", createdAt: T1, updatedAt: T2 }],
});

const prop = (id: string, name: string, extra: { aliases?: string[]; messageId?: string } = {}) => ({ id, name, statement: `${name} holds.`, aliases: extra.aliases ?? [], ...(extra.messageId ? { messageId: extra.messageId } : {}) });

/** One extraction batch: new ideas, re-taught ones, tested ones and every chain edge case. */
export const findings = {
	propositions: [
		prop("p1", "Pi", { aliases: ["Pi, again"], messageId: "msg_1" }),
		prop("p2", "Rho"),
		{ ...prop("p1", "Pi twin"), messageId: "msg_5" },
		prop("p3", "Sigma", { messageId: "msg_3" }),
	],
	reteaches: ["n_a", "n_a", "n_nope", "n_c", "n_d"],
	tests: [
		{ messageId: "msg_2", ids: ["p1", "n_b", "n_nope", "n_b", "p2"] },
		{ messageId: "msg_1", ids: ["p1"] },
		{ messageId: "msg_9", ids: ["n_c", "n_e"] },
	],
	chains: [
		{ premises: ["p1", "n_a"], conclusion: "p2" },
		{ premises: ["p1", "p1"], conclusion: "p2" },
		{ premises: ["p2"], conclusion: "p2" },
		{ premises: ["n_b", "n_a"], conclusion: "n_c" },
		{ premises: ["zzz"], conclusion: "p1" },
		{ premises: ["p1"], conclusion: "n_nope" },
		{ premises: [], conclusion: "p3" },
		{ premises: ["p2", "n_d"], conclusion: "n_e" },
		{ premises: ["p1", "n_a", "n_d"], conclusion: "n_e" },
		{ premises: ["p3", "n_a"], conclusion: "n_b" },
	],
};

/** A notes import: no message ids, no tests. */
export const noteFindings = {
	propositions: [prop("a", "Notes one"), prop("b", "Notes two"), prop("c", "Notes three")],
	reteaches: ["n_a"],
	tests: [],
	chains: [{ premises: ["a", "b"], conclusion: "c" }, { premises: ["c"], conclusion: "n_b" }],
};

export const mergeSteps = [
	{ chatId: "chat_new", findings, source: { foldedAt: T3, coverage: [entry("chat_new", "fp1", 7), entry("chat_new", "fp2", 9)] } },
	{ chatId: "chat_new", findings: { propositions: [], reteaches: ["n_a", "n_b"], tests: [{ messageId: "msg_2", ids: ["n_b"] }], chains: [{ premises: ["n_b", "n_a"], conclusion: "n_c" }, { premises: ["n_d"], conclusion: "n_e" }] }, source: { foldedAt: T3, coverage: [] } },
	{ chatId: "src_new1", findings: noteFindings, source: { foldedAt: T3 } },
	{ chatId: "chat_old", findings: { propositions: [], reteaches: [], tests: [], chains: [{ premises: ["n_a", "n_b"], conclusion: "n_c" }] }, source: { foldedAt: T3 } },
];

/** Chain-simplification cases with fixed ids, dates and ties. */
export const simplifyCases: Record<string, any[]> = {
	"derivable through two others": [chain("c1", ["A", "B"], "X", ["s"], T1), chain("c2", ["X", "C"], "Y", ["s"], T2), chain("c3", ["A", "B", "C"], "Y", ["s"], T3), chain("c3b", ["C", "B", "A"], "Y", ["t"], T3)],
	"nothing derivable": [chain("c1", ["A"], "X", ["s"]), chain("c2", ["B"], "Y", ["s"])],
	"single line": [chain("c1", ["A"], "X", ["s"])],
	"no lines": [],
	"cycle keeps one derivation": [chain("c1", ["A"], "B", ["s"], T1), chain("c2", ["B"], "A", ["s"], T2), chain("c3", ["A"], "B", ["t"], T3)],
	"three-cycle shortcut": [chain("c1", ["A"], "B", ["s"], T1), chain("c2", ["B"], "C", ["s"], T2), chain("c3", ["A"], "C", ["s"], T3)],
	"equal size and date tie by key": [chain("c1", ["A"], "B", ["s"], T1), chain("c2", ["A"], "C", ["s"], T1), chain("c3", ["B"], "C", ["s"], T1), chain("c4", ["C"], "B", ["s"], T1)],
	"repeated premise": [chain("c1", ["A", "A"], "X", ["s"], T1), chain("c2", ["A", "B"], "Y", ["s"], T2), chain("c3", ["X", "B"], "Y", ["s"], T3)],
	"long ladder": [
		chain("l1", ["A"], "B", ["s"], T1),
		chain("l2", ["B"], "C", ["s"], T1),
		chain("l3", ["C"], "D", ["s"], T1),
		chain("l4", ["A"], "D", ["s"], T2),
		chain("l5", ["A", "C"], "D", ["s"], T3),
		chain("l6", ["B", "A"], "D", ["s"], T3),
	],
	"empty premises": [chain("c1", [], "X", ["s"]), chain("c2", ["A"], "X", ["s"]), chain("c3", [], "X", ["t"])],
};

const text = (t: string) => ({ type: "text", text: t });
const call = (id: string, name: string, args: Record<string, unknown>) => ({ type: "toolCall", id, name, arguments: args });

/** Transcript shapes coverage reads: prose, graded questions, failed output calls, bare text. */
export const messages = [
	{ id: "u1", role: "user", content: "hello" },
	{ id: "a1", role: "assistant", content: [text("  Welcome to the lesson.  "), call("c1", "quiz", { question: " What is 2+2? " }), call("c2", "send_to_user", { message: "Here is a note." })] },
	{ id: "r1", role: "toolResult", toolCallId: "c2", toolName: "send_to_user", isError: false, content: [text("ok")] },
	{ id: "a2", role: "assistant", content: [call("c3", "send_to_user", { message: "This send failed." }), call("c4", "probe", { question: "Why?" }), call("c5", "explain", { question: "not graded" })] },
	{ id: "r2", role: "toolResult", toolCallId: "c3", toolName: "send_to_user", isError: true, content: [text("boom")] },
	{ id: "a3", role: "assistant", stopReason: "aborted", content: [text("Cut off."), call("c6", "send_to_user", { message: "Never delivered." })] },
	{ id: "a4", role: "assistant", content: "A plain string answer." },
	{ id: "a5", role: "assistant", content: [] },
	{ id: "a6", role: "assistant", content: [{ type: "thinking", thinking: "private" }, call("c7", "quiz", { question: "   " }), call("c8", "quiz", { question: 5 }), call("c9", "send_to_user", { message: "   " })] },
	{ id: "m1", role: "custom", customType: "marker", content: "marker" },
	{ id: "a7", role: "assistant", content: [text("\u{1F600} wide text, é, and 中文"), text("   "), text("Second block.")] },
	{ id: "a8", role: "assistant", content: [text("Same prose.")] },
	{ id: "a9", role: "assistant", content: [text("Same prose.")] },
];

/** Topic cases for repairTopics: ids, names, ties and neighbors. */
export const topicCases: Record<string, { drafts: any[]; factIds: string[]; chains: any[]; existing: any[]; snapshot: any }> = {
	"keeps ids and places left-out facts by neighbors": {
		drafts: [{ id: "tpc_1", name: "Letters", members: ["a", "b"] }, { name: "Numbers", members: ["c", "d"] }],
		factIds: ["a", "b", "c", "d", "e", "f", "g"],
		chains: [{ premises: ["a", "b"], conclusion: "e" }, { premises: ["c"], conclusion: "f" }, { premises: ["f", "e"], conclusion: "g" }],
		existing: [{ id: "tpc_1", name: "Letters", members: ["a"] }, { id: "tpc_2", name: "numbers", members: ["c"] }],
		snapshot: { at: "t", topics: [{ id: "tpc_1", name: "Letters", members: ["a", "x"] }, { id: "tpc_2", name: "numbers", members: ["c"] }] },
	},
	"unknown, repeated and empty": {
		drafts: [{ name: "  Spaced   out  name ", members: ["a", "zzz", "a", "b"] }, { name: "   ", members: ["c"] }, { name: "Empty", members: ["nope"] }, { id: "  tpc_9 ", name: "Nine", members: ["c"] }],
		factIds: ["a", "b", "c", "d"],
		chains: [],
		existing: [{ id: "tpc_9", name: "Nine", members: [] }],
		snapshot: null,
	},
	"materials: an existing topic keeps its own, a new one takes the draft's": {
		drafts: [{ id: "tpc_1", name: "Letters", members: ["a"], material: "term" }, { name: "Numbers", members: ["b"], material: "procedure" }, { id: "tpc_3", name: "Proofs", members: ["c"], material: "proof" }],
		factIds: ["a", "b", "c", "d"],
		chains: [],
		existing: [{ id: "tpc_1", name: "Letters", members: [], material: "concept" }, { id: "tpc_3", name: "Proofs", members: [] }, { id: "tpc_o", name: "Other", members: [], material: "term" }],
		snapshot: { at: "t", topics: [{ id: "tpc_1", name: "Letters", members: ["a"], material: "concept" }, { id: "tpc_3", name: "Proofs", members: ["c", "d"] }] },
	},
	"tie goes to the earlier topic": {
		drafts: [{ name: "One", members: ["a"] }, { name: "Two", members: ["b"] }],
		factIds: ["a", "b", "c", "d"],
		chains: [{ premises: ["a", "b"], conclusion: "c" }, { premises: ["c"], conclusion: "d" }],
		existing: [],
		snapshot: { at: "t", topics: [] },
	},
	"others topic reuses its name": {
		drafts: [{ name: "other", members: ["a"] }, { name: "Two", members: ["b"] }],
		factIds: ["a", "b", "c", "d"],
		chains: [],
		existing: [{ id: "tpc_o", name: "Other", members: ["a"] }],
		snapshot: { at: "t", topics: [{ id: "tpc_o", name: "Other", members: ["a"] }] },
	},
	"duplicate existing ids and same names": {
		drafts: [{ id: "tpc_1", name: "A", members: ["a"] }, { id: "tpc_1", name: "A", members: ["b"] }, { name: "a", members: ["c"] }],
		factIds: ["a", "b", "c"],
		chains: [],
		existing: [{ id: "tpc_1", name: "A", members: [] }, { id: "tpc_2", name: " a ", members: [] }],
		snapshot: { at: "t", topics: [{ id: "tpc_1", name: "A", members: ["a", "b", "c", "a"] }, { id: "tpc_1", name: "A", members: ["c"] }] },
	},
	"chains cascade placement": {
		drafts: [{ name: "Seed", members: ["a"] }],
		factIds: ["a", "b", "c", "d", "e"],
		chains: [{ premises: ["a"], conclusion: "b" }, { premises: ["b"], conclusion: "c" }, { premises: ["c", "b"], conclusion: "d" }],
		existing: [],
		snapshot: { at: "t", topics: [{ id: "tpc_s", name: "Seed", members: ["a", "e"] }] },
	},
	"no facts": { drafts: [{ name: "Gone", members: ["a"] }], factIds: [], chains: [], existing: [], snapshot: { at: "t", topics: [{ id: "tpc_s", name: "Seed", members: ["a"] }] } },
};

export const topicNames = ["", "   ", "One", "Two words", "four whole words here", "five whole words go here", "  spaced   out   name  ", "tab\tseparated\nname", " nbsp name ", "\u{1F600} emoji name", "a b c d e", "x".repeat(300)];

/** Chain-line cases for formatChainLine. */
export const chainLineCases = {
	names: { n_a: "Alpha", n_b: "Beta", n_c: "Gamma", n_d: "Delta \u{1F600}" },
	chains: [
		{ premises: ["n_b", "n_a"], conclusion: "n_c" },
		{ premises: [], conclusion: "n_c" },
		{ premises: ["n_a", "unknown"], conclusion: "n_d" },
		{ premises: ["z", "y"], conclusion: "x" },
		{ premises: ["n_d", "n_a", "n_c"], conclusion: "n_b" },
	],
};

export const targetCases = ["", "  ", "n_a", " :n_a. ", "`n_a`", "'n_b'", "ALPHA", "  beta ", "`GAMMA.`", "delta \u{1F600}", "n_zzz", "alpha beta", "\u0000", "Nope", "n_a n_b"];

/** Birth-session and imp-node cases for the cluster helpers. */
export const clusterCases = {
	nodes: [
		node("n1", "One", "s", ["chat_a"]),
		node("n2", "Two", "s", ["chat_b"]),
		node("n3", "Three", "s", ["chat_b"]),
		node("n1", "One", "s", ["chat_b"]),
		node("n4", "Four", "s", []),
		node("n5", "Five", "s", ["chat_c", "chat_a"]),
		node("n6", "Six", "s", ["src_x"]),
		node("n7", "Seven", "s", ["chat_b"]),
		node("n8", "Eight", "s", ["chat_a"]),
		node("n9", "Nine \u{1F600}", "s", ["\u{1F600}chat"]),
		node("n10", "Ten", "s", ["～chat"]),
	],
	births: { n1: "chat_a", n2: "chat_b", n3: "chat_b", n4: null, n5: "chat_c", n6: "src_x", n7: "chat_b", n8: "chat_a" },
	chains: [
		chain("arg_1", ["n1", "n2", "n3"], "n5", ["z"]),
		chain("arg_2", ["n1", "n2"], "n5", ["z"]),
		chain("arg_3", ["n2", "n1"], "n5", []),
		chain("arg_4", ["n4"], "n5", ["z"]),
		chain("arg_5", ["n5", "n6"], "n1", ["chat_a"]),
		chain("arg_6", ["q"], "n1", ["chat_q"]),
		chain("arg_7", ["n3", "n7", "n8"], "n1", ["chat_a"]),
		chain("arg_8", ["n8", "n1", "n2", "n3"], "n1", []),
	],
};
