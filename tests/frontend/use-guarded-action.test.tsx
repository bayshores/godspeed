/**
 * A clicked request: a second click while it runs does nothing, the error
 * line shows when it fails, and a closing dialog can stay busy.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { useGuardedAction } from "../../src/frontend/components/use-guarded-action.ts";

const dom = parseHTML("<!doctype html><html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true });

type Api = ReturnType<typeof useGuardedAction>;

async function withHook(options: { stayBusy?: boolean }, run: (api: () => Api) => Promise<void>) {
	let latest: Api | null = null;
	function Probe() {
		latest = useGuardedAction(options);
		return null;
	}
	const host = document.createElement("div");
	const root = createRoot(host);
	try {
		await act(async () => root.render(<Probe />));
		await run(() => latest as unknown as Api);
	} finally {
		await act(async () => root.unmount());
	}
}

function gate() {
	let open: (line: string | null) => void = () => {};
	const done = new Promise<string | null>((resolve) => (open = resolve));
	return { done, open: (line: string | null) => open(line) };
}

describe("useGuardedAction", () => {
	it("runs one request at a time and shows its error line", async () => {
		await withHook({}, async (api) => {
			const first = gate();
			let calls = 0;
			let firstRun: Promise<boolean> = Promise.resolve(false);
			let second: Promise<boolean> = Promise.resolve(true);
			await act(async () => {
				firstRun = api().run(() => (calls++, first.done));
				second = api().run(async () => (calls++, null));
			});
			assert.equal(api().busy, true);
			assert.equal(await second, false);
			await act(async () => first.open("Delete failed (500)"));
			assert.equal(await firstRun, false);
			assert.equal(calls, 1);
			assert.equal(api().busy, false);
			assert.equal(api().error, "Delete failed (500)");
			await act(async () => void (await api().run(async () => null)));
			assert.equal(api().error, null);
		});
	});

	it("stays busy after a success until reset when asked to", async () => {
		await withHook({ stayBusy: true }, async (api) => {
			await act(async () => void (await api().run(async () => null)));
			assert.equal(api().busy, true);
			assert.equal(await api().run(async () => null), false);
			await act(async () => api().reset());
			assert.equal(api().busy, false);
		});
	});
});
