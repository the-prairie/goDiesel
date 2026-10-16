export interface MetadataField {
  label: string;
  text: string;
}

const values = (value: unknown): string => {
  if (Array.isArray(value))
    return [...new Set(value.map(values).filter(Boolean))].join(". ");
  if (value && typeof value === "object")
    return Object.values(value).map(values).filter(Boolean).join(". ");
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
};

export function routeMetadata(route: Record<string, unknown>): MetadataField[] {
  const fields: [string, unknown][] = [
    ["Title", [route.activity_name ?? route.activityName, route.name === route.region ? undefined : route.name, route.subtitle]],
    ["Description", route.description],
    ["Place", route.region],
    ["Date", route.date],
    ["Activity", route.type],
    ["Distance", route.distance_km ?? route.distanceKm],
    ["Climb", route.elevation_gain_m ?? route.elevationGainM],
    ["Difficulty", route.difficulty],
    ["Theme", route.theme],
    ["Completion", [route.completion_rule ?? route.completionRule, route.quest_blurb]],
    ["Status", route.lifecycle],
    ["ID", [route.slug, route.activity_id ?? route.activityId]],
    ["Guide", route.curation ?? route.guide],
    ["Annotation", Array.isArray(route.annotations) ? route.annotations.map(a => [a.title, a.body, a.kind, a.evidence]) : undefined],
    ["Recording", (route.provenance as { temporal?: unknown } | undefined)?.temporal],
  ];
  return fields.map(([label, value]) => ({ label, text: values(value) })).filter(field => field.text);
}

export const literalTokens = (text: string) => text.toLowerCase().normalize("NFKD")
  .replace(/\p{M}/gu, "").match(/[\p{L}\p{N}]+|\p{Extended_Pictographic}/gu) ?? [];

export function matchMetadata(fields: MetadataField[], query: string): MetadataField | undefined {
  const terms = literalTokens(query);
  if (!terms.length) return undefined;
  const matches = (text: string) => {
    const tokens = literalTokens(text);
    if (terms.every(term => /^\p{N}+$/u.test(term))) return ` ${tokens.join(" ")} `.includes(` ${terms.join(" ")} `);
    return terms.every(term => tokens.some(token => token.startsWith(term)));
  };
  const field = fields.find(field => matches(field.text));
  if (field) return field;
  if (!matches(fields.map(field => field.text).join(" "))) return undefined;
  return {
    label: "Metadata",
    text: fields
      .filter(field => literalTokens(field.text).some(token => terms.some(term => token.startsWith(term))))
      .map(field => `${field.label}: ${field.text}`)
      .join(" · "),
  };
}
