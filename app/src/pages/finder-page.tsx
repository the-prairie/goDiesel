import { Database, SearchX } from "lucide-react";
import { useState } from "react";

import { CandidateRoute } from "@/components/finder/candidate-route";
import { FinderForm } from "@/components/finder/finder-form";
import { PageTitle } from "@/components/page-title";
import { curatedRouteDiscoveryProvider } from "@/data/discovery-provider";
import {
  savePlannedRoute,
  usePlannedRoutes,
} from "@/data/planned-route-store";
import type { DiscoveryResult, FinderIntent } from "@/domain/planning";

const initialIntent: FinderIntent = {
  place: "",
  activity: "Run",
  distanceKm: 20,
  terrain: "any",
  vibe: "",
};

export function FinderPage() {
  const [intent, setIntent] = useState(initialIntent);
  const [searchState, setSearchState] = useState<{
    intent: FinderIntent;
    result: DiscoveryResult;
  } | null>(null);
  const plannedRoutes = usePlannedRoutes();
  const result = searchState?.result ?? null;

  function search() {
    const searchedIntent = { ...intent };
    setSearchState({
      intent: searchedIntent,
      result: curatedRouteDiscoveryProvider.search(searchedIntent),
    });
  }

  return (
    <section className="grid content-start gap-7">
      <PageTitle
        eyebrow="Finder"
        title="Commit the next day to ink."
        copy="Unexplored ground lifts on the page. Candidates arrive as pencil until you save them — then they wait in your atlas, untraveled."
      />

      <div className="grid gap-8 border-y border-border py-7 lg:grid-cols-[minmax(17rem,0.72fr)_minmax(0,1.28fr)] lg:gap-12">
        <div className="grid content-start gap-6">
          <FinderForm intent={intent} onChange={setIntent} onSubmit={search} />
          <div className="flex gap-3 border-t border-border pt-5 text-sm text-muted-foreground">
            <Database className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <p>
              <strong className="font-medium text-foreground">Finder does not generate routes.</strong>{" "}
              Results come from owner-curated or imported GPX records, so every path has a known source.
            </p>
          </div>
        </div>

        <section aria-label="Finder results" className="min-w-0">
          {result === null ? (
            <FinderState
              title="Set the kind of day you want"
              copy="Search the small curated route shelf by place, effort, surface, and feeling."
            />
          ) : result.status === "unsupported" ? (
            <FinderState title="No curated match" copy={result.message} role="status" />
          ) : (
            <div className="grid gap-4">
              <p aria-live="polite" className="text-sm text-muted-foreground">
                {result.message}
              </p>
              {result.candidates.map((candidate) => (
                <CandidateRoute
                  key={candidate.id}
                  candidate={candidate}
                  plannedRoute={plannedRoutes.find(
                    (route) => route.planning.candidateId === candidate.id,
                  )}
                  onSave={() =>
                    savePlannedRoute(candidate, searchState!.intent).route
                  }
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function FinderState({
  title,
  copy,
  role,
}: {
  title: string;
  copy: string;
  role?: "status";
}) {
  return (
    <div
      role={role}
      className="grid min-h-72 place-items-center rounded-[var(--radius-panel)] border border-dashed border-line bg-paper-lifted/60 p-8 text-center"
    >
      <div className="grid max-w-md justify-items-center gap-3">
        <SearchX className="size-6 text-graphite" aria-hidden="true" />
        <h2 className="font-editorial text-lg font-medium tracking-[0.01em]">{title}</h2>
        <p className="font-marginalia text-sm leading-6 text-ink-secondary">{copy}</p>
      </div>
    </div>
  );
}
