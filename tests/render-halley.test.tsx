/**
 * Halley's screens (plan 2026-10-28, Phase 4): the face (one svg, every
 * mood, plain black eyes), the panel (head, Follow switch, Now, Recent,
 * Background jobs), the Follow chip, the teacher name setting, and the
 * sidebar footer opening the panel instead of the old popup.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { AgentAction } from "../src/core/events.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	IS_REACT_ACT_ENVIRONMENT: true,
	self: globalThis,
});

const { HalleyFace } = await import("../src/components/halley/halley-face.tsx");
const { HALLEY_MOODS } = await import("../src/components/halley/mood.ts");
const { HalleyPanel, agentLine, panelPlacement } = await import("../src/components/halley/halley-panel.tsx");
const { FollowChipView } = await import("../src/components/halley/follow-chip.tsx");
const { WAITING_NOTICE } = await import("../src/components/agent-status.tsx");
const { ActivitySection } = await import("../src/components/activity-dock.tsx");
const { DEFAULT_TEACHER_NAME, sanitizeTeacherName, sanitizeUserSettings, TEACHER_NAME_MAX } = await import("../src/core/settings.ts");
const { parseGeneralSettingsBody } = await import("../src/server/settings-body.ts");

let host: HTMLElement | null = null;
let root: Root | null = null;
afterEach(() => {
	act(() => root?.unmount());
	host?.remove();
	host = root = null;
});
function mount(node: React.ReactNode): HTMLElement {
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
	act(() => root!.render(node));
	return host;
}

const ACTIONS: AgentAction[] = [
	{ id: "a2", at: "2026-10-28T23:11:00.000Z", agent: "Claude Code", label: "Adding Lab 4", classId: "cls_29", target: { kind: "deadline", id: "d4" }, page: "/" },
	{ id: "a1", at: "2026-10-28T22:52:00.000Z", agent: "Claude Code", label: "Reading notes", classId: null, target: null, page: "javascript:alert(1)" },
];
const names = (id: string | null) => (id === "cls_29" ? "CSE 29" : null);

describe("the face", () => {
	it("one svg with every mood; the dot is #F2F2F2 and the eyes plain black", () => {
		const html = renderToStaticMarkup(<HalleyFace mood="idle" />);
		assert.match(html, /data-mood="idle"/);
		assert.match(html, /fill="#F2F2F2"/);
		for (const mood of HALLEY_MOODS) {
			if (mood === "talking") continue; // talking reuses the idle eyes plus the mouth
			assert.ok(html.includes(`hy-m-${mood}`), mood);
		}
		assert.doesNotMatch(html, /fill="#fff"|fill="white"/i, "no white highlights in the eyes");
	});
	it("a still copy has no motion", () => {
		assert.match(renderToStaticMarkup(<HalleyFace mood="sleepy" still />), /hy-still/);
	});
});

describe("the panel", () => {
	const panel = (over: Partial<React.ComponentProps<typeof HalleyPanel>> = {}) => (
		<HalleyPanel
			name="Halley"
			agent={{ connected: true, name: "Claude Code", pendingWork: 0 }}
			follow={false}
			onFollow={() => {}}
			nowText="Reading syllabus.pdf for CSE 29"
			recent={ACTIONS}
			onPick={() => {}}
			classNameOf={names}
			jobs={<div data-testid="jobs-slot" />}
			{...over}
		/>
	);

	it("head: the name, the agent, and the Follow switch", () => {
		const html = renderToStaticMarkup(panel());
		assert.match(html, /data-testid="halley-panel-name"[^>]*>Halley</);
		assert.match(html, /Claude Code · connected/);
		assert.match(html, /role="switch" aria-checked="false" aria-label="Follow"/);
	});
	it("no agent: the waiting notice", () => {
		assert.equal(agentLine({ connected: false, pendingWork: 0 }), WAITING_NOTICE);
		assert.equal(agentLine(null), WAITING_NOTICE);
		assert.match(renderToStaticMarkup(panel({ agent: { connected: false, pendingWork: 2 } })), new RegExp(WAITING_NOTICE));
	});
	it("Now shows what it is doing, or says nothing is happening", () => {
		assert.match(renderToStaticMarkup(panel()), /Reading syllabus\.pdf for CSE 29/);
		assert.match(renderToStaticMarkup(panel({ nowText: null })), /Nothing right now/);
	});
	it("Recent: time, label, class, and an arrow only where it can go", () => {
		const el = mount(panel());
		const rows = [...el.querySelectorAll("[data-testid='halley-recent-row']")];
		assert.equal(rows.length, 2);
		assert.match(rows[0]!.textContent ?? "", /Added Lab 4CSE 29/);
		assert.match(rows[0]!.querySelector(".font-mono")?.textContent ?? "", /^\d{1,2}:\d{2} (AM|PM)$/);
		assert.ok(rows[0]!.querySelector("svg"), "arrow");
		assert.equal(rows[1]!.hasAttribute("disabled"), true, "a page that isn't the app's is never followed");
	});
	it("Recent shows at most 8 rows", () => {
		const many = Array.from({ length: 12 }, (_, i) => ({ ...ACTIONS[0]!, id: `a${i}` }));
		const el = mount(panel({ recent: many }));
		assert.equal(el.querySelectorAll("[data-testid='halley-recent-row']").length, 8);
	});
	it("clicking a Recent row goes there; the switch turns Follow on", () => {
		const picked: string[] = [];
		const follows: boolean[] = [];
		const el = mount(panel({ onPick: (a) => picked.push(a.id), onFollow: (on) => follows.push(on) }));
		act(() => (el.querySelector("[data-testid='halley-recent-row']") as HTMLElement).click());
		act(() => (el.querySelector("[data-testid='halley-follow']") as HTMLElement).click());
		assert.deepEqual(picked, ["a2"]);
		assert.deepEqual(follows, [true]);
	});
	it("Background jobs live in the panel", () => {
		assert.match(renderToStaticMarkup(panel()), /jobs-slot/);
		const jobs = renderToStaticMarkup(<ActivitySection feed={{ jobs: [], extractions: [], failed: [{ id: "j1", kind: "pdf", chatId: "c1", title: "06_Counting.pdf", error: "The PDF could not be read", at: "2026-10-28T16:00:00Z" }] }} />);
		assert.match(jobs, /Background jobs/);
		assert.match(jobs, /data-testid="activity-failed"/);
		assert.match(jobs, /Failed: The PDF could not be read/);
	});
	it("sits above Halley in the bottom-right, aligned to its right edge", () => {
		const style = panelPlacement({ spot: { x: 1356, y: 816 }, size: 56 }, { width: 1440, height: 900 });
		assert.deepEqual({ right: style.right, bottom: style.bottom }, { right: 28, bottom: 900 - 816 + 16 });
		const high = panelPlacement({ spot: { x: 300, y: 72 }, size: 56 }, { width: 1440, height: 900 });
		assert.deepEqual({ left: high.left, top: high.top }, { left: 300, top: 72 + 56 + 16 });
	});
});

describe("the Follow chip", () => {
	it("white, 'Following <name>' with Stop", () => {
		const stops: number[] = [];
		const el = mount(<FollowChipView following name="Halley" notice={null} onStop={() => stops.push(1)} offer={null} onGo={() => {}} />);
		assert.match(el.textContent ?? "", /Following HalleyStop/);
		assert.match(el.querySelector("[data-testid='follow-chip']")!.className, /bg-ink/);
		act(() => (el.querySelector("[data-testid='follow-stop']") as HTMLElement).click());
		assert.deepEqual(stops, [1]);
	});
	it("'Stopped following' briefly, otherwise nothing", () => {
		assert.match(renderToStaticMarkup(<FollowChipView following={false} name="Halley" notice="Stopped following" onStop={() => {}} offer={null} onGo={() => {}} />), /Stopped following/);
		assert.equal(renderToStaticMarkup(<FollowChipView following={false} name="Halley" notice={null} onStop={() => {}} offer={null} onGo={() => {}} />), "");
	});
	it("with Follow off, a change on another page offers 'Go to'", () => {
		const offer: AgentAction = { id: "act_1", at: new Date().toISOString(), agent: "Claude Code", label: "Starting CSE 29 review", classId: null, target: null, page: "/chat/c1" };
		const went: AgentAction[] = [];
		const el = mount(<FollowChipView following={false} name="Halley" notice={null} onStop={() => {}} offer={offer} onGo={(a) => went.push(a)} />);
		assert.match(el.textContent ?? "", /Starting CSE 29 reviewGo to lesson/);
		act(() => (el.querySelector("[data-testid='follow-go']") as HTMLElement).click());
		assert.deepEqual(went, [offer]);
	});
});

describe("the teacher name setting", () => {
	it("defaults to Halley", () => {
		assert.equal(DEFAULT_TEACHER_NAME, "Halley");
	});
	it("is one clean line, at most 40 characters", () => {
		assert.equal(sanitizeTeacherName("  Comet\n\tthe\u0000 Great  "), "Comet the Great");
		assert.equal(sanitizeTeacherName("x".repeat(100)).length, TEACHER_NAME_MAX);
		assert.equal(sanitizeTeacherName("   "), "");
		assert.equal(sanitizeTeacherName("a‮b"), "a b", "no direction tricks");
	});
	it("the stored record keeps a clean name and drops an empty one", () => {
		assert.equal(sanitizeUserSettings({ general: { teacherName: " Nova " } })?.general?.teacherName, "Nova");
		assert.equal(sanitizeUserSettings({ general: { teacherName: "  " } })?.general?.teacherName, undefined);
		assert.equal(sanitizeUserSettings({ general: { teacherName: 5 } })?.general?.teacherName, undefined);
	});
	it("PUT general: a string is cleaned, '' clears it, anything else is refused", () => {
		const ok = parseGeneralSettingsBody({ teacherName: "  Nova\n" });
		assert.ok(ok.ok && ok.settings.teacherName === "Nova");
		const cleared = parseGeneralSettingsBody({ teacherName: "" });
		assert.ok(cleared.ok && !("teacherName" in cleared.settings));
		const bad = parseGeneralSettingsBody({ teacherName: 7 });
		assert.ok(!bad.ok && /teacherName/.test(bad.error));
	});
});
