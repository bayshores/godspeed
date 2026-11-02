import { useEffect, useImperativeHandle, useRef, useState } from "react";
import type { MathBoxHandle } from "@/components/math-box-view";

/** Keys typed in the box stay in it: Esc must not stop the turn, digits
 *  must not pick an option, Enter is the box's own. Modifier shortcuts
 *  reach the app. */
function keepKeysInBox(e: React.KeyboardEvent) {
	if (!e.metaKey && !e.ctrlKey && !e.altKey) e.stopPropagation();
}

/**
 * The writing box (thinking, answers): text where math formats as you
 * type. CodeMirror loads on mount, so server rendering shows the
 * placeholder.
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
	/** Enter's action. Absent: Enter is a newline. */
	onEnter?: () => void;
	onFocus?: () => void;
	placeholder: string;
	ariaLabel: string;
	ref?: React.Ref<{ focus(): void }>;
}) {
	const hostRef = useRef<HTMLDivElement>(null);
	const handleRef = useRef<MathBoxHandle | null>(null);
	const [ready, setReady] = useState(false);
	const latest = useRef({ value, onChange, onEnter });
	latest.current = { value, onChange, onEnter };

	useImperativeHandle(ref, () => ({ focus: () => handleRef.current?.focus() }), []);

	// Mount once; the box reads the latest callbacks through the ref.
	useEffect(() => {
		let gone = false;
		void import("@/components/math-box-view").then(({ mountMathBox }) => {
			const host = hostRef.current;
			if (gone || !host) return;
			handleRef.current = mountMathBox(host, {
				doc: latest.current.value,
				placeholder,
				ariaLabel,
				onEnter: () => {
					const action = latest.current.onEnter;
					action?.();
					return action !== undefined;
				},
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

	return (
		<div
			data-testid="math-box"
			onKeyDown={keepKeysInBox}
			onFocus={onFocus}
			className="lh-input relative flex min-h-28 w-full min-w-0 flex-1 flex-col overflow-hidden bg-background text-[15px]! leading-[22px]! text-ink"
		>
			{!ready && (
				<div aria-hidden className={value ? "whitespace-pre-wrap px-3.5 py-3" : "px-3.5 py-3 text-ink-3"}>
					{value || placeholder}
				</div>
			)}
			{/* CodeMirror owns this node's children. */}
			<div ref={hostRef} className="min-h-0 flex-1" />
		</div>
	);
}
