/**
 * Values the browser and the Rust server each hold a copy of. A change on one
 * side only fails here. Each Rust value is read from its source file as text.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENTS } from "../../src/shared/core/attachments.ts";
import { MAX_LINKED_FILES, SIGNATURE_MAX, SPACE_ICONS, SUPPORTED_SPACE_FILE_EXTENSIONS } from "../../src/shared/core/contracts/space.ts";
import { isQuestionTool } from "../../src/shared/core/pending.ts";
import { subscriptionLabel } from "../../src/shared/core/prices.ts";
import { RAMP_COLORS, rampColor, tally, topicStatus } from "../../src/shared/core/progress.ts";
import { DONT_KNOW } from "../../src/shared/core/question-grading.ts";
import { FACTORY_SETTINGS } from "../../src/shared/core/settings.ts";
import { TOOL_SWITCH_LABELS } from "../../src/shared/core/tool-switches.ts";
import { APP_ICONS } from "../../src/frontend/components/settings/appearance-model.ts";
import { FIGURE_COLORS } from "../../src/frontend/components/artifacts/figure-model.ts";
import { PIECE_WIDTHS } from "../../src/frontend/components/citations/page-piece-model.ts";
import { MAX_LESSON_FILES } from "../../src/frontend/components/files/files-pick-model.ts";
import { VAULT_WORDS } from "../../src/frontend/components/vault/vault-model.ts";
import { TITLE_CUT } from "../../src/frontend/components/lesson/wait-model.ts";
import { HELP_LINES } from "../../src/frontend/components/lesson/lesson-box-model.ts";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf-8");
const ts = (name: string) => read(`src/shared/core/${name}.ts`);
const rust = (path: string) => read(`crates/core/src/${path}.rs`);

/** What follows `= ` in `const NAME ... = <value>;`, in either language. */
function valueOf(source: string, name: string): string {
	const found = new RegExp(`const ${name}\\b[^=]*=([\\s\\S]*?);\\s*$`, "m").exec(source)?.[1];
	assert.ok(found !== undefined, `no const ${name} found`);
	return found.trim();
}
const quoted = (text: string) => [...text.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!);
function strings(source: string, name: string): string[] {
	const found = quoted(valueOf(source, name));
	assert.ok(found.length > 0, `const ${name} holds no text`);
	return found;
}
const number = (source: string, name: string) => Number(valueOf(source, name).replaceAll("_", ""));

describe("question tools", () => {
	it("are the same names", () => {
		const names = strings(rust("messages/pending"), "QUESTION_TOOLS");
		assert.deepEqual(strings(ts("pending"), "QUESTION_TOOLS"), names);
		for (const name of names) assert.equal(isQuestionTool(name), true, name);
	});
});

describe("the figure tool", () => {
	it("is the same name", () => {
		assert.deepEqual(strings(ts("native-messages"), "VISUAL_TOOL"), strings(rust("session/tool_switches"), "VISUAL_TOOL"));
	});
});

describe("why a lesson's turn runs", () => {
	it("is the same causes in the same order", () => {
		assert.deepEqual(strings(ts("contracts/lesson-work"), "TURN_CAUSES"), strings(rust("session/turn_cause"), "TURN_CAUSES"));
	});
});

describe("the Stuck? keys' lines", () => {
	it("are the lines the server reads as asks, not work on the problem", () => {
		assert.deepEqual(Object.values(HELP_LINES), strings(rust("session/turn_cause"), "HELP_LINES"));
	});

	it("include the I don't know line, which the server reads as a go-ahead", () => {
		assert.deepEqual([DONT_KNOW], strings(rust("session/turn_cause"), "DONT_KNOW"));
	});
});

describe("what a permission question is about", () => {
	it("is the same kinds in the same order", () => {
		assert.deepEqual(strings(ts("contracts/lesson-work"), "APPROVAL_SUBJECTS"), strings(rust("session/approval_card"), "APPROVAL_SUBJECTS"));
	});
});

describe("a lesson title cut short", () => {
	it("ends with the mark the lesson page looks for", () => {
		assert.ok(rust("contracts/graph").includes(`format!("{}${TITLE_CUT}"`));
	});
});

describe("who writes a note", () => {
	it("is the same two values", () => {
		assert.deepEqual([...VAULT_WORDS], strings(rust("records/settings"), "VAULT_WORDS"));
	});
});

describe("plan labels", () => {
	it("are the same prefixes and labels", () => {
		const pairs = strings(rust("session/prices"), "PLAN_LABELS");
		assert.deepEqual(strings(ts("prices"), "PLAN_LABELS"), pairs);
		for (let i = 0; i < pairs.length; i += 2) assert.equal(subscriptionLabel(`${pairs[i]}model`), pairs[i + 1]);
	});
});

describe("tool switches", () => {
	const source = rust("session/tool_switches");
	it("the toggleable tools are the same", () => {
		const names = strings(source, "TOGGLEABLE_TOOLS");
		assert.deepEqual(strings(ts("tool-switches"), "TOGGLEABLE_TOOLS"), names);
		assert.deepEqual(Object.keys(TOOL_SWITCH_LABELS), names);
	});
	it("the switch labels are the same", () => {
		const match = /fn switch_label[\s\S]*?\{\s*match tool \{([\s\S]*?)_ =>/.exec(source)?.[1] ?? "";
		const pairs = Object.fromEntries([...match.matchAll(/"(\w+)" => "([^"]+)"/g)].map((m) => [m[1]!, m[2]!]));
		assert.ok(Object.keys(pairs).length > 0);
		assert.deepEqual(TOOL_SWITCH_LABELS, pairs);
	});
});

describe("a figure's colors", () => {
	it("are the same names, in order", () => {
		assert.deepEqual([...FIGURE_COLORS], strings(read("crates/agent/src/tools/visual.rs"), "FIGURE_COLORS"));
	});
});

describe("space limits", () => {
	const source = rust("contracts/space");
	it("signature length and linked file count are the same", () => {
		assert.equal(SIGNATURE_MAX, number(source, "SIGNATURE_MAX"));
		assert.equal(MAX_LINKED_FILES, number(source, "MAX_LINKED_FILES"));
	});
	it("the subject icons are the same, in order", () => {
		const inRust = [...valueOf(source, "SPACE_ICONS").matchAll(/\("([\w-]+)", "([^"]+)"\)/g)].map((m) => [m[1], m[2]]);
		assert.ok(inRust.length > 0);
		assert.deepEqual(Object.entries(SPACE_ICONS), inRust);
	});
	it("the supported file extensions are the same, in order", () => {
		const inRust = ["TEXT", "CODE", "DOCUMENT", "TRANSCRIPT", "RECORDING"].flatMap((kind) => strings(source, `${kind}_EXTENSIONS`));
		assert.deepEqual([...SUPPORTED_SPACE_FILE_EXTENSIONS], inRust);
	});
});

describe("attachment limits", () => {
	const inRust = rust("messages/attachments");
	const inTs = ts("attachments");
	it("the count is the same", () => {
		assert.equal(MAX_ATTACHMENTS, number(inRust, "MAX_ATTACHMENTS"));
	});
	it("the size limits are the same", () => {
		for (const name of ["MAX_IMAGE_BYTES", "MAX_PDF_BYTES"]) assert.equal(valueOf(inTs, name), valueOf(inRust, name), name);
	});
	it("the accepted types are the same", () => {
		for (const name of ["IMAGE_TYPES", "HEIC_TYPES", "PDF_TYPE"]) assert.deepEqual(strings(inTs, name), strings(inRust, name), name);
		assert.equal(ATTACHMENT_ACCEPT, [...strings(inRust, "IMAGE_TYPES"), ...strings(inRust, "PDF_TYPE")].join(","));
	});
	it("the refusals are the same words", () => {
		assert.deepEqual(strings(inTs, "HEIC_REFUSAL"), strings(inRust, "HEIC_REFUSAL"));
		const tooMany = valueOf(inTs, "TOO_MANY_REFUSAL").replaceAll("`", "").replace("${MAX_ATTACHMENTS}", String(MAX_ATTACHMENTS));
		assert.equal(tooMany, strings(inRust, "TOO_MANY_REFUSAL")[0]);
	});
});

describe("progress thresholds", () => {
	it("a hinted answer counts the same", () => {
		const weight = Number(/const HINTED_WEIGHT: f64 = ([\d.]+);/.exec(rust("study/answers"))?.[1]);
		assert.equal(tally([{ outcome: "hinted" }]).rate, weight);
	});
	it("the status cut-offs are the same", () => {
		const body = /fn topic_status[\s\S]*?\n\}/.exec(rust("study/progress"))?.[0] ?? "";
		const [strong, shaky] = [...body.matchAll(/r >= ([\d.]+)/g)].map((m) => Number(m[1]));
		assert.equal(strong, 0.85);
		assert.equal(shaky, 0.55);
		assert.equal(topicStatus(strong!), "strong");
		assert.equal(topicStatus(strong! - 0.001), "shaky");
		assert.equal(topicStatus(shaky!), "shaky");
		assert.equal(topicStatus(shaky! - 0.001), "weak");
		assert.equal(topicStatus(null), "untested");
	});
	it("the colour steps are the same", () => {
		const limits = /fn ramp_color[\s\S]*?\[([\d., ]+)\]\.iter/.exec(rust("study/progress"))?.[1]?.split(",").map(Number) ?? [];
		assert.equal(limits.length, RAMP_COLORS.length - 1);
		limits.forEach((limit, i) => {
			assert.equal(rampColor(limit - 0.001), RAMP_COLORS[i]);
			assert.equal(rampColor(limit), RAMP_COLORS[i + 1]);
		});
	});
});

describe("factory settings", () => {
	it("the defaults the browser reads are the ones the server sends", () => {
		const source = rust("records/settings");
		const teacherName = /DEFAULT_TEACHER_NAME: &str = "([^"]+)"/.exec(source)?.[1];
		const general = /"general": \{([^}]*)\}/.exec(source)?.[1] ?? "";
		const inRust = Object.fromEntries([...general.matchAll(/"(\w+)": (true|false|"[^"]*"|DEFAULT_TEACHER_NAME)/g)].map((m) => [m[1]!, m[2] === "DEFAULT_TEACHER_NAME" ? teacherName : JSON.parse(m[2]!)]));
		assert.deepEqual(FACTORY_SETTINGS.general, inRust);
		assert.equal(/"graph": \{ "enabled": (true|false)/.exec(source)?.[1], String(FACTORY_SETTINGS.graph.enabled));
		assert.match(source, /"background": null,\s*"fontFamily": null/);
		assert.deepEqual(FACTORY_SETTINGS.appearance, { background: null, fontFamily: null });
	});
});

describe("app icons", () => {
	it("have the same names in Settings, on the server, in the Mac shell and as picture files", () => {
		const offered = APP_ICONS.flatMap(({ icon }) => (icon === null ? [] : [icon]));
		assert.deepEqual(strings(rust("records/settings"), "APP_ICONS"), offered);
		const shell = read("crates/shell/src/mac/app_icon.rs");
		assert.deepEqual([...shell.matchAll(/icons\/choices\/(\w+)\.png/g)].map((m) => m[1]), offered);
		assert.deepEqual([...shell.matchAll(/\("(\w+)", include_bytes/g)].map((m) => m[1]), offered);
		for (const picture of ["graphite", ...offered]) assert.ok(read(`public/app-icons/${picture}.svg`).startsWith("<svg"), picture);
	});
});

describe("files the page ships", () => {
	it("each have a type the server sends them as", () => {
		const types = read("crates/server/src/http/ui.rs");
		const files = readdirSync(new URL("../../public", import.meta.url), { recursive: true, encoding: "utf-8" });
		for (const file of files.filter((name) => name.includes("."))) assert.ok(types.includes(`"${file.slice(file.lastIndexOf("."))}" =>`), file);
	});
});

describe("files one lesson works from", () => {
	it("are as many on the Files page as the server takes", () => {
		assert.equal(MAX_LESSON_FILES, number(read("crates/services/src/turns/files_lesson.rs"), "MAX_LESSON_FILES"));
	});
});

describe("page picture widths", () => {
	it("are the same steps", () => {
		const inRust = read("crates/services/src/app/reading_pages.rs");
		assert.deepEqual([...PIECE_WIDTHS], [...valueOf(inRust, "PIECE_WIDTHS").matchAll(/\d+/g)].map((m) => Number(m[0])));
	});
});

describe("the Claude helper's tool server", () => {
	it("is the name godspeed's tools are told apart by", () => {
		const helper = read("crates/runtime/src/claude/claude-helper.mjs");
		const protocol = read("crates/runtime/src/claude/protocol.rs");
		assert.deepEqual(strings(helper, "TOOL_SERVER"), strings(protocol, "TOOL_SERVER"));
	});
});

/** The text each `Type::Variant => "text"` arm gives, in order: a variant may hold data, and the
 *  text may lead a tuple (`=> ("text", …)`). */
const arms = (source: string, type: string) => [...source.matchAll(new RegExp(`${type}::\\w+(?:\\([^)]*\\))? => \\(?"([^"]+)"`, "g"))].map((m) => m[1]!);

describe("the agent's setup", () => {
	const contract = ts("contracts/agent-health");
	const health = read("crates/runtime/src/health.rs");
	it("names the same checks, in the card's order", () => {
		assert.deepEqual(strings(contract, "AGENT_CHECKS"), arms(health, "Check"));
	});
	it("names the same problems", () => {
		assert.deepEqual(strings(contract, "AGENT_PROBLEMS"), arms(health, "Problem"));
	});
	it("names the same states of a check", () => {
		assert.deepEqual(strings(contract, "CHECK_STATES"), arms(read("crates/services/src/app/agent_health.rs"), "Outcome"));
	});
	it("names the same states of an update", () => {
		assert.deepEqual(strings(contract, "UPDATE_STATES"), arms(read("crates/services/src/app/agent_update.rs"), "Stage"));
	});
});
