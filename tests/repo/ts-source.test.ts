/** The TypeScript reader the checks in this folder stand on: a reader that misreads a comment hides real findings. */
import assert from "node:assert/strict";
import { it } from "node:test";
import { parseTs, tsComments } from "./ts-source.ts";

it("reads every comment, and none inside a string, a regex or JSX text", () => {
	const text = 'const re = /a\\/\\/b/; // one\nconst s = "// not";\n/** two */\nfunction f() { return 1; /* three */ }\nconst t = `${"/*"}`;\n// four\n';
	assert.deepEqual(tsComments(parseTs("a.ts", text)), [
		{ line: 1, text: "// one" },
		{ line: 3, text: "/** two */" },
		{ line: 4, text: "/* three */" },
		{ line: 6, text: "// four" },
	]);
	assert.deepEqual(tsComments(parseTs("a.tsx", "const a = <div>{/* jsx */}// text</div>;\n")), [{ line: 1, text: "/* jsx */" }]);
});
