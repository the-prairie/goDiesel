/** Ephemeral reading context; scoped to a D day and the region it belongs to. */
export interface DayContext { leafOpen: boolean; photoUrl?: string; progress?: number }
const days = new Map<string, DayContext>();
export function readDayContext(key: string) { return days.get(key); }
export function writeDayContext(key: string, value: DayContext) {
  days.delete(key);
  days.set(key, value);
  if (days.size > 12) days.delete(days.keys().next().value!);
}
