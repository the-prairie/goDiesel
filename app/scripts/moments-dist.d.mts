export interface PublicMomentsData {
  catalog: { id: string; clip: string | null; public?: boolean; [key: string]: unknown }[];
  placements: { id: string; entryId: string | null; [key: string]: unknown }[];
}
export function publicMoments(data: unknown, exists: (file: string) => boolean): { moments: PublicMomentsData | null; clips: string[] };
