import {
	AtomIcon,
	BookOpenIcon,
	BrainIcon,
	ChartLineIcon,
	CodeIcon,
	CpuIcon,
	DnaIcon,
	FlaskConicalIcon,
	GlobeIcon,
	LandmarkIcon,
	LanguagesIcon,
	MusicIcon,
	PaletteIcon,
	ScaleIcon,
	SigmaIcon,
	TrendingUpIcon,
	type LucideIcon,
} from "lucide-react";
import type { ClassIcon as ClassIconName } from "@/core";

/** A class's subject icon; a class without one shows the open book. */

const ICONS: Record<ClassIconName, LucideIcon> = {
	cpu: CpuIcon,
	code: CodeIcon,
	sigma: SigmaIcon,
	"chart-line": ChartLineIcon,
	atom: AtomIcon,
	"flask-conical": FlaskConicalIcon,
	dna: DnaIcon,
	brain: BrainIcon,
	landmark: LandmarkIcon,
	scale: ScaleIcon,
	"trending-up": TrendingUpIcon,
	globe: GlobeIcon,
	languages: LanguagesIcon,
	"book-open": BookOpenIcon,
	palette: PaletteIcon,
	music: MusicIcon,
};

export function ClassIcon({ icon, className }: { icon: ClassIconName | undefined; className?: string }) {
	const Icon = ICONS[icon ?? "book-open"];
	return <Icon className={className} aria-hidden />;
}
