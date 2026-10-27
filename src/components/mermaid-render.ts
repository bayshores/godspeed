/**
 * The app's ONE mermaid renderer (the chrome-melt wave, 2026-09-19): both the
 * in-chat block (src/components/md-blocks.tsx) and the session-scoped focus
 * overlay (src/components/session-overlay.tsx) render charts through this module
 * — one dark-theme config, one plugin instance, unique render ids. This
 * REPLACES streamdown's internal mermaid path entirely: its fullscreen portal
 * was hard-wired `fixed inset-0` (covering the window-drag bar, X landing in
 * drag territory) with no styling hook, which is what drove the custom
 * component in the first place.
 */

import type { MermaidConfig } from "mermaid";

/** The chart's base font size (px) — mermaid sizes ALL text relative to
 *  this, so it's the number the display-width cap (md-blocks) divides by:
 *  a chart shown at its natural width renders text at exactly this size.
 *  Pinned explicitly so a mermaid default change can't silently shift the
 *  cap (owner rule, chrome-melt tweaks wave, 2026-09-19: chart text must
 *  never render larger than the session's own text). */
export const MERMAID_FONT_SIZE = 16;

// The app is dark-only (html.dark in the root layout) — diagrams render in
// mermaid's dark theme. (Moved from ai-elements/message.tsx when the
// renderer became app-owned; the old `mermaid` prop wiring is retired.)
export const mermaidTheme: MermaidConfig = {
	fontFamily: "ui-sans-serif, system-ui, sans-serif",
	fontSize: MERMAID_FONT_SIZE,
	securityLevel: "strict",
	theme: "dark",
};

// Mermaid is large, so it loads only when the first diagram renders
// (the dynamic import() Next documents for libraries), then stays cached.
type MermaidPlugin = ReturnType<typeof import("@streamdown/mermaid").createMermaidPlugin>;
let pluginPromise: Promise<MermaidPlugin> | null = null;
function loadPlugin(): Promise<MermaidPlugin> {
	if (!pluginPromise) {
		pluginPromise = import("@streamdown/mermaid").then((m) => m.createMermaidPlugin());
		// A failed load (a chunk fetch error) may retry on the next diagram.
		pluginPromise.catch(() => {
			pluginPromise = null;
		});
	}
	return pluginPromise;
}

/** Render one chart source to an svg string. The id is unique per call —
 *  mermaid caches rendered ids, and a repeated id across charts/renders
 *  returns the stale svg (the bug streamdown's own id minting avoids). */
export async function renderMermaid(chart: string): Promise<string> {
	const id = `lh-mermaid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
	const plugin = await loadPlugin();
	const { svg } = await plugin.getMermaid(mermaidTheme).render(id, chart);
	return svg;
}
