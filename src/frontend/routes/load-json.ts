import { data } from "react-router";

/** A loader's read: a 404 shows the not-found page; any other failure goes
 *  to the error page. */
export async function loadJson<T>(url: string, signal: AbortSignal): Promise<T> {
	const res = await fetch(url, { signal });
	if (res.status === 404) throw data(null, { status: 404 });
	if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
	return (await res.json()) as T;
}
