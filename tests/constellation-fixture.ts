/**
 * Made-up spaces for the Graph picture's layout and route tests: a course
 * of 17 topics, 60 interview topics over 9 levels, one topic, and 14
 * topics with no links. Deterministic, with some answers so every status shows.
 */
import type { Cluster, Rect } from "../src/frontend/components/graph/constellation-layout.ts";
import { rampColor, tally, topicStatus, type FactProgress, type GraphChain, type TopicLink, type TopicProgress } from "../src/shared/core/index.ts";

export interface Space {
	topics: TopicProgress[];
	links: TopicLink[];
	facts: FactProgress[];
	chains: Pick<GraphChain, "premises" | "conclusion">[];
}

export const boxesMeet = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
export const discMeetsBox = (k: Cluster, b: Rect) => Math.hypot(k.cx - Math.max(b.x0, Math.min(k.cx, b.x1)), k.cy - Math.max(b.y0, Math.min(k.cy, b.y1))) < k.r;

/** Rough 13-point name widths, about what the page's font gives. */
export const measure = (t: string) => t.length * 6.6;

function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const COURSE = [
	["Terminal basics", "Variables and types", "Makefiles"],
	["Control flow", "Functions", "Arrays", "Variable-length strings"],
	["Pointers", "Memory layout", "Bitwise operations"],
	["Structs", "Dynamic memory with malloc", "Debugging with GDB"],
	["Linked lists", "File input and output"],
	["Hash tables and collision handling in C"],
];

const SIXTY = [
	["Big O notation", "Arrays and strings", "Hash maps", "Recursion basics", "Bit tricks", "Math for interviews"],
	["Two pointers", "Sliding window", "Prefix sums", "Sorting algorithms", "Stacks", "Queues and deques", "Linked lists"],
	["Binary search", "Monotonic stack", "Fast and slow pointers", "Intervals and merging", "Heaps and priority queues", "Recursion with memo", "Matrix traversal"],
	["Binary trees", "Tree traversals", "Backtracking", "Top K problems", "Greedy choices", "Union find", "Tries"],
	["Binary search trees", "Lowest common ancestor", "Graph basics", "Breadth first search", "Depth first search", "Subsets and permutations", "1D dynamic programming"],
	["Topological sort", "Shortest paths with Dijkstra", "Cycle detection", "2D dynamic programming", "Knapsack problems", "Segment trees"],
	["Minimum spanning trees", "Bitmask dynamic programming", "Dynamic programming on trees", "String matching with KMP", "Design an LRU cache", "Rate limiter design", "Consistent hashing"],
	["Caching strategies", "Load balancers", "Database indexing", "Sharding and replication", "Message queues", "Design a URL shortener"],
	["Design a news feed", "Design a chat system", "Behavioural stories with STAR", "Talking through tradeoffs", "Mock interview pacing", "Negotiating an offer"],
];

const FLAT = ["Greetings", "Numbers to twenty", "Days and months", "Ordering food", "Asking directions", "Family words", "Telling the time", "Weather talk", "At the station", "Shopping phrases", "Past tense verbs", "Polite requests", "Hobbies and free time", "Describing people"];

/** `ungrouped` is how many loose facts sit in an Ungrouped topic; none, no such topic. */
function build(levels: string[][], seed: number, size: [number, number], linked: boolean, ungrouped: number): Space {
	const r = rng(seed);
	const topics: TopicProgress[] = [];
	const facts: FactProgress[] = [];
	const chains: Space["chains"] = [];
	const links: TopicLink[] = [];
	levels.forEach((names, column) =>
		names.forEach((name) => {
			const id = `tpc_${seed}_${topics.length}`;
			const n = size[0] + Math.floor(r() * (size[1] - size[0] + 1));
			const skill = r() < 0.4 ? null : r();
			const mine: FactProgress[] = [];
			for (let k = 0; k < n; k++) {
				const fid = `${id}_f${k}`;
				const answers =
					skill === null || r() < 0.3
						? []
						: Array.from({ length: 1 + Math.floor(r() * 3) }, (_, i) => ({
								chatId: "c",
								toolCallId: `${fid}-${i}`,
								outcome: r() < skill ? ("right" as const) : ("wrong" as const),
								answeredAt: "2026-11-01T00:00:00Z",
							}));
				mine.push({ id: fid, name: `${name} fact ${k + 1}`, statement: "", topicId: id, born: null, inLessons: answers.length > 0, answers });
				if (k > 0 && r() < 0.6) chains.push({ premises: [`${id}_f${Math.floor(r() * k)}`], conclusion: fid });
			}
			facts.push(...mine);
			const t = tally(mine.flatMap((f) => f.answers));
			topics.push({ id, name, members: mine.map((f) => f.id), ...t, status: topicStatus(t.rate), color: rampColor(t.rate), overconfident: false, answers: mine.flatMap((f) => f.answers), column: linked ? column : 0 });
		}),
	);
	if (linked)
		for (const t of topics) {
			if (t.column === 0) continue;
			const at = (l: number) => topics.filter((x) => x.column === l);
			const parents = new Set([at(t.column - 1)[Math.floor(r() * at(t.column - 1).length)]!]);
			if (r() < 0.55) parents.add(at(t.column - 1)[Math.floor(r() * at(t.column - 1).length)]!);
			if (t.column > 1 && r() < 0.35) parents.add(at(t.column - 2)[Math.floor(r() * at(t.column - 2).length)]!);
			for (const p of parents) {
				links.push({ from: p.id, to: t.id, weight: 1 + Math.floor(r() * 6) });
				// A chain across the link, so fact lines run between topics too.
				chains.push({ premises: [p.members[Math.floor(r() * p.members.length)]!], conclusion: t.members[Math.floor(r() * t.members.length)]! });
			}
		}
	if (ungrouped) {
		const id = `tpc_${seed}_ungrouped`;
		const members = Array.from({ length: ungrouped }, (_, k) => `${id}_f${k}`);
		for (const fid of members) facts.push({ id: fid, name: `Loose note ${fid}`, statement: "", topicId: id, born: null, inLessons: false, answers: [] });
		topics.push({ id, name: "Ungrouped", ungrouped: true, members, ...tally([]), status: "untested", color: rampColor(null), overconfident: false, answers: [], column: 0 });
	}
	return { topics, links, facts, chains };
}

export const course = () => build(COURSE, 1, [4, 22], true, 9);
export const sixty = () => build(SIXTY, 2, [6, 29], true, 9);
export const one = () => build([["Binary search"]], 3, [12, 12], false, 0);
export const flat = () => build([FLAT], 4, [4, 15], false, 9);
/** A new space: only Ungrouped, holding one fact. */
export const looseOnly = () => build([], 5, [1, 1], false, 1);
