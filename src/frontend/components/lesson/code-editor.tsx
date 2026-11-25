import { useEffect, useRef, useState, type ReactNode } from "react";
import { SmallSwitch } from "@/frontend/components/ui/small-switch";
import { readStorage, writeStorage } from "@/frontend/lib/storage";
import type { CodeEditorHandle } from "./code-editor-view";
import { VIM_KEY, languageLabel, parseVim } from "./code-editor-model";

/** Keys typed in the editor belong to it (and to Vim): Esc must not stop
 *  the turn, Tab must not jump fields, Ctrl keys are Vim's. Only ⌘ shortcuts
 *  reach the app. */
function keepKeysInEditor(e: React.KeyboardEvent) {
	if (!e.metaKey) e.stopPropagation();
}

/**
 * A code editor as tall as the box it is given: the language (or `tools`) over a CodeMirror field, with
 * the Vim switch (and Vim's mode while it is on) in the corner. CodeMirror
 * loads on mount, so server rendering shows the empty field.
 */
export function CodeEditor({
	initialCode,
	language,
	onChange,
	tools,
}: {
	initialCode: string;
	language: string;
	onChange: (code: string) => void;
	/** In place of the language's name (a mock's language pick). */
	tools?: ReactNode;
}) {
	const hostRef = useRef<HTMLDivElement>(null);
	const handleRef = useRef<CodeEditorHandle | null>(null);
	const [vim, setVim] = useState(false);
	const vimRef = useRef(false);
	const [mode, setMode] = useState("NORMAL");
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;

	// Mount once per question (the form remounts for each one).
	useEffect(() => {
		vimRef.current = parseVim(readStorage(VIM_KEY));
		setVim(vimRef.current);
		let gone = false;
		void import("./code-editor-view").then(({ mountCodeEditor }) => {
			if (gone || !hostRef.current) return;
			handleRef.current = mountCodeEditor(hostRef.current, {
				doc: initialCode,
				language,
				vim: vimRef.current,
				onChange: (code) => onChangeRef.current(code),
				onVimMode: setMode,
			});
		});
		return () => {
			gone = true;
			handleRef.current?.destroy();
			handleRef.current = null;
		};
	}, []);

	const toggleVim = (on: boolean) => {
		vimRef.current = on;
		setVim(on);
		writeStorage(VIM_KEY, on ? "1" : "0");
		handleRef.current?.setVim(on);
	};

	return (
		<div data-testid="code-editor" className="flex min-h-0 flex-1 flex-col lh-well">
			<div className="flex items-center justify-between gap-3 px-3.5 pt-2.5 pb-1">
				{tools ?? (
					<span data-testid="code-language" className="font-mono text-[12.5px] text-ink-3">
						{languageLabel(language)}
					</span>
				)}
				<span className="flex items-center gap-[7px]">
					{vim && (
						<span data-testid="vim-mode" className="font-mono text-[12.5px] font-bold text-ink-2">
							{mode}
						</span>
					)}
					<span className="text-[13px] text-ink-2">Vim</span>
					<SmallSwitch on={vim} onChange={toggleVim} label="Vim" testId="vim-switch" />
				</span>
			</div>
			<div ref={hostRef} data-testid="code-editor-host" className="min-h-0 flex-1" onKeyDown={keepKeysInEditor} />
		</div>
	);
}
