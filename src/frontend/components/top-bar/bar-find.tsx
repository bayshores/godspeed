import type { KeyboardEvent, RefObject } from "react";
import { Hint } from "@/frontend/components/ui/hint";
import { KeyHint, keyShortcutProps } from "@/frontend/components/ui/key-hint";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { barWord } from "./bar-look";

/**
 * A page's Find in the top bar. Closed it is one key, the magnifying glass
 * with its shortcut; open it takes the place of the page's other words: the
 * field, then the count and the previous and next keys where the page has
 * them, then Close. The page does the finding.
 */
export function BarFind({
	label,
	testIds,
	open,
	onOpen,
	query,
	onQuery,
	inputRef,
	keyRef,
	onKeyDown,
	count,
	step,
	onClose,
}: {
	/** The key's and the field's name, as "Find in lesson". */
	label: string;
	testIds: { key: string; field: string };
	open: boolean;
	onOpen: () => void;
	query: string;
	onQuery: (query: string) => void;
	inputRef: RefObject<HTMLInputElement | null>;
	/** The magnifying glass, which takes focus back on closing when it had it. */
	keyRef: RefObject<HTMLButtonElement | null>;
	onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
	/** Where the matches are, as "2 of 5". */
	count?: string;
	/** Walks the matches; `disabled` while there are none. */
	step?: { onStep: (direction: 1 | -1) => void; disabled: boolean };
	onClose: () => void;
}) {
	if (!open) {
		return (
			<Hint label={label} side="bottom">
				<button ref={keyRef} type="button" data-testid={testIds.key} aria-label={label} {...keyShortcutProps("find")} onClick={onOpen} className={barWord(false)}>
					<PixelIcon name="search" />
					{/* The narrowest windows keep the glass alone, so the page's words clear the clock. */}
					<span className="contents max-[699px]:hidden">
						<KeyHint action="find" />
					</span>
				</button>
			</Hint>
		);
	}
	return (
		<div role="search" aria-label={label} data-testid={testIds.field} onKeyDown={onKeyDown} className="flex min-w-0 items-center pl-1.5">
			<input
				ref={inputRef}
				aria-label={label}
				placeholder={label}
				value={query}
				onChange={(event) => onQuery(event.target.value)}
				spellCheck={false}
				className="h-[30px] w-[220px] min-w-[8ch] shrink rounded-[2px] bg-bar-ink/10 px-3 text-[15px] text-bar-ink outline-none placeholder:text-bar-ink/60"
			/>
			{count !== undefined && (
				<output aria-live="polite" data-testid={`${testIds.field}-count`} className="font-count min-w-[7ch] px-3 text-[15px] whitespace-nowrap">
					{count}
				</output>
			)}
			{step && (
				<>
					<Hint label="Previous match" side="bottom">
						<button type="button" aria-label="Previous match" disabled={step.disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => step.onStep(-1)} className={barWord(false)}>
							<PixelIcon name="chevron" className="-rotate-90" />
						</button>
					</Hint>
					<Hint label="Next match" side="bottom">
						<button type="button" aria-label="Next match" disabled={step.disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => step.onStep(1)} className={barWord(false)}>
							<PixelIcon name="chevron" className="rotate-90" />
						</button>
					</Hint>
				</>
			)}
			<Hint label="Close Find" side="bottom">
				<button type="button" aria-label="Close Find" onClick={onClose} className={barWord(false)}>
					<PixelIcon name="close" />
				</button>
			</Hint>
		</div>
	);
}
