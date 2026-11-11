// The knowledge-graph logic (read, derive, merge, simplify, delete, topics, coverage, clusters)
// on the fixture ledgers and on hand-made ones. Each case is `{ op, input, expected }`: the
// Rust test replays `op` on `input` and compares with `expected`. Big outputs from the fixtures
// are digests (`$sha` of the JSON text, `$len` of the array or object); hand-made ones are whole.
import { chainsForSelection, formatChainLine, resolveTargetId } from "../../../../src/shared/core/chains.ts";
import { MIN_CLUSTER_SIZE } from "../../../../src/shared/core/clusters.ts";
import { batchRuns, coverageOf, coverageSlots, messageFingerprint, messageViewLines } from "../../../../src/shared/core/coverage.ts";
import { deleteChatTraces, deleteNodeTraces, deleteSourceTraces } from "../../../../src/shared/core/graph-deletion.ts";
import { deriveView, getGraph, graphSessionIndex, graphSessionPropositions, graphSnapshot, mergeFindings, simplifyChains } from "../../../../src/shared/core/graph.ts";
import { failedOutputCallIds } from "../../../../src/shared/core/native-messages.ts";
import { attachImpToCommunities, birthSessionPartition, impClusterKey } from "../../../../src/shared/core/session-clusters.ts";
import { repairTopics, resolveTopics, sameFactSet, topicNameProblem } from "../../../../src/shared/core/topics.ts";
import * as S from "./graph-scenarios.ts";
import { attempt, big, chatListing, emptyLedgers, fixture, type Ledgers, ledgerMarks, memoryStore, normalise, stringsOf, transcript } from "./graph-support.ts";

/** A fixture's name, or the ledgers themselves. */
type LedgerIn = string | Ledgers;
const load = (l: LedgerIn): Ledgers => (typeof l === "string" ? fixture(l) : l);
const isWhole = (l: LedgerIn): boolean => typeof l !== "string";
const mark = (value: unknown, whole: boolean) => (whole ? value : big(value));
const marks = (parts: Record<string, unknown>, whole: boolean) => Object.fromEntries(Object.entries(parts).map(([key, value]) => [key, mark(value, whole)]));
const storeOf = (ledgers: Ledgers) => memoryStore(ledgers);
const depsOf = (m: ReturnType<typeof memoryStore>, ledgers: Ledgers) => ({ chatStore: chatListing(ledgers.chats), graphStore: m.store }) as any;

/** The case's data is copied before the run, so a function that mutates cannot change what the Rust side reads. */
function make(op: string, input: unknown, run: () => unknown) {
	const kept = structuredClone(input);
	return { op, input: kept, expected: run() };
}

const cases: Record<string, () => unknown> = {};
const add = (name: string, run: () => unknown) => {
	if (cases[name]) throw new Error(`duplicate case ${name}`);
	cases[name] = run;
};

const SETS: [string, LedgerIn][] = [
	["cse21", "cse21"],
	["cse29", "cse29"],
	["shared", S.shared],
	["base", S.base],
	["empty", emptyLedgers()],
];

const graphOf = (l: LedgerIn) => getGraph(storeOf(load(l)).store);
const lastSnapshot = (l: Ledgers) => l.topics.at(-1) ?? null;

// ─── reads ───────────────────────────────────────────────────────────────────

for (const [name, l] of SETS) {
	const whole = isWhole(l);
	add(`get_graph / ${name}`, () => make("get_graph", { ledgers: l }, () => {
		const g = graphOf(l);
		return marks({ nodes: g.nodes, chains: g.chains }, whole);
	}));
	add(`derive_view / ${name}`, () => make("derive_view", { ledgers: l }, () => marks(deriveView(graphOf(l)), whole)));
	add(`snapshot / ${name}`, () => make("snapshot", { ledgers: l }, () => {
		const ledgers = load(l);
		return marks(graphSnapshot(depsOf(storeOf(ledgers), ledgers)) as any, whole);
	}));
	add(`session_index / ${name}`, () => {
		const ledgers = load(l);
		const deps = depsOf(storeOf(ledgers), ledgers);
		const index = graphSessionIndex(deps);
		const sessions = [...index.map((entry) => entry.id), "chat_nothing", "src_nothing"];
		return make("session_index", { ledgers: l, sessions }, () => ({
			index,
			propositions: Object.fromEntries(sessions.map((id) => [id, mark(graphSessionPropositions(deps, id), whole)])),
		}));
	});
	add(`simplify / ${name} ledger chains`, () => make("simplify", { ledgers: l }, () => mark(simplifyChains(load(l).chains), whole)));
}

for (const [name, lines] of Object.entries(S.simplifyCases)) {
	add(`simplify / ${name}`, () => make("simplify", { lines }, () => simplifyChains(lines)));
}

// ─── topics ──────────────────────────────────────────────────────────────────

function resolveCase(name: string, snapshot: any, factIds: string[], whole: boolean) {
	add(`resolve_topics / ${name}`, () => make("resolve_topics", { snapshot, factIds }, () => ({ resolved: mark(resolveTopics(snapshot, factIds), whole), same: sameFactSet(snapshot, factIds) })));
}

function repairCase(name: string, drafts: any[], factIds: string[], chains: any[], existing: any[], whole: boolean) {
	add(`repair_topics / ${name}`, () => make("repair_topics", { drafts, factIds, chains, existing }, () => {
		let counter = 0;
		return mark(repairTopics(drafts, factIds, chains, existing, () => `new_${++counter}`), whole);
	}));
}

for (const name of ["cse21", "cse29"]) {
	const ledgers = fixture(name);
	const snapshot = lastSnapshot(ledgers);
	const g = graphOf(name);
	const facts = g.nodes.map((n) => n.id);
	const chains = g.chains.map((c) => ({ premises: c.premises, conclusion: c.conclusion }));
	resolveCase(`${name} all facts`, snapshot, facts, false);
	resolveCase(`${name} every second fact`, snapshot, facts.filter((_, i) => i % 2 === 0), false);
	resolveCase(`${name} new facts`, snapshot, [...facts, "n_brandnew1", "n_brandnew2"], false);
	resolveCase(`${name} older snapshot`, ledgers.topics[0], facts, false);
	resolveCase(`${name} no snapshot`, null, facts, false);
	const topics = snapshot.topics;
	const echo = topics.map((t: any) => ({ id: t.id, name: t.name, members: t.members }));
	const partial = topics.map((t: any, i: number) => ({
		...(i % 2 === 0 ? { id: t.id } : {}),
		name: i % 3 === 0 ? t.name.toUpperCase() : t.name,
		members: t.members.filter((_: string, j: number) => j % 2 === 0),
	}));
	repairCase(`${name} echo`, echo, facts, chains, topics, false);
	repairCase(`${name} empty draft`, [], facts, chains, topics, false);
	repairCase(`${name} partial draft`, partial, facts, chains, topics, false);
	repairCase(`${name} partial draft without existing`, partial, facts, chains, [], false);
	repairCase(`${name} fewer facts`, echo, facts.filter((_, i) => i % 3 !== 0), chains, topics, false);
}

for (const [name, c] of Object.entries(S.topicCases)) {
	resolveCase(name, c.snapshot, c.factIds, true);
	repairCase(name, c.drafts, c.factIds, c.chains, c.existing, true);
}

add("topic_names", () => make("topic_names", { names: S.topicNames }, () => S.topicNames.map((n) => topicNameProblem(n))));

// ─── chains ──────────────────────────────────────────────────────────────────

for (const [name, l] of SETS) {
	const whole = isWhole(l);
	const ledgers = load(l);
	const nodes = graphOf(l).nodes.map((n) => ({ id: n.id, name: n.name }));
	const lines = ledgers.chains.map((c) => ({ id: c.id, premises: c.premises, conclusion: c.conclusion }));
	const picks = nodes.filter((_, i) => i % 7 === 0);
	const targets = [
		...S.targetCases,
		"LIMA \u{1F600}",
		...picks.map((n) => n.id),
		...picks.map((n) => n.name.toUpperCase()),
		...picks.map((n) => ` \`${n.name}\` `),
		...nodes.filter((_, i) => i % 11 === 3).map((n) => `:${n.id}.`),
	];
	add(`chains_selection / ${name} all nodes`, () => make("chains_selection", { nodes: nodes.map((n) => ({ id: n.id })), chains: lines }, () => mark(chainsForSelection(nodes, lines), whole)));
	const third = nodes.filter((_, i) => i % 3 === 0).map((n) => ({ id: n.id }));
	add(`chains_selection / ${name} every third node`, () => make("chains_selection", { nodes: third, chains: lines }, () => mark(chainsForSelection(third, lines), whole)));
	add(`resolve_target / ${name}`, () => make("resolve_target", { nodes, targets }, () => targets.map((t) => resolveTargetId(t, nodes))));
	const names = Object.fromEntries(nodes.map((n) => [n.id, n.name]));
	const premiseLines = lines.map((c) => ({ premises: c.premises, conclusion: c.conclusion }));
	add(`format_chain_line / ${name}`, () => make("format_chain_line", { names, chains: premiseLines }, () => mark(premiseLines.map((c) => formatChainLine(c, Object.fromEntries(Object.entries(names).map(([id, n]) => [id, { name: n }])))), whole)));
}

add("format_chain_line / names and unknown ids", () => make("format_chain_line", S.chainLineCases, () => S.chainLineCases.chains.map((c) => formatChainLine(c, Object.fromEntries(Object.entries(S.chainLineCases.names).map(([id, n]) => [id, { name: n }]))))));

// ─── session clusters ────────────────────────────────────────────────────────

const clustersOut = (communities: { id: string; members: string[] }[]) => communities.map((c) => ({ id: c.id, members: [...c.members] }));

add("session_clusters / hand-made", () => {
	const { nodes, chains, births } = S.clusterCases as any;
	return make("session_clusters", { nodes, chains, births }, () => {
		const partition = birthSessionPartition(nodes);
		const attach = (minSize: number) => {
			const communities = clustersOut(partition).filter((c) => c.members.length >= minSize);
			attachImpToCommunities(communities, nodes, chains);
			return communities;
		};
		return {
			partition,
			impKeys: chains.map((c: any) => impClusterKey(c, (id) => births[id] ?? null)),
			attachedAll: attach(1),
			attachedBig: attach(2),
		};
	});
});

for (const [name, l] of SETS) {
	const whole = isWhole(l);
	add(`session_clusters / ${name} ledgers`, () => make("session_clusters_ledgers", { ledgers: l }, () => {
		const lines = load(l).nodes;
		const g = graphOf(l);
		const partition = birthSessionPartition(lines);
		const communities = clustersOut(partition).filter((c) => c.members.length >= MIN_CLUSTER_SIZE);
		attachImpToCommunities(communities, g.nodes, g.chains);
		const birth = new Map(g.nodes.map((n) => [n.id, n.provenance[0]?.chatId ?? null]));
		return marks({ partition, impKeys: g.chains.map((c) => impClusterKey(c, (id) => birth.get(id) ?? null)), attached: communities }, whole);
	}));
}

// ─── coverage ────────────────────────────────────────────────────────────────

const BUDGETS = [0, -3, 1, 6, 12, 40, 100, 100000, 7.5];

/** Every `every`th visible message covered, plus decoys that must be ignored (another chat's row). */
function coveredEntries(messages: any[], chatId: string, every: number) {
	const visible = coverageSlots(messages).filter((s) => s.tokens > 0);
	const entries = visible.filter((_, i) => i % every === 0).map((s) => ({ chatId, fp: s.fp, tokens: s.tokens, foldedAt: "2026-02-01T00:00:00.000Z" }));
	const decoy = visible.at(-1);
	if (decoy) entries.push({ chatId: "chat_other", fp: decoy.fp, tokens: decoy.tokens, foldedAt: "2026-02-01T00:00:00.000Z" });
	return entries;
}

function coverageCase(name: string, messages: string | any[], chatId: string, every: number | null) {
	add(`coverage / ${name}`, () => {
		const msgs: any[] = typeof messages === "string" ? transcript(messages) : messages;
		const whole = typeof messages !== "string";
		const entries = every === null ? [] : coveredEntries(msgs, chatId, every);
		return make("coverage", { messages, entries, chatId, budgets: BUDGETS }, () => {
			const failed = failedOutputCallIds(msgs);
			const slots = coverageSlots(msgs);
			const cov = coverageOf(msgs, entries, chatId);
			return {
				...marks(
					{
						viewLines: msgs.map((m) => messageViewLines(m, m.id)),
						viewLinesFailed: msgs.map((m) => messageViewLines(m, m.id, failed)),
						fingerprints: msgs.map((m) => messageFingerprint(m)),
						fingerprintsFailed: msgs.map((m) => messageFingerprint(m, failed)),
						slots: slots.map((s) => ({ fp: s.fp, tokens: s.tokens })),
						uncovered: cov.uncovered,
					},
					whole,
				),
				totals: { coveredTokens: cov.coveredTokens, uncoveredTokens: cov.uncoveredTokens, coveredCount: cov.coveredCount, uncoveredCount: cov.uncoveredCount },
				runs: BUDGETS.map((budget) => ({ budget, runs: mark(batchRuns(cov.slots, cov.uncovered, budget).map((run) => run.map((s) => s.message.id)), whole) })),
			};
		});
	});
}

coverageCase("hand-made nothing covered", S.messages, "chat_x", null);
coverageCase("hand-made every second covered", S.messages, "chat_x", 2);
coverageCase("hand-made all covered", S.messages, "chat_x", 1);
coverageCase("no messages", [], "chat_x", null);
for (const id of ["chat_cvvooldp_183cb789", "chat_cw5rpskb_617eb4f6"]) {
	coverageCase(`${id} nothing covered`, id, id, null);
	coverageCase(`${id} every third covered`, id, id, 3);
	coverageCase(`${id} all covered`, id, id, 1);
}

// ─── deletion ────────────────────────────────────────────────────────────────

type DeleteStep = { kind: "chat"; id: string; mode: "preserve-graph" | "delete-nodes" } | { kind: "source"; id: string };

function deleteChatsCase(name: string, l: LedgerIn, steps: DeleteStep[]) {
	add(`delete_chats / ${name}`, () => make("delete_chats", { ledgers: l, steps }, () => {
		const m = storeOf(load(l));
		const results = steps.map((s) => attempt(() => (s.kind === "chat" ? deleteChatTraces(m.store, s.id, s.mode) : deleteSourceTraces(m.store, s.id))));
		return { results, rewrites: m.rewrites, ledgers: isWhole(l) ? ledgerMarks(m.state, true) : ledgerMarks(m.state, false) };
	}));
}

const chat = (id: string, mode: "preserve-graph" | "delete-nodes"): DeleteStep => ({ kind: "chat", id, mode });
const source = (id: string): DeleteStep => ({ kind: "source", id });

const singles: [string, DeleteStep[]][] = [
	["preserve one lesson", [chat("chat_c1", "preserve-graph")]],
	["delete nodes of one lesson", [chat("chat_c1", "delete-nodes")]],
	["delete nodes of a second lesson", [chat("chat_c2", "delete-nodes")]],
	["delete a lesson already gone", [chat("chat_gone", "delete-nodes")]],
	["delete a lesson with no traces", [chat("chat_unused", "delete-nodes")]],
	["preserve a lesson with no traces", [chat("chat_unused", "preserve-graph")]],
	["delete a notes file", [source("src_f1")]],
	["delete a notes file with no record", [source("src_f9")]],
	["notes id that is not one", [source("chat_c4")]],
	["delete the last lesson of a fact", [chat("chat_c4", "delete-nodes")]],
];
for (const [name, steps] of singles) deleteChatsCase(`shared ${name}`, S.shared, steps);
deleteChatsCase("shared one after another", S.shared, [
	chat("chat_c1", "preserve-graph"),
	chat("chat_c1", "delete-nodes"),
	chat("chat_c2", "delete-nodes"),
	chat("chat_c1", "delete-nodes"),
	source("src_f1"),
	source("src_f1"),
	chat("chat_gone", "delete-nodes"),
	chat("chat_c4", "delete-nodes"),
]);
deleteChatsCase("base all lessons", S.base, [chat("chat_new", "delete-nodes"), chat("chat_old", "delete-nodes"), source("src_done")]);
deleteChatsCase("empty ledgers", emptyLedgers(), [chat("chat_a", "delete-nodes"), chat("chat_a", "preserve-graph"), source("src_a")]);

for (const name of ["cse21", "cse29"]) {
	const ledgers = fixture(name);
	const chatIds = [...new Set(ledgers.nodes.flatMap((n) => n.provenance.map((p: any) => p.chatId)).filter((id: string) => !id.startsWith("src_")))];
	const sourceIds = [...new Set(ledgers.nodes.flatMap((n) => n.provenance.map((p: any) => p.chatId)).filter((id: string) => id.startsWith("src_")))];
	const [a, b, c] = chatIds;
	const steps: DeleteStep[] = [chat(a, "preserve-graph"), chat(b, "delete-nodes"), chat(a, "delete-nodes"), chat(b, "delete-nodes"), chat("chat_nothing", "delete-nodes")];
	if (c) steps.push(chat(c, "preserve-graph"));
	for (const id of sourceIds.slice(0, 2)) steps.push(source(id));
	deleteChatsCase(`${name} lessons and files`, name, steps);
	for (const id of chatIds) deleteChatsCase(`${name} only ${id}`, name, [chat(id, "delete-nodes")]);
}

function deleteNodesCase(name: string, l: LedgerIn, ids: string[]) {
	add(`delete_nodes / ${name}`, () => make("delete_nodes", { ledgers: l, ids }, () => {
		const m = storeOf(load(l));
		const results = ids.map((id) => attempt(() => deleteNodeTraces(m.store, id)));
		return { results, rewrites: m.rewrites, ledgers: ledgerMarks(m.state, isWhole(l)) };
	}));
}

deleteNodesCase("shared nodes and arguments", S.shared, ["n_a", "n_nothing", "arg_1", "arg_1", "arg_nothing", "n_c", "n_f", "n_ghost", "arg_5", "n_e", "n_l"]);
deleteNodesCase("shared one node", S.shared, ["n_b"]);
deleteNodesCase("shared nothing", S.shared, ["n_zzz", "arg_zzz", ""]);
deleteNodesCase("base", S.base, ["n_c", "arg_old1", "n_a"]);
deleteNodesCase("empty", emptyLedgers(), ["n_a", "arg_a"]);
for (const name of ["cse21", "cse29"]) {
	const g = graphOf(name);
	const ids = [g.nodes[5]!.id, g.nodes[17]!.id, g.nodes[17]!.id, g.chains[1]!.id, g.chains[7]!.id, g.nodes[40]!.id, "n_nothing", "arg_nothing"];
	deleteNodesCase(`${name} some nodes and arguments`, name, ids);
	deleteNodesCase(`${name} one argument`, name, [g.chains[3]!.id]);
}

// ─── merge ───────────────────────────────────────────────────────────────────

type MergeStep = { chatId: string; findings: any; source: any };

function mergeCase(name: string, l: LedgerIn, steps: MergeStep[]) {
	add(`merge / ${name}`, () => make("merge", { ledgers: l, steps }, () => {
		const ledgers = load(l);
		const m = storeOf(ledgers);
		const deps = depsOf(m, ledgers);
		const results = steps.map((s) => attempt(() => mergeFindings(s.chatId, s.findings, deps, s.source)));
		// Fresh ids and run times differ on every run, so they are renamed in order of appearance.
		const out: any = normalise({ results, ledgers: ledgerMarks(m.state, true), rewrites: m.rewrites }, stringsOf([ledgers, steps]));
		if (!isWhole(l)) out.ledgers = Object.fromEntries(Object.entries(out.ledgers).map(([key, value]) => [key, big(value)]));
		return out;
	}));
}

mergeCase("base four sources one after another", S.base, S.mergeSteps);
mergeCase("base first batch only", S.base, S.mergeSteps.slice(0, 1));
mergeCase("empty ledgers lesson then notes", emptyLedgers(), [S.mergeSteps[0]!, S.mergeSteps[2]!]);
mergeCase("empty findings", S.base, [{ chatId: "chat_new", findings: { propositions: [], reteaches: [], tests: [], chains: [] }, source: { foldedAt: "2026-03-01T00:00:00.000Z", coverage: [] } }]);
mergeCase("notes import with no coverage and no tests key", S.base, [{ chatId: "src_new2", findings: { propositions: [{ id: "x", name: "Ex", statement: "Ex holds.", aliases: [] }], reteaches: ["n_a", "n_b"], chains: [{ premises: ["x", "n_a"], conclusion: "n_d" }] }, source: { foldedAt: "2026-03-01T00:00:00.000Z" } }]);
mergeCase("shared graph with repeated lines", S.shared, [
	{
		chatId: "chat_c2",
		findings: {
			propositions: [
				{ id: "p1", name: "Pi", statement: "Pi holds.", aliases: [], messageId: "msg_1" },
				{ id: "p2", name: "Rho", statement: "Rho holds.", aliases: ["Rho again"] },
			],
			reteaches: ["n_e", "n_b", "n_zz", "n_h", "n_l"],
			tests: [{ messageId: "msg_1", ids: ["n_e", "p1", "n_e", "n_gone"] }, { messageId: "msg_2", ids: ["n_e", "n_a"] }],
			chains: [{ premises: ["p1", "n_e"], conclusion: "p2" }, { premises: ["n_a", "n_b"], conclusion: "n_c" }, { premises: ["n_c"], conclusion: "n_d" }],
		},
		source: { foldedAt: "2026-03-01T00:00:00.000Z", coverage: [{ chatId: "chat_c2", fp: "zz", tokens: 4, foldedAt: "2026-03-01T00:00:00.000Z" }] },
	},
]);

for (const name of ["cse21", "cse29"]) {
	const ids = graphOf(name).nodes.map((n) => n.id);
	const at = (i: number) => ids[i]!;
	const entry = (chatId: string, fp: string, tokens: number) => ({ chatId, fp, tokens, foldedAt: "2026-03-01T00:00:00.000Z" });
	mergeCase(`${name} a lesson then a notes file`, name, [
		{
			chatId: "chat_golden",
			findings: {
				propositions: [{ id: "p1", name: "Golden fact", statement: "A fact for the golden run.", aliases: ["Golden alias"], messageId: "msg_g1" }],
				reteaches: [at(3), at(4), at(3)],
				tests: [{ messageId: "msg_g2", ids: ["p1", at(5), at(6)] }],
				chains: [{ premises: ["p1", at(0)], conclusion: at(1) }],
			},
			source: { foldedAt: "2026-03-01T00:00:00.000Z", coverage: [entry("chat_golden", "fpA", 11), entry("chat_golden", "fpB", 13)] },
		},
		{
			chatId: "src_golden",
			findings: {
				propositions: [{ id: "a", name: "File fact", statement: "From a file.", aliases: [] }],
				reteaches: [at(7)],
				tests: [],
				chains: [{ premises: ["a"], conclusion: at(8) }],
			},
			source: { foldedAt: "2026-03-02T00:00:00.000Z" },
		},
	]);
}

export default cases;
