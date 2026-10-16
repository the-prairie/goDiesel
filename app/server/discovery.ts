import {
  parseExternalRoutes,
  type DiscoveryPlace,
} from "../src/domain/search/external";
// Fixed upstreams; request text is never interpreted as a URL or Overpass query.
const cache = new Map<string, { expires: number; data: unknown }>();
let lastRequest = 0;
export async function discoveryResponse(request: Request): Promise<Response> {
  if (request.method !== "GET")
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  const url = new URL(request.url);
  const key = url.searchParams.toString();
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return Response.json(cached.data);
  const place = url.searchParams.get("place");
  const lat = Number(url.searchParams.get("lat")),
    lng = Number(url.searchParams.get("lng"));
  if (
    place !== null
      ? !place.trim() || place.length > 120
      : !url.searchParams.has("lat") ||
        !url.searchParams.has("lng") ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        Math.abs(lat) > 90 ||
        Math.abs(lng) > 180
  )
    return Response.json(
      { error: "Enter a place or valid coordinates." },
      { status: 400 },
    );
  if (Date.now() - lastRequest < 1100)
    return Response.json(
      { error: "Please wait a moment before searching again." },
      { status: 429 },
    );
  lastRequest = Date.now();
  try {
    let data: unknown;
    if (place !== null) {
      const upstream = new URL("https://photon.komoot.io/api/");
      upstream.searchParams.set("q", place.trim());
      upstream.searchParams.set("limit", "4");
      upstream.searchParams.set("lang", "en");
      const body = await upstreamJson(upstream.toString(), undefined, 15000);
      const places: DiscoveryPlace[] = (body.features ?? []).flatMap(
        (f: {
          geometry?: { coordinates?: number[] };
          properties?: Record<string, string>;
        }) => {
          const p = f.properties ?? {},
            c = f.geometry?.coordinates;
          if (
            !c ||
            !Number.isFinite(c[0]) ||
            !Number.isFinite(c[1]) ||
            Math.abs(c[0]) > 180 ||
            Math.abs(c[1]) > 90
          )
            return [];
          return [
            {
              name: [
                ...new Set(
                  [p.name, p.city, p.state, p.country].filter(Boolean),
                ),
              ].join(", "),
              lng: c[0],
              lat: c[1],
            },
          ];
        },
      );
      data = {
        places: [
          ...new Map(
            places
              .slice()
              .reverse()
              .map((p) => [p.name, p]),
          ).values(),
        ].reverse(),
      };
    } else {
      const activity =
        url.searchParams.get("activity") === "Ride"
          ? "bicycle|mtb"
          : "hiking|foot|running";
      const query = `[out:json][timeout:20][maxsize:8388608];rel(around:18000,${lat.toFixed(5)},${lng.toFixed(5)})[type=route][route~"^(${activity})$"][name];out geom 60;way(r);out tags;`;
      const body = await routeQuery(query);
      data = {
        routes: parseExternalRoutes(body),
        fetchedAt: new Date().toISOString(),
        radiusKm: 18,
      };
    }
    if (cache.size >= 20) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: Date.now() + 30 * 60 * 1000, data });
    return Response.json(data, {
      headers: { "Cache-Control": "private, max-age=1800" },
    });
  } catch (error) {
    const failure = error instanceof ProviderFailure ? error : new ProviderFailure("invalid-response");
    return Response.json(
      {
        error:
          place !== null
            ? "Place search is temporarily unavailable. Please try again shortly."
            : "New-route search is temporarily busy. Your collection is still searchable. Please try again in a minute.",
        code: failure.kind,
      },
      { status: 503, headers: { "Retry-After": "60", "Cache-Control": "no-store" } },
    );
  }
}
async function upstreamJson(
  url: string,
  init: RequestInit | undefined,
  timeout: number,
) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": "goDiesel/1.0 (+https://godiesel.pages.dev; personal route discovery)",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(timeout),
  }).catch(() => { throw new ProviderFailure("connection"); });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new ProviderFailure("http", response.status);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderFailure("invalid-response");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 10_000_000) throw new ProviderFailure("invalid-response");
      chunks.push(value);
    }
  } catch (error) {
    throw error instanceof ProviderFailure ? error : new ProviderFailure("connection");
  } finally {
    await reader.cancel().catch(() => {});
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    throw new ProviderFailure("invalid-response");
  }
}

type FailureKind = "http" | "connection" | "incomplete" | "invalid-response";
class ProviderFailure extends Error {
  constructor(readonly kind: FailureKind, readonly status?: number) {
    super(`Discovery provider ${kind}${status ? ` (${status})` : ""}`);
  }
  get retryable() {
    return this.kind === "connection" || this.kind === "incomplete" ||
      (this.kind === "http" && this.status !== undefined &&
        [408, 429, 500, 502, 503, 504].includes(this.status));
  }
}

// One sequential failover, never a retry loop or a request to a user-supplied host.
async function routeQuery(query: string) {
  const providers = [
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
  ];
  for (const [index, provider] of providers.entries()) {
    try {
      const body = await upstreamJson(provider,
        { method: "POST", body: new URLSearchParams({ data: query }) }, 26000);
      if (!body || typeof body !== "object" || !Array.isArray(body.elements))
        throw new ProviderFailure("invalid-response");
      if (body.remark) throw new ProviderFailure("incomplete");
      return body;
    } catch (error) {
      const failure = error instanceof ProviderFailure ? error : new ProviderFailure("invalid-response");
      console.warn(JSON.stringify({ event: "discovery-provider-failure",
        provider: new URL(provider).hostname, kind: failure.kind, status: failure.status }));
      if (!failure.retryable || index === providers.length - 1) throw failure;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  throw new ProviderFailure("connection");
}
