import { useEffect, useRef } from "react";

const EARTH_RADIUS_M = 6_378_137;

export function NightEarthDisc({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const image = new Image();
    image.src = "/earth/black-marble-2016.jpg";
    image.onload = () => {
      imageRef.current = image;
    };
    return () => {
      image.onload = null;
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    let frame = 0;
    let lastKey = "";
    const draw = () => {
      frame = window.requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const image = imageRef.current;
      if (!canvas || !image?.complete || image.naturalWidth === 0) return;
      const key = paintNightEarth(canvas, image);
      if (key) lastKey = key;
      else if (lastKey) return;
    };
    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, [active]);

  if (!active) return null;
  return <canvas ref={canvasRef} className="atlas-object-earth" data-testid="atlas-object-earth" aria-hidden="true" />;
}

function paintNightEarth(canvas: HTMLCanvasElement, image: HTMLImageElement) {
  const source = document.querySelector("canvas[data-atlas-engine='cesium']");
  if (!(source instanceof HTMLCanvasElement)) return "";
  if (!cesiumIsBlank(source)) {
    const context = canvas.getContext("2d");
    context?.clearRect(0, 0, canvas.width, canvas.height);
    canvas.dataset.frameKey = "cesium";
    return "cesium";
  }
  const lat = Number(source.dataset.cameraLat);
  const lng = Number(source.dataset.cameraLng);
  const height = Number(source.dataset.cameraHeight);
  const fovy = Number(source.dataset.cameraFovy);
  const heading = Number(source.dataset.cameraHeading);
  if (![lat, lng, height, fovy].every(Number.isFinite) || fovy <= 0) return "";
  const width = canvas.clientWidth;
  const viewHeight = canvas.clientHeight;
  if (width < 2 || viewHeight < 2) return "";
  const key = `${lat.toFixed(3)}|${lng.toFixed(3)}|${Math.round(height)}|${width}`;
  if (canvas.dataset.frameKey === key) return key;
  canvas.dataset.frameKey = key;
  canvas.width = width;
  canvas.height = viewHeight;
  const context = canvas.getContext("2d");
  if (!context) return "";
  const pixels = context.createImageData(width, viewHeight);
  const data = pixels.data;
  const distance = EARTH_RADIUS_M + height;
  const limb = Math.asin(Math.min(0.999, EARTH_RADIUS_M / distance));
  const focal = (viewHeight / 2) / Math.tan(fovy / 2);
  const radius = Math.max(8, focal * Math.tan(limb));
  const centerX = width / 2;
  const centerY = viewHeight / 2;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLng = Math.sin(lng);
  const cosLng = Math.cos(lng);
  const sinHeading = Math.sin(heading || 0);
  const cosHeading = Math.cos(heading || 0);
  const left = Math.max(0, Math.floor(centerX - radius));
  const right = Math.min(width - 1, Math.ceil(centerX + radius));
  const top = Math.max(0, Math.floor(centerY - radius));
  const bottom = Math.min(viewHeight - 1, Math.ceil(centerY + radius));
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const east = (x - centerX) / radius;
      const north = (centerY - y) / radius;
      const turnedEast = east * cosHeading - north * sinHeading;
      const turnedNorth = east * sinHeading + north * cosHeading;
      const disc = turnedEast * turnedEast + turnedNorth * turnedNorth;
      if (disc > 1) continue;
      const up = Math.sqrt(1 - disc);
      const sample = geographic(turnedEast, turnedNorth, up, sinLat, cosLat, sinLng, cosLng);
      const u = ((sample.lng + Math.PI) / (Math.PI * 2)) * image.naturalWidth;
      const v = ((Math.PI / 2 - sample.lat) / Math.PI) * image.naturalHeight;
      const color = sampleImage(image, u, v);
      const index = (y * width + x) * 4;
      data[index] = color[0];
      data[index + 1] = color[1];
      data[index + 2] = color[2];
      data[index + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  return key;
}

function cesiumIsBlank(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  if (!gl || canvas.width < 16 || canvas.height < 16) return true;
  const samples = [[0.5, 0.5], [0.38, 0.42], [0.62, 0.46], [0.5, 0.34]];
  for (const [xRatio, yRatio] of samples) {
    const pixel = new Uint8Array(4);
    gl.readPixels(
      Math.floor(canvas.width * xRatio),
      Math.floor(canvas.height * yRatio),
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixel,
    );
    if (pixel[0] + pixel[1] + pixel[2] > 28) return false;
  }
  return true;
}

function geographic(
  east: number,
  north: number,
  up: number,
  sinLat: number,
  cosLat: number,
  sinLng: number,
  cosLng: number,
) {
  const x = -sinLng * east - sinLat * cosLng * north + cosLat * cosLng * up;
  const y = cosLng * east - sinLat * sinLng * north + cosLat * sinLng * up;
  const z = cosLat * north + sinLat * up;
  return { lat: Math.asin(Math.max(-1, Math.min(1, z))), lng: Math.atan2(y, x) };
}

function sampleImage(image: HTMLImageElement, u: number, v: number) {
  const canvas = imageCanvas(image);
  const x = Math.max(0, Math.min(canvas.width - 1, Math.floor(u)));
  const y = Math.max(0, Math.min(canvas.height - 1, Math.floor(v)));
  const index = (y * canvas.width + x) * 4;
  const data = imagePixels(canvas);
  return [data[index], data[index + 1], data[index + 2]] as const;
}

let cachedImage: HTMLImageElement | null = null;
let cachedCanvas: HTMLCanvasElement | null = null;
let cachedPixels: Uint8ClampedArray | null = null;

function imageCanvas(image: HTMLImageElement) {
  if (cachedImage === image && cachedCanvas && cachedPixels) return cachedCanvas;
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  context?.drawImage(image, 0, 0);
  cachedImage = image;
  cachedCanvas = canvas;
  cachedPixels = context?.getImageData(0, 0, canvas.width, canvas.height).data ?? null;
  return canvas;
}

function imagePixels(canvas: HTMLCanvasElement) {
  if (cachedCanvas === canvas && cachedPixels) return cachedPixels;
  const data = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
  cachedPixels = data ?? new Uint8ClampedArray();
  return cachedPixels;
}
