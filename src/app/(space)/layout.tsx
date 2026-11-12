import { SpaceHead } from "@/frontend/components/space-page/space-head";

/** Every space page: the space's head and tabs over the tab's page. */
export default function SpaceLayout({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex h-full flex-col">
			<SpaceHead />
			<div className="min-h-0 flex-1">{children}</div>
		</div>
	);
}
