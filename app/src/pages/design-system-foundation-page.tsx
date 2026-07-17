import {
  AlertTriangle,
  Bike,
  Check,
  CircleDot,
  Info,
  LoaderCircle,
  MapPin,
  Route,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const swatches = [
  ["Canvas", "var(--canvas)"],
  ["Surface", "var(--surface)"],
  ["Forest", "var(--forest)"],
  ["Route", "var(--route)"],
  ["Position", "var(--coral)"],
] as const;

export function DesignSystemFoundationPage() {
  return (
    <main
      className="field-guide-theme min-h-full w-full min-w-0 overflow-x-clip bg-[var(--canvas)] text-[var(--ink)]"
      data-testid="field-guide-foundation"
    >
      <header className="min-w-0 border-b border-[var(--line)] bg-[var(--surface)] px-5 py-8 sm:px-8 lg:px-12">
        <p className="text-micro font-semibold uppercase text-[var(--forest)]">
          goDiesel design lab
        </p>
        <h1 className="mt-3 text-place-lg font-semibold text-[var(--ink)]">
          Field guide foundation
        </h1>
        <p
          className="mt-3 max-w-2xl text-body text-[var(--ink-secondary)]"
          data-clipping-check="intro"
        >
          Terrain is the canvas, route data is the annotation, and interface
          chrome behaves like an editorial field guide.
        </p>
      </header>

      <div className="grid min-w-0 gap-0 lg:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
        <section className="min-w-0 overflow-hidden border-b border-[var(--line)] p-5 sm:p-8 lg:border-r lg:px-12 lg:py-10">
          <div className="flex min-w-0 flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-caption font-semibold uppercase text-[var(--ink-secondary)]">
                Cartographic roles
              </p>
              <h2 className="mt-2 font-editorial text-title">Kyoto foothills</h2>
            </div>
            <div
              className="flex min-w-0 flex-wrap items-center justify-end gap-3 text-caption text-[var(--ink-secondary)]"
              data-clipping-check="route-metrics"
            >
              <span className="inline-flex items-center gap-1.5">
                <Route className="size-4 text-[var(--route)]" aria-hidden="true" />
                21.3 km
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CircleDot className="size-4 text-[var(--coral)]" aria-hidden="true" />
                680 m up
              </span>
            </div>
          </div>

          <div className="relative mt-6 aspect-[16/9] min-h-60 overflow-hidden rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-muted)]">
            <div className="absolute inset-0 bg-[linear-gradient(145deg,transparent_0_35%,rgb(14_64_57/8%)_35%_52%,transparent_52%),repeating-linear-gradient(18deg,transparent_0_32px,rgb(23_32_30/5%)_33px_34px)]" />
            <svg
              aria-label="Selected route cartography example"
              className="absolute inset-0 size-full"
              viewBox="0 0 800 450"
            >
              <path
                d="M40 345 C130 350 155 270 230 286 S340 330 390 245 S490 90 580 155 S675 305 760 190"
                fill="none"
                stroke="var(--route-halo)"
                strokeLinecap="round"
                strokeWidth="8"
              />
              <path
                d="M40 345 C130 350 155 270 230 286 S340 330 390 245 S490 90 580 155 S675 305 760 190"
                fill="none"
                stroke="var(--route)"
                strokeLinecap="round"
                strokeWidth="4"
              />
              <circle
                cx="390"
                cy="245"
                fill="var(--coral)"
                r="14"
                stroke="white"
                strokeWidth="2"
              />
              <text
                x="390"
                y="250"
                fill="white"
                fontFamily="var(--font-interface)"
                fontSize="14"
                fontWeight="700"
                textAnchor="middle"
              >
                1
              </text>
            </svg>
            <div className="absolute bottom-4 left-4 rounded-[var(--radius-control)] border border-white/70 bg-[var(--surface-map-glass)] px-3 py-2 shadow-[var(--shadow-panel)]">
              <p className="font-editorial text-lg font-medium">Higashiyama</p>
              <p className="text-caption text-[var(--ink-secondary)]">
                Shaded climb into quiet temple roads
              </p>
            </div>
          </div>
        </section>

        <section className="min-w-0 border-b border-[var(--line)] p-5 sm:p-8 lg:px-10 lg:py-10">
          <p className="text-caption font-semibold uppercase text-[var(--ink-secondary)]">
            Semantic palette
          </p>
          <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-2">
            {swatches.map(([label, color]) => (
              <div key={label} className="flex items-center gap-3">
                <span
                  className="size-10 shrink-0 rounded-[var(--radius-control)] border border-[var(--line)]"
                  style={{ background: color }}
                />
                <span className="text-control font-medium">{label}</span>
              </div>
            ))}
          </div>
          <Separator className="my-7" />
          <p className="font-editorial text-place-mobile uppercase tracking-[0.16em]">
            Crete
          </p>
          <p className="mt-2 text-body text-[var(--ink-secondary)]">
            Editorial type belongs to places, routes, and a short sense of the
            day. Interface type carries every action and fact.
          </p>
        </section>

        <section className="min-w-0 border-b border-[var(--line)] p-5 sm:p-8 lg:border-r lg:px-12 lg:py-10">
          <p className="text-caption font-semibold uppercase text-[var(--ink-secondary)]">
            Controls and inputs
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button>
              <MapPin aria-hidden="true" />
              Start route
            </Button>
            <Button variant="outline">
              <Bike aria-hidden="true" />
              Save for later
            </Button>
            <Button variant="ghost">Preview</Button>
            <Button aria-pressed="true">Active route</Button>
            <Button disabled>
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              Saving route
            </Button>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button aria-label="Route information" size="icon" variant="outline">
                    <Info aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="field-guide-theme" sideOffset={8}>
                  Route information
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="secondary">Open route sheet</Button>
              </SheetTrigger>
              <SheetContent className="field-guide-theme">
                <SheetHeader>
                  <SheetTitle className="font-editorial text-title">
                    Kyoto foothills
                  </SheetTitle>
                  <SheetDescription>
                    Quiet roads, shaded climbs, and a fast return through the city.
                  </SheetDescription>
                </SheetHeader>
              </SheetContent>
            </Sheet>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-control font-medium" htmlFor="route-search">
              Search memories and places
              <Input id="route-search" placeholder="Crete, Kyoto, Highwood Pass" />
            </label>
            <label className="grid gap-2 text-control font-medium" htmlFor="route-search-error">
              Route search error
              <Input
                aria-invalid="true"
                defaultValue="Unknown place"
                id="route-search-error"
              />
            </label>
          </div>
        </section>

        <section className="min-w-0 p-5 sm:p-8 lg:px-10 lg:py-10">
          <p className="text-caption font-semibold uppercase text-[var(--ink-secondary)]">
            Status and loading
          </p>
          <div className="mt-5 grid gap-3">
            <div className="flex items-start gap-3 border-l-2 border-[var(--success)] py-2 pl-3">
              <Check className="mt-0.5 size-4 text-[var(--success)]" aria-hidden="true" />
              <div>
                <p className="text-control font-semibold">Route ready</p>
                <p className="text-caption text-[var(--ink-secondary)]">
                  Geometry and replay data are available.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 border-l-2 border-[var(--warning)] py-2 pl-3">
              <AlertTriangle
                className="mt-0.5 size-4 text-[var(--warning)]"
                aria-hidden="true"
              />
              <div>
                <p className="text-control font-semibold">Limited water</p>
                <p className="text-caption text-[var(--ink-secondary)]">
                  Carry enough for the exposed middle section.
                </p>
              </div>
            </div>
          </div>
          <div className="mt-6 grid gap-3" data-testid="foundation-skeleton">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        </section>
      </div>
    </main>
  );
}
