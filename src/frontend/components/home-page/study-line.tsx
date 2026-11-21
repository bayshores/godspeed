import { useCallback, useRef, useState } from "react";
import type { SpaceSummary } from "@/shared/core";
import { spaceColorVar } from "@/frontend/components/space-color";
import { MenuShell } from "@/frontend/components/menu-shell";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";
import { useSpaces } from "@/frontend/components/space-context";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { Key } from "@/frontend/components/ui/key";
import { isStartKey } from "@/frontend/components/study-page/topic-box";
import { TYPED_START } from "@/frontend/components/study-page/use-lesson-start";
import { SpaceMenuItems } from "./space-menu-items";

/**
 * Home's one-line form: a topic typed, the space its lesson goes in (a chip
 * with a menu, drawn only when there are several open spaces) and the Study
 * key. The chip starts on the active space, else the first open one. An
 * empty topic starts nothing: the key puts the cursor in the line.
 */
export function StudyLine({ spaces, busyOn, onStudy }: { spaces: readonly SpaceSummary[]; busyOn: string | null; onStudy: (spaceId: string, title: string) => void }) {
	const { active } = useSpaces();
	const [text, setText] = useState("");
	const [chosen, setChosen] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const space = spaces.find((c) => c.id === chosen) ?? spaces.find((c) => c.id === active) ?? spaces[0]!;

	const submit = () => {
		const title = text.trim();
		if (title) onStudy(space.id, title);
		else inputRef.current?.focus();
	};

	return (
		<form
			data-testid="home-study"
			onSubmit={(e) => e.preventDefault()}
			className="mt-2 ml-auto flex w-full items-center gap-2 self-center lh-well rounded py-1.5 pr-1.5 pl-4 @[1300px]/page:mt-0 @[1300px]/page:w-[560px]"
		>
			<input
				ref={inputRef}
				data-testid="home-study-input"
				aria-label="What do you want to study?"
				placeholder="What do you want to study?"
				value={text}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={(e) => {
					if (isStartKey({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing })) {
						e.preventDefault();
						submit();
					}
				}}
				className="min-w-0 flex-1 bg-transparent font-prose text-[17px] text-ink outline-none placeholder:text-ink-3"
			/>
			{spaces.length > 1 && <SpaceChip spaces={spaces} space={space} onPick={setChosen} />}
			<Key data-testid="home-study-start" busy={busyOn === TYPED_START} disabled={busyOn !== null} onClick={submit} className="shrink-0 text-[15px]">
				Study
			</Key>
		</form>
	);
}

/** Names the space the lesson goes in; opens a menu of the open spaces. */
function SpaceChip({ spaces, space, onPick }: { spaces: readonly SpaceSummary[]; space: SpaceSummary; onPick: (spaceId: string) => void }) {
	const [open, setOpen] = useState(false);
	const anchorRef = useRef<HTMLButtonElement>(null);
	const close = useCallback(() => setOpen(false), []);
	useMenuDismiss(open, close, anchorRef);
	return (
		<>
			<button
				ref={anchorRef}
				type="button"
				data-testid="home-study-space"
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
				className="lh-btn lh-btn-quiet min-w-0 shrink-0 text-[15px]"
			>
				<span aria-hidden className="size-3 shrink-0" style={{ background: spaceColorVar(space.color) }} />
				{space.name}
				<PixelIcon name="chevron" className="rotate-90" />
			</button>
			<MenuShell open={open} anchorRef={anchorRef} testid="home-study-space-menu" preferredSide="down" align="right" menuClass="lh-popup flex w-[236px] flex-col gap-0.5 p-1.5">
				<SpaceMenuItems
					spaces={spaces}
					testidPrefix="home-study-space"
					onPick={(id) => {
						setOpen(false);
						onPick(id);
					}}
				/>
			</MenuShell>
		</>
	);
}
