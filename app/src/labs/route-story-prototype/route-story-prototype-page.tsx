// Throwaway prototype: four route-story compositions, switchable with ?variant=.
import { useParams, useSearchParams } from "react-router-dom";

import { APP_PATHS, decodedRouteSlug } from "@/app/route-paths";
import { findRouteBySlug } from "@/data/routes";
import { useRouteDetail } from "@/data/use-route-detail";
import { AtlasDossierPrototype } from "@/labs/route-story-prototype/variant-atlas-dossier";
import { CinematicCartographyPrototype } from "@/labs/route-story-prototype/variant-cinematic-cartography";
import { MapAsIndexPrototype } from "@/labs/route-story-prototype/variant-map-as-index";
import { SplitEvidencePrototype } from "@/labs/route-story-prototype/variant-split-evidence";
import {
  PROTOTYPE_VARIANTS,
  PrototypeSwitcher,
  type PrototypeVariantId,
} from "@/labs/route-story-prototype/prototype-switcher";

const VARIANT_COMPONENT = {
  dossier: AtlasDossierPrototype,
  index: MapAsIndexPrototype,
  split: SplitEvidencePrototype,
  cinematic: CinematicCartographyPrototype,
};

export function RouteStoryPrototypePage() {
  const { routeSlug } = useParams();
  const decodedSlug = decodedRouteSlug(routeSlug);
  const summary = decodedSlug ? findRouteBySlug(decodedSlug) : undefined;
  const detail = useRouteDetail(summary?.slug, 0);
  const [searchParams] = useSearchParams();
  const requested = searchParams.get("variant");
  const variant: PrototypeVariantId = PROTOTYPE_VARIANTS.some((item) => item.id === requested)
    ? (requested as PrototypeVariantId)
    : "dossier";

  if (!summary || detail.status === "not-found") {
    return <PrototypeState title="Route unavailable" detail="Choose a recorded route from the library." />;
  }
  if (summary.lifecycle !== "completed") {
    return <PrototypeState title="Recorded routes only" detail="These story prototypes require a completed activity with owner-recorded geography." />;
  }
  if (detail.status !== "ready") {
    return <PrototypeState title="Opening route prototypes" detail="Loading recorded geography and story evidence." />;
  }

  const Variant = VARIANT_COMPONENT[variant];
  return (
    <main className="field-guide-theme h-dvh overflow-hidden bg-canvas">
      <Variant route={detail.route} routesPath={APP_PATHS.routes} />
      <PrototypeSwitcher current={variant} />
    </main>
  );
}

function PrototypeState({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="field-guide-theme grid h-dvh place-items-center bg-canvas px-6 text-ink">
      <div className="max-w-md border-y border-line py-8">
        <h1 className="font-editorial text-4xl">{title}</h1>
        <p className="mt-3 text-body text-ink-secondary">{detail}</p>
      </div>
    </main>
  );
}
