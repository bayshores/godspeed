/**
 * A topic's figure and a fact's moon close up
 * (src/frontend/components/graph/constellation-figure.ts and
 * constellation-moon.ts): the order by what comes first, a loop that still
 * ends, a fact's path, figure places, which lines are lit, and moon phases.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rampColor, tally, topicStatus, type AnswerOutcome, type FactProgress, type TopicProgress } from "../../src/shared/core/index.ts";
import { factPath, figuresOf, isLit, lineLight, stepsOf, type FigureLine } from "../../src/frontend/components/graph/constellation-figure.ts";
import { moonPaths, moonPhase } from "../../src/frontend/components/graph/constellation-moon.ts";
import { layoutSky } from "../../src/frontend/components/graph/constellation-layout.ts";
import { starPitch } from "../../src/frontend/components/graph/constellation-camera.ts";
import { course, flat, looseOnly, measure, one, sixty, type Space } from "../constellation-fixture.ts";
import { introC } from "../constellation-course-fixture.ts";
import { realCourse } from "../constellation-real-fixture.ts";

const line = (from: string, to: string): FigureLine => ({ from, to });
const answered = (...outcomes: AnswerOutcome[]) => ({ answers: outcomes.map((outcome) => ({ outcome })) }) as never;

/** A space's figures at its own star pitch, as the page lays them out. */
function figuresFor(sp: Pick<Space, "topics" | "links" | "facts" | "chains">, chains = sp.chains) {
	const sky = layoutSky(sp.topics, sp.links, sp.facts, 1440, measure);
	const nn = starPitch(sky);
	return { sky, nn, fig: figuresOf(sky, chains, nn) };
}
/** The keys of a place map and where each is, rounded, so two runs compare as strings. */
const placeKey = (places: ReadonlyMap<string, { cx: number; cy: number }>) =>
	JSON.stringify([...places].sort(([a], [b]) => a.localeCompare(b)).map(([id, p]) => [id, p.cx.toFixed(3), p.cy.toFixed(3)]));
const spaces = [
	["the made-up course", course],
	["the intro course", introC],
	["the real-sized course", realCourse],
	["the sixty-topic sample", sixty],
] as const;

describe("the order by what comes first", () => {
	it("puts each fact one step above the deepest fact it needs", () => {
		const steps = stepsOf([line("a", "b"), line("b", "c"), line("a", "c"), line("d", "c")]);
		assert.deepEqual(Object.fromEntries(steps), { a: 0, b: 1, c: 2, d: 0 });
	});

	it("ends on a loop and gives the same order every time", () => {
		const loop = [line("x", "y"), line("y", "z"), line("z", "x"), line("a", "x")];
		const steps = stepsOf(loop);
		assert.equal(steps.size, 4, "every fact gets a step");
		assert.deepEqual(stepsOf([...loop].reverse()), steps);
		assert.equal(steps.get("a"), 0);
	});

	it("a loop with nothing outside it still ends", () => {
		const steps = stepsOf([line("p", "q"), line("q", "p")]);
		assert.deepEqual([...steps.keys()].sort(), ["p", "q"]);
	});
});

describe("a fact's path", () => {
	it("needs everything back to the basics and leads to everything after it", () => {
		const lines = [line("a", "b"), line("b", "c"), line("c", "d"), line("e", "c")];
		const p = factPath(lines, "c");
		assert.deepEqual([...p.needs].sort(), ["a", "b", "e"]);
		assert.deepEqual([...p.leadsTo], ["d"]);
	});

	it("never counts the fact itself, even in a loop", () => {
		const p = factPath([line("a", "b"), line("b", "a")], "a");
		assert.deepEqual([...p.needs], ["b"]);
		assert.deepEqual([...p.leadsTo], ["b"]);
	});
});

describe("lit lines", () => {
	const facts = new Map([
		["a", answered("wrong", "right")],
		["b", answered("right", "wrong")],
		["c", answered()],
		["d", answered("right")],
	]);
	it("a fact is lit when its latest answer was right", () => {
		assert.deepEqual(["a", "b", "c", "d", "gone"].map((id) => isLit(facts.get(id))), [true, false, false, true, false]);
	});
	it("a line is lit when both its facts are, half lit with one, a ghost with none", () => {
		assert.equal(lineLight(line("a", "d"), facts), 2);
		assert.equal(lineLight(line("a", "b"), facts), 1);
		assert.equal(lineLight(line("b", "a"), facts), 1);
		assert.equal(lineLight(line("b", "c"), facts), 0);
		assert.equal(lineLight(line("a", "gone"), facts), 1, "a fact that is not there is not lit");
	});
});

describe("figures on a real-sized space", () => {
	const sp = realCourse();
	const sky = layoutSky(sp.topics, sp.links, sp.facts, 1440, measure);
	const nn = starPitch(sky);
	const fig = figuresOf(sky, sp.chains, nn);

	it("keeps each figure near its own cluster", () => {
		for (const k of sky.clusters)
			for (const s of k.stars) {
				const p = fig.places.get(s.id)!;
				assert.ok(Math.hypot(p.cx - k.cx, p.cy - k.cy) < 2 * k.r + 2 * nn, `${s.id} strays from ${k.topic.name}`);
			}
	});

	it("is the same every time", () => {
		assert.deepEqual(figuresOf(sky, sp.chains, nn).places, fig.places);
	});
});

describe("a fact's moon", () => {
	it("its phase is the rights in the last four answers: 0 to 4 rights give 0 to 4", () => {
		assert.equal(moonPhase(answered()), 0);
		assert.equal(moonPhase(answered("wrong", "wrong", "wrong", "wrong")), 0);
		assert.equal(moonPhase(answered("wrong", "right", "wrong", "dontKnow")), 1);
		assert.equal(moonPhase(answered("wrong", "right", "hinted", "right")), 2);
		assert.equal(moonPhase(answered("right", "hinted", "right", "right")), 3);
		assert.equal(moonPhase(answered("right", "right", "right", "right")), 4);
	});

	it("only the last four answers count", () => {
		assert.equal(moonPhase(answered("right", "wrong", "wrong", "wrong", "wrong")), 0);
		assert.equal(moonPhase(answered("right", "right", "right", "wrong", "wrong", "wrong", "right")), 1);
		assert.equal(moonPhase(answered("wrong", "wrong", "right", "right", "right", "right")), 4);
	});

	it("a fuller moon lights more of its cells", () => {
		const litArea = (f: never) => moonPaths(f, 50, 50).find((p) => p.fill === "var(--foreground)")?.d.match(/h2v2/g)?.length ?? 0;
		const sizes = [answered("right"), answered("right", "right"), answered("right", "right", "right"), answered("right", "right", "right", "right")].map(litArea);
		for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i]! > sizes[i - 1]!, `phase ${i + 1} lights more than ${i}`);
	});

	it("a fact never asked is dark, with a centre pixel once a lesson taught it", () => {
		const file = moonPaths({ answers: [], inLessons: false } as never, 50, 50);
		const lesson = moonPaths({ answers: [], inLessons: true } as never, 50, 50);
		assert.ok(!file.some((p) => p.fill === "var(--foreground)"));
		assert.equal(lesson.length, file.length + 1);
	});
});

describe("the lines of a figure", () => {
	for (const [name, make] of spaces) {
		const sp = make();
		const { sky, fig } = figuresFor(sp);
		const topicOf = new Map(sp.facts.map((f) => [f.id, f.topicId]));
		const real = new Set(sp.chains.flatMap((c) => c.premises.filter((p) => p !== c.conclusion && topicOf.get(p) === topicOf.get(c.conclusion)).map((p) => `${p}>${c.conclusion}`)));
		const drawn = [...fig.lines.values()].flat();

		it(`${name}: every fact of a grouped topic gets a place, and Ungrouped has no figure`, () => {
			assert.equal(fig.places.size, sky.clusters.filter((k) => !k.muted).reduce((n, k) => n + k.stars.length, 0));
			for (const k of sky.clusters) for (const st of k.stars) assert.equal(fig.places.has(st.id), !k.muted, st.id);
		});

		it(`${name}: every line runs from a needed fact, lower, to a later fact, higher up`, () => {
			assert.ok(drawn.length > 0);
			for (const l of drawn) assert.ok(fig.places.get(l.from)!.cy > fig.places.get(l.to)!.cy, `${l.from} is not under ${l.to}`);
		});

		it(`${name}: no line joins two topics, and each topic's lines are its own`, () => {
			for (const [topic, lines] of fig.lines)
				for (const l of lines) assert.ok(topicOf.get(l.from) === topic && topicOf.get(l.to) === topic, `${l.from} to ${l.to} in ${topic}`);
		});

		it(`${name}: exactly the real links inside a topic are drawn, once each`, () => {
			const keys = drawn.map((l) => `${l.from}>${l.to}`);
			assert.equal(new Set(keys).size, keys.length, "none twice");
			assert.deepEqual([...keys].sort(), [...real].sort());
		});

		it(`${name}: a figure's facts are never closer than a moon is wide`, () => {
			// Moons are 18 points wide where they first show, at a star pitch of 44.
			const least = (18 / 44) * figuresFor(sp).nn;
			for (const k of sky.clusters.filter((o) => !o.muted)) {
				const at = k.stars.map((s) => ({ id: s.id, ...fig.places.get(s.id)! }));
				for (let i = 0; i < at.length; i++)
					for (let j = i + 1; j < at.length; j++)
						assert.ok(Math.max(Math.abs(at[i]!.cx - at[j]!.cx), Math.abs(at[i]!.cy - at[j]!.cy)) >= least, `${at[i]!.id} and ${at[j]!.id} overlap in ${k.topic.name}`);
			}
		});

		it(`${name}: loose facts sit under the facts that are linked`, () => {
			for (const k of sky.clusters.filter((o) => !o.muted)) {
				const linked = k.stars.filter((s) => fig.steps.has(s.id)).map((s) => fig.places.get(s.id)!.cy);
				const loose = k.stars.filter((s) => !fig.steps.has(s.id)).map((s) => fig.places.get(s.id)!.cy);
				if (linked.length && loose.length) assert.ok(Math.min(...loose) > Math.max(...linked), k.topic.name);
			}
		});
	}

	it("a loop in the links neither hangs nor throws and lays out the same twice", () => {
		const sp = one();
		const [a, b, c, d] = sp.facts.map((f) => f.id);
		for (const chains of [
			[{ premises: [a!], conclusion: b! }, { premises: [b!], conclusion: a! }],
			[{ premises: [a!], conclusion: b! }, { premises: [b!], conclusion: c! }, { premises: [c!], conclusion: a! }, { premises: [c!], conclusion: d! }],
		]) {
			const first = figuresFor(sp, chains).fig;
			const again = figuresFor(sp, chains).fig;
			assert.equal(first.places.size, sp.facts.length, "every fact is placed");
			assert.equal(placeKey(first.places), placeKey(again.places));
			assert.deepEqual([...first.steps].sort(), [...again.steps].sort());
		}
	});

	it("a topic with no links lays every fact out as loose, under no line", () => {
		const sp = flat();
		const { sky, fig } = figuresFor(sp, []);
		assert.equal(fig.lines.size, 0);
		assert.equal(fig.steps.size, 0);
		assert.equal(fig.places.size, sky.clusters.filter((k) => !k.muted).reduce((n, k) => n + k.stars.length, 0));
		assert.ok(fig.places.size > 0);
	});

	it("a topic of one fact, alone in the space, is placed", () => {
		const sp = one();
		const only = sp.facts[0]!;
		const { fig } = figuresFor({ ...sp, topics: [{ ...sp.topics[0]!, members: [only.id] }], facts: [only], chains: [] });
		assert.deepEqual([...fig.places.keys()], [only.id]);
	});

	it("a space of only Ungrouped has no figure", () => {
		assert.equal(figuresFor(looseOnly()).fig.places.size, 0);
	});

	it("one topic in the whole space draws its figure", () => {
		const sp = one();
		const { fig } = figuresFor(sp);
		assert.equal(fig.places.size, sp.facts.length);
		assert.ok([...fig.lines.values()].flat().length > 0);
	});
});

/** A space of the given topics (name to fact ids) and an Ungrouped topic, with the given chains. */
function tiny(groups: Record<string, string[]>, chains: [string, string][], loose: string[] = []) {
	const make = (id: string, name: string, members: string[], ungrouped = false): TopicProgress => ({
		id,
		name,
		members,
		...tally([]),
		status: topicStatus(null),
		color: rampColor(null),
		overconfident: false,
		answers: [],
		column: 0,
		...(ungrouped ? { ungrouped: true as const } : {}),
	});
	const fact = (id: string, topicId: string): FactProgress => ({ id, name: id, statement: "", topicId, born: null, inLessons: false, answers: [] });
	const topics = Object.entries(groups).map(([name, members]) => make(`t-${name}`, name, members));
	const facts = topics.flatMap((t) => t.members.map((id) => fact(id, t.id)));
	if (loose.length) {
		topics.push(make("t-loose", "Ungrouped", loose, true));
		facts.push(...loose.map((id) => fact(id, "t-loose")));
	}
	return { topics, links: [], facts, chains: chains.map(([from, to]) => ({ premises: [from], conclusion: to })) };
}
const linesOf = (fig: ReturnType<typeof figuresFor>["fig"]) => [...fig.lines.values()].flat().map((l) => `${l.from}>${l.to}`);

describe("figures of the smallest topics", () => {
	it("a topic with no facts has no figure and does not disturb the others", () => {
		const { fig } = figuresFor(tiny({ Empty: [], Full: ["a", "b", "c"] }, [["a", "b"]]));
		assert.deepEqual([...fig.places.keys()].sort(), ["a", "b", "c"]);
		assert.deepEqual(linesOf(fig), ["a>b"]);
	});

	it("a topic of one fact places it, with no line and no step", () => {
		const { sky, fig } = figuresFor(tiny({ Solo: ["a"], Pair: ["b", "c"] }, []));
		assert.ok(fig.places.has("a"));
		assert.equal(fig.lines.size, 0);
		assert.equal(fig.steps.size, 0);
		const solo = sky.byTopic.get("t-Solo")!;
		const at = fig.places.get("a")!;
		assert.ok(Math.hypot(at.cx - solo.cx, at.cy - solo.cy) <= solo.r, "inside its own topic");
	});

	it("two linked facts are one line, the needed fact lower and the later one higher", () => {
		const { fig } = figuresFor(tiny({ Pair: ["a", "b"], Other: ["c", "d", "e"] }, [["a", "b"]]));
		assert.deepEqual(linesOf(fig), ["a>b"]);
		assert.deepEqual([fig.steps.get("a"), fig.steps.get("b")], [0, 1]);
		assert.ok(fig.places.get("a")!.cy > fig.places.get("b")!.cy);
	});

	it("two facts with no link are both loose", () => {
		const { fig } = figuresFor(tiny({ Pair: ["a", "b"], Other: ["c", "d", "e"] }, []));
		assert.equal(fig.lines.size, 0);
		assert.ok(fig.places.has("a") && fig.places.has("b"));
		assert.equal(fig.steps.size, 0);
	});
});

describe("the links a figure draws", () => {
	it("a link given twice, or twice in one chain, is one line", () => {
		const sp = tiny({ T: ["a", "b", "c"] }, [["a", "b"], ["a", "b"]]);
		sp.chains.push({ premises: ["a", "a", "c"], conclusion: "b" });
		const { fig } = figuresFor(sp);
		assert.deepEqual(linesOf(fig).sort(), ["a>b", "c>b"]);
	});

	it("links inside Ungrouped give no figure and no lines", () => {
		const { sky, fig } = figuresFor(tiny({ T: ["a", "b"] }, [["u1", "u2"], ["u2", "u3"], ["a", "b"]], ["u1", "u2", "u3"]));
		assert.ok(sky.byTopic.get("t-loose")!.muted);
		assert.deepEqual(linesOf(fig), ["a>b"]);
		for (const id of ["u1", "u2", "u3"]) assert.ok(!fig.places.has(id) && !fig.steps.has(id), id);
	});

	it("a link to a fact that does not exist is ignored, and the real links stay", () => {
		const { fig } = figuresFor(tiny({ T: ["a", "b", "c"] }, [["a", "gone"], ["gone", "b"], ["a", "b"]]));
		assert.deepEqual(linesOf(fig), ["a>b"]);
		assert.ok(!fig.places.has("gone") && !fig.steps.has("gone"));
		assert.deepEqual([...fig.places.keys()].sort(), ["a", "b", "c"]);
	});

	it("a fact linked to itself draws no line", () => {
		const { fig } = figuresFor(tiny({ T: ["a", "b"] }, [["a", "a"]]));
		assert.equal(fig.lines.size, 0);
	});

	it("a space whose chains have not loaded draws figures with no lines", () => {
		assert.equal(figuresFor(tiny({ T: ["a", "b"] }, []), null as never).fig.lines.size, 0);
	});
});

describe("the order lines draw in", () => {
	for (const [name, make] of spaces)
		it(`${name}: a line never draws before a line it builds on`, () => {
			const { fig } = figuresFor(make());
			for (const lines of fig.lines.values())
				for (const l of lines)
					for (const before of lines.filter((m) => m.to === l.from)) assert.ok(fig.steps.get(before.from)! < fig.steps.get(l.from)!, `${before.from} to ${before.to} comes after ${l.from} to ${l.to}`);
		});
});
