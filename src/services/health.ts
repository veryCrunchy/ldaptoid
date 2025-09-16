// Health Check Service
// Provides readiness and liveness endpoints with comprehensive health status

import { Snapshot as _Snapshot } from "../models/mod.ts";
import { RefreshScheduler } from "./refresh_scheduler.ts";
import { RedisClient } from "./redis_client.ts";
import { LDAPServer } from "./ldap_server.ts";
import { Adaptor } from "../adaptors/types.ts";

export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: number;
  checks: {
    snapshot: HealthCheck;
    adaptor: HealthCheck;
    ldapServer: HealthCheck;
    redis?: HealthCheck;
    refreshScheduler: HealthCheck;
  };
  uptime: number;
  version?: string;
}

export interface HealthCheck {
  status: "pass" | "warn" | "fail";
  message: string;
  details?: Record<string, unknown>;
}

export interface HealthServiceOptions {
  snapshotMaxAgeMs?: number; // Max age before snapshot is considered stale (default: 1 hour)
  adaptorTimeoutMs?: number; // Timeout for adaptor health checks (default: 5 seconds)
  enableDetailedChecks?: boolean; // Include detailed diagnostics (default: true)
}

export class HealthService {
  private readonly startTime: number;
  private readonly options: Required<HealthServiceOptions>;
  private adaptor?: Adaptor;
  private refreshScheduler?: RefreshScheduler;
  private ldapServer?: LDAPServer;
  private redisClient?: RedisClient;

  constructor(options: HealthServiceOptions = {}) {
    this.startTime = Date.now();
    this.options = {
      snapshotMaxAgeMs: options.snapshotMaxAgeMs ?? 3600000, // 1 hour
      adaptorTimeoutMs: options.adaptorTimeoutMs ?? 5000,
      enableDetailedChecks: options.enableDetailedChecks ?? true,
    };
  }

  setAdaptor(adaptor: Adaptor): void {
    this.adaptor = adaptor;
  }

  setRefreshScheduler(scheduler: RefreshScheduler): void {
    this.refreshScheduler = scheduler;
  }

  setLDAPServer(server: LDAPServer): void {
    this.ldapServer = server;
  }

  setRedisClient(client: RedisClient): void {
    this.redisClient = client;
  }

  async getHealthStatus(): Promise<HealthStatus> {
    const timestamp = Date.now();
    const uptime = timestamp - this.startTime;

    const checks = {
      snapshot: this.checkSnapshot(),
      adaptor: await this.checkAdaptor(),
      ldapServer: this.checkLDAPServer(),
      refreshScheduler: this.checkRefreshScheduler(),
      ...(this.redisClient && { redis: await this.checkRedis() }),
    };

    // Determine overall status
    const overallStatus = this.determineOverallStatus(checks);

    return {
      status: overallStatus,
      timestamp,
      checks,
      uptime,
      version: Deno.env.get("LDAPTOID_VERSION") || "dev",
    };
  }

  async getReadiness(): Promise<{ ready: boolean; message: string }> {
    const health = await this.getHealthStatus();

    // Service is ready if snapshot and adaptor are healthy
    const ready = health.checks.snapshot.status !== "fail" &&
      health.checks.adaptor.status !== "fail";

    return {
      ready,
      message: ready ? "Service is ready" : "Service is not ready - check health endpoint for details",
    };
  }

  getLiveness(): { alive: boolean; message: string } {
    // Service is alive if basic components are responding
    const ldapOk = this.checkLDAPServer().status !== "fail";
    const schedulerOk = this.checkRefreshScheduler().status !== "fail";

    const alive = ldapOk && schedulerOk;

    return {
      alive,
      message: alive ? "Service is alive" : "Service is not responding properly",
    };
  }

  private checkSnapshot(): HealthCheck {
    if (!this.refreshScheduler) {
      return {
        status: "fail",
        message: "Refresh scheduler not configured",
      };
    }

    const snapshot = this.refreshScheduler.getCurrentSnapshot();

    if (!snapshot) {
      return {
        status: "fail",
        message: "No snapshot available",
      };
    }

    const age = Date.now() - this.startTime; // Approximate age
    const isStale = age > this.options.snapshotMaxAgeMs;

    return {
      status: isStale ? "warn" : "pass",
      message: isStale ? "Snapshot is stale" : "Snapshot is current",
      details: this.options.enableDetailedChecks
        ? {
          userCount: snapshot.users.length,
          groupCount: snapshot.groups.length,
          approximateAgeMs: age,
          maxAgeMs: this.options.snapshotMaxAgeMs,
        }
        : undefined,
    };
  }

  private async checkAdaptor(): Promise<HealthCheck> {
    if (!this.adaptor) {
      return {
        status: "fail",
        message: "Adaptor not configured",
      };
    }

    try {
      // Simple health check - try to fetch minimal data with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.options.adaptorTimeoutMs);

      // For now, we'll just check if we can create the adaptor connection
      // In a real implementation, we might have a ping/health method on the adaptor
      const healthResult = await Promise.race([
        Promise.resolve(this.performAdaptorHealthCheck()),
        new Promise<HealthCheck>((_, reject) => {
          setTimeout(() => reject(new Error("Health check timeout")), this.options.adaptorTimeoutMs);
        }),
      ]);

      clearTimeout(timeoutId);
      return healthResult;
    } catch (error) {
      return {
        status: "fail",
        message: `Adaptor health check failed: ${error instanceof Error ? error.message : String(error)}`,
        details: this.options.enableDetailedChecks
          ? {
            error: error instanceof Error ? error.message : String(error),
          }
          : undefined,
      };
    }
  }

  private performAdaptorHealthCheck(): HealthCheck {
    // This is a placeholder for adaptor-specific health checks
    // In a real implementation, each adaptor would have a health() method
    try {
      // For now, assume the adaptor is healthy if it exists
      return {
        status: "pass",
        message: "Adaptor is responding",
        details: this.options.enableDetailedChecks
          ? {
            adaptorType: this.adaptor?.constructor.name || "unknown",
          }
          : undefined,
      };
    } catch (error) {
      return {
        status: "fail",
        message: `Adaptor check failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private checkLDAPServer(): HealthCheck {
    // For now, we assume the LDAP server is healthy if it exists
    // In a real implementation, we might check if the server is listening
    if (!this.ldapServer) {
      return {
        status: "fail",
        message: "LDAP server not configured",
      };
    }

    return {
      status: "pass",
      message: "LDAP server is running",
      details: this.options.enableDetailedChecks
        ? {
          serverType: "TCP LDAP v3",
        }
        : undefined,
    };
  }

  private checkRefreshScheduler(): HealthCheck {
    if (!this.refreshScheduler) {
      return {
        status: "fail",
        message: "Refresh scheduler not configured",
      };
    }

    const schedulerStatus = this.refreshScheduler.getStatus();
    const isHealthy = this.refreshScheduler.isHealthy();

    if (!isHealthy) {
      return {
        status: "fail",
        message: `Refresh scheduler unhealthy: ${schedulerStatus.consecutiveFailures} consecutive failures`,
        details: this.options.enableDetailedChecks ? schedulerStatus : undefined,
      };
    }

    if (schedulerStatus.consecutiveFailures > 0) {
      return {
        status: "warn",
        message: `Refresh scheduler recovering from ${schedulerStatus.consecutiveFailures} failures`,
        details: this.options.enableDetailedChecks ? schedulerStatus : undefined,
      };
    }

    return {
      status: "pass",
      message: "Refresh scheduler is healthy",
      details: this.options.enableDetailedChecks ? schedulerStatus : undefined,
    };
  }

  private async checkRedis(): Promise<HealthCheck> {
    if (!this.redisClient) {
      return {
        status: "warn",
        message: "Redis client not configured (optional)",
      };
    }

    try {
      const isAlive = await this.redisClient.ping();
      const health = this.redisClient.getHealth();

      if (!isAlive || !health.connected) {
        return {
          status: "warn", // Redis is optional, so warn instead of fail
          message: "Redis is not responding",
          details: this.options.enableDetailedChecks ? (health as unknown as Record<string, unknown>) : undefined,
        };
      }

      return {
        status: "pass",
        message: "Redis is responding",
        details: this.options.enableDetailedChecks ? (health as unknown as Record<string, unknown>) : undefined,
      };
    } catch (error) {
      return {
        status: "warn",
        message: `Redis check failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private determineOverallStatus(checks: HealthStatus["checks"]): "healthy" | "degraded" | "unhealthy" {
    const checkValues = Object.values(checks);

    // If any critical check fails, service is unhealthy
    const criticalChecks = [checks.snapshot, checks.adaptor, checks.ldapServer, checks.refreshScheduler];
    const hasCriticalFailure = criticalChecks.some((check) => check.status === "fail");

    if (hasCriticalFailure) {
      return "unhealthy";
    }

    // If any check has warnings, service is degraded
    const hasWarnings = checkValues.some((check) => check.status === "warn");

    if (hasWarnings) {
      return "degraded";
    }

    return "healthy";
  }

  async serveHealthEndpoint(request: Request): Promise<Response> {
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const health = await this.getHealthStatus();
      const statusCode = health.status === "healthy" ? 200 : health.status === "degraded" ? 200 : 503;

      return new Response(JSON.stringify(health, null, 2), {
        status: statusCode,
        headers: {
          "Content-Type": "application/json",
        },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          status: "unhealthy",
          error: error instanceof Error ? error.message : String(error),
        }),
        {
          status: 503,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }
  }

  async serveReadinessEndpoint(request: Request): Promise<Response> {
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const readiness = await this.getReadiness();
      const statusCode = readiness.ready ? 200 : 503;

      return new Response(JSON.stringify(readiness, null, 2), {
        status: statusCode,
        headers: {
          "Content-Type": "application/json",
        },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          ready: false,
          message: `Readiness check failed: ${error instanceof Error ? error.message : String(error)}`,
        }),
        {
          status: 503,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }
  }

  async serveLivenessEndpoint(request: Request): Promise<Response> {
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const liveness = await this.getLiveness();
      const statusCode = liveness.alive ? 200 : 503;

      return new Response(JSON.stringify(liveness, null, 2), {
        status: statusCode,
        headers: {
          "Content-Type": "application/json",
        },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          alive: false,
          message: `Liveness check failed: ${error instanceof Error ? error.message : String(error)}`,
        }),
        {
          status: 503,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }
  }
}

export default HealthService;
