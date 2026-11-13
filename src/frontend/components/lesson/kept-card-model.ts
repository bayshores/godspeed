/**
 * What a kept card draws: his sentence, the phrase and the analogy lines
 * (each with whether it shows now) and the source the card links to. Pure.
 */
import { citeView, type KeptCardData } from "@/shared/core";
import type { FileCite } from "@/frontend/components/citations/page-excerpt-model";

interface KeptCardView {
	statement: string;
	/** "Remember it as SOH CAH TOA"; `shown` is false once he dropped it. */
	phrase: { line: string; shown: boolean } | null;
	/** Where the analogy fits and where it stops; `shown` is false once he dropped it. */
	analogy: { fits: string; stops: string; shown: boolean } | null;
	source: FileCite | null;
}

/** A stored source mark as the space file place it points at, or null. */
export function keptSource(mark: string | undefined): FileCite | null {
	if (!mark) return null;
	const cite = citeView(mark).cites[0];
	return cite?.kind === "file" ? cite : null;
}

/** The phrase as the card says it. */
export function phraseLine(phrase: string): string {
	return `Remember it as ${phrase}`;
}

export function keptCardView(kept: KeptCardData): KeptCardView {
	return {
		statement: kept.text,
		phrase: kept.phrase ? { line: phraseLine(kept.phrase), shown: kept.phraseDropped !== true } : null,
		analogy: kept.fits && kept.stops ? { fits: kept.fits, stops: kept.stops, shown: kept.analogyDropped !== true } : null,
		source: keptSource(kept.source),
	};
}
