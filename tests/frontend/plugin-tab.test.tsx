import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Outlet, Route, Routes } from "react-router";
import { PluginTab } from "../../src/frontend/routes/plugin-tab.tsx";
import { ServerEventsProvider } from "../../src/frontend/components/server-events.tsx";
import { SpaceProvider } from "../../src/frontend/components/space-context.tsx";
import type { PluginsAt } from "../../src/frontend/lib/use-plugins-at.ts";
import type { SpaceSummary } from "../../src/shared/core/index.ts";

/** A plugin's tab on the space page: its page for a plugin that is on, the not-found page for any other id. */

const SPACE: SpaceSummary = { id: "c21", name: "CSE 21", description: "", createdAt: "", updatedAt: "", closed: false, fileCount: 3, color: 2, filesLeft: 0 };
const CARDS = { id: "cards", name: "Flashcards", label: "Cards", values: {}, manifest: { id: "cards", name: "Flashcards", version: "1.0.0", description: "", author: "x", entry: "index.html", settings: [], network: [], uses: [] } };

const quietEvents = () => ({ onEvent() {}, onOpen() {}, close() {} });

function tab(path: string, pluginsAt: Partial<PluginsAt>, active: string | null = "c21") {
	const value = { plugins: undefined, reload() {}, ...pluginsAt } as PluginsAt;
	return renderToStaticMarkup(
		<MemoryRouter initialEntries={[path]}>
			<ServerEventsProvider connect={quietEvents as never}>
				<SpaceProvider initialActive={active} initialSpaces={[SPACE]}>
					<Routes>
						<Route element={<Outlet context={value} />}>
							<Route path="space/plugin/:id" element={<PluginTab />} />
						</Route>
					</Routes>
				</SpaceProvider>
			</ServerEventsProvider>
		</MemoryRouter>,
	);
}

describe("a plugin's tab", () => {
	it("shows the plugin's page in a frame that fills the area", () => {
		const html = tab("/space/plugin/cards", { plugins: [CARDS] });
		assert.match(html, /data-testid="plugin-frame"/);
		assert.match(html, /src="\/plugin-files\/cards\/index\.html"/);
	});
	it("shows nothing while the list loads", () => {
		assert.equal(tab("/space/plugin/cards", { plugins: undefined }), "");
	});
	it("says so when the list didn't load", () => {
		assert.match(tab("/space/plugin/cards", { plugins: null }), /Couldn&#x27;t load your plugins\./);
	});
	it("an unknown or switched-off plugin is not found (a switched-off one is not in the list)", () => {
		assert.match(tab("/space/plugin/gone", { plugins: [CARDS] }), /data-testid="not-found"/);
		assert.match(tab("/space/plugin/cards", { plugins: [] }), /data-testid="not-found"/);
	});
	it("with no space open it asks for one", () => {
		assert.match(tab("/space/plugin/cards", { plugins: [CARDS] }, null), /data-testid="pick-space"/);
	});
});
