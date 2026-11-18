import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Fit } from "./fit";

/**
 * A page's own place in the top bar. The bar draws two hosts: the crumb,
 * which joins the lit tab ("CSE 21 › Work on HW6"), and the actions, on the
 * bar's right after the live pill. A page fills them with BarCrumb and
 * BarActions; its words stay the page's own components, with its state,
 * and leave the bar with the page.
 */

/** A crumb's name keeps this many letters. */
const CRUMB_LETTERS = 12;

interface Slots {
	crumb: HTMLElement | null;
	actions: HTMLElement | null;
	setCrumb: (node: HTMLElement | null) => void;
	setActions: (node: HTMLElement | null) => void;
}

const SlotsContext = createContext<Slots | null>(null);

/** Around the bar and the page, so both reach the hosts. */
export function BarSlotsProvider({ children }: { children: ReactNode }) {
	// State, not refs: a page's words render once the host they go into is drawn.
	const [crumb, setCrumb] = useState<HTMLElement | null>(null);
	const [actions, setActions] = useState<HTMLElement | null>(null);
	const slots = useMemo(() => ({ crumb, actions, setCrumb, setActions }), [crumb, actions]);
	return <SlotsContext.Provider value={slots}>{children}</SlotsContext.Provider>;
}

/** The callback refs the bar puts on its two hosts. */
export function useBarHosts() {
	const slots = useContext(SlotsContext);
	return { crumbRef: slots?.setCrumb, actionsRef: slots?.setActions };
}

/** What the page adds to the lit tab, after a "›". Nothing while no tab is lit. */
export function BarCrumb({ children }: { children: ReactNode }) {
	const host = useContext(SlotsContext)?.crumb;
	if (!host) return null;
	return createPortal(
		<>
			<span aria-hidden className="shrink-0">
				›
			</span>
			{children}
		</>,
		host,
	);
}

/** A name in the crumb: cut short with an ellipsis as the bar narrows, never below its first letters. */
export function CrumbName({ text }: { text: string }) {
	return <Fit text={text} least={text.slice(0, CRUMB_LETTERS)} />;
}

/** The page's words on the bar's right, after the live pill. */
export function BarActions({ children }: { children: ReactNode }) {
	const host = useContext(SlotsContext)?.actions;
	return host ? createPortal(children, host) : null;
}
