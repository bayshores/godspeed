/** Which page a click is opening while its loader reads it. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Location } from "react-router";
import { hrefPage, pageBeingRead } from "../../src/frontend/components/top-bar/page-wait-model.ts";

const at = (pathname: string, search = ""): Location => ({ pathname, search, hash: "", state: null, key: "k1" });

describe("the page being read", () => {
	it("is the page a loading navigation goes to", () => {
		assert.equal(pageBeingRead({ state: "loading", location: at("/chat/c1") }, "/space")?.pathname, "/chat/c1");
	});
	it("is none while the router is idle", () => {
		assert.equal(pageBeingRead({ state: "idle" }, "/space"), null);
	});
	it("is none when the page shown is read again because its search changed", () => {
		assert.equal(pageBeingRead({ state: "loading", location: at("/chat/c1", "?lit=stop") }, "/chat/c1"), null);
	});
});

describe("the page a link leads to", () => {
	it("is its path without the search or the anchor", () => {
		assert.equal(hrefPage("/chat/c1"), "/chat/c1");
		assert.equal(hrefPage("/chat/c1#m-ab"), "/chat/c1");
		assert.equal(hrefPage("/chat/c1?prompt=x#m"), "/chat/c1");
	});
});
