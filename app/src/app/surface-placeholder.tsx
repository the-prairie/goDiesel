import { cn } from "@/ui/utils";

// What a surface looks like while its code downloads. It reserves the
// surface's own layout, so nothing jumps when the surface replaces it, and it
// says what is opening. Keep it light: it ships in the initial shell.

export const SURFACES = [
  "atlas",
  "finder",
  "routes",
  "route",
  "replay",
  "courses",
  "course-preview",
  "admin",
  "lab",
  "missing",
] as const;

export type Surface = (typeof SURFACES)[number];

const SURFACE_COPY: Record<Surface, { title: string; status: string }> = {
  atlas: { title: "Atlas", status: "Opening Atlas…" },
  finder: { title: "Finder", status: "Opening Finder…" },
  routes: { title: "Routes", status: "Opening your routes…" },
  // The guide says the same while its own data loads, so the status reads as
  // one continuous message rather than two.
  route: { title: "Route guide", status: "Loading route details." },
  replay: { title: "Replay", status: "Opening Replay…" },
  courses: { title: "Route studio", status: "Opening the route studio…" },
  "course-preview": { title: "Course preview", status: "Opening the course preview…" },
  admin: { title: "Admin", status: "Opening Admin…" },
  lab: { title: "Lab", status: "Opening the lab…" },
  missing: { title: "Page not found", status: "Opening goDiesel…" },
};

export function surfaceStatus(surface: Surface) {
  return SURFACE_COPY[surface].status;
}

export function surfaceTitle(surface: Surface) {
  return SURFACE_COPY[surface].title;
}

export function surfaceDocumentTitle(surface: Surface | undefined) {
  return surface ? `${SURFACE_COPY[surface].title} · goDiesel` : "goDiesel";
}

/** The surface a matched route declares in its `handle`. */
export function surfaceOfHandle(handle: unknown): Surface | undefined {
  const surface = (handle as { surface?: unknown } | null | undefined)?.surface;
  return SURFACES.includes(surface as Surface) ? (surface as Surface) : undefined;
}

function Block({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "rounded-[var(--radius-control)] bg-surface-muted motion-safe:animate-pulse",
        className,
      )}
    />
  );
}

function Status({ surface, chip = false }: { surface: Surface; chip?: boolean }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        "text-control text-ink-secondary",
        chip &&
          "inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-line bg-[var(--surface-map-glass)] px-3",
      )}
    >
      {surfaceStatus(surface)}
    </p>
  );
}

// Full-height surfaces fill the space above the mobile navigation.
const immersiveFrame =
  "relative flex h-[calc(100dvh-var(--mobile-navigation-height))] min-h-0 w-full flex-col overflow-hidden bg-canvas md:h-dvh";
const mapEdge =
  "left-4 top-[calc(1rem+var(--safe-area-top))] md:left-[var(--space-map-edge)] md:top-[calc(var(--space-map-edge)+var(--safe-area-top))]";

export function SurfacePlaceholder({ surface }: { surface: Surface }) {
  if (surface === "finder") {
    return (
      <section aria-busy="true" data-surface-placeholder={surface} className={immersiveFrame}>
        <div className="grid shrink-0 gap-3 border-b border-line bg-surface/97 px-4 py-3 sm:px-5">
          <Status surface={surface} />
          <Block className="h-9 w-56 max-w-full" />
          <Block className="h-12 w-full" />
        </div>
        <div aria-hidden="true" className="min-h-0 flex-1 bg-surface-muted/40" />
      </section>
    );
  }

  if (surface === "route") {
    return (
      <section
        aria-busy="true"
        data-surface-placeholder={surface}
        className={cn(immersiveFrame, "md:flex-row")}
      >
        <div aria-hidden="true" className="min-h-0 flex-1 bg-surface-muted/40" />
        <div className="absolute inset-x-0 bottom-0 grid h-[180px] content-start gap-3 rounded-t-[22px] border-t border-line bg-surface p-4 md:static md:h-auto md:w-[var(--inspector-width)] md:rounded-none md:border-l md:border-t-0 md:p-[var(--space-map-edge)]">
          <Status surface={surface} />
          <Block className="h-8 w-3/4" />
          <Block className="h-4 w-1/2" />
          <Block className="hidden h-28 w-full md:block" />
        </div>
      </section>
    );
  }

  if (surface === "atlas" || surface === "replay" || surface === "course-preview" || surface === "lab") {
    const hasDock = surface !== "atlas";
    return (
      <section aria-busy="true" data-surface-placeholder={surface} className={immersiveFrame}>
        <div className={cn("absolute", mapEdge)}>
          <Status surface={surface} chip />
        </div>
        {hasDock ? (
          <Block className="absolute inset-x-4 bottom-[calc(1rem+var(--safe-area-bottom))] mx-auto h-24 max-w-3xl md:bottom-[calc(var(--space-map-edge)+var(--safe-area-bottom))]" />
        ) : null}
      </section>
    );
  }

  // Utility surfaces sit inside the shell's padded content column.
  return (
    <section aria-busy="true" data-surface-placeholder={surface} className="grid content-start gap-6">
      <Status surface={surface} />
      <div className="grid max-w-3xl gap-3">
        <Block className="h-3 w-28" />
        <Block className="h-10 w-3/4 sm:h-12" />
        <Block className="h-4 w-2/3" />
      </div>
      {surface === "admin" ? (
        <div className="grid gap-2">
          {Array.from({ length: 6 }, (_, index) => (
            <Block key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Block key={index} className="h-56 w-full" />
          ))}
        </div>
      )}
    </section>
  );
}
