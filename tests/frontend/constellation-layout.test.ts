/**
 * Where the Graph picture puts its clusters and names
 * (src/frontend/components/graph/constellation-layout.ts): the same data
 * gives the same picture, nothing overlaps, every name's button lies inside
 * the picture and holds its name, one topic sits top left, a space with no
 * links is a calm grid, and Ungrouped sits last and apart.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CLEAR, MARK_W, layoutSky, nameBox, type Sky } from "../../src/frontend/components/graph/constellation-layout.ts";
import { boxesMeet, course, discMeetsBox, flat, looseOnly, measure, one, sixty, type Space } from "../constellation-fixture.ts";

const WIDTHS = [1440, 1100, 800];
const SPACES: [string, () => Space][] = [
	["the course", course],
	["60 topics", sixty],
	["one topic", one],
	["no links", flat],
	["Ungrouped alone with 1 fact", looseOnly],
];
const sky = (sp: Space, width: number) => layoutSky(sp.topics, sp.links, sp.facts, width, measure);

describe("the constellation layout", () => {
	it("gives the same picture for the same data", () => {
		for (const [, make] of SPACES)
			for (const w of WIDTHS) {
				const plain = (s: Sky) => ({ height: s.height, s: s.s, clusters: s.clusters.map((k) => ({ ...k, topic: k.topic.id })) });
				assert.ok(JSON.stringify(plain(sky(make(), w))) === JSON.stringify(plain(sky(make(), w))), `at ${w}`);
			}
	});

	it("places every topic once and every fact as one star of its topic", () => {
		for (const [name, make] of SPACES) {
			const sp = make();
			const s = sky(sp, 1440);
			assert.equal(s.clusters.length, sp.topics.length, name);
			assert.equal(s.stars.length, sp.facts.length, name);
			for (const k of s.clusters) assert.equal(k.stars.map((x) => x.id).sort().join(" "), [...k.topic.members].sort().join(" "), k.topic.name);
		}
	});

	it("never lets a cluster or a name touch another, and keeps all of it inside the width", () => {
		for (const [name, make] of SPACES)
			for (const w of WIDTHS) {
				const s = sky(make(), w);
				for (const a of s.clusters) {
					const at = `${name} at ${w}: ${a.topic.name}`;
					assert.ok(a.cx - a.r >= -1 && a.cx + a.r <= w + 1, `${at} spills sideways`);
					assert.ok(nameBox(a).x0 >= -6 && nameBox(a).x1 <= w + 6, `${at} name spills sideways`);
					assert.ok(nameBox(a).y1 <= s.height, `${at} name below the picture`);
					for (const b of s.clusters) {
						if (a === b) continue;
						const against = `${at} against ${b.topic.name}`;
						assert.ok(Math.hypot(a.cx - b.cx, a.cy - b.cy) >= a.r + b.r, `${against}: clusters overlap`);
						assert.ok(!boxesMeet(nameBox(a), nameBox(b)), `${against}: names overlap`);
						assert.ok(!discMeetsBox(a, nameBox(b)), `${against}: cluster on a name`);
					}
				}
			}
	});

	it("cuts a long name only at its end, on the second line", () => {
		const s = sky(sixty(), 800);
		for (const k of s.clusters) {
			assert.ok(k.text.length <= 2);
			assert.ok(!k.text[0]!.endsWith("…"), k.topic.name);
			assert.ok(k.text.join(" ").replace("…", "").length <= k.topic.name.length);
		}
	});

	it("puts a lone topic at the top left and makes the picture only as tall as it", () => {
		for (const w of WIDTHS) {
			const s = sky(one(), w);
			const [k] = s.clusters;
			assert.ok(k);
			assert.ok(Math.min(k.cx - k.r, nameBox(k).x0) <= 1, `left edge at ${Math.min(k.cx - k.r, nameBox(k).x0)}`);
			assert.ok(k.cy - k.r <= 20, "near the top");
			assert.ok(s.height <= nameBox(k).y1 + 20, `height ${s.height}`);
		}
	});

	it("lays a space with no links out as a calm grid in rows, Ungrouped last and apart", () => {
		const s = sky(flat(), 1440);
		const rows = new Set(s.clusters.map((k) => k.cy - k.r));
		assert.ok(rows.size <= Math.ceil(s.clusters.length / 5) * 7, "rows, give or take a few points");
		const loose = s.clusters.find((k) => k.muted)!;
		const last = Math.max(...s.clusters.map((k) => k.cy));
		assert.ok(loose.cy >= last - 10, "Ungrouped is in the last row");
		const sameRow = s.clusters.filter((k) => !k.muted && Math.abs(k.cy - loose.cy) < 20);
		for (const k of sameRow) assert.ok(k.cx < loose.cx, "after the rest of its row");
	});

	it("keeps Ungrouped right of every level, a column apart", () => {
		for (const w of WIDTHS)
			for (const make of [course, sixty]) {
				const s = sky(make(), w);
				const loose = s.clusters.find((k) => k.muted)!;
				const right = Math.max(...s.clusters.filter((k) => !k.muted).map((k) => k.cx + k.r));
				assert.ok(loose.cx - loose.r > right + CLEAR, `at ${w}`);
			}
	});

	it("keeps the course's picture about one window tall at 1440", () => {
		const s = sky(course(), 1440);
		assert.ok(s.height < 720, `height ${s.height}`);
	});

	it("keeps every name's button inside the picture, and draws each name inside its button", () => {
		for (const [name, make] of SPACES)
			for (const w of [1440, 1100, 800, 836, 696, 644]) {
				const s = sky(make(), w);
				for (const k of s.clusters) {
					const at = `${name} at ${w}: ${k.topic.name}`;
					const b = nameBox(k);
					assert.ok(b.x0 >= 0 && b.x1 <= w, `${at} has its button at ${b.x0} to ${b.x1}`);
					// The status square sits before the first line only.
					const mark = k.topic.status !== "untested" && !k.muted ? MARK_W : 0;
					const lines = k.text.map((ln, i) => measure(ln) + (i === 0 ? mark : 0));
					assert.equal(b.x1 - b.x0, Math.ceil(Math.max(...lines)), `${at}: the button is not as wide as its name`);
				}
			}
	});
});
