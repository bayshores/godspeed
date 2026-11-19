/** JSON requests to the app server. Every request from the browser goes
 *  through `send` or `getJson`; eslint.config.mjs lists the few that cannot. */

/** A failed write's message, or null on success. */
export type WriteResult = string | null;

/** What a request came back with. `status` is 0 when the server could not be reached. */
interface Answer<T> {
	error: WriteResult;
	body: T;
	status: number;
}

/** The message in a failure's `{ error }` body, when the server sent one. */
export function serverError(body: unknown): string | undefined {
	const error = (body as { error?: unknown } | null)?.error;
	return typeof error === "string" ? error : undefined;
}

/** One request: its error message (null on success), its JSON body and status. Never throws. */
export async function send(url: string, init: RequestInit): Promise<Answer<unknown>> {
	try {
		const res = await fetch(url, init);
		const body = await res.json().catch(() => ({}));
		if (!res.ok) return { error: serverError(body) ?? `Request failed (${res.status})`, body, status: res.status };
		return { error: null, body, status: res.status };
	} catch {
		return { error: "Network error. Try again.", body: null, status: 0 };
	}
}

/** One read (GET, never cached): its error message (null on success), its
 *  JSON body, typed here and nowhere else, and its status. */
export async function getJson<T>(url: string, signal?: AbortSignal): Promise<Answer<T | null>> {
	const { error, body, status } = await send(url, { cache: "no-store", signal });
	return { error, body: error ? null : (body as T), status };
}

export function jsonInit(method: string, body: unknown): RequestInit {
	return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
