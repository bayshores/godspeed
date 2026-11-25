/** The setup card's requests: signing the agent in, its code, Cancel, Update, and opening a page
 *  outside godspeed. Each resolves to its error line, or null. */
import { jsonInit, send, type WriteResult } from "@/frontend/lib/api";

const post = async (url: string, body: object = {}): Promise<WriteResult> => (await send(url, jsonInit("POST", body))).error;

/** Opens a web page in the browser (the desktop app's shell, else a new tab). */
function openOutside(url: string): void {
	if (window.lh?.openLink) void window.lh.openLink(url);
	else window.open(url, "_blank", "noopener,noreferrer");
}

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
