// How `req.formData()` (undici) reads the bodies the class-file routes take, for the form parser in
// crates/server/src/routes/classes.rs: multipart edge cases, URL-encoded bodies, and the bodies it
// refuses (formData() throws, the routes answer a 500). Each case keeps its content type and body
// (as hex) next to the entries undici read, or `entries: null` when it threw.
type Entry = { name: string; text?: string; fileName?: string; hex?: string };

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const crlf = (lines: string[]) => lines.join("\r\n");
const part = (disposition: string, body: string, extra: string[] = []) => crlf([`Content-Disposition: ${disposition}`, ...extra, "", body]);
const multipart = (boundary: string, parts: string[], { preamble = "", epilogue = "\r\n" } = {}) =>
	`${preamble}${parts.map((p) => `--${boundary}\r\n${p}\r\n`).join("")}--${boundary}--${epilogue}`;

const CASES: [string, string, string | Uint8Array][] = [
	["field and file", "multipart/form-data; boundary=XX", multipart("XX", [part('form-data; name="kind"', "study"), part('form-data; name="files"; filename="notes.txt"', "line one\r\nline two\r\n", ["Content-Type: text/plain"])])],
	["windows path file name", "multipart/form-data; boundary=XX", multipart("XX", [part('form-data; name="files"; filename="C:\\week 1\\a.txt"', "hi")])],
	["preamble of blank lines", "multipart/form-data; boundary=XX", multipart("XX", [part('form-data; name="kind"', "info")], { preamble: "\r\n\r\n" })],
	["quoted boundary", 'multipart/form-data; boundary="a b"', multipart("a b", [part('form-data; name="kind"', "study")])],
	["upper-case type and header", "MULTIPART/FORM-DATA; BOUNDARY=XX", multipart("XX", [part('form-data; name="kind"', "study").replace("Content-Disposition", "CONTENT-DISPOSITION")])],
	["escaped name and file name", "multipart/form-data; boundary=XX", multipart("XX", [part('form-data; name="a%22b"; filename="x%0Ay%0D%22.txt"', "z")])],
	["empty file name", "multipart/form-data; boundary=XX", multipart("XX", [part('form-data; name="files"; filename=""', "data")])],
	["duplicate names", "multipart/form-data; boundary=XX", multipart("XX", [part('form-data; name="files"; filename="a.txt"', "A"), part('form-data; name="files"; filename="b.txt"', "B"), part('form-data; name="kind"', "info")])],
	["empty part body", "multipart/form-data; boundary=XX", multipart("XX", [part('form-data; name="kind"', "")])],
	["epilogue after the end", "multipart/form-data; boundary=XX", multipart("XX", [part('form-data; name="kind"', "study")], { epilogue: "\r\ntrailing words" })],
	["no closing newline", "multipart/form-data; boundary=XX", multipart("XX", [part('form-data; name="kind"', "study")], { epilogue: "" })],
	["boundary text inside a body", "multipart/form-data; boundary=XX", multipart("XX", [part('form-data; name="files"; filename="a.txt"', "--XY not the end --X")])],
	["unicode file name", "multipart/form-data; boundary=XX", multipart("XX", [part('form-data; name="files"; filename="Übung 3 – Lösungen.txt"', "ö")])],
	["bad utf-8 in a field", "multipart/form-data; boundary=XX", Buffer.concat([Buffer.from('--XX\r\nContent-Disposition: form-data; name="kind"\r\n\r\nst'), Buffer.from([0xff, 0xfe]), Buffer.from("udy\r\n--XX--\r\n")])],
	["boundary text without dashes inside a body", "multipart/form-data; boundary=XX", multipart("XX", [part('form-data; name="files"; filename="a.txt"', "abcXXdef")])],
	["boundary text right after the headers", "multipart/form-data; boundary=XX", multipart("XX", [part('form-data; name="files"; filename="a.txt"', "XX")])],
	["base64 part", "multipart/form-data; boundary=XX", multipart("XX", [part('form-data; name="files"; filename="a.txt"', "aGVs bG8=", ["Content-Transfer-Encoding: base64"])])],
	["base64 field", "multipart/form-data; boundary=XX", multipart("XX", [part('form-data; name="kind"', "c3R1ZHk=", ["content-transfer-encoding: base64  "])])],
	["other transfer encoding", "multipart/form-data; boundary=XX", multipart("XX", [part('form-data; name="kind"', "c3R1ZHk=", ["Content-Transfer-Encoding: BASE64"])])],
	["extended file name", "multipart/form-data; boundary=XX", multipart("XX", [part("form-data; name=\"files\"; filename*=UTF-8''%C3%9Cbung%201.txt", "x")])],
	["extended file name wins", "multipart/form-data; boundary=XX", multipart("XX", [part("form-data; name=\"files\"; filename*=utf-8''real.txt; filename=\"plain.txt\"", "x")])],
	["bad extended escape", "multipart/form-data; boundary=XX", multipart("XX", [part("form-data; name=\"files\"; filename*=utf-8''%E0%A4", "x")])],
	["extended other charset", "multipart/form-data; boundary=XX", multipart("XX", [part("form-data; name=\"files\"; filename*=iso-8859-1''a.txt", "x")])],
	["unquoted name", "multipart/form-data; boundary=XX", multipart("XX", [part("form-data; name=kind", "study")])],
	["lower-case escapes", "multipart/form-data; boundary=XX", multipart("XX", [part('form-data; name="a%0ab%0dc%22"', "v")])],
	["bom in a file name", "multipart/form-data; boundary=XX", multipart("XX", [part('form-data; name="files"; filename="﻿a.txt"', "x")])],
	["bom in a field", "multipart/form-data; boundary=XX", multipart("XX", [part('form-data; name="kind"', "﻿study")])],
	["space before the header colon", "multipart/form-data; boundary=XX", multipart("XX", [part('form-data; name="kind"', "study").replace("Content-Disposition:", "Content-Disposition :")])],
	["unclosed quote", "multipart/form-data; boundary=XX", multipart("XX", [part('form-data; name="kind', "study")])],
	["junk after the attributes", "multipart/form-data; boundary=XX", multipart("XX", [part('form-data; name="kind" junk', "study")])],
	["attachment disposition", "multipart/form-data; boundary=XX", multipart("XX", [part('attachment; name="kind"', "study")])],
	["second disposition resets", "multipart/form-data; boundary=XX", multipart("XX", [crlf(['Content-Disposition: form-data; name="files"; filename="a.txt"', 'Content-Disposition: form-data; name="kind"', "", "study"])])],
	["no space in the content type", "multipart/form-data;boundary=XX", multipart("XX", [part('form-data; name="kind"', "study")])],
	["boundary with escapes", 'multipart/form-data; boundary="a\\"b"', multipart('a"b', [part('form-data; name="kind"', "study")])],
	["charset and boundary", "multipart/form-data; charset=utf-8; boundary=XX; boundary=YY", multipart("XX", [part('form-data; name="kind"', "study")])],
	["two content types", "text/plain, multipart/form-data; boundary=XX", multipart("XX", [part('form-data; name="kind"', "study")])],
	["comma inside a quoted boundary", 'multipart/form-data; boundary="X,X"', multipart("X,X", [part('form-data; name="kind"', "study")])],
	["url-encoded with a question mark", "application/x-www-form-urlencoded", "?kind=info&??x=1"],
	["url-encoded bad escapes", "application/x-www-form-urlencoded", "kind=%zz%C3&a%2Bb=%2"],
	["other headers first","multipart/form-data; boundary=XX", multipart("XX", [crlf(["Content-Type: text/plain", 'Content-Disposition: form-data; name="files"; filename="a.txt"', "", "x"])])],
	["no space after the semicolon", "multipart/form-data; boundary=XX", multipart("XX", [part('form-data;name="kind"', "study")])],
	["no name", "multipart/form-data; boundary=XX", multipart("XX", [part('form-data; filename="a.txt"', "x")])],
	["no content disposition", "multipart/form-data; boundary=XX", multipart("XX", [crlf(["Content-Type: text/plain", "", "x"])])],
	["no closing boundary", "multipart/form-data; boundary=XX", '--XX\r\nContent-Disposition: form-data; name="kind"\r\n\r\nstudy\r\n'],
	["wrong boundary", "multipart/form-data; boundary=XX", multipart("YY", [part('form-data; name="kind"', "study")])],
	["empty body", "multipart/form-data; boundary=XX", ""],
	["only the end", "multipart/form-data; boundary=XX", "--XX--\r\n"],
	["no boundary", "multipart/form-data", multipart("XX", [part('form-data; name="kind"', "study")])],
	["bare line feeds", "multipart/form-data; boundary=XX", '--XX\nContent-Disposition: form-data; name="kind"\n\nstudy\n--XX--\n'],
	["url-encoded", "application/x-www-form-urlencoded", "kind=info&name=a+b%20c&empty=&kind=study"],
	["url-encoded with a charset", "application/x-www-form-urlencoded;charset=UTF-8", "kind=%C3%BC"],
	["json", "application/json", '{"kind":"study"}'],
	["plain text", "text/plain", "kind=study"],
	["no content type", "", "kind=study"],
];

async function read(contentType: string, body: string | Uint8Array): Promise<Entry[] | null> {
	const headers = contentType ? { "content-type": contentType } : undefined;
	const req = new Request("http://127.0.0.1/api/classes/x/files", { method: "POST", headers, body: typeof body === "string" ? body : Buffer.from(body) });
	try {
		const form = await req.formData();
		const out: Entry[] = [];
		for (const [name, value] of form.entries()) {
			out.push(typeof value === "string" ? { name, text: value } : { name, fileName: value.name, hex: hex(new Uint8Array(await value.arrayBuffer())) });
		}
		return out;
	} catch {
		return null;
	}
}

export default {
	forms: async () => {
		const out = [];
		for (const [name, contentType, body] of CASES) {
			const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
			out.push({ name, contentType, hex: hex(bytes), entries: await read(contentType, bytes) });
		}
		return out;
	},
};
