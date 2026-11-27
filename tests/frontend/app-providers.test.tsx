/**
 * What every window stands on (routes/app-providers.tsx): the chat window gets the notes folder and
 * the open deadlines too, so the teacher's ideas there are made from the same facts as in the panel.
 */
import "../window-dom.ts";
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import { createRoot } from "react-dom/client";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

const { MemoryRouter } = await import("react-router");
const { AppProviders } = await import("../../src/frontend/routes/app-providers.tsx");
const { useIdeaFacts } = await import("../../src/frontend/components/teacher/use-idea-facts.ts");

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
	delete (globalThis as Record<string, unknown>).EventSource;
});

const ANSWERS: Record<string, unknown> = {
	"/api/vault": { folder: { path: "/home/ada/notes", name: "notes", short: "~/notes" }, words: "teacher", obsidian: false, vaults: [], notes: 3, capped: false, state: "ok" },
	"/api/deadlines": { deadlines: [{ id: "ddl_1", spaceId: "spc_1", title: "HW 3", due: "2030-01-01" }], doneToday: [], overdueAsked: [], gaps: [] },
};

function Facts() {
	const facts = useIdeaFacts();
	return <p data-testid="facts">{`${facts.notesFolder ? "notes folder" : "no notes folder"}, ${facts.deadlines.length} open`}</p>;
}

describe("the providers every window has", () => {
	it("give the chat window the notes folder and the open deadlines", async () => {
		(globalThis as Record<string, unknown>).EventSource = class {
			addEventListener() {}
			close() {}
		};
		globalThis.fetch = (async (url: string) => Response.json(ANSWERS[url] ?? {})) as unknown as typeof fetch;
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		try {
			await act(async () =>
				root.render(
					<MemoryRouter initialEntries={["/chat-window"]}>
						<AppProviders boot={{ onboarding: false, firstLoad: null, whatsNewSince: null, folderNotice: null, activeSpace: null, spaces: [], startupSound: false, sounds: false }}>
							<Facts />
						</AppProviders>
					</MemoryRouter>,
				),
			);
			await act(() => new Promise((r) => setTimeout(r, 20)));
			assert.equal(host.querySelector("[data-testid=facts]")?.textContent, "notes folder, 1 open");
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});
});
