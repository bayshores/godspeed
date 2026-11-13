/** The stop card renders its two lines and its buttons, one of them dark, and reports the button pressed. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { StopCard } from "../../src/frontend/components/lesson/stop-card.tsx";
import { stopCard, type StopAction } from "../../src/frontend/components/lesson/stop-card-model.ts";
import type { LessonStop } from "../../src/shared/core/index.ts";

const stop: LessonStop = { kind: "topic", at: "2026-11-18T21:48:00.000Z", nodeId: "reg", stopOf: "c1", next: "Cross-validation", activeMinutes: 48, keptGoing: false };

describe("StopCard", () => {
	it("draws line 1, line 2 and the buttons with Stop here dark", () => {
		const html = renderToStaticMarkup(<StopCard view={stopCard(stop)} onAction={() => {}} />);
		assert.match(html, /data-testid="stop-card"[\s\S]*>That finishes this topic\.<[\s\S]*>Cross-validation is next\.<[\s\S]*data-testid="stop-keep-going"[^>]*>Keep going<[\s\S]*data-testid="stop-stop-here"[^>]*>Stop here</);
		assert.doesNotMatch(/data-testid="stop-keep-going"[^>]*/.exec(html)![0], /lh-btn-main/);
		assert.match(/data-testid="stop-stop-here"[^>]*/.exec(html)![0], /lh-btn-main/);
	});

	it("leaves out a missing second line", () => {
		const html = renderToStaticMarkup(<StopCard view={stopCard({ ...stop, kind: "problem", next: null })} onAction={() => {}} />);
		assert.match(html, />That finishes this problem\.</);
		assert.equal(html.match(/<p/g)?.length, 1);
	});

	it("reports the button pressed", async () => {
		const { document, window } = parseHTML("<!doctype html><html><body></body></html>");
		Object.assign(globalThis, { window, document, IS_REACT_ACT_ENVIRONMENT: true });
		const host = document.createElement("div");
		document.body.appendChild(host);
		const pressed: StopAction[] = [];
		const root = createRoot(host as unknown as HTMLElement);
		await act(async () => root.render(<StopCard view={stopCard({ ...stop, kind: "end", next: null })} onAction={(a) => pressed.push(a)} />));
		assert.equal(host.querySelector("[data-testid='stop-done-for-today']")!.textContent, "Done for today");
		await act(async () => (host.querySelector("[data-testid='stop-done-for-today']") as unknown as HTMLElement).click());
		assert.deepEqual(pressed, ["done-for-today"]);
		await act(async () => root.unmount());
	});
});
