import { Component, createRef, type ReactNode } from "react";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { wayBetween, type Place, type Way } from "./travel-model";
import { stillCopy, type StillCopy } from "./still-copy";

interface Props {
	place: Place;
	children: ReactNode;
}

interface Leaving {
	way: Way;
	copy: StillCopy;
}

/**
 * The pages lie side by side. When the page changes, a still copy of the old
 * one leaves while the new one arrives (globals.css moves them): side by
 * side in the order of the tabs, or a deeper page laid on top from the
 * bottom edge. A class, because only getSnapshotBeforeUpdate sees the old
 * page before React replaces it.
 */
export class Travel extends Component<Props> {
	private readonly root = createRef<HTMLDivElement>();
	private readonly page = createRef<HTMLDivElement>();
	private readonly old = createRef<HTMLDivElement>();
	/** Counts travels, so an ended one never clears a later one. */
	private travel = 0;

	getSnapshotBeforeUpdate(prev: Props): Leaving | null {
		const way = wayBetween(prev.place, this.props.place);
		const page = this.page.current;
		// With motion off the new page is just there. A page inside a traveling page does not travel too.
		if (!way || !page || prefersReducedMotion() || this.root.current?.parentElement?.closest(".lh-travel[data-way]")) return null;
		this.rest();
		return { way, copy: stillCopy(page) };
	}

	componentDidUpdate(_props: Props, _state: unknown, leaving: Leaving | null) {
		const root = this.root.current;
		const page = this.page.current;
		const old = this.old.current;
		if (!leaving || !root || !page || !old) return;
		old.replaceChildren(leaving.copy.node);
		root.dataset.way = leaving.way;
		leaving.copy.scroll();
		const travel = ++this.travel;
		// Where nothing moves, the copy is gone before it is drawn.
		const moving = [old, page].flatMap((el) => el.getAnimations?.() ?? []);
		void Promise.allSettled(moving.map((a) => a.finished)).then(() => {
			if (travel === this.travel) this.rest();
		});
	}

	componentWillUnmount() {
		this.rest();
	}

	private rest() {
		this.travel++;
		this.old.current?.replaceChildren();
		this.root.current?.removeAttribute("data-way");
	}

	render() {
		return (
			<div ref={this.root} className="lh-travel">
				<div ref={this.page} className="lh-travel-page">
					{this.props.children}
				</div>
				{/* After the page, so a search of the document finds the live page first. */}
				<div ref={this.old} aria-hidden inert className="lh-travel-old" />
			</div>
		);
	}
}
