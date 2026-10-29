/**
 * The welcome screen: once per server process, and its status line.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { welcomeNeeded } from "../src/server/welcome.ts";
import { statusLine } from "../src/components/welcome/welcome-model.ts";

// Wed Oct 28 2026, 4:12 PM local.
const NOW = new Date(2026, 9, 28, 16, 12).getTime();
const on = { connected: true, name: "Claude Code" };
const midterm = (date: string, time?: string) => ({ name: "Midterm 2", date, ...(time ? { time } : {}) });

describe("welcomeNeeded", () => {
	it("is true once, then false for the rest of the launch", () => {
		assert.equal(welcomeNeeded(), true);
		assert.equal(welcomeNeeded(), false);
		assert.equal(welcomeNeeded(), false);
	});
});

describe("statusLine", () => {
	it("names the agent, or says none is connected", () => {
		assert.equal(statusLine(on, undefined, NOW), "Claude Code connected");
		assert.equal(statusLine({ connected: true }, undefined, NOW), "Your agent connected");
		assert.equal(statusLine({ connected: false, name: "Claude Code" }, undefined, NOW), "No agent connected");
	});
	it("adds the next deadline: today, tomorrow, in N days, overdue", () => {
		assert.equal(statusLine(on, midterm("2026-10-28", "23:00"), NOW), "Claude Code connected · Midterm 2 today");
		assert.equal(statusLine(on, midterm("2026-10-29"), NOW), "Claude Code connected · Midterm 2 tomorrow");
		assert.equal(statusLine(on, midterm("2026-10-31"), NOW), "Claude Code connected · Midterm 2 in 3 days");
		assert.equal(statusLine(on, midterm("2026-10-28", "09:00"), NOW), "Claude Code connected · Midterm 2 overdue");
	});
});
