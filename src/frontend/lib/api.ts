/** JSON requests to the app server. */

/** A failed write's message, or null on success. */
export type WriteResult = string | null;

/** One request: its error message (null on success) and its JSON body. */
export async function send(url: string, init: RequestInit): Promise<{ error: WriteResult; body: unknown }> {
	try {
		const res = await fetch(url, init);
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		if (!res.ok) return { error: body.error ?? `Request failed (${res.status})`, body };
		return { error: null, body };
	} catch {
		return { error: "Network error. Try again.", body: null };
	}
}

/** One read (GET, never cached): its error message (null on success) and
 *  its JSON body, typed here and nowhere else. */
export async function getJson<T>(url: string): Promise<{ error: WriteResult; body: T | null }> {
	const { error, body } = await send(url, { cache: "no-store" });
	return { error, body: error ? null : (body as T) };
}

export function jsonInit(method: string, body: unknown): RequestInit {
	return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
