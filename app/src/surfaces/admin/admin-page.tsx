import { Circle, Database, LockKeyhole, Search, SearchX } from "lucide-react";
import { useEffect, useMemo, useReducer, useRef } from "react";

import { RouteEditor } from "@/surfaces/admin/components/route-editor";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import {
  loadAdminWorkspace,
  loadBundledCuration,
  saveAdminCuration,
} from "@/data/admin-repository";
import {
  initialAdminWorkspaceState,
  reduceAdminWorkspace,
  selectAdminWorkspace,
} from "./workspace-state";

export function AdminPage() {
  const [state, dispatch] = useReducer(reduceAdminWorkspace, undefined, initialAdminWorkspaceState);
  const requestId = useRef(0);
  const {
    workspace, query, matchingRoutes, visibleRoutes, effectiveSelectedId,
    selectedRoute, draft, dirty, saving, saveMessage, canSave,
  } = useMemo(() => selectAdminWorkspace(state), [state]);

  useEffect(() => {
    let active = true;
    void loadAdminWorkspace().then((loaded) => {
      if (active) dispatch({ type: "workspaceLoaded", workspace: loaded });
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedRoute || workspace?.mode !== "read-only") return;
    let active = true;
    const routeId = selectedRoute.activityId;
    const id = ++requestId.current;
    dispatch({ type: "detailStarted", routeId, requestId: id });
    void loadBundledCuration(selectedRoute).then((curation) => {
      if (active) dispatch({ type: "detailReceived", routeId, requestId: id, draft: curation });
    });
    return () => {
      active = false;
    };
  }, [selectedRoute?.activityId, workspace?.mode]);

  async function save() {
    if (!selectedRoute || !draft || !canSave) return;
    const routeId = selectedRoute.activityId;
    const id = ++requestId.current;
    dispatch({ type: "saveStarted", routeId, requestId: id, draft });
    try {
      await saveAdminCuration(routeId, draft);
      dispatch({ type: "saveSucceeded", routeId, requestId: id });
    } catch (error) {
      dispatch({
        type: "saveFailed", routeId, requestId: id,
        message: error instanceof Error ? error.message : "Save failed.",
      });
    }
  }

  return (
    <section className="grid content-start gap-4" data-testid="admin-workspace">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div>
          <p className="text-micro font-semibold uppercase text-forest">Owner workspace</p>
          <h1 className="mt-1 font-editorial text-4xl font-semibold text-ink">Curation ledger</h1>
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
                className="mt-0.5 size-4 shrink-0 text-accent-foreground"
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

          <div className="grid min-w-0 items-start rounded-2xl border border-line bg-surface lg:grid-cols-[22rem_minmax(0,1fr)]">
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
                    onChange={(event) => dispatch({ type: "queryEdited", query: event.target.value })}
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
                    className="group grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 border-b border-line px-3 py-3 text-left last:border-b-0 hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:bg-forest-soft"
                    onClick={() => {
                      dispatch({ type: "routeSelected", routeId: route.activityId });
                    }}
                  >
                    <Circle
                      className="mt-1 size-3 text-line-strong group-aria-pressed:fill-ink group-aria-pressed:text-ink"
                      aria-hidden="true"
                    />
                    <span className="grid min-w-0 gap-1">
                      <span className="truncate text-control font-medium text-ink">
                        {route.name}
                      </span>
                      <span className="flex min-w-0 items-center justify-between gap-3 text-micro text-ink-muted">
                        <span className="truncate tabular-nums">
                          {route.date || "Date unknown"} · {route.distanceKm.toFixed(1)} km
                        </span>
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
                saving={saving}
                saveMessage={saveMessage}
                onChange={(nextDraft) => {
                  dispatch({ type: "draftEdited", routeId: selectedRoute.activityId, draft: nextDraft });
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
                    onClick={() => dispatch({ type: "queryEdited", query: "" })}
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
