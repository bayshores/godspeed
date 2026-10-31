/**
 * The dispatch card's elapsed seconds count up while the job runs, with no
 * new jobs data.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { DispatchCard } from "../src/components/artifacts/dispatch-card.tsx";
import { JobsContext } from "../src/components/jobs-context.ts";
import type { JobRecord } from "../src/core/contracts.ts";

const dom = parseHTML("<!doctype html><html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	IS_REACT_ACT_ENVIRONMENT: true,
});

describe("DispatchCard elapsed", () => {
	it("ticks every second while the job runs", async () => {
		mock.timers.enable({ apis: ["setInterval", "Date"], now: 1_000_000 });
		const started = new Date(1_000_000).toISOString();
		const job: JobRecord = { id: "j1", kind: "research", chatId: "c1", toolCallId: "t1", status: "running", activity: "", createdAt: started, updatedAt: started };
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		try {
			await act(async () =>
				root.render(
					<JobsContext.Provider value={[job]}>
						<DispatchCard toolCallId="t1" kind="research" />
					</JobsContext.Provider>,
				),
			);
			assert.match(host.textContent ?? "", /· 0s/);
			await act(async () => mock.timers.tick(5000));
			assert.match(host.textContent ?? "", /· 5s/);
		} finally {
			await act(async () => root.unmount());
			host.remove();
			mock.timers.reset();
		}
	});
});
