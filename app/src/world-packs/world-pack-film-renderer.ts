import type { QuestRoute } from "@/domain/route";
import {
  worldPackCameraFrame,
  type WorldPackCameraTimeline,
} from "@/world-packs/world-pack-cinematic";
import type {
  WorldObstacle,
  WorldPhysicsRuntime,
} from "@/world-packs/world-physics";

interface FilmPalette {
  background: string;
  building: string;
  buildingShadow: string;
  contour: string;
  route: string;
  routeHalo: string;
  terrainHigh: [number, number, number];
  terrainLow: [number, number, number];
  text: string;
}

const PALETTES: Record<string, FilmPalette> = {
  "banff-mountain": {
    background: "#142129",
    building: "#bec4b6",
    buildingShadow: "#263c39",
    contour: "#d8d5b4",
    route: "#ffb36f",
    routeHalo: "#fff7e6",
    terrainHigh: [181, 190, 148],
    terrainLow: [50, 90, 78],
    text: "#f5f1df",
  },
  "tokyo-urban": {
    background: "#17242b",
    building: "#c8d0d2",
    buildingShadow: "#253b43",
    contour: "#cad8d4",
    route: "#ff9f6e",
    routeHalo: "#fff8ea",
    terrainHigh: [137, 157, 143],
    terrainLow: [56, 83, 81],
    text: "#f6f3e8",
  },
  "ucluelet-coastal": {
    background: "#10272d",
    building: "#c4c9bd",
    buildingShadow: "#203e3d",
    contour: "#b9d5c2",
    route: "#ffc078",
    routeHalo: "#f9f4df",
    terrainHigh: [145, 171, 130],
    terrainLow: [37, 91, 78],
    text: "#f1f0df",
  },
};

interface Projection {
  centreX: number;
  centreY: number;
  directionX: number;
  directionY: number;
  height: number;
  rightX: number;
  rightY: number;
  scale: number;
  targetX: number;
  targetY: number;
  width: number;
}

function mixChannel(low: number, high: number, ratio: number) {
  return Math.round(low + (high - low) * ratio);
}

function terrainColor(palette: FilmPalette, ratio: number, variation: number) {
  const value = Math.max(0, Math.min(1, ratio * 0.82 + variation * 0.18));
  return `rgb(${palette.terrainLow.map((low, index) =>
    mixChannel(low, palette.terrainHigh[index], value),
  ).join(",")})`;
}

function project(projection: Projection, x: number, y: number) {
  const dx = x - projection.targetX;
  const dy = y - projection.targetY;
  return {
    x:
      projection.centreX +
      (dx * projection.rightX + dy * projection.rightY) * projection.scale,
    y:
      projection.centreY -
      (dx * projection.directionX + dy * projection.directionY) *
        projection.scale,
  };
}

function polygon(
  context: CanvasRenderingContext2D,
  points: readonly { x: number; y: number }[],
) {
  context.beginPath();
  points.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.closePath();
}

function obstacleVisible(obstacle: WorldObstacle, projection: Projection) {
  const radiusM = Math.max(projection.width, projection.height) / projection.scale;
  return !(
    obstacle.maximumX < projection.targetX - radiusM ||
    obstacle.minimumX > projection.targetX + radiusM ||
    obstacle.maximumY < projection.targetY - radiusM ||
    obstacle.minimumY > projection.targetY + radiusM
  );
}

export class WorldPackFilmRenderer {
  private context: CanvasRenderingContext2D;
  private palette: FilmPalette;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly route: QuestRoute,
    private readonly runtime: WorldPhysicsRuntime,
    private readonly timeline: WorldPackCameraTimeline,
  ) {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("The deterministic film canvas is unavailable.");
    this.context = context;
    this.palette = PALETTES[runtime.worldId] ?? PALETTES["banff-mountain"];
    canvas.dataset.worldPackState = "ready";
    canvas.dataset.worldPackId = runtime.packId;
    canvas.dataset.worldId = runtime.worldId;
    canvas.dataset.networkRequired = "false";
    canvas.dataset.cinematicDuration = String(
      timeline.durationFrames / timeline.framesPerSecond,
    );
    canvas.dataset.cinematicTimeline = timeline.timelineId;
    canvas.dataset.filmRenderer = "deterministic-topographic-v1";
  }

  render(seconds: number) {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const frame = worldPackCameraFrame(this.timeline, seconds);
    const horizontalX = frame.target[0] - frame.camera[0];
    const horizontalY = frame.target[1] - frame.camera[1];
    const horizontalRange = Math.max(1, Math.hypot(horizontalX, horizontalY));
    const projection: Projection = {
      centreX: width * 0.5,
      centreY: height * 0.53,
      directionX: horizontalX / horizontalRange,
      directionY: horizontalY / horizontalRange,
      height,
      rightX: horizontalY / horizontalRange,
      rightY: -horizontalX / horizontalRange,
      scale: Math.min(width, height) / (horizontalRange * 2.15),
      targetX: frame.target[0],
      targetY: frame.target[1],
      width,
    };
    this.drawBackground(width, height, frame.frame);
    this.drawTerrain(projection);
    this.drawSurveyGrid(width, height, frame.frame);
    this.drawStructures(projection);
    this.drawRoute(projection, frame.routePointIndex);
    this.drawTitles(width, height, seconds, frame.routePointIndex);
    this.canvas.dataset.cinematicFrame = frame.frame.toFixed(6);
    this.canvas.dataset.cinematicSeconds = seconds.toFixed(6);
  }

  private drawBackground(width: number, height: number, frame: number) {
    const context = this.context;
    context.fillStyle = this.palette.background;
    context.fillRect(0, 0, width, height);
    context.fillStyle = "rgba(255,255,255,0.035)";
    const offset = Math.floor(frame) % 47;
    for (let y = -47 + offset; y < height; y += 47) {
      for (let x = (y / 47) % 2 === 0 ? 18 : 41; x < width; x += 94) {
        context.fillRect(x, y, 1, 1);
      }
    }
  }

  private drawTerrain(projection: Projection) {
    const context = this.context;
    const terrain = this.runtime.heightfield;
    const values = terrain.heights.flat();
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const range = Math.max(1, maximum - minimum);
    context.lineWidth = 0.55;
    for (let row = 0; row < terrain.yAxis.length - 1; row += 1) {
      for (let column = 0; column < terrain.xAxis.length - 1; column += 1) {
        const corners = [
          project(projection, terrain.xAxis[column], terrain.yAxis[row]),
          project(projection, terrain.xAxis[column + 1], terrain.yAxis[row]),
          project(
            projection,
            terrain.xAxis[column + 1],
            terrain.yAxis[row + 1],
          ),
          project(projection, terrain.xAxis[column], terrain.yAxis[row + 1]),
        ];
        const cellHeights = [
          terrain.heights[row][column],
          terrain.heights[row][column + 1],
          terrain.heights[row + 1][column + 1],
          terrain.heights[row + 1][column],
        ];
        const mean = cellHeights.reduce((total, value) => total + value, 0) / 4;
        const variation =
          Math.max(...cellHeights) - Math.min(...cellHeights) > range * 0.015
            ? 0.9
            : (row + column) % 4 / 8;
        polygon(context, corners);
        context.fillStyle = terrainColor(
          this.palette,
          (mean - minimum) / range,
          variation,
        );
        context.fill();
        context.strokeStyle = "rgba(230,238,220,0.11)";
        context.stroke();
      }
    }
  }

  private drawStructures(projection: Projection) {
    const context = this.context;
    for (const obstacle of this.runtime.obstacles) {
      if (!obstacle.footprint || !obstacleVisible(obstacle, projection)) continue;
      const roof = obstacle.footprint.map(([x, y]) => project(projection, x, y));
      if (
        roof.every(
          (point) =>
            point.x < -20 ||
            point.x > projection.width + 20 ||
            point.y < -20 ||
            point.y > projection.height + 20,
        )
      ) continue;
      const extrusion = Math.max(
        2,
        Math.min(18, (obstacle.maximumZ - obstacle.minimumZ) * projection.scale * 0.16),
      );
      const shadow = roof.map((point) => ({
        x: point.x - extrusion * 0.55,
        y: point.y + extrusion,
      }));
      polygon(context, shadow);
      context.fillStyle = this.palette.buildingShadow;
      context.fill();
      polygon(context, roof);
      context.fillStyle = this.palette.building;
      context.fill();
      context.strokeStyle = "rgba(17,35,39,0.52)";
      context.lineWidth = 0.7;
      context.stroke();
    }
  }

  private drawSurveyGrid(width: number, height: number, frame: number) {
    const context = this.context;
    const offset = (Math.floor(frame) % 32) / 8;
    context.strokeStyle = "rgba(240,244,225,0.055)";
    context.lineWidth = 0.55;
    for (let x = -height + offset; x < width + height; x += 32) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x - height * 0.22, height);
      context.stroke();
    }
    context.fillStyle = "rgba(250,247,225,0.09)";
    for (let y = 16; y < height; y += 48) {
      for (let x = 16 + ((y / 48) % 2) * 24; x < width; x += 48) {
        context.fillRect(x, y, 1, 1);
      }
    }
  }

  private drawRoute(projection: Projection, activeIndex: number) {
    const context = this.context;
    const nodes = this.runtime.navigation.nodes;
    const draw = (endIndex: number) => {
      context.beginPath();
      nodes.slice(0, endIndex + 1).forEach((node, index) => {
        const point = project(projection, node.position[0], node.position[1]);
        if (index === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      });
    };
    draw(nodes.length - 1);
    context.strokeStyle = "rgba(255,255,255,0.24)";
    context.lineWidth = 2.2;
    context.stroke();
    draw(Math.min(nodes.length - 1, Math.max(1, activeIndex)));
    context.strokeStyle = this.palette.routeHalo;
    context.lineWidth = 6.4;
    context.stroke();
    context.strokeStyle = this.palette.route;
    context.lineWidth = 3.5;
    context.stroke();
    const current = project(
      projection,
      nodes[Math.min(nodes.length - 1, activeIndex)].position[0],
      nodes[Math.min(nodes.length - 1, activeIndex)].position[1],
    );
    context.beginPath();
    context.arc(current.x, current.y, 5.5, 0, Math.PI * 2);
    context.fillStyle = this.palette.routeHalo;
    context.fill();
    context.beginPath();
    context.arc(current.x, current.y, 3.2, 0, Math.PI * 2);
    context.fillStyle = this.palette.route;
    context.fill();
  }

  private drawTitles(
    width: number,
    height: number,
    seconds: number,
    routePointIndex: number,
  ) {
    const context = this.context;
    const progress = routePointIndex / Math.max(1, this.runtime.navigation.nodes.length - 1);
    context.shadowColor = "rgba(5,14,18,0.92)";
    context.shadowBlur = 5;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 1;
    context.fillStyle = this.palette.text;
    context.font = "600 15px Inter, sans-serif";
    context.fillText(this.route.name.toUpperCase(), 28, 31);
    context.fillStyle = "rgba(244,242,226,0.64)";
    context.font = "500 10px Inter, sans-serif";
    context.fillText(
      `${this.runtime.worldId.toUpperCase()}  /  SEALED WORLD PACK`,
      28,
      51,
    );
    const right = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
      Math.floor(seconds % 60),
    ).padStart(2, "0")}  /  ${Math.round(progress * 100)}%`;
    context.textAlign = "right";
    context.fillStyle = this.palette.text;
    context.font = "600 11px Inter, sans-serif";
    context.fillText(right, width - 28, 42);
    context.textAlign = "left";
    context.shadowColor = "transparent";
    context.shadowBlur = 0;
    context.shadowOffsetY = 0;
    context.fillStyle = "rgba(255,255,255,0.18)";
    context.fillRect(28, height - 18, width - 56, 2);
    context.fillStyle = this.palette.route;
    context.fillRect(28, height - 18, (width - 56) * progress, 2);
  }

  destroy() {
    this.canvas.remove();
  }
}
