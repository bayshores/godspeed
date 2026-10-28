/**
 * The BIRTH STAMP: POST /api/chats stamps every newborn lesson with the
 * outside agent's model (agent:outside-agent) — the only model since the
 * built-in sign-ins were removed (owner, 2026-10-27). Old model settings
 * in the record never reach a new lesson.
 *
 * This pin drives the actual route handler (framework-free
 * Request/Response) under an isolated LH_DATA_DIR — the seam must be set
 * before the first import that transitively loads config.ts, so every
 * app-module import is dynamic (the prompt-overrides discipline).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

// ── the seam, BEFORE any config-loading import ──────────────────────────────
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-birth-stamp-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { POST } = await import("../app/api/chats/route.ts");
const { chatStore } = await import("../src/store/chats.ts");

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

function post(): Promise<Response> {
	return POST(new Request("http://test/api/chats", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: "teach me the chain rule" }),
	}));
}

describe("POST /api/chats — the birth stamp", () => {
	it("stamps the newborn with the outside agent's model", async () => {
		const res = await post();
		assert.equal(res.status, 200);
		const { id } = (await res.json()) as { id: string };
		const record = chatStore.getChat(id);
		assert.ok(record);
		assert.deepEqual(record.settings, { model: { provider: "agent", id: "outside-agent" } });
	});

	it("an old record's model slots are ignored", async () => {
		fs.writeFileSync(
			path.join(TMP_DATA, "settings.json"),
			JSON.stringify({ version: 1, models: { strong: { model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" }, thinkingLevel: "low" } } }),
		);
		const { id } = (await (await post()).json()) as { id: string };
		assert.deepEqual(chatStore.getChat(id)?.settings, { model: { provider: "agent", id: "outside-agent" } });
	});
});
