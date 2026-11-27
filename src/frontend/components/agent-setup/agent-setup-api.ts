/** The setup card's requests: signing the agent in, its code, Cancel and Update. Each resolves to
 *  its error line, or null. */
import { jsonInit, send, type WriteResult } from "@/frontend/lib/api";
import { openOutside } from "@/frontend/lib/open-outside";

const post = async (url: string, body: object = {}): Promise<WriteResult> => (await send(url, jsonInit("POST", body))).error;

/** Starts the sign-in. Codex leaves opening its page to godspeed (`opens`); Claude Code opens it itself. */
export async function startLogin(opens: boolean): Promise<WriteResult> {
	const { error, body } = await send("/api/agent/login", jsonInit("POST", {}));
	const url = (body as { url?: unknown } | null)?.url;
	if (!error && opens && typeof url === "string") openOutside(url);
	return error;
}

export const sendLoginCode = (code: string): Promise<WriteResult> => post("/api/agent/login/code", { code });
export const cancelLogin = (): Promise<WriteResult> => post("/api/agent/login/cancel");
export const startUpdate = (): Promise<WriteResult> => post("/api/agent/update");
