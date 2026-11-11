"use client";

import Link from "next/link";
import { useClasses } from "@/frontend/components/class-context";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";

/**
 * ARCHIVED CLASSES: the classes that left the top bar. A row opens the
 * class again; its "Edit class" unarchives it.
 */
export function ArchivedClasses() {
	const { classes, loaded, setActive } = useClasses();
	const archived = classes.filter((c) => c.archived);
	return (
		<div className="h-full overflow-y-auto">
			<div data-testid="archived-classes" className="mx-auto flex w-full max-w-[908px] flex-col px-6 pt-10 pb-12">
				<h1 className="text-[40px] leading-[48px] text-ink">Archived classes</h1>
				<p className="mt-2 text-base text-ink-2">Open one to see it again. Unarchive is in Edit class.</p>
				<div className="mt-8 flex flex-col border-y-2 border-ink">
					{archived.length === 0 ? (
						<p className="px-2 py-4 text-[15px] text-ink-2">{loaded ? "No archived classes." : "Loading…"}</p>
					) : (
						archived.map((c) => (
							<Link
								key={c.id}
								href="/class"
								prefetch={false}
								data-testid={`class-option-${c.id}`}
								onClick={() => setActive(c.id)}
								className="lh-press flex items-center gap-4 border-b border-dotted border-edge px-2 py-4 last:border-b-0 hover:bg-tone"
							>
								<span aria-hidden className="w-2.5 shrink-0 self-stretch bg-ink-3" />
								<span className="flex min-w-0 flex-1 flex-col gap-1">
									<span className="truncate text-[17px] font-medium text-ink">{c.name}</span>
									<span className="truncate text-sm text-ink-2">
										{c.description ? `${c.description.replace(/\.$/, "")}. ` : ""}
										{c.fileCount} {c.fileCount === 1 ? "file" : "files"}
									</span>
								</span>
								<PixelIcon name="chevron" className="text-ink" />
							</Link>
						))
					)}
				</div>
			</div>
		</div>
	);
}
