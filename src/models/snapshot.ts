import type { User } from "./user.ts";
import type { Group } from "./group.ts";

export interface Snapshot {
  users: User[];
  groups: Group[]; // includes synthetic / mirrored
  generatedAt: string; // ISO timestamp
  sequence: number; // monotonic counter
  featureFlags: string[]; // enabled
}

export function newEmptySnapshot(): Snapshot {
  return {
    users: [],
    groups: [],
    generatedAt: new Date().toISOString(),
    sequence: 0,
    featureFlags: [],
  };
}
