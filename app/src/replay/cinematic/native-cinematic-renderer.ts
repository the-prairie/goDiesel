import type { QuestRoute } from "@/domain/routes";
import type { CinematicRendererStatus } from "@/replay/cinematic/cesium-cinematic-renderer";
import type { CinematicFrame } from "@/replay/cinematic/route-cinematic-director";
import {
  createGoogleRouteNavigatorEngine,
  type GoogleRouteNavigatorEngine,
} from "@/replay/google/google-route-navigator-engine";

interface MountOptions {
  container: HTMLElement;
  frame: CinematicFrame;
  onStatus: (status: CinematicRendererStatus) => void;
  route: QuestRoute;
}

export class NativeCinematicRenderer {
  private engine?: GoogleRouteNavigatorEngine;

  async mount({ container, route, frame, onStatus }: MountOptions) {
    container.dataset.cinematicState = "loading";
    const engine = createGoogleRouteNavigatorEngine();
    this.engine = engine;
    await engine.mount({
      apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "",
      container,
      route,
      groundingMode: "mesh",
      onStatus: (status) => {
        container.dataset.cinematicState = status.state;
        onStatus(status);
      },
      routeStyle: {
        color: "#f16c4b",
        outerColor: "#f8f4ea",
        outerWidth: 0.42,
        width: 7,
      },
    });
    this.setFrame(frame);
  }

  setFrame(frame: CinematicFrame) {
    this.engine?.setCamera({
      center: { lat: frame.target.lat, lng: frame.target.lng },
      fovDeg:
        frame.cut === "intimate" ? 54 : frame.cut === "kinetic" ? 48 : 44,
      headingDeg: frame.headingDeg,
      progressM: frame.routeProgressM,
      rangeM: frame.rangeM,
      tiltDeg: Math.min(82, Math.max(18, 90 + frame.pitchDeg)),
    });
    this.engine?.setRouteReveal(frame.threadEndRatio);
  }

  setInteractive(enabled: boolean) {
    this.engine?.setFollowing(!enabled);
  }

  destroy() {
    this.engine?.destroy();
    this.engine = undefined;
  }
}
