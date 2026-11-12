// The lesson store on a copy of real app data kept outside the repo (GODSPEED_SEED_CHATS).
// Only hashes and counts are recorded, never text, and the result lands in chats-seed.lab.json,
// which git ignores. Without the copy the case is null and the Rust test skips.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chatStore } from "../../../../src/backend/store/chats.ts";
import { inFolder } from "./chats-support.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const seedDir = process.env.GODSPEED_SEED_CHATS ?? path.resolve(here, "../../../../../../rewrite-lab/seed-data/chats");

const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

export default {
	"seed chats": () => {
		if (!fs.existsSync(seedDir)) return null;
		return inFolder((dir) => {
			fs.cpSync(seedDir, dir, { recursive: true });
			const names = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
			const files = names.map((name) => {
				const id = name.slice(0, -5);
				const before = fs.readFileSync(path.join(dir, name));
				const record = chatStore.getChat(id);
				const edits = [
					() => chatStore.renameChat(id, "Golden title"),
					() => chatStore.appendTurnUsage(id, { id: "golden-turn" } as never),
					() => chatStore.appendExtractionUsage(id, { startedAt: "golden-run" } as never),
					() => chatStore.saveTree(id, { nodes: [] } as never),
					() => chatStore.setChatSpace(id, "cls_golden"),
				];
				const steps = edits.map((edit) => {
					edit();
					const bytes = fs.readFileSync(path.join(dir, name));
					return { sha: sha(bytes), length: bytes.length };
				});
				const text = before.toString("utf-8");
				return { id, before: sha(before), roundTrips: JSON.stringify(JSON.parse(text), null, "\t") === text, record: record === null ? null : sha(JSON.stringify(record)), steps };
			});
			// Unrelated edits above rewrote every file; read the original list from a fresh copy.
			fs.rmSync(dir, { recursive: true, force: true });
			fs.cpSync(seedDir, dir, { recursive: true });
			const list = chatStore.listChats();
			return { count: names.length, files, list: list.map((s) => ({ id: s.id, sha: sha(JSON.stringify(s)), phase: s.phase, messageCount: s.messageCount, pendingQuestion: s.pendingQuestion, pendingProblem: s.pendingProblem, kind: s.kind })) };
		});
	},
} as Record<string, () => unknown>;
