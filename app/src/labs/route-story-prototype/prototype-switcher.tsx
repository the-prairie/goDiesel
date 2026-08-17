import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

export const PROTOTYPE_VARIANTS = [
  { id: "dossier", label: "Atlas Dossier" },
  { id: "index", label: "Map as Index" },
  { id: "split", label: "Split Evidence" },
  { id: "cinematic", label: "Cinematic Cartography" },
] as const;

export type PrototypeVariantId = (typeof PROTOTYPE_VARIANTS)[number]["id"];

export function PrototypeSwitcher({ current }: { current: PrototypeVariantId }) {
  const [, setSearchParams] = useSearchParams();
  const currentIndex = PROTOTYPE_VARIANTS.findIndex((variant) => variant.id === current);
  const select = (offset: number) => {
    const next = PROTOTYPE_VARIANTS[(currentIndex + offset + PROTOTYPE_VARIANTS.length) % PROTOTYPE_VARIANTS.length];
    setSearchParams({ variant: next.id }, { replace: true });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "ArrowLeft") select(-1);
      if (event.key === "ArrowRight") select(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (!import.meta.env.DEV) return null;
  const label = PROTOTYPE_VARIANTS[currentIndex]?.label ?? PROTOTYPE_VARIANTS[0].label;
  return (
    <aside
      aria-label="Route story prototype switcher"
      className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center border border-white/20 bg-[#101a18] p-1 text-white shadow-sheet"
    >
      <button type="button" aria-label="Previous prototype" onClick={() => select(-1)} className="grid size-11 place-items-center outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-route">
        <ArrowLeft aria-hidden="true" className="size-4" />
      </button>
      <p className="min-w-[13.5rem] px-4 text-center text-control font-semibold">{currentIndex + 1} / 4 · {label}</p>
      <button type="button" aria-label="Next prototype" onClick={() => select(1)} className="grid size-11 place-items-center outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-route">
        <ArrowRight aria-hidden="true" className="size-4" />
      </button>
    </aside>
  );
}

