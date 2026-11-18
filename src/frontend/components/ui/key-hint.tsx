import { ariaKeyShortcuts, bindingForAction, IS_MAC, keyHintText, type KeyAction } from "@/shared/core";

/** The key of a button's action, drawn inside the button after its label. It follows the button's
 *  text colour, so it reads on the dark top bar and on light keys alike. */
export function KeyHint({ action }: { action: KeyAction }) {
	return (
		<kbd aria-hidden className="rounded-[2px] bg-[color-mix(in_srgb,currentColor_14%,transparent)] px-[5px] font-[inherit] text-[13px] leading-[1.4]">
			{keyHintText(bindingForAction(action), IS_MAC)}
		</kbd>
	);
}

/** The attribute a button with a KeyHint carries, so assistive tech announces the key too. */
export function keyShortcutProps(action: KeyAction): { "aria-keyshortcuts": string } {
	return { "aria-keyshortcuts": ariaKeyShortcuts(bindingForAction(action), IS_MAC) };
}
