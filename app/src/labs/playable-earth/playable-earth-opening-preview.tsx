import { useLayoutEffect, useRef } from "react";

import type { QuestRoute } from "@/domain/route";

const PREVIEW_PALETTES = {
  mountain: { background: "#233532", contour: "#79917b", terrain: "#455f50" },
  urban: { background: "#243238", contour: "#71858a", terrain: "#4d615f" },
  coastal: { background: "#173a3e", contour: "#548077", terrain: "#315e52" },
};

function paletteFor(route: QuestRoute) {
  const identity = `${route.name} ${route.region}`.toLowerCase();
  if (identity.includes("banff") || identity.includes("mountain")) {
    return PREVIEW_PALETTES.mountain;
  }
  if (identity.includes("ucluelet") || identity.includes("coast")) {
    return PREVIEW_PALETTES.coastal;
  }
  return PREVIEW_PALETTES.urban;
}

export function PlayableEarthOpeningPreview({ route }: { route: QuestRoute }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || route.route.length < 2) return;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;
    const palette = paletteFor(route);
    const latitudeScale = Math.max(
      0.1,
      Math.cos((route.centerLat * Math.PI) / 180),
    );
    const points = route.route.map((point) => ({
      x: (point.lng - route.centerLng) * latitudeScale,
      y: point.lat - route.centerLat,
    }));
    const minimumX = Math.min(...points.map((point) => point.x));
    const maximumX = Math.max(...points.map((point) => point.x));
    const minimumY = Math.min(...points.map((point) => point.y));
    const maximumY = Math.max(...points.map((point) => point.y));

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.fillStyle = palette.background;
      context.fillRect(0, 0, width, height);

      const spacing = Math.max(36, Math.min(width, height) / 12);
      context.lineWidth = 1;
      for (let offset = -height; offset < width + height; offset += spacing) {
        context.beginPath();
        context.moveTo(offset, 0);
        context.lineTo(offset - height * 0.3, height);
        context.strokeStyle = "rgba(233,240,222,0.055)";
        context.stroke();
      }
      for (let ring = 1; ring <= 7; ring += 1) {
        context.beginPath();
        context.ellipse(
          width * 0.5,
          height * 0.52,
          ring * spacing * 1.25,
          ring * spacing * 0.72,
          -0.18,
          0,
          Math.PI * 2,
        );
        context.strokeStyle = `${palette.contour}${ring % 2 === 0 ? "30" : "20"}`;
        context.stroke();
      }
      context.fillStyle = `${palette.terrain}66`;
      context.fillRect(0, height * 0.64, width, height * 0.36);

      const paddingX = Math.min(140, width * 0.14);
      const paddingY = Math.min(120, height * 0.16);
      const spanX = Math.max(0.000001, maximumX - minimumX);
      const spanY = Math.max(0.000001, maximumY - minimumY);
      const scale = Math.min(
        (width - paddingX * 2) / spanX,
        (height - paddingY * 2) / spanY,
      );
      const routeWidth = spanX * scale;
      const routeHeight = spanY * scale;
      const project = (point: { x: number; y: number }) => ({
        x: (width - routeWidth) * 0.5 + (point.x - minimumX) * scale,
        y: (height - routeHeight) * 0.5 + (maximumY - point.y) * scale,
      });
      const trace = () => {
        context.beginPath();
        points.forEach((point, index) => {
          const projected = project(point);
          if (index === 0) context.moveTo(projected.x, projected.y);
          else context.lineTo(projected.x, projected.y);
        });
      };
      trace();
      context.strokeStyle = "rgba(255,248,230,0.92)";
      context.lineWidth = 7;
      context.stroke();
      trace();
      context.strokeStyle = "#ff9e68";
      context.lineWidth = 3.5;
      context.stroke();

      const start = project(points[0]);
      const finish = project(points.at(-1)!);
      for (const marker of [start, finish]) {
        context.beginPath();
        context.arc(marker.x, marker.y, 5, 0, Math.PI * 2);
        context.fillStyle = "#fff8e8";
        context.fill();
        context.beginPath();
        context.arc(marker.x, marker.y, 2.5, 0, Math.PI * 2);
        context.fillStyle = "#ff9e68";
        context.fill();
      }
      canvas.dataset.worldPackMeaningfulView = "true";
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [route]);

  return (
    <canvas
      ref={canvasRef}
      aria-label="Local World Pack route preview"
      data-network-required="false"
      className="pointer-events-none absolute inset-0 z-[1] size-full"
    />
  );
}
