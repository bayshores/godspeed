/**
 * Where a page lies on the desk and which way the window travels to it.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pagePlace, wayBetween } from "../../src/frontend/components/desk/desk-model.ts";

const SPACES = [
	{ id: "a", closed: false },
	{ id: "old", closed: true },
	{ id: "b", closed: false },
];
const place = (pathname: string, active: string | null = "a") => pagePlace(pathname, active, SPACES);
const way = (from: ReturnType<typeof place>, to: ReturnType<typeof place>) => wayBetween(from, to);

describe("the way from one page to the next", () => {
	it("follows the top bar: Home, the open spaces, the +, Settings", () => {
		assert.equal(way(place("/"), place("/space")), "right");
		assert.equal(way(place("/space", "a"), place("/space", "b")), "right");
		assert.equal(way(place("/space", "b"), place("/space", "a")), "left");
		assert.equal(way(place("/space", "b"), place("/space", "old")), "right", "a closed space is behind the +");
		assert.equal(way(place("/space", "old"), place("/settings")), "right");
		assert.equal(way(place("/settings"), place("/")), "left");
	});
	it("lays a deeper page on top, and takes it off again", () => {
		assert.equal(way(place("/space"), place("/chat/c1")), "up");
		assert.equal(way(place("/"), place("/chat/c1")), "up");
		assert.equal(way(place("/space"), place("/space/deadline/d1")), "up");
		assert.equal(way(place("/space/deadline/d1"), place("/chat/c1")), "up");
		assert.equal(way(place("/space/deadline/d1"), place("/space/deadline/d1/cheat-sheet")), "up");
		assert.equal(way(place("/space"), place("/new")), "up");
		assert.equal(way(place("/chat/c1"), place("/space/deadline/d1")), "down");
		assert.equal(way(place("/chat/c1"), place("/")), "down");
		assert.equal(way(place("/space/mock/a/m1"), place("/space/deadlines")), "down");
	});
	it("goes nowhere between a space's own tabs, which its layout moves between", () => {
		assert.equal(way(place("/space"), place("/space/files")), null);
		assert.equal(way(place("/space/files"), place("/graph")), null);
		assert.equal(way(place("/space/deadlines"), place("/space/plugin/cards")), null);
	});
	it("stays on Home while the space behind it changes", () => {
		assert.equal(way(place("/", "a"), place("/", "b")), null);
		assert.equal(way(place("/new", "a"), place("/new", "b")), null);
	});
	it("goes from one lesson to another", () => {
		assert.equal(way(place("/chat/c1"), place("/chat/c2")), "right");
	});
});
