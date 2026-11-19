import type { ServerEventType, ServerEvents } from "@/shared/core";

/** The server events that reload a record: true for every one, or a test
 *  on its payload. */
export type ReloadOn = { [K in ServerEventType]?: true | ((payload: ServerEvents[K]) => boolean) };

export function reloads(on: ReloadOn, type: ServerEventType, payload: unknown): boolean {
	const when = on[type] as true | ((payload: unknown) => boolean) | undefined;
	return when === true || (when !== undefined && when(payload));
}

/** What was read, and from where; `url` null reads nothing. */
export interface ResourceState<T> {
	url: string | null;
	value: T | null;
	error: string | null;
}

type Read<T> = (url: string) => Promise<{ error: string | null; body: T | null }>;

/**
 * The reads of one server record, apart from React. The newest read wins;
 * a failed one keeps the last value and says why; pointing at another
 * address drops the old value at once. `update` puts in a value the page
 * already knows (a write's answer); a read still out is then dropped as
 * older, unless the update changed nothing.
 */
export function createResource<T>(read: Read<T>, publish: (state: ResourceState<T>) => void, start: ResourceState<T>) {
	let state = start;
	let request = 0;
	const set = (next: ResourceState<T>) => {
		state = next;
		publish(next);
	};
	const load = async (): Promise<void> => {
		const url = state.url;
		if (url === null) return;
		const id = ++request;
		const { error, body } = await read(url);
		if (id !== request) return;
		set(error === null ? { url, value: body, error: null } : { ...state, error });
	};
	const show = (url: string | null) => {
		if (url === state.url) return;
		request++;
		set({ url, value: null, error: null });
		void load();
	};
	const update = (change: (value: T | null) => T | null) => {
		const value = change(state.value);
		if (value === state.value) return;
		request++;
		set({ ...state, value, error: null });
	};
	return { load, show, update };
}
