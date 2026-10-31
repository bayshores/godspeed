import { useEffect, useRef, useState, type ComponentProps } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type CopyButtonProps = Omit<ComponentProps<"button">, "children" | "type"> & {
	/** What lands on the clipboard. A function is read at click time. */
	text: string | (() => string);
	/** The label before a copy. */
	children?: string;
	/** Show a copy icon (a check once copied) before the label; "only" shows just the icon. */
	icon?: boolean | "only";
};

/** Clipboard write with a fallback: navigator.clipboard needs a permission
 *  Electron's handler (electron/main.cjs) must grant, and a stale API
 *  rejects, so the hidden-textarea execCommand path catches what would
 *  otherwise fail silently. Returns whether the copy landed. */
async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		/* fall through to the legacy path */
	}
	try {
		const ta = document.createElement("textarea");
		ta.value = text;
		ta.setAttribute("readonly", "");
		ta.style.position = "fixed";
		ta.style.opacity = "0";
		document.body.appendChild(ta);
		ta.select();
		const ok = document.execCommand("copy");
		ta.remove();
		return ok;
	} catch {
		return false;
	}
}

/** Copies `text` and says "Copied" for a moment (an icon-only button flips to a check). */
export function CopyButton({ text, children = "Copy", icon = false, onClick, ...button }: CopyButtonProps) {
	const [copied, setCopied] = useState(false);
	const timer = useRef<number | undefined>(undefined);
	useEffect(() => () => window.clearTimeout(timer.current), []);
	const Icon = copied ? CheckIcon : CopyIcon;
	return (
		<button
			{...button}
			type="button"
			onClick={(e) => {
				onClick?.(e);
				void copyText(typeof text === "function" ? text() : text).then((ok) => {
					if (!ok) return;
					setCopied(true);
					window.clearTimeout(timer.current);
					timer.current = window.setTimeout(() => setCopied(false), 1500);
				});
			}}
		>
			{/* With no "Copied" word, the check settles in so the flip reads. */}
			{icon && <Icon className={cn("size-3.5", copied && icon === "only" && "motion-safe:animate-[lh-dialog-in_var(--lh-dur-fast)_var(--lh-ease-out)]")} aria-hidden />}
			{icon !== "only" && (copied ? "Copied" : children)}
		</button>
	);
}
