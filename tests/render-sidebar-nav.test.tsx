/**
 * The redesigned sidebar's chrome (2026-10-27): the class nav (active row,
 * the Files count, Files hidden under "No class"), the footer line, and
 * the class mark's initials.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ClassNav, activeNavHref } from "../components/sidebar/class-nav.tsx";
import { footerLabel } from "../components/sidebar/sidebar-footer.tsx";
import { classInitials } from "../components/class-switcher.tsx";

function nav(pathname: string, hasClass = true, fileCount = 33) {
	return renderToStaticMarkup(<ClassNav pathname={pathname} hasClass={hasClass} fileCount={fileCount} />);
}

/** The opening tag of the element carrying `testid`. */
function tag(html: string, testid: string): string {
	const m = html.match(new RegExp(`<[^>]*data-testid="${testid}"[^>]*>`));
	assert.ok(m, `expected ${testid}`);
	return m[0];
}

describe("ClassNav — Overview / Graph / Files", () => {
	it("routes: Overview → /class, Graph → /graph, Files → /class/files", () => {
		const html = nav("/");
		assert.match(tag(html, "nav-overview"), /href="\/class"/);
		assert.match(tag(html, "nav-graph"), /href="\/graph"/);
		assert.match(tag(html, "nav-files"), /href="\/class\/files"/);
	});

	it("the current page's row is active (tone block, bold, aria-current); the others are not", () => {
		const html = nav("/graph");
		const graph = tag(html, "nav-graph");
		assert.match(graph, /data-active="true"/);
		assert.match(graph, /aria-current="page"/);
		assert.match(graph, /bg-tone/);
		assert.match(graph, /font-bold/);
		for (const other of ["nav-overview", "nav-files"]) {
			assert.doesNotMatch(tag(html, other), /data-active|aria-current/);
		}
	});

	it("matching is exact: /class/files is Files, not Overview; lessons match nothing", () => {
		assert.equal(activeNavHref("/class/files"), "/class/files");
		assert.equal(activeNavHref("/class"), "/class");
		assert.equal(activeNavHref("/chat/abc"), null);
		assert.equal(activeNavHref("/"), null);
		assert.doesNotMatch(tag(nav("/class/files"), "nav-overview"), /data-active/);
	});

	it("Files shows the class's file count in mono on the right", () => {
		const html = nav("/", true, 33);
		assert.match(html, /<span data-testid="nav-files-count" class="[^"]*font-mono[^"]*tabular-nums[^"]*">33<\/span>/);
	});

	it("No class: Overview and Graph stay, Files (and its count) are hidden", () => {
		const html = nav("/class", false, 0);
		assert.ok(html.includes('data-testid="nav-overview"'));
		assert.ok(html.includes('data-testid="nav-graph"'));
		assert.ok(!html.includes('data-testid="nav-files"'));
		assert.ok(!html.includes("nav-files-count"));
	});
});

describe("footerLabel — '<agent> · N jobs'", () => {
	it("a connected agent shows its name and the running jobs", () => {
		assert.equal(footerLabel({ enabled: true, connected: true, name: "Claude Code" }, 1), "Claude Code · 1 job");
		assert.equal(footerLabel({ enabled: true, connected: true, name: "Claude Code" }, 3), "Claude Code · 3 jobs");
	});
	it("no jobs: just the agent", () => {
		assert.equal(footerLabel({ enabled: true, connected: true, name: "Codex" }, 0), "Codex");
	});
	it("connected without a known name reads 'Outside agent'", () => {
		assert.equal(footerLabel({ enabled: true, connected: true }, 0), "Outside agent");
	});
	it("nobody connected (or access off, or not loaded yet)", () => {
		assert.equal(footerLabel({ enabled: true, connected: false }, 2), "No agent connected · 2 jobs");
		assert.equal(footerLabel({ enabled: false, connected: false }, 0), "No agent connected");
		assert.equal(footerLabel(null, 0), "No agent connected");
	});
});

describe("classInitials — the class mark", () => {
	it("an acronym first word keeps its first two letters", () => {
		assert.equal(classInitials("ML Foundations"), "ML");
		assert.equal(classInitials("CSE 21"), "CS");
	});
	it("otherwise the first letters of the first two words", () => {
		assert.equal(classInitials("Linear algebra"), "LA");
		assert.equal(classInitials("  intro to proofs "), "IT");
	});
	it("one word: its first two letters; nothing: empty", () => {
		assert.equal(classInitials("Calculus"), "CA");
		assert.equal(classInitials(""), "");
		assert.equal(classInitials(null), "");
	});
});
