import { ariaKeyShortcuts, bindingForAction, IS_MAC, keyHintText, type KeyAction } from "@/shared/core";

/** A key of the keyboard as the app draws it. It follows the text colour around it, so it reads on
 *  the dark top bar and on light keys alike. */
export const KEYCAP = "lh-notch bg-[color-mix(in_srgb,currentColor_14%,transparent)] px-[5px] font-[inherit] text-sm leading-ui";

/** The key of a button's action, drawn inside the button after its label. */
export function KeyHint({ action }: { action: KeyAction }) {
	return (
		<kbd aria-hidden className={KEYCAP}>
			{keyHintText(bindingForAction(action), IS_MAC)}
		</kbd>
	);
}

/** The attribute a button with a KeyHint carries, so assistive tech announces the key too. */
export function keyShortcutProps(action: KeyAction): { "aria-keyshortcuts": string } {
	return { "aria-keyshortcuts": ariaKeyShortcuts(bindingForAction(action), IS_MAC) };
}
