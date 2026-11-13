/**
 * A plot and its guess in the view. The plot learns whether its guess is
 * answered (it stays locked until then), the guess learns the drawn value it
 * asked about (its card's result line), and the guess's card sits right
 * under the plot. A refused plot shows nothing: the teacher re-sends it, or
 * the guess alone. Pure and browser-safe.
 */
import type { LhViewMessage, LhViewPart } from "./view.ts";

const PLOT_PART = "tool-plot";

/** The guess a stored plot result names: its quiz call and the value asked about. */
function guessOf(output: unknown): { toolCallId: string; value: number } | null {
	const onPlot = (output as { onPlot?: { toolCallId?: unknown; value?: unknown } } | null)?.onPlot;
	if (typeof onPlot?.toolCallId !== "string" || typeof onPlot.value !== "number") return null;
	return { toolCallId: onPlot.toolCallId, value: onPlot.value };
}

/** Joins each drawn plot to its guess, in place (the view's parts are made
 *  fresh by every projection). `guessOpen` on the plot part, `plotValue`
 *  on the guess part. */
export function joinPlots(view: LhViewMessage[]): void {
	const byCall = new Map<string, LhViewPart>();
	for (const m of view) {
		m.parts = m.parts.filter((p) => !(p.type === PLOT_PART && p.state === "output-error"));
		for (const p of m.parts) if (p.toolCallId && p.state !== "moved") byCall.set(p.toolCallId, p);
	}
	for (const m of view) {
		for (const plot of [...m.parts]) {
			if (plot.type !== PLOT_PART || plot.state !== "output-available") continue;
			const of = guessOf(plot.output);
			const guess = of && byCall.get(of.toolCallId);
			if (!of || !guess) continue;
			// Answered or skipped, or closed by a later message: nothing else opens it.
			plot.guessOpen = guess.state === "output-available" || guess.state === "interrupted";
			guess.plotValue = of.value;
			const at = m.parts.indexOf(guess);
			if (at >= 0 && at < m.parts.indexOf(plot)) {
				m.parts.splice(at, 1);
				m.parts.splice(m.parts.indexOf(plot) + 1, 0, guess);
			}
		}
	}
}
