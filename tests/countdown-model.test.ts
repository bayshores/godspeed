/**
 * The deadline countdown: "in N days" until the
 * last 24h, then HH:MM:SS, then MM:SS.hh in the last hour, "Overdue" once
 * past due; the grey → red fade over the last 24h; how fast the clock
 * must tick; and a deadline with no time being due at 23:59.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	COUNTDOWN_GREY,
	COUNTDOWN_RED,
	DAY,
	HOUR,
	MINUTE,
	SECOND,
	countdown,
	countdownColor,
	dueAtMs,
	nextWake,
	tickRate,
} from "../src/components/countdown-model.ts";

const due = new Date(2026, 9, 30, 17, 0).getTime(); // Fri Oct 30, 5:00 PM local

describe("dueAtMs", () => {
	it("is the local wall clock", () => {
		assert.equal(dueAtMs({ date: "2026-10-30", time: "17:00" }), due);
	});
	it("no time: due at 23:59 that day", () => {
		assert.equal(dueAtMs({ date: "2026-10-30" }), new Date(2026, 9, 30, 23, 59).getTime());
	});
});

describe("countdown", () => {
	it("more than 24h: whole days, rounded down, muted", () => {
		assert.deepEqual(countdown(due, due - 3 * DAY - 5 * HOUR), { mode: "days", text: "in 3 days", color: COUNTDOWN_GREY });
		assert.equal(countdown(due, due - 2 * DAY + SECOND).text, "in 1 day");
		assert.equal(countdown(due, due - DAY).text, "in 1 day", "exactly 24h left is still a day");
	});

	it("under 24h: HH:MM:SS", () => {
		const c = countdown(due, due - DAY + SECOND);
		assert.equal(c.mode, "clock");
		assert.equal(c.text, "23:59:59");
		assert.equal(countdown(due, due - (5 * HOUR + 4 * MINUTE + 3 * SECOND + 500)).text, "05:04:03");
		assert.equal(countdown(due, due - HOUR).text, "01:00:00", "exactly an hour is still the clock");
	});

	it("the last hour: MM:SS.hh, or MM:SS with reduced motion", () => {
		const c = countdown(due, due - (12 * MINUTE + 34 * SECOND + 560));
		assert.equal(c.mode, "fine");
		assert.equal(c.text, "12:34.56");
		assert.equal(countdown(due, due - (12 * MINUTE + 34 * SECOND + 560), { hundredths: false }).text, "12:34");
		assert.equal(countdown(due, due - HOUR + 1).text, "59:59.99");
		assert.equal(countdown(due, due - 10).text, "00:00.01");
	});

	it("at or past due: Overdue, red", () => {
		assert.deepEqual(countdown(due, due), { mode: "overdue", text: "Overdue", color: COUNTDOWN_RED });
		assert.equal(countdown(due, due + DAY).text, "Overdue");
	});

	it("a deadline with no time counts down to 23:59", () => {
		const noTime = dueAtMs({ date: "2026-10-30" });
		assert.equal(countdown(noTime, new Date(2026, 9, 30, 23, 0).getTime()).text, "59:00.00");
	});
});

describe("countdownColor", () => {
	it("grey at 24h left, red at 0, linear between", () => {
		assert.equal(countdownColor(DAY), COUNTDOWN_GREY);
		assert.equal(countdownColor(2 * DAY), COUNTDOWN_GREY, "clamped above 24h");
		assert.equal(countdownColor(0), COUNTDOWN_RED);
		// Halfway: (190, 105, 105).
		assert.equal(countdownColor(12 * HOUR), "#BE6969");
	});
	it("the clock carries the fade", () => {
		assert.equal(countdown(due, due - 12 * HOUR).color, "#BE6969");
	});
});

describe("tickRate", () => {
	const now = due - 3 * DAY;
	it("idle while everything is more than a day away (or past)", () => {
		assert.equal(tickRate([due, due - 5 * DAY], now, false), "idle");
		assert.equal(tickRate([], now, false), "idle");
	});
	it("every second while something is in its last 24h", () => {
		assert.equal(tickRate([due, now + 5 * HOUR], now, false), "second");
	});
	it("every frame while something is in its last hour; once a second with reduced motion", () => {
		assert.equal(tickRate([due, now + 30 * MINUTE], now, false), "frame");
		assert.equal(tickRate([now + 30 * MINUTE], now, true), "second");
	});
});

describe("nextWake", () => {
	const now = due - 3 * DAY - 5 * HOUR;
	it("wakes when the day count drops", () => {
		assert.equal(nextWake([due], now, false), due - 3 * DAY);
	});
	it("wakes when the last 24h starts", () => {
		assert.equal(nextWake([due], due - DAY - HOUR, false), due - DAY);
	});
	it("exactly N days left: a moment later", () => {
		assert.equal(nextWake([due], due - 2 * DAY, false), due - 2 * DAY + 1);
	});
	it("the next minute for a minute clock; nothing to wait for = null", () => {
		const t = new Date(2026, 9, 28, 16, 12, 30).getTime();
		assert.equal(nextWake([], t, true), new Date(2026, 9, 28, 16, 13).getTime());
		assert.equal(nextWake([], t, false), null);
		assert.equal(nextWake([t - 1], t, false), null, "past due ones never wake it");
	});
});
