import { useEffect, useImperativeHandle, useRef, useState } from "react";
import type { MathBoxHandle } from "@/frontend/components/math-box-view";

/** Keys typed in the box stay in it: Esc must not stop the turn, digits
 *  must not pick an option, Enter is the box's own. Modifier shortcuts
 *  reach the app. */
function keepKeysInBox(e: React.KeyboardEvent) {
	if (!e.metaKey && !e.ctrlKey && !e.altKey) e.stopPropagation();
}

/**
 * The writing box's text: math formats as you type. Whoever shows it
 * draws the edge around it and sets how tall it gets. CodeMirror loads on
 * mount, so server rendering shows the placeholder.
 */
export function MathBox({
	value,
	onChange,
	onEnter,
	onFocus,
	placeholder,
	ariaLabel,
	ref,
}: {
	value: string;
	onChange: (text: string) => void;
	/** Enter's action; false when it has none right now, so Enter is a newline. */
	onEnter: () => boolean;
	onFocus?: () => void;
	placeholder: string;
	ariaLabel: string;
	ref?: React.Ref<{ focus(): void }>;
}) {
	const hostRef = useRef<HTMLDivElement>(null);
	const handleRef = useRef<MathBoxHandle | null>(null);
	const [ready, setReady] = useState(false);
	const latest = useRef({ value, onChange, onEnter, placeholder, ariaLabel });
	latest.current = { value, onChange, onEnter, placeholder, ariaLabel };

	useImperativeHandle(ref, () => ({ focus: () => handleRef.current?.focus() }), []);

	// Mount once; the box reads the latest callbacks through the ref.
	useEffect(() => {
		let gone = false;
		void import("@/frontend/components/math-box-view").then(({ mountMathBox }) => {
			const host = hostRef.current;
			if (gone || !host) return;
			handleRef.current = mountMathBox(host, {
				doc: latest.current.value,
				placeholder: latest.current.placeholder,
				ariaLabel: latest.current.ariaLabel,
				onEnter: () => latest.current.onEnter(),
				onChange: (text) => {
					latest.current.value = text;
					latest.current.onChange(text);
				},
			});
			setReady(true);
		});
		return () => {
			gone = true;
			handleRef.current?.destroy();
			handleRef.current = null;
		};
	}, []);

	// A value set from outside (cleared after send, restored on failure).
	useEffect(() => {
		handleRef.current?.setValue(value);
	}, [value]);

	useEffect(() => {
		handleRef.current?.setLabels(placeholder, ariaLabel);
	}, [placeholder, ariaLabel, ready]);

	return (
		<div data-testid="math-box" onKeyDown={keepKeysInBox} onFocus={onFocus} className="lh-input relative flex w-full min-w-0 flex-1 flex-col overflow-hidden text-[16px]! leading-6! text-ink">
			{!ready && (
				<div aria-hidden className={`px-3.5 py-3 ${value ? "whitespace-pre-wrap" : "text-ink-3"}`}>
					{value || placeholder}
				</div>
			)}
			{/* CodeMirror owns this node's children. */}
			<div ref={hostRef} className="min-h-0 flex-1" />
		</div>
	);
}
