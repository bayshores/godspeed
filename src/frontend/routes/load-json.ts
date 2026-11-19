import { data } from "react-router";
import { getJson } from "@/frontend/lib/api";

/** A loader's read: a 404 shows the not-found page; any other failure goes
 *  to the error page. */
export async function loadJson<T>(url: string, signal: AbortSignal): Promise<T> {
	const { error, body, status } = await getJson<T>(url, signal);
	if (status === 404) throw data(null, { status: 404 });
	if (error) throw new Error(`GET ${url}: ${status}`);
	return body as T;
}
