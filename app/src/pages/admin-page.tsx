import { Database, LockKeyhole, Search, SearchX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { RouteEditor } from "@/components/admin/route-editor";
import { PageTitle } from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  loadAdminWorkspace,
  loadBundledCuration,
  saveAdminCuration,
  type AdminWorkspace,
} from "@/data/admin-repository";
import type { CurationDraft } from "@/domain/admin-curation";

interface RouteSaveState {
  saving: boolean;
  message: string | null;
}

export function AdminPage() {
  const [workspace, setWorkspace] = useState<AdminWorkspace | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftState, setDraftState] = useState<{
    routeId: string;
    draft: CurationDraft;
  } | null>(null);
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
  const draft =
    draftState && draftState.routeId === selectedRoute?.activityId
      ? draftState.draft
      : null;
  const selectedSaveState = selectedRoute
    ? saveStates[selectedRoute.activityId]
    : undefined;

  useEffect(() => {
    if (!selectedRoute || !workspace) {
      setDraftState(null);
      return;
    }
    let active = true;
    if (workspace.mode === "editable") {
      setDraftState({
        routeId: selectedRoute.activityId,
        draft: selectedRoute.curation,
      });
    } else {
      setDraftState({
        routeId: selectedRoute.activityId,
        draft: selectedRoute.curation,
      });
      void loadBundledCuration(selectedRoute).then((curation) => {
        if (active) {
          setDraftState({ routeId: selectedRoute.activityId, draft: curation });
        }
      });
    }
    return () => {
      active = false;
    };
  }, [selectedRoute, workspace]);

  async function save() {
    if (
      !selectedRoute ||
      !draft ||
      draftState?.routeId !== selectedRoute.activityId ||
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
    <section className="grid content-start gap-7">
      <PageTitle
        eyebrow="Admin"
        title="Route curation."
        copy="Review route readiness, shape the experience, and publish generated route data from one owner workspace."
      />

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
                ? "flex gap-3 border-y border-primary/30 bg-primary/5 px-4 py-3 text-sm"
                : "flex gap-3 border-y border-border bg-muted/30 px-4 py-3 text-sm"
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

          <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(15rem,0.42fr)_minmax(0,1fr)] lg:gap-10">
            <aside
              aria-label="Owner route list"
              className="grid min-w-0 content-start gap-4 lg:border-r lg:border-border lg:pr-6"
            >
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
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
              <p className="text-xs text-muted-foreground">
                {matchingRoutes.length > visibleRoutes.length
                  ? `Showing ${visibleRoutes.length} of ${matchingRoutes.length} routes. Search to narrow the list.`
                  : `${matchingRoutes.length} ${matchingRoutes.length === 1 ? "route" : "routes"}`}
              </p>
              <div className="grid max-h-[42rem] overflow-y-auto border-y border-border">
                {visibleRoutes.map((route) => (
                  <button
                    key={route.activityId}
                    type="button"
                    aria-pressed={route.activityId === effectiveSelectedId}
                    className="grid min-w-0 gap-1 border-b border-border px-3 py-3 text-left last:border-b-0 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:bg-muted"
                    onClick={() => {
                      setSelectedId(route.activityId);
                    }}
                  >
                    <span className="truncate text-sm font-medium">
                      {route.name}
                    </span>
                    <span className="flex min-w-0 items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span className="truncate">{route.region}</span>
                      <span className="shrink-0 capitalize">
                        {route.curation.reviewStatus}
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
                saving={selectedSaveState?.saving ?? false}
                saveMessage={selectedSaveState?.message ?? null}
                onChange={(nextDraft) => {
                  setDraftState({
                    routeId: selectedRoute.activityId,
                    draft: nextDraft,
                  });
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
