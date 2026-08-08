import { Circle, Database, LockKeyhole, Search, SearchX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { RouteEditor } from "@/surfaces/admin/components/route-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  loadAdminWorkspace,
  loadBundledCuration,
  saveAdminCuration,
  type AdminWorkspace,
} from "@/data/admin-repository";
import type { CurationDraft } from "@/surfaces/admin/admin-curation";

interface RouteSaveState {
  saving: boolean;
  message: string | null;
}

export function AdminPage() {
  const [workspace, setWorkspace] = useState<AdminWorkspace | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, CurationDraft>>({});
  const [query, setQuery] = useState("");
  const [saveStates, setSaveStates] = useState<Record<string, RouteSaveState>>(
    {},
  );

  useEffect(() => {
    let active = true;
    void loadAdminWorkspace().then((loaded) => {
      if (!active) return;
      setWorkspace(loaded);
      setSelectedId(loaded.routes[0]?.activityId ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  const matchingRoutes = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!workspace || !normalized) return workspace?.routes ?? [];
    return workspace.routes.filter((route) =>
      [route.name, route.region, route.type, route.date].some((value) =>
        value.toLowerCase().includes(normalized),
      ),
    );
  }, [query, workspace]);
  const visibleRoutes = matchingRoutes.slice(0, 200);
  const effectiveSelectedId = matchingRoutes.some(
    (route) => route.activityId === selectedId,
  )
    ? selectedId
    : (matchingRoutes[0]?.activityId ?? null);
  const selectedRoute = workspace?.routes.find(
    (route) => route.activityId === effectiveSelectedId,
  );
  const draft = selectedRoute ? (drafts[selectedRoute.activityId] ?? null) : null;
  const selectedSaveState = selectedRoute
    ? saveStates[selectedRoute.activityId]
    : undefined;
  const dirty = Boolean(
    selectedRoute &&
      draft &&
      JSON.stringify(draft) !== JSON.stringify(selectedRoute.curation),
  );

  useEffect(() => {
    if (!selectedRoute || !workspace) {
      return;
    }
    let active = true;
    const routeId = selectedRoute.activityId;
    setDrafts((current) =>
      current[routeId]
        ? current
        : { ...current, [routeId]: selectedRoute.curation },
    );
    if (workspace.mode === "read-only") {
      void loadBundledCuration(selectedRoute).then((curation) => {
        if (active) {
          setDrafts((current) => ({ ...current, [routeId]: curation }));
        }
      });
    }
    return () => {
      active = false;
    };
  }, [selectedRoute?.activityId, workspace?.mode]);

  async function save() {
    if (
      !selectedRoute ||
      !draft ||
      workspace?.mode !== "editable"
    ) {
      return;
    }
    const routeId = selectedRoute.activityId;
    setSaveStates((current) => ({
      ...current,
      [routeId]: { saving: true, message: null },
    }));
    try {
      await saveAdminCuration(routeId, draft);
      setWorkspace((current) =>
        current?.mode === "editable"
          ? {
              ...current,
              generationStatus: "ready",
              routes: current.routes.map((route) =>
                route.activityId === routeId
                  ? { ...route, curation: draft, generationStatus: "ready" }
                  : route,
              ),
            }
          : current,
      );
      setSaveStates((current) => ({
        ...current,
        [routeId]: {
          saving: false,
          message: "Saved. Manifest and route detail regenerated.",
        },
      }));
    } catch (error) {
      setSaveStates((current) => ({
        ...current,
        [routeId]: {
          saving: false,
          message: error instanceof Error ? error.message : "Save failed.",
        },
      }));
    }
  }

  return (
    <section className="grid content-start gap-4" data-testid="admin-workspace">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div>
          <p className="text-micro font-semibold uppercase text-forest">Owner workspace</p>
          <h1 className="mt-1 text-2xl font-semibold text-ink">Curation ledger</h1>
        </div>
        <p className="max-w-xl text-caption text-ink-secondary">
          Review route readiness, shape the experience, and regenerate source-backed guide data.
        </p>
      </header>

      {workspace === null ? (
        <div
          role="status"
          className="grid min-h-64 place-items-center border-y border-border text-sm text-muted-foreground"
        >
          Checking for the local owner writer...
        </div>
      ) : (
        <>
          <div
            role="status"
            className={
              workspace.mode === "editable"
                ? "flex gap-3 border border-forest/25 bg-forest-soft px-4 py-3 text-caption text-ink-secondary"
                : "flex gap-3 border border-line bg-surface-muted px-4 py-3 text-caption text-ink-secondary"
            }
          >
            {workspace.mode === "editable" ? (
              <Database
                className="mt-0.5 size-4 shrink-0 text-primary"
                aria-hidden="true"
              />
            ) : (
              <LockKeyhole
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
            )}
            <p>
              {workspace.mode === "editable"
                ? "Local owner writer connected. Saving validates curation and regenerates application route data."
                : "Read-only mode. No local authenticated writer is available, so bundled route guides can be inspected but not changed."}
            </p>
          </div>

          <div className="grid min-w-0 items-start border border-line bg-surface lg:grid-cols-[22rem_minmax(0,1fr)]">
            <aside
              aria-label="Owner route list"
              className="grid min-w-0 content-start border-b border-line lg:sticky lg:top-[4.75rem] lg:max-h-[calc(100dvh-6rem)] lg:border-b-0 lg:border-r"
            >
              <div className="grid gap-2 border-b border-line p-3">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
                    aria-hidden="true"
                  />
                  <Input
                    type="search"
                    aria-label="Search owner routes"
                    value={query}
                    placeholder="Search route library"
                    className="pl-9"
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </div>
                <p className="text-micro text-ink-muted">
                  {matchingRoutes.length > visibleRoutes.length
                    ? `Showing ${visibleRoutes.length} of ${matchingRoutes.length} routes. Search to narrow the list.`
                    : `${matchingRoutes.length} ${matchingRoutes.length === 1 ? "route" : "routes"}`}
                </p>
              </div>
              <div className="grid max-h-64 overflow-y-auto lg:max-h-[calc(100dvh-11rem)]">
                {visibleRoutes.map((route) => (
                  <button
                    key={route.activityId}
                    type="button"
                    aria-pressed={route.activityId === effectiveSelectedId}
                    className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 border-b border-line px-3 py-3 text-left last:border-b-0 hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:bg-forest-soft"
                    onClick={() => {
                      setSelectedId(route.activityId);
                    }}
                  >
                    <Circle
                      className="mt-1 size-3 text-line-strong aria-pressed:fill-forest"
                      aria-hidden="true"
                    />
                    <span className="grid min-w-0 gap-1">
                      <span className="truncate text-control font-medium text-ink">
                        {route.name}
                      </span>
                      <span className="flex min-w-0 items-center justify-between gap-3 text-micro text-ink-muted">
                        <span className="truncate">{route.region}</span>
                        <span className="shrink-0 capitalize">
                          {route.curation.reviewStatus}
                        </span>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </aside>

            {selectedRoute && draft ? (
              <RouteEditor
                route={selectedRoute}
                draft={draft}
                readOnly={workspace.mode === "read-only"}
                dirty={dirty}
                saving={selectedSaveState?.saving ?? false}
                saveMessage={selectedSaveState?.message ?? null}
                onChange={(nextDraft) => {
                  setDrafts((current) => ({
                    ...current,
                    [selectedRoute.activityId]: nextDraft,
                  }));
                  setSaveStates((current) => ({
                    ...current,
                    [selectedRoute.activityId]: {
                      saving: current[selectedRoute.activityId]?.saving ?? false,
                      message: null,
                    },
                  }));
                }}
                onSave={save}
              />
            ) : query ? (
              <div className="grid min-h-64 place-items-center border-y border-border px-6 text-center">
                <div className="grid max-w-sm justify-items-center gap-3">
                  <SearchX
                    className="size-5 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div className="grid gap-1">
                    <p className="text-sm font-medium">
                      No routes match this search.
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Clear the search to return to the full route library.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setQuery("")}
                  >
                    Clear search
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid min-h-64 place-items-center border-y border-border text-sm text-muted-foreground">
                Select a route to inspect its curation.
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
