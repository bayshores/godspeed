import { cn } from "@/frontend/lib/utils";

/** A numbered box and its name; the box is filled on the step you are on. */
function StepMark({ n, label, here }: { n: 1 | 2; label: string; here: boolean }) {
	return (
		<div className="flex items-center gap-2.5">
			<span
				className={cn(
					"flex size-7 items-center justify-center rounded border-2 border-ink font-count text-base leading-none",
					here ? "bg-ink text-background" : "text-ink",
				)}
			>
				{n}
			</span>
			<span className={cn("text-base", here ? "text-ink" : "text-ink-2")}>{label}</span>
		</div>
	);
}

function StepBar({ at }: { at: 1 | 2 }) {
	return (
		<div data-testid="onboarding-steps" className="flex items-center gap-3.5">
			<StepMark n={1} label="Agent" here={at === 1} />
			<span aria-hidden className="h-0.5 w-20 bg-line" />
			<StepMark n={2} label="Space" here={at === 2} />
		</div>
	);
}

/** One setup step: the step bar over a sheet with the step's title and sentence. */
export function StepSheet({ at, title, sub, children }: { at: 1 | 2; title: string; sub: string; children: React.ReactNode }) {
	return (
		<div className="ob-step m-auto flex flex-col items-center gap-[30px] px-4 py-8">
			<StepBar at={at} />
			<section className="flex w-[600px] max-w-full flex-col gap-4 rounded border-2 border-ink bg-panel px-[34px] pt-[30px] pb-[26px]">
				<h1 className="text-[30px] leading-tight text-ink">{title}</h1>
				<p className="text-lg text-ink-2">{sub}</p>
				{children}
			</section>
		</div>
	);
}
