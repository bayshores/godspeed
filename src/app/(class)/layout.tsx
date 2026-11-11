import { ClassHead } from "@/frontend/components/class-page/class-head";

/** Every class page: the class's head and tabs over the tab's page. */
export default function ClassLayout({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex h-full flex-col">
			<ClassHead />
			<div className="min-h-0 flex-1">{children}</div>
		</div>
	);
}
