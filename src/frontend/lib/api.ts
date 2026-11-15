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

export function jsonInit(method: string, body: unknown): RequestInit {
	return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
