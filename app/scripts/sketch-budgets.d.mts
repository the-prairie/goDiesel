export interface LabBucket {
  id: string;
  label: string;
  match: RegExp;
  kib: number;
  each?: boolean;
}
export const LAB_BUCKETS: LabBucket[];
export function bucketChunks(names: readonly string[]): { buckets: Map<string, string[]>; unassigned: string[]; ambiguous: string[] };
export function overBudget(buckets: Map<string, string[]>, sizeOf: (name: string) => number): { id: string; label: string; kib: number; bytes: number }[];
