import { useState, useSyncExternalStore } from "react";
import { useLocation, useMatches, useNavigate, useRouteError } from "react-router-dom";

import { chunkFailure, isChunkLoadError } from "@/app/chunk-recovery";
import { singleRouteMicrosite } from "@/app/single-route-microsite";
import { surfaceOfHandle, surfaceTitle } from "@/app/surface-placeholder";
import { Button } from "@/ui/button";

function subscribeToConnection(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function useOnline() {
  return useSyncExternalStore(subscribeToConnection, () => navigator.onLine, () => true);
}

function BackToRoutes() {
  return (
    <Button variant="outline" asChild>
      <a href={singleRouteMicrosite?.guidePath ? `#${singleRouteMicrosite.guidePath}` : "#/routes"} onClick={(event) => {
        event.preventDefault();
        window.location.hash = singleRouteMicrosite?.guidePath ?? "/routes";
        window.location.reload();
      }}>Back to routes</a>
    </Button>
  );
}

/**
 * A view that could not open, shown inside the shell so the primary
 * navigation and every surface already loaded stay usable.
 */
export function RouteError() {
  const error = useRouteError();
  const online = useOnline();
  // Classified once, at the moment the view failed.
  const [failure] = useState(() => chunkFailure(error, navigator.onLine));
  const [stillOffline, setStillOffline] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const surface = surfaceOfHandle(useMatches().at(-1)?.handle);
  const name = surface ? surfaceTitle(surface) : undefined;
  const canGoBack = location.key !== "default";

  if (failure === "offline") {
    // A browser keeps a failed module download for the life of the document,
    // so opening the view again needs a fresh document. Reloading offline
    // would only show the browser's offline page, so wait for a connection.
    const tryAgain = () => {
      if (navigator.onLine) window.location.reload();
      else setStillOffline(true);
    };
    return (
      <section role="alert" data-testid="view-offline" className="mx-auto grid min-h-[60dvh] w-full max-w-md content-center gap-5 px-4 py-10">
        <h1 className="text-3xl font-medium">{online ? "You’re back online." : "You’re offline."}</h1>
        <p className="text-base leading-7 text-muted-foreground">
          {online
            ? `Try again to open ${name ?? "this page"}.`
            : `${name ?? "This page"} hasn’t been downloaded yet, so it needs a connection to open. Places you’ve already opened still work.`}
        </p>
        {stillOffline && !online ? (
          <p role="status" className="text-control text-ink-secondary">Still offline. This opens as soon as you reconnect and try again.</p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Button onClick={tryAgain}>Try again</Button>
          {canGoBack ? (
            <Button variant="outline" onClick={() => navigate(-1)}>Go back</Button>
          ) : null}
        </div>
      </section>
    );
  }

  const loading = failure === "unavailable";
  return (
    <section role="alert" className="mx-auto grid min-h-[60dvh] w-full max-w-md content-center gap-5 px-4 py-10">
      <h1 className="text-3xl font-medium">{loading ? "Let’s get you back on track." : "This view couldn’t open."}</h1>
      <p className="text-base leading-7 text-muted-foreground">
        {loading ? "This page couldn’t finish loading. Check your connection and try again." : "Try opening this page again, or return to your routes."}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => window.location.reload()}>Try again</Button>
        <BackToRoutes />
      </div>
    </section>
  );
}

/** The last resort, for a failure in the shell itself. */
export function RootRouteError() {
  const error = useRouteError();
  const loading = isChunkLoadError(error);
  return (
    <main className="weathered-atlas field-guide-theme grid min-h-dvh place-items-center bg-background px-6 text-foreground">
      <section role="alert" className="w-full max-w-md space-y-5">
        <p className="text-sm text-muted-foreground">goDiesel</p>
        <h1 className="text-3xl font-medium">{loading ? "Let’s get you back on track." : "This view couldn’t open."}</h1>
        <p className="text-base leading-7 text-muted-foreground">
          {loading ? "This page couldn’t finish loading. Check your connection and try again." : "Try opening this page again, or return to your routes."}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => window.location.reload()}>Try again</Button>
          <BackToRoutes />
        </div>
      </section>
    </main>
  );
}
