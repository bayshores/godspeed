/** The godspeed folder on the server, and the agent that runs the lessons. */
import { isFolderAgent, type FolderAgent } from "@/shared/core";
import { jsonInit, send, serverError, type WriteResult } from "@/frontend/lib/api";
import { readStorage, writeStorage } from "@/frontend/lib/storage";
import type { FolderView } from "./agent-folder-model";

/** Where an older godspeed kept the agent last started, in the window. */
const OLD_AGENT_KEY = "lh-folder-agent";
const UNREACHABLE = "Couldn't reach godspeed. Try again.";

/** The folder's writes. Each resolves to its error line (null on success) and hands the folder
 *  as it is then to `keep`. */
export function folderWriters(keep: (view: FolderView) => void) {
	const change = async (method: "POST" | "PATCH", body: object): Promise<WriteResult> => {
		const { error, body: answer } = await send("/api/agent-folder", jsonInit(method, body));
		if (error) return serverError(answer) ?? UNREACHABLE;
		keep(answer as FolderView);
		return null;
	};
	return {
		post: (body: object) => change("POST", body),
		/** The agent that runs the lessons, picked. */
		pick: (agent: FolderAgent) => change("PATCH", { agent }),
		/** The model `agent`'s new lessons start on; null: the agent's own default. */
		pickModel: (agent: FolderAgent, model: string | null) => change("PATCH", { model: { [agent]: model } }),
	};
}

/** The agent an older godspeed kept in the window goes to the server once, with `pick`, and
 *  leaves the window; the server's is the only one from then on. A send that fails keeps it for
 *  the next start. */
export async function sendOldAgent(pick: (agent: FolderAgent) => Promise<WriteResult>): Promise<WriteResult> {
	const old = readStorage(OLD_AGENT_KEY);
	const failed = isFolderAgent(old) ? await pick(old) : null;
	if (failed === null && old !== null) writeStorage(OLD_AGENT_KEY, null);
	return failed;
}
