import { useEffect, useState } from "react";
import type { ServerEventType } from "@/shared/core";
import { getJson } from "@/frontend/lib/api";
import { useTrailing } from "@/frontend/lib/use-trailing";
import { useServerEvents, useServerResync } from "./server-events";
import { createResource, reloads, type ReloadOn, type ResourceState } from "./server-resource-model";

interface ResourceOptions<T> {
	/** The server events that read it again. */
	on?: ReloadOn;
	/** Wait this long after the last of a burst of events before reading. */
	debounceMs?: number;
	/** What the page's loader already read from `url`, so it is not read again on mount. */
	initial?: T;
}

/**
 * One record from the server (GET `url`; null reads nothing), read on
 * mount, when `url` changes, on the events in `on` and after the events
 * channel reconnects. A failed read keeps the last value and sets `error`.
 */
export function useServerResource<T>(url: string | null, { on = {}, debounceMs, initial }: ResourceOptions<T> = {}): {
	value: T | null;
	error: string | null;
	reload: () => Promise<void>;
	/** Change the value the page holds, without a read (a write's answer). */
	update: (change: (value: T | null) => T | null) => void;
} {
	const [state, setState] = useState<ResourceState<T>>(() => ({ url: initial === undefined ? null : url, value: initial ?? null, error: null }));
	const [resource] = useState(() => createResource<T>((at) => getJson<T>(at), setState, state));
	useEffect(() => resource.show(url), [resource, url]);
	const later = useTrailing(resource.load, debounceMs ?? 0);
	useServerEvents(Object.keys(on) as ServerEventType[], (type, payload) => {
		if (reloads(on, type, payload)) void (debounceMs === undefined ? resource.load() : later());
	});
	useServerResync(() => void resource.load());
	const current = state.url === url;
	return { value: current ? state.value : null, error: current ? state.error : null, reload: resource.load, update: resource.update };
}
