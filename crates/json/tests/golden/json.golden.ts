// JSON.parse then JSON.stringify (compact and tab-indented) on texts that probe every rule.
const texts: string[] = [
	`{"b":1,"a":2,"10":3,"2":4,"01":5,"-1":6,"4294967294":7,"4294967295":8}`,
	`{"a":1,"b":2,"a":3,"c":{"x":1,"x":2}}`,
	`[0,-0,1,-1,0.1,1e21,1e20,1e-6,1e-7,123e-20,5e-324,1.7976931348623157e308,1e400,-1e400,9007199254740993,0.30000000000000004,2.5e+3,1E2,100,12345678901234567890]`,
	`["\\ud83d\\ude00","\\ud83d","\\ude00","x\\ud83dy","\\ude00\\ud83d","\\uD83D\\uDE00","a\\u0000b","\\u001f\\u007f\\u2028\\u2029","\\/\\b\\f\\n\\r\\t\\"\\\\"]`,
	`"raw é ü 中文 😀  "`,
	` \t\n\r{ "sp" : [ 1 , 2 ] } \n`,
	`{"__proto__":{"x":1},"constructor":2,"toString":3}`,
	`{"nested":{"deep":[[[[{"a":[]}]]]],"empty":{},"list":[]}}`,
	`true`,
	`null`,
	`""`,
	`"﻿"`,
	"﻿{}",
	`{"a":1,}`,
	`[1,]`,
	`01`,
	`1.`,
	`-`,
	`{'a':1}`,
	`NaN`,
	`"tab\there"`,
	`[1] [2]`,
	`"\\x41"`,
	`"\\u12G4"`,
	``,
];

// Deterministic doubles across the whole range, written the way V8 prints them, then re-parsed.
let seed = 0x9e3779b9;
const rand = () => {
	seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
	return seed;
};
const view = new DataView(new ArrayBuffer(8));
const numbers: number[] = [];
while (numbers.length < 400) {
	view.setUint32(0, rand());
	view.setUint32(4, rand());
	const n = view.getFloat64(0);
	if (Number.isFinite(n)) numbers.push(n);
}
for (let i = 0; i < 200; i++) numbers.push((rand() % 2_000_000) / 1000 - 1000, rand() * 1e-9, rand());
texts.push(JSON.stringify(numbers));
texts.push(`[${numbers.slice(0, 50).map((n) => n.toPrecision(21)).join(",")}]`);

const cases: Record<string, () => unknown> = {};
texts.forEach((text, i) => {
	cases[`text ${i}`] = () => {
		try {
			const value = JSON.parse(text);
			return { text, compact: JSON.stringify(value), tab: JSON.stringify(value, null, "\t"), two: JSON.stringify(value, null, 2) };
		} catch {
			return { text, error: true };
		}
	};
});
export default cases;
