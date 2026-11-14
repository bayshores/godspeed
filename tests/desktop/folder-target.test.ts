import { test } from "node:test";
import assert from "node:assert/strict";
import { dataDir, terminalHeader } from "../../crates/services/folder-files/target.mjs";

test("the terminal header is sent only for an id the app made", () => {
	const before = process.env.GODSPEED_TERMINAL;
	try {
		const id = "0123456789abcdef0123456789abcdef";
		process.env.GODSPEED_TERMINAL = id;
		assert.deepEqual(terminalHeader(), { "x-godspeed-terminal": id });
		for (const odd of ["", "0123456789ABCDEF0123456789ABCDEF", "0123456789abcdef", `${id}0`, `${id}\n`, "0123456789abcdef0123456789abcdeg"]) {
			process.env.GODSPEED_TERMINAL = odd;
			assert.deepEqual(terminalHeader(), {}, JSON.stringify(odd));
		}
		delete process.env.GODSPEED_TERMINAL;
		assert.deepEqual(terminalHeader(), {});
	} finally {
		if (before === undefined) delete process.env.GODSPEED_TERMINAL;
		else process.env.GODSPEED_TERMINAL = before;
	}
});

test("an agent started outside godspeed gets both variables empty from .mcp.json and keeps the usual data folder", () => {
	const before = { terminal: process.env.GODSPEED_TERMINAL, data: process.env.GODSPEED_DATA_DIR };
	try {
		delete process.env.GODSPEED_DATA_DIR;
		const usual = dataDir();
		process.env.GODSPEED_TERMINAL = "";
		process.env.GODSPEED_DATA_DIR = "";
		assert.deepEqual(terminalHeader(), {});
		assert.ok(dataDir() === usual, dataDir());
	} finally {
		for (const [key, value] of [["GODSPEED_TERMINAL", before.terminal], ["GODSPEED_DATA_DIR", before.data]] as const) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});
