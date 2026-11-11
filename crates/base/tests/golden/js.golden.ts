// What Node's String, Number, Date, RegExp and localeCompare give for the inputs gs-base copies.
const strings = ["", "a", "😀", "a😀b", "x\ud83d", "\ud83dx", "  pad ﻿", "\u0085x\u0085", "é中文😀😀z", "line\nbreak\r\n"];
const cuts: [number, number | undefined][] = [[0, 1], [0, 2], [1, 3], [-1, undefined], [-3, -1], [2, 1], [5, 99], [-99, 2]];

const numbers = [0, -0, 0.5, 1.5, 2.5, -2.5, -0.5, 0.49999999999999994, 1.005, 1.125, -1.125, 1.45, 10 / 3, 123.456, 1e21, 1e-7, 0.000001, 99.995, 4.35, 1536 / 1024];
const dates = ["2026-11-09T20:00:00.000Z", "2026-11-09", "2026-02-30", "2026-11-09T10:00", "2026-11-09T10:00:00", "2026-03-08T02:30", "2026-11-01T01:30", "2026-11-09T10:00:00.5+01:00", "2026", "bad", "2026-11-09T25:00"];
const sortable = ["b", "a", "B", "_", "A", "é", "e", "10", "9", "lec10.pdf", "Lec2.pdf", "lec9.pdf", "ä", "z", "Zebra", "apple", "Äpple", "-x", " x", "x-y", "xy", "2026-11-09", "2026-11-10T00:00:00.000Z"];
const regexCases: [string, string, string, string][] = [
	["(\\w)(\\d)?", "g", "a1 b", "[$2$1$$$&]"],
	["o", "g", "foo", "$`|$'"],
	["x*", "g", "ab", "-"],
	["\\s+", "g", " a ﻿b\tc ", "_"],
	["\\b", "g", "ab cd", "|"],
	["(?<!\\d)(20\\d{2})", "", "x2026 12026", "<$1>"],
	["^", "gm", "a\nb", "> "],
	[".", "g", "a\nb c", "."],
	["[^\\x00-\\x7f]", "g", "aé😀", "?"],
];

const cases: Record<string, () => unknown> = {
	strings: () =>
		strings.map((s) => ({
			s,
			length: s.length,
			slices: cuts.map(([a, b]) => s.slice(a, b)),
			trim: [s.trim(), s.trimStart(), s.trimEnd()],
			indexOf: [s.indexOf("😀"), s.indexOf("z"), s.lastIndexOf("😀")],
			hex: Buffer.from(s).toString("hex"),
		})),
	numbers: () => numbers.map((n) => ({ n, round: Math.round(n), fixed: [0, 1, 2].map((d) => n.toFixed(d)), text: String(n) })),
	dates: () => dates.map((d) => ({ d, parsed: Date.parse(d) || null, iso: Number.isNaN(Date.parse(d)) ? null : new Date(Date.parse(d)).toISOString() })),
	sorted: () => [...sortable].sort((a, b) => a.localeCompare(b)),
	sortedNumeric: () => [...sortable].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
	regex: () =>
		regexCases.map(([source, flags, text, replacement]) => ({
			source,
			flags,
			text,
			replacement,
			replaced: text.replace(new RegExp(source, flags), replacement),
			split: text.split(new RegExp(source, flags.replace("g", ""))),
			test: new RegExp(source, flags.replace("g", "")).test(text),
		})),
};
export default cases;
