// UID/GID allocator service
// Implements deterministic salted FNV-1a 64-bit hashing with limited collision retries
// Falls back to sequential allocation (persisted) after retry budget exhaustion.
// Phase 1: in-memory mapping only (no Redis); structure left extensible.

// (Optional future use) import feature flag types if allocator behavior becomes flag-dependent.
// import { FeatureFlag } from "../models/feature_flags.ts";

// FNV-1a 64-bit constants (using BigInt for intermediate math)
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

export interface AllocationResult {
  id: number;            // Positive integer (truncated 31-bit safe)
  hashed: boolean;       // True if derived from hash path, false if sequential fallback
  collisionCount: number;// Number of collisions encountered before success
}

export interface IdAllocatorOptions {
  salt: string;                  // Salt mixed into hash to reduce collision risk between deployments
  retryLimit?: number;           // Number of rehash attempts with salt variations (default 4)
  floor?: number;                // Minimum allocated ID value (default 10000 to avoid reserved system IDs)
  ceiling?: number;              // Optional max; if reached sequential fallback will wrap or error
  sequentialStart?: number;      // Starting value for sequential fallback (default floor + 1)
}

interface InternalState {
  byKey: Map<string, number>;    // key -> id mapping
  byId: Map<number, string>;     // id -> key reverse mapping for collision detection
  nextSeq: number;               // next sequential candidate
  collisions: number;            // total collisions encountered (metrics hook)
  fallbacks: number;             // total sequential fallback allocations
}

export class IdAllocator {
  private readonly salt: string;
  private readonly retryLimit: number;
  private readonly floor: number;
  private readonly ceiling?: number;
  private state: InternalState;

  constructor(opts: IdAllocatorOptions) {
    this.salt = opts.salt;
    this.retryLimit = opts.retryLimit ?? 4;
    this.floor = opts.floor ?? 10000;
    this.ceiling = opts.ceiling;
    const start = opts.sequentialStart ?? (this.floor + 1);
    this.state = {
      byKey: new Map(),
      byId: new Map(),
      nextSeq: start,
      collisions: 0,
      fallbacks: 0,
    };
  }

  /** Deterministically allocate (or retrieve) an ID for a stable key */
  allocate(key: string): AllocationResult {
    const existing = this.state.byKey.get(key);
    if (existing !== undefined) {
      return { id: existing, hashed: this.state.byId.get(existing) === key, collisionCount: 0 };
    }

    // Attempt hash path first
    let attempt = 0;
    while (attempt <= this.retryLimit) {
      const hashId = this.hashToInt(`${this.salt}:${attempt}:${key}`);
      if (hashId <= this.floor) { // avoid reserved & too-small
        attempt++;
        continue;
      }
      if (this.ceiling && hashId > this.ceiling) {
        attempt++;
        continue;
      }
      const currentKey = this.state.byId.get(hashId);
      if (!currentKey) {
        this.commit(key, hashId);
        return { id: hashId, hashed: true, collisionCount: attempt };
      }
      if (currentKey === key) {
        // Should not happen since existing would have caught, but guard
        return { id: hashId, hashed: true, collisionCount: attempt };
      }
      // Collision
      this.state.collisions++;
      attempt++;
    }

    // Sequential fallback
    const seqId = this.nextSequential();
    this.state.fallbacks++;
    this.commit(key, seqId);
    return { id: seqId, hashed: false, collisionCount: this.retryLimit + 1 };
  }

  /** Stats snapshot for metrics publication */
  stats() {
    return {
      total: this.state.byKey.size,
      collisions: this.state.collisions,
      fallbacks: this.state.fallbacks,
    };
  }

  /** Export internal mapping (for persistence) */
  exportMapping() {
    return Array.from(this.state.byKey.entries()).map(([k, v]) => ({ key: k, id: v }));
  }

  /** Import previously persisted mapping. Does not overwrite existing conflicting entries. */
  importMapping(entries: Array<{ key: string; id: number }>) {
    for (const { key, id } of entries) {
      if (this.state.byKey.has(key)) continue;
      if (this.state.byId.has(id)) continue; // skip conflicting id
      this.state.byKey.set(key, id);
      this.state.byId.set(id, key);
      if (id >= this.state.nextSeq) this.state.nextSeq = id + 1;
    }
  }

  private commit(key: string, id: number) {
    this.state.byKey.set(key, id);
    this.state.byId.set(id, key);
  }

  private nextSequential(): number {
    while (true) {
      const candidate = this.state.nextSeq++;
      if (this.ceiling && candidate > this.ceiling) {
        throw new Error("ID allocator sequential ceiling exhausted");
      }
      if (this.state.byId.has(candidate)) continue; // extremely unlikely
      return candidate;
    }
  }

  private hashToInt(input: string): number {
    let hash = FNV_OFFSET;
    for (let i = 0; i < input.length; i++) {
      hash ^= BigInt(input.charCodeAt(i));
      hash = BigInt.asUintN(64, hash * FNV_PRIME);
    }
    // Fold to 31-bit signed-safe positive integer space
  const lower = Number(hash & 0x7fffffffn); // mask to 31 bits positive
    return lower;
  }
}

export default IdAllocator;
