export interface AdventurePublicationManifest {
  adventure: string;
  legs: string[];
  sourceSha256: string;
  files: { path: string; bytes: number; sha256: string }[];
}

export function stageAdventurePublication(options: {
  store?: string;
  id: string;
  dist: string;
  approval?: string;
  dryRun?: boolean;
}): AdventurePublicationManifest;
