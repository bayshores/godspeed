import { useEffect, useImperativeHandle, useRef, useState } from "react";
import type { MathBoxHandle } from "@/frontend/components/math-box-view";
import { FIELD_EDGE } from "@/frontend/components/lesson/panel-parts";

/** Keys typed in the box stay in it: Esc must not stop the turn, digits
 *  must not pick an option, Enter is the box's own. Modifier shortcuts
 *  reach the app. */
function keepKeysInBox(e: React.KeyboardEvent) {
	if (!e.metaKey && !e.ctrlKey && !e.altKey) e.stopPropagation();
}

/**
 * The writing box (thinking, answers, the lesson's message box): text
 * where math formats as you type. CodeMirror loads on mount, so server
 * rendering shows the placeholder.
 */
export function MathBox({
	value,
	onChange,
	onEnter,
	onFocus,
	placeholder,
	ariaLabel,
	compact = false,
	autoFocus = false,
	footer,
	ref,
}: {
	value: string;
	onChange: (text: string) => void;
	/** Enter's action. Absent: Enter is a newline. */
	onEnter?: () => void;
	onFocus?: () => void;
	placeholder: string;
	ariaLabel: string;
	/** One line that grows (the side question row), its edge drawn by the row. */
	compact?: boolean;
	/** Focus once it loads. */
	autoFocus?: boolean;
	/** A row inside the box's bottom edge (attach and Send). */
	footer?: React.ReactNode;
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
		void import("@/frontend/components/math-box-view").then(({ mountMathBox }) => {
			const host = hostRef.current;
			if (gone || !host) return;
			handleRef.current = mountMathBox(host, {
				doc: latest.current.value,
				placeholder,
				ariaLabel,
				compact,
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
			if (autoFocus) handleRef.current.focus();
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
			className={`lh-input relative flex w-full min-w-0 flex-1 flex-col overflow-hidden ${compact ? "max-h-32 text-[14px]! leading-5! text-ink" : `min-h-28 ${FIELD_EDGE}`}`}
		>
			{!ready && (
				<div aria-hidden className={`${compact ? "px-3.5 py-2.5" : "px-5 py-[18px]"} ${value ? "whitespace-pre-wrap" : "text-ink-3"}`}>
					{value || placeholder}
				</div>
			)}
			{/* CodeMirror owns this node's children. */}
			<div ref={hostRef} className="min-h-0 flex-1" />
			{footer && <div className="flex shrink-0 items-center gap-2 p-2">{footer}</div>}
		</div>
	);
}
