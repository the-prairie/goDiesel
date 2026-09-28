import {
  parseAdventure,
  parseAdventureIndex,
  type Adventure,
  type AdventureIndex,
} from "@/domain/adventure";

// Adventures live in the local store served by dev and preview. A build has
// none, which is a normal state: the route simply has no adventure layer.

function storeUrl(relative: string) {
  const base = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}adventures/${relative}`;
}

let indexRequest: Promise<AdventureIndex | undefined> | undefined;
const adventureRequests = new Map<string, Promise<Adventure | undefined>>();

async function fetchJson(url: string) {
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) return undefined;
    if (!response.headers.get("content-type")?.includes("json")) return undefined;
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

function loadIndex() {
  indexRequest ??= fetchJson(storeUrl("index.json")).then((value) => {
    if (value === undefined) return undefined;
    try {
      return parseAdventureIndex(value);
    } catch (error) {
      console.warn("Adventure index is invalid; adventures are unavailable.", error);
      return undefined;
    }
  });
  return indexRequest;
}

function loadAdventure(id: string) {
  const existing = adventureRequests.get(id);
  if (existing) return existing;
  const request = fetchJson(storeUrl(`${encodeURIComponent(id)}/adventure.json`)).then((value) => {
    if (value === undefined) return undefined;
    try {
      const adventure = parseAdventure(value);
      return adventure.id === id ? adventure : undefined;
    } catch (error) {
      console.warn(`Adventure ${id} is invalid and was not loaded.`, error);
      return undefined;
    }
  });
  adventureRequests.set(id, request);
  return request;
}

/** The adventure that includes this recording, if one is available locally. */
export async function loadAdventureForRoute(slug: string) {
  const index = await loadIndex();
  const entry = index?.adventures.find((adventure) => adventure.legs.includes(slug));
  return entry ? loadAdventure(entry.id) : undefined;
}

export function adventureMediaUrl(adventure: Adventure, relative: string) {
  return storeUrl(`${encodeURIComponent(adventure.id)}/${relative.split("/").map(encodeURIComponent).join("/")}`);
}

/** Every adventure in the local store, for the owner's workspace. */
export async function loadAdventureIndex() {
  return loadIndex();
}

export async function loadAdventureById(id: string, fresh = false) {
  if (fresh) adventureRequests.delete(id);
  return loadAdventure(id);
}

const writerUrl = (relative = "") => storeUrl(relative).replace("adventures/", "__adventure-writer/");

/** The owner's writer exists only on the local dev server. */
export async function adventureWriterAvailable() {
  try {
    const response = await fetch(writerUrl(), { method: "GET" });
    if (!response.headers.get("content-type")?.includes("json")) return false;
    const body = (await response.json()) as { error?: string };
    return response.status === 403 && body.error === "Only PUT is accepted.";
  } catch {
    return false;
  }
}

async function put(relative: string, body: unknown) {
  const response = await fetch(writerUrl(relative), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(result.error ?? `The writer answered ${response.status}.`);
}

export async function saveAdventure(adventure: Adventure) {
  await put(encodeURIComponent(adventure.id), adventure);
  adventureRequests.delete(adventure.id);
  indexRequest = undefined;
}

export async function savePublicationPlan(id: string, plan: unknown) {
  await put(`${encodeURIComponent(id)}/publication-plan`, plan);
}
