/**
 * linkedom stand-ins CodeMirror needs to mount (it never measures here),
 * and finding a mounted writing box's CodeMirror view.
 */
import { act } from "react";
import { EditorView } from "@codemirror/view";

export function stubCodeMirrorDom(dom: { window: object; document: object }): void {
	Object.assign(dom.document, { getSelection: () => null, hasFocus: () => false });
	Object.assign(dom.window, {
		requestAnimationFrame: () => 0,
		cancelAnimationFrame: () => {},
		getSelection: () => null,
		MutationObserver: class {
			observe() {}
			disconnect() {}
			takeRecords() {
				return [];
			}
		},
	});
	Object.assign(globalThis, { MutationObserver: (dom.window as { MutationObserver: unknown }).MutationObserver });
}

/** The writing box's editor once it has loaded (it mounts after import()). */
export async function mathBoxView(within: HTMLElement, label?: string): Promise<EditorView> {
	for (let i = 0; i < 200; i++) {
		const editors = [...within.querySelectorAll<HTMLElement>('[data-testid="math-box"] .cm-editor')];
		const editor = editors.find((e) => !label || e.querySelector(`[aria-label="${label}"]`));
		const view = editor && EditorView.findFromDOM(editor);
		if (view) return view;
		await act(() => new Promise((r) => setTimeout(r, 5)));
	}
	throw new Error(`no writing box${label ? ` labeled ${label}` : ""}`);
}
