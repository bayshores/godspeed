import { lazy, Suspense, type ComponentType } from "react";

/** A component whose code loads on its first render; until then it draws
 *  nothing, so the page around it never waits or flashes a fallback. */
export function lazyComponent<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> {
	const Loaded = lazy(async () => ({ default: await load() }));
	return function LazyComponent(props: P) {
		return (
			<Suspense fallback={null}>
				<Loaded {...props} />
			</Suspense>
		);
	};
}
