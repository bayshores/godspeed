/**
 * The Graph picture's camera maths
 * (src/frontend/components/graph/constellation-camera.ts): zoom toward the
 * pointer, pan, the view kept inside the picture, where a flight to a topic
 * lands, bringing a rect into view, the steps of a flight, when the picture
 * is near, carrying a camera onto a picture laid out again, and the
 * wheel's zoom factor.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { layoutSky, NAME_GAP, NAME_LINE, type Cluster, type Rect } from "../../src/frontend/components/graph/constellation-layout.ts";
import { fitPicture } from "../../src/frontend/components/graph/constellation-fit.ts";
import {
	MOON_PITCH,
	between,
	camOnTopic,
	camShowing,
	carryCam,
	homeCam,
	isNear,
	nearRamp,
	panBy,
	pitchOf,
	project,
	starPitch,
	toLayout,
	topZoom,
	viewRect,
	wheelFactor,
	zoomAt,
	zoomed,
	type Cam,
	type Frame,
	type Shot,
} from "../../src/frontend/components/graph/constellation-camera.ts";
import { course, looseOnly, measure, type Space } from "../constellation-fixture.ts";
import { introC } from "../constellation-course-fixture.ts";

/** A 1000 x 500 box over a 2000 x 1000 picture drawn at half size. */
const F: Frame = { w: 1000, h: 500, scale: 0.5, skyW: 2000, skyH: 1000 };
const TOP = 8;
const near = (a: number, b: number, why = "") => assert.ok(Math.abs(a - b) < 1e-6, `${why} ${a} is not ${b}`);
const under = (c: Cam, f: Frame, sx: number, sy: number) => toLayout(project(c, f), sx, sy);
const inside = (r: Rect, f: Frame) => r.x0 >= -1e-6 && r.y0 >= -1e-6 && r.x1 <= f.skyW + 1e-6 && r.y1 <= f.skyH + 1e-6;

/** A space laid out and fitted into a room, as the page does. */
function look(space: Space, width = 1192, height = 600) {
	const { sky, scale } = fitPicture((w) => layoutSky(space.topics, space.links, space.facts, w, measure), { width, height });
	const f: Frame = { w: sky.width * scale, h: Math.max(sky.height * scale, height), scale, skyW: sky.width, skyH: sky.height };
	const nn = starPitch(sky);
	return { sky, f, nn, zMax: topZoom(nn, f) };
}

describe("zooming toward the pointer", () => {
	it("keeps the layout point under the pointer where it is", () => {
		for (const [sx, sy] of [[500, 250], [300, 200], [100, 450], [0, 0], [1000, 500]] as const) {
			const home = homeCam(F);
			const before = under(home, F, sx, sy);
			const c = zoomAt(home, F, 3, sx, sy, TOP);
			const after = under(c, F, sx, sy);
			near(after.x, before.x, `x at ${sx},${sy}`);
			near(after.y, before.y, `y at ${sx},${sy}`);
		}
	});

	it("keeps it there through a second zoom toward the middle of the view", () => {
		const first = zoomAt(homeCam(F), F, 2, 400, 200, TOP);
		const at = under(first, F, 500, 250);
		const second = zoomAt(first, F, 2, 500, 250, TOP);
		near(under(second, F, 500, 250).x, at.x);
		near(under(second, F, 500, 250).y, at.y);
	});

	it("stays between the whole picture and the top zoom", () => {
		const out = zoomAt(homeCam(F), F, 0.01, 300, 300, TOP);
		assert.equal(out.z, 1);
		assert.ok(!zoomed(out));
		const deep = zoomAt(homeCam(F), F, 1e6, 300, 300, TOP);
		assert.equal(deep.z, TOP);
		const back = zoomAt(deep, F, 1e-6, 300, 300, TOP);
		assert.equal(back.z, 1);
	});

	it("never lets the view leave the picture, at any edge", () => {
		for (const [sx, sy] of [[0, 0], [1000, 0], [0, 500], [1000, 500]] as const)
			for (const factor of [1.5, 4, 100]) {
				const c = zoomAt(homeCam(F), F, factor, sx, sy, TOP);
				assert.ok(inside(viewRect(c, F), F), `zoom ${factor} at ${sx},${sy}`);
			}
	});

	it("zooming out from a corner lands back on the whole picture", () => {
		const corner = zoomAt(homeCam(F), F, 6, 1000, 500, TOP);
		const out = zoomAt(corner, F, 1 / 6, 500, 250, TOP);
		assert.ok(!zoomed(out));
		near(out.x, homeCam(F).x);
		near(out.y, homeCam(F).y);
	});
});

describe("dragging", () => {
	const zoomedIn = zoomAt(homeCam(F), F, 4, 500, 250, TOP);

	it("moves the picture with the pointer and keeps the zoom", () => {
		const k = F.scale * zoomedIn.z;
		const c = panBy(zoomedIn, F, 40, -20, TOP);
		assert.equal(c.z, zoomedIn.z);
		near(c.x, zoomedIn.x - 40 / k);
		near(c.y, zoomedIn.y + 20 / k);
	});

	it("never takes the view past the picture's edge, however far the drag", () => {
		for (const [dx, dy] of [[1e5, 0], [-1e5, 0], [0, 1e5], [0, -1e5], [1e5, 1e5], [-1e5, -1e5]] as const) {
			const c = panBy(zoomedIn, F, dx, dy, TOP);
			assert.ok(inside(viewRect(c, F), F), `drag ${dx},${dy}`);
		}
		const left = viewRect(panBy(zoomedIn, F, 1e5, 0, TOP), F);
		near(left.x0, 0, "dragged all the way right sits at the left edge");
	});

	it("does not move the whole picture", () => {
		const home = homeCam(F);
		const c = panBy(home, F, 300, 300, TOP);
		near(c.x, home.x);
		near(c.y, home.y);
	});

	it("a box taller than its picture keeps the picture at the top left", () => {
		const tall: Frame = { w: 1000, h: 800, scale: 0.5, skyW: 2000, skyH: 1000 };
		const home = homeCam(tall);
		const dragged = panBy(home, tall, 0, 500, TOP);
		near(dragged.y, home.y);
		const zoomedTall = zoomAt(home, tall, 2, 500, 400, TOP);
		assert.ok(viewRect(zoomedTall, tall).y0 >= -1e-6);
	});
});

describe("where a flight to a topic lands", () => {
	for (const [name, make] of [["the intro course", introC], ["the made-up course", course]] as const) {
		const { sky, f, nn, zMax } = look(make());

		it(`${name}: close enough for moons, never past the top, and the view stays inside the picture`, () => {
			for (const k of sky.clusters) {
				const c = camOnTopic(k, f, nn, zMax);
				assert.ok(c.z <= zMax + 1e-9, k.topic.name);
				assert.ok(pitchOf(c, f, nn) >= MOON_PITCH - 1e-6, `${k.topic.name} shows moons`);
				const v = viewRect(c, f);
				assert.ok(v.x0 >= -1e-6 && v.x1 <= f.skyW + 1e-6 && v.y0 >= -1e-6, `${k.topic.name} inside`);
			}
		});

		it(`${name}: the topic's disc is in view`, () => {
			for (const k of sky.clusters) {
				const v = viewRect(camOnTopic(k, f, nn, zMax), f);
				assert.ok(k.cx >= v.x0 && k.cx <= v.x1 && k.cy >= v.y0 && k.cy <= v.y1, k.topic.name);
			}
		});
	}

	it("a small cluster stops at a pitch of 72, short of the top zoom, with its disc and the name under it in the box", () => {
		const { sky, f, nn, zMax } = look(course());
		const small = [...sky.clusters].sort((a, b) => a.r - b.r)[0]!;
		const c = camOnTopic(small, f, nn, zMax);
		near(pitchOf(c, f, nn), 72);
		assert.ok(c.z < zMax);
		const v = viewRect(c, f);
		const below = (NAME_GAP + small.text.length * NAME_LINE) / (f.scale * c.z);
		assert.ok(v.x0 <= small.cx - small.r && v.x1 >= small.cx + small.r, "its width is in view");
		assert.ok(v.y0 <= small.cy - small.r && v.y1 >= small.cy + small.r + below - 1e-6, "its names are in view");
	});

	it("a cluster too big for a short box lands where facts are moons and no deeper", () => {
		const { sky, f, nn, zMax } = look(introC(), 1192, 300);
		const big = [...sky.clusters].sort((a, b) => b.r - a.r)[0]!;
		const c = camOnTopic(big, f, nn, zMax);
		assert.ok(c.z < zMax);
		near(pitchOf(c, f, nn), MOON_PITCH, "a big cluster is not zoomed past the moon pitch");
	});

	it("a cluster between the two limits is fitted to 60% of the box's shorter side", () => {
		const { sky, f, nn, zMax } = look(introC());
		const mid = sky.clusters.find((k) => {
			const p = pitchOf(camOnTopic(k, f, nn, zMax), f, nn);
			return p > MOON_PITCH + 1 && p < 71;
		});
		assert.ok(mid, "the course has a topic between the two limits");
		const c = camOnTopic(mid!, f, nn, zMax);
		near(2 * mid!.r * f.scale * c.z, 0.6 * Math.min(f.w, f.h), "the disc's size on screen");
	});
});

describe("bringing a rect into view", () => {
	const c: Cam = { z: 2, x: 1000, y: 500 };
	const view = viewRect(c, F);
	const rect = (x0: number, y0: number, w = 40, h = 40): Rect => ({ x0, y0, x1: x0 + w, y1: y0 + h });

	it("returns the same camera when the rect is in view with room to spare", () => {
		assert.ok(camShowing(c, F, rect(980, 480), 24, TOP) === c);
	});

	it("moves the least that gets a rect past the left edge inside the padded view", () => {
		const r = rect(view.x0 - 200, 480);
		const next = camShowing(c, F, r, 24, TOP);
		assert.equal(next.z, c.z);
		assert.equal(next.y, c.y, "no move up or down");
		near(viewRect(next, F, -24).x0, r.x0, "the rect's edge sits on the padded view's edge");
	});

	it("moves down for a rect below, and by nothing sideways", () => {
		const r = rect(980, view.y1 + 100);
		const next = camShowing(c, F, r, 24, TOP);
		assert.equal(next.x, c.x);
		near(viewRect(next, F, -24).y1, r.y1);
	});

	it("a rect inside the view but inside the pad still moves, just enough", () => {
		const r = rect(980, view.y1 - 5);
		const next = camShowing(c, F, r, 24, TOP);
		assert.ok(next !== c);
		near(viewRect(next, F, -24).y1, r.y1);
	});

	it("centres a rect too big for the view", () => {
		const r = rect(300, 300, 1200, 600);
		const next = camShowing(c, F, r, 24, TOP);
		near(next.x, 900);
		near(next.y, 600);
	});

	it("never takes the view past the picture", () => {
		const next = camShowing(c, F, rect(-500, -500), 24, TOP);
		assert.ok(inside(viewRect(next, F), F));
	});
});

describe("the steps of a flight", () => {
	const a: Cam = { z: 1, x: 1000, y: 500 };
	const b: Cam = { z: 6, x: 300, y: 200 };

	it("starts at one camera and ends at the other", () => {
		for (const [from, to] of [[a, b], [b, a]] as const) {
			const start = between(from, to, 0);
			const end = between(from, to, 1);
			near(start.z, from.z);
			near(start.x, from.x);
			near(start.y, from.y);
			near(end.z, to.z);
			near(end.x, to.x);
			near(end.y, to.y);
		}
	});

	it("never overshoots, on the way in or out", () => {
		for (const [from, to] of [[a, b], [b, a]] as const) {
			const lo = (p: number, q: number) => Math.min(p, q) - 1e-9;
			const hi = (p: number, q: number) => Math.max(p, q) + 1e-9;
			for (let i = 0; i <= 50; i++) {
				const s = between(from, to, i / 50);
				assert.ok(s.z >= lo(from.z, to.z) && s.z <= hi(from.z, to.z), `zoom at ${i}`);
				assert.ok(s.x >= lo(from.x, to.x) && s.x <= hi(from.x, to.x), `x at ${i}`);
				assert.ok(s.y >= lo(from.y, to.y) && s.y <= hi(from.y, to.y), `y at ${i}`);
			}
		}
	});

	it("zoom changes evenly in ratio", () => {
		near(between(a, b, 0.5).z, Math.sqrt(6));
	});

	it("a flight at one zoom only moves, evenly", () => {
		const p: Cam = { z: 3, x: 100, y: 100 };
		const q: Cam = { z: 3, x: 200, y: 300 };
		const s = between(p, q, 0.25);
		near(s.z, 3);
		near(s.x, 125);
		near(s.y, 150);
	});
});

describe("when the picture is near", () => {
	it("never at the whole picture, however far apart the stars are", () => {
		assert.equal(isNear(500, 1), false);
		assert.equal(isNear(500, 1.001), false);
		assert.equal(nearRamp(500, 1), 0);
	});

	it("from a pitch of 28", () => {
		assert.equal(isNear(28, 2), true);
		assert.equal(isNear(27.9, 2), false);
		assert.equal(isNear(92, 9), true);
	});

	it("the ramp runs from 0 at 21 to 1 at 28 and stays inside that", () => {
		near(nearRamp(21, 2), 0);
		near(nearRamp(24.5, 2), 0.5);
		near(nearRamp(28, 2), 1);
		assert.equal(nearRamp(10, 2), 0);
		assert.equal(nearRamp(200, 2), 1);
	});
});

describe("carrying a camera onto the picture laid out again", () => {
	const space = introC();
	const wide = look(space, 1192);
	const narrow = look(space, 836);
	const shot = (l: typeof wide, cam: Cam): Shot => ({ sky: l.sky, f: l.f, nn: l.nn, cam });
	const there = { sky: narrow.sky, f: narrow.f, nn: narrow.nn };

	it("keeps the whole picture whole", () => {
		const c = carryCam(shot(wide, homeCam(wide.f)), there, narrow.zMax);
		const home = homeCam(narrow.f);
		assert.ok(!zoomed(c));
		near(c.x, home.x);
		near(c.y, home.y);
	});

	it("keeps near near, at the same pitch, on the same topic", () => {
		const topic = wide.sky.clusters.find((k) => k.topic.name === "Pointers")!;
		const cam = camOnTopic(topic, wide.f, wide.nn, wide.zMax);
		assert.ok(isNear(pitchOf(cam, wide.f, wide.nn), cam.z));
		const c = carryCam(shot(wide, cam), there, narrow.zMax);
		near(pitchOf(c, narrow.f, narrow.nn), pitchOf(cam, wide.f, wide.nn), "pitch");
		assert.ok(isNear(pitchOf(c, narrow.f, narrow.nn), c.z));
		const k = narrow.sky.byTopic.get(topic.topic.id)!;
		const v = viewRect(c, narrow.f);
		assert.ok(k.cx >= v.x0 && k.cx <= v.x1 && k.cy >= v.y0 && k.cy <= v.y1, "the topic is still in view");
	});

	it("never carries past the new top zoom", () => {
		const topic = wide.sky.clusters[0]!;
		const c = carryCam(shot(wide, { z: wide.zMax, x: topic.cx, y: topic.cy }), there, narrow.zMax);
		assert.ok(c.z <= narrow.zMax + 1e-9);
	});

	it("a camera on a picture whose topics are gone still lands inside the picture", () => {
		const other = look(course());
		const cam = camOnTopic(wide.sky.clusters[3]!, wide.f, wide.nn, wide.zMax);
		const c = carryCam(shot(wide, cam), { sky: other.sky, f: other.f, nn: other.nn }, other.zMax);
		assert.ok(inside(viewRect(c, other.f), other.f));
	});
});

describe("the usual star gap", () => {
	it("is twice a star's size for an empty sky and for one star alone", () => {
		const none = layoutSky([], [], [], 1000, measure);
		assert.equal(starPitch(none), none.s * 2);
		const lone = look(looseOnly()).sky;
		assert.equal(lone.stars.length, 1);
		assert.equal(starPitch(lone), lone.s * 2);
	});

	it("is the median gap between a star and its nearest neighbour", () => {
		const { sky } = look(introC());
		const nearest = (k: Cluster) => k.stars.map((a) => Math.min(...k.stars.filter((b) => b !== a).map((b) => Math.hypot(a.cx - b.cx, a.cy - b.cy))));
		const gaps = sky.clusters.flatMap(nearest).sort((x, y) => x - y);
		assert.equal(starPitch(sky), gaps[Math.floor(gaps.length / 2)]);
		assert.ok(starPitch(sky) >= sky.s, "stars never overlap");
	});
});

describe("the wheel", () => {
	it("scrolling up zooms in and scrolling down zooms out, by the same amount", () => {
		assert.ok(wheelFactor(-100, 0, false) > 1);
		assert.ok(wheelFactor(100, 0, false) < 1);
		near(wheelFactor(0, 0, false), 1);
		near(wheelFactor(100, 0, false) * wheelFactor(-100, 0, false), 1);
	});

	it("a pinch counts for more than the same wheel delta", () => {
		assert.ok(wheelFactor(-5, 0, true) > wheelFactor(-5, 0, false));
		assert.ok(wheelFactor(5, 0, true) < wheelFactor(5, 0, false));
	});

	it("a wheel counted in lines or pages counts as the pixels it stands for", () => {
		near(wheelFactor(3, 1, false), wheelFactor(48, 0, false));
		near(wheelFactor(1, 2, false), wheelFactor(400, 0, false));
	});
});
