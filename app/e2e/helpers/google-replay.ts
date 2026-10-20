import type { Page } from "@playwright/test";

export async function installGoogleReplay(page: Page, state: "ready" | "unavailable" | "loading") {
  await page.addInitScript((providerState) => {
    const replayWindow = window as typeof window & {
      __GODIESEL_SET_PROVIDER_STATUS__?: (state: "ready" | "loading" | "unavailable") => void;
      __GODIESEL_MANUAL_CAMERA__?: { center: { lat: number; lng: number; altitude: number }; headingDeg: number; rangeM: number; tiltDeg: number; fovDeg: number };
      __GODIESEL_CAMERA_CALLS__?: Array<{
        center: { lat: number; lng: number };
        headingDeg: number;
      }>;
      __GODIESEL_CINEMATIC_ROUTE_CALLS__?: Array<{
        startRatio: number;
        focusRatio: number;
        endRatio: number;
      }>;
      __GODIESEL_GOOGLE_ROUTE_NAVIGATOR_FACTORY__?: () => {
        mount(options: {
          container: HTMLElement;
          onStatus: (status: {
            state: "ready" | "unavailable" | "loading";
            message: string;
          }) => void;
        }): Promise<void>;
        readCamera(): unknown;
        setCamera(): void;
        setFollowing(): void;
        setGrounding(): void;
        setCinematicRoute(treatment: {
          startRatio: number;
          focusRatio: number;
          endRatio: number;
        }): void;
        setRouteReveal(): void;
        destroy(): void;
      };
      __GODIESEL_REPLAY_ENGINE_FACTORY__?: () => {
        mount(options: {
          container: HTMLElement;
          onStatus: (status: {
            state: "ready";
            title: string;
            message: string;
          }) => void;
        }): Promise<void>;
        setPose(): void;
        destroy(): void;
      };
    };

    replayWindow.__GODIESEL_CINEMATIC_ROUTE_CALLS__ = [];
    replayWindow.__GODIESEL_CAMERA_CALLS__ = [];
    replayWindow.__GODIESEL_GOOGLE_ROUTE_NAVIGATOR_FACTORY__ = () => ({
      async mount({ container, onStatus }) {
        replayWindow.__GODIESEL_SET_PROVIDER_STATUS__ = (state) => onStatus({ state, message: `Google 3D fixture ${state}.` });
        if (providerState === "unavailable") {
          onStatus({
            state: "unavailable",
            message: "Google 3D fixture unavailable.",
          });
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.dataset.renderer = "google-production";
        canvas.style.background = "rgb(30, 80, 96)";
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        const credits = document.createElement("button");
        credits.textContent = "Provider information fixture";
        credits.style.cssText = "position:absolute;bottom:4px;right:10px;height:24px";
        credits.onclick = () => { credits.textContent = "Provider information opened"; };
        container.replaceChildren(canvas, credits);
        onStatus({ state: providerState, message: `Google 3D fixture ${providerState}.` });
      },
      setCamera(pose: {
        center: { lat: number; lng: number };
        headingDeg: number;
      }) {
        replayWindow.__GODIESEL_CAMERA_CALLS__?.push(pose);
      },
      readCamera() { return replayWindow.__GODIESEL_MANUAL_CAMERA__; },
      setFollowing() {},
      setGrounding() {},
      setCinematicRoute(treatment) {
        replayWindow.__GODIESEL_CINEMATIC_ROUTE_CALLS__?.push(treatment);
      },
      setRouteReveal() {},
      destroy() {},
    });

    replayWindow.__GODIESEL_REPLAY_ENGINE_FACTORY__ = () => ({
      async mount({ container, onStatus }) {
        const canvas = document.createElement("canvas");
        canvas.dataset.renderer = "atlas-fallback";
        container.replaceChildren(canvas);
        onStatus({
          state: "ready",
          title: "Atlas replay ready",
          message: "Fallback fixture ready.",
        });
      },
      setPose() {},
      destroy() {},
    });
  }, state);
}

