/**
 * data/agent-seen.json: what each outside agent has seen of each lesson
 * (core/agent-seen.ts). Read-modify-write; small by design (a short hash
 * per lesson, SEEN_AGENTS_MAX agents).
 */
import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../config.ts";
import { parseAgentSeen, withSeen, type AgentSeenFile, type SeenStore } from "../core/agent-seen.ts";
import { writeFileAtomic } from "./write-file-atomic.ts";

const SEEN_FILE = path.join(PATHS.data, "agent-seen.json");
const VERSION = 1;

function read(): AgentSeenFile {
	try {
		return parseAgentSeen(JSON.parse(fs.readFileSync(SEEN_FILE, "utf8")));
	} catch {
		return { agents: {} };
	}
}

function write(file: AgentSeenFile): void {
	writeFileAtomic(SEEN_FILE, JSON.stringify({ version: VERSION, ...file }, null, "\t"));
}

export const agentSeenStore: SeenStore = {
	get: (agent, conversation) => read().agents[agent]?.conversations[conversation],
	set: (agent, conversation, mark) => write(withSeen(read(), agent, conversation, mark, new Date().toISOString())),
	forgetAgent: (agent) => {
		const file = read();
		if (!file.agents[agent]) return;
		delete file.agents[agent];
		write(file);
	},
};
