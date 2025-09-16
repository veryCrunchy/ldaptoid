// Refresh Scheduler Service
// Periodically refreshes snapshot data with configurable intervals and exponential backoff

import { Adaptor } from "../adaptors/types.ts";
import { SnapshotBuilder } from "./snapshot_builder.ts";
import { Snapshot } from "../models/mod.ts";
import { MetricsCollector } from "./metrics.ts";

export interface RefreshSchedulerOptions {
  refreshIntervalMs: number; // Default refresh interval
  maxBackoffMs?: number; // Maximum backoff delay (default: 300000 = 5 minutes)
  backoffMultiplier?: number; // Backoff multiplier (default: 2.0)
  maxRetries?: number; // Maximum consecutive failures before stopping (default: 10)
}

export interface RefreshResult {
  success: boolean;
  snapshot?: Snapshot;
  error?: Error;
  durationMs: number;
}

export class RefreshScheduler {
  private readonly adaptor: Adaptor;
  private readonly snapshotBuilder: SnapshotBuilder;
  private readonly metricsCollector?: MetricsCollector;
  private readonly refreshIntervalMs: number;
  private readonly maxBackoffMs: number;
  private readonly backoffMultiplier: number;
  private readonly maxRetries: number;

  private currentSnapshot?: Snapshot;
  private isRunning = false;
  private timeoutId?: number;
  private consecutiveFailures = 0;
  private currentBackoffMs = 0;
  private onSnapshotUpdate?: (snapshot: Snapshot) => void;

  constructor(
    adaptor: Adaptor,
    snapshotBuilder: SnapshotBuilder,
    options: RefreshSchedulerOptions,
    metricsCollector?: MetricsCollector,
  ) {
    this.adaptor = adaptor;
    this.snapshotBuilder = snapshotBuilder;
    this.metricsCollector = metricsCollector;
    this.refreshIntervalMs = options.refreshIntervalMs;
    this.maxBackoffMs = options.maxBackoffMs ?? 300000; // 5 minutes
    this.backoffMultiplier = options.backoffMultiplier ?? 2.0;
    this.maxRetries = options.maxRetries ?? 10;
  }

  setSnapshotUpdateCallback(callback: (snapshot: Snapshot) => void): void {
    this.onSnapshotUpdate = callback;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.consecutiveFailures = 0;
    this.currentBackoffMs = 0;

    // Perform initial refresh
    await this.performRefresh();

    // Schedule periodic refreshes
    this.scheduleNext();
  }

  stop(): void {
    this.isRunning = false;

    if (this.timeoutId !== undefined) {
      clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }
  }

  getCurrentSnapshot(): Snapshot | undefined {
    return this.currentSnapshot;
  }

  isHealthy(): boolean {
    return this.consecutiveFailures < this.maxRetries && this.currentSnapshot !== undefined;
  }

  getStatus(): {
    isRunning: boolean;
    consecutiveFailures: number;
    currentBackoffMs: number;
    hasSnapshot: boolean;
    lastRefreshTime?: number;
  } {
    return {
      isRunning: this.isRunning,
      consecutiveFailures: this.consecutiveFailures,
      currentBackoffMs: this.currentBackoffMs,
      hasSnapshot: this.currentSnapshot !== undefined,
      lastRefreshTime: this.currentSnapshot ? Date.now() : undefined,
    };
  }

  private async performRefresh(): Promise<RefreshResult> {
    const startTime = Date.now();

    try {
      console.log("Starting snapshot refresh...");
      const snapshot = await this.snapshotBuilder.buildSnapshot(this.adaptor);
      const durationMs = Date.now() - startTime;

      // Success - reset failure tracking
      this.consecutiveFailures = 0;
      this.currentBackoffMs = 0;
      this.currentSnapshot = snapshot;

      // Record metrics
      if (this.metricsCollector) {
        this.metricsCollector.recordSnapshotRefresh(
          true,
          durationMs,
          snapshot.users.length,
          snapshot.groups.length,
        );
      }

      // Notify callback
      if (this.onSnapshotUpdate) {
        this.onSnapshotUpdate(snapshot);
      }

      console.log(
        `Snapshot refresh successful: ${snapshot.users.length} users, ${snapshot.groups.length} groups (${durationMs}ms)`,
      );

      return {
        success: true,
        snapshot,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.consecutiveFailures++;

      // Calculate backoff delay
      if (this.consecutiveFailures === 1) {
        this.currentBackoffMs = Math.min(this.refreshIntervalMs, this.maxBackoffMs);
      } else {
        this.currentBackoffMs = Math.min(
          this.currentBackoffMs * this.backoffMultiplier,
          this.maxBackoffMs,
        );
      }

      // Record metrics
      if (this.metricsCollector) {
        this.metricsCollector.recordSnapshotRefresh(false, durationMs, 0, 0);
      }

      console.error(`Snapshot refresh failed (attempt ${this.consecutiveFailures}/${this.maxRetries}):`, error);

      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        durationMs,
      };
    }
  }

  private scheduleNext(): void {
    if (!this.isRunning) {
      return;
    }

    // Stop scheduling if we've exceeded max retries
    if (this.consecutiveFailures >= this.maxRetries) {
      console.error(`Refresh scheduler stopped after ${this.maxRetries} consecutive failures`);
      this.isRunning = false;
      return;
    }

    // Determine next refresh delay
    const delay = this.consecutiveFailures > 0 ? this.currentBackoffMs : this.refreshIntervalMs;

    console.log(`Scheduling next refresh in ${delay}ms`);

    this.timeoutId = setTimeout(async () => {
      if (this.isRunning) {
        await this.performRefresh();
        this.scheduleNext();
      }
    }, delay);
  }

  // Force an immediate refresh (useful for manual triggers)
  async forceRefresh(): Promise<RefreshResult> {
    return await this.performRefresh();
  }
}

export default RefreshScheduler;
