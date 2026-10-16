import { discoveryResponse } from "../../app/server/discovery";

export async function onRequest(context: {
  request: Request;
  waitUntil: (task: Promise<unknown>) => void;
}) {
  const { request } = context;
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  if (request.method !== "GET" || url.searchParams.has("place") ||
    !url.searchParams.has("lat") || !url.searchParams.has("lng") ||
    !Number.isFinite(lat) || !Number.isFinite(lng) ||
    Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return discoveryResponse(request);

  const edge = (caches as CacheStorage & { default: Cache }).default;
  url.search = new URLSearchParams({
    lat: lat.toFixed(5), lng: lng.toFixed(5),
    activity: url.searchParams.get("activity") === "Ride" ? "Ride" : "Run",
    version: "1",
  }).toString();
  const key = new Request(url);
  const cached = await edge.match(key).catch(() => undefined);
  if (cached) {
    const response = new Response(cached.body, cached);
    response.headers.set("Cache-Control", cached.headers.get("Cache-Control")!.replace("public", "private"));
    return response;
  }

  const response = await discoveryResponse(request);
  if (response.status === 200) {
    const stored = new Response(response.clone().body, response);
    context.waitUntil((async () => {
      const { fetchedAt } = await stored.clone().json();
      if (typeof fetchedAt !== "string") return;
      const remaining = Math.floor((Date.parse(fetchedAt) + 1800_000 - Date.now()) / 1000);
      if (!Number.isFinite(remaining) || remaining <= 0) return;
      stored.headers.set("Cache-Control", `public, max-age=${Math.min(1800, remaining)}`);
      await edge.put(key, stored);
    })().catch(() => {}));
  }
  return response;
}
