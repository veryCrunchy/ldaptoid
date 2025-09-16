#!/usr/bin/env -S deno run -A
// Main CLI Entry Point
// Integrates all services and orchestrates startup, configuration, and graceful shutdown

import { parseArgs } from "jsr:@std/cli/parse-args";
import { IdAllocator } from "../services/id_allocator.ts";
import { SnapshotBuilder } from "../services/snapshot_builder.ts";
import { RefreshScheduler } from "../services/refresh_scheduler.ts";
import { LDAPServer } from "../services/ldap_server.ts";
import { SearchExecutor } from "../services/search_executor.ts";
import { BindAuthenticator } from "../services/bind_authenticator.ts";
import { PrometheusMetricsService } from "../services/metrics.ts";
import { DefaultFeatureFlagService } from "../services/feature_flags.ts";
import { RedisClient } from "../services/redis_client.ts";
import { HealthService } from "../services/health.ts";
import { OAuth2Client } from "../services/oauth_client.ts";
import { KeycloakAdaptor } from "../adaptors/keycloak_adaptor.ts";
import { EntraAdaptor } from "../adaptors/entra_adaptor.ts";
import { ZitadelAdaptor } from "../adaptors/zitadel_adaptor.ts";
import { Adaptor } from "../adaptors/types.ts";

interface CLIConfig {
  // LDAP Server Config
  ldapPort: number;
  ldapBindDN?: string;
  ldapBindPassword?: string;
  ldapBaseDN: string;
  ldapSizeLimit: number;
  allowAnonymousBind: boolean;

  // Identity Provider Config
  idpType: "keycloak" | "entra" | "zitadel";
  idpBaseUrl: string;
  idpClientId: string;
  idpClientSecret: string;
  idpRealm?: string; // Keycloak/Zitadel
  idpTenant?: string; // Entra
  idpOrganization?: string; // Zitadel v2

  // Refresh Config
  refreshIntervalMs: number;
  maxBackoffMs: number;
  maxRetries: number;

  // Redis Config (optional)
  redisEnabled: boolean;
  redisHost: string;
  redisPort: number;
  redisPassword?: string;
  redisDatabase: number;

  // Metrics Config
  metricsPort: number;
  metricsPath: string;

  // Health Config
  healthPort: number;
  healthPath: string;
  readinessPath: string;
  livenessPath: string;

  // Feature Flags
  enabledFeatures: string[];

  // General
  verbose: boolean;
  help: boolean;
}

export class LDAPtoIDMain {
  private config!: CLIConfig;
  private adaptor!: Adaptor;
  private uidAllocator!: IdAllocator;
  private gidAllocator!: IdAllocator;
  private snapshotBuilder!: SnapshotBuilder;
  private refreshScheduler!: RefreshScheduler;
  private ldapServer!: LDAPServer;
  private searchExecutor!: SearchExecutor;
  private bindAuthenticator!: BindAuthenticator;
  private metricsService!: PrometheusMetricsService;
  private featureFlagService!: DefaultFeatureFlagService;
  private redisClient?: RedisClient;
  private healthService!: HealthService;
  private oauthClient!: OAuth2Client;

  private metricsServer?: Deno.HttpServer;
  private healthServer?: Deno.HttpServer;
  private isShuttingDown = false;

  async run(args: string[]): Promise<void> {
    try {
      const config = this.parseConfig(args);
      
      // Handle help flag early
      if (config.help) {
        this.printHelp();
        return;
      }

      this.config = config;
      
      if (config.verbose) {
        console.log("Starting LDAP-to-ID proxy with configuration:", config);
      }

      await this.initializeServices();
      await this.startServices();
      await this.setupGracefulShutdown();

      console.log("🚀 LDAP-to-ID proxy is running!");
      console.log(`   LDAP Server: port ${this.config.ldapPort}`);
      console.log(`   Metrics: http://localhost:${this.config.metricsPort}${this.config.metricsPath}`);
      console.log(`   Health: http://localhost:${this.config.healthPort}${this.config.healthPath}`);

      // Keep the process running
      await new Promise(() => {}); // This will run until process is terminated

    } catch (error) {
      console.error("Failed to start LDAP-to-ID proxy:", error);
      Deno.exit(1);
    }
  }

  private parseConfig(args: string[]): CLIConfig {
    const parsed = parseArgs(args, {
      boolean: ["help", "verbose", "allow-anonymous-bind", "redis-enabled"],
      string: [
        "ldap-bind-dn", "ldap-bind-password", "ldap-base-dn",
        "idp-type", "idp-base-url", "idp-client-id", "idp-client-secret",
        "idp-realm", "idp-tenant", "idp-organization",
        "redis-host", "redis-password", "enabled-features",
        "ldap-port", "ldap-size-limit", "refresh-interval-ms", "max-backoff-ms", "max-retries",
        "redis-port", "redis-database", "metrics-port", "health-port",
        "metrics-path", "health-path", "readiness-path", "liveness-path"
      ],
      alias: {
        h: "help",
        v: "verbose",
        p: "ldap-port"
      },
      default: {
        "ldap-port": "389",
        "ldap-base-dn": "dc=example,dc=com",
        "ldap-size-limit": "1000",
        "allow-anonymous-bind": false,
        "refresh-interval-ms": "300000", // 5 minutes
        "max-backoff-ms": "300000", // 5 minutes
        "max-retries": "10",
        "redis-enabled": false,
        "redis-host": "localhost",
        "redis-port": "6379",
        "redis-database": "0",
        "metrics-port": "9090",
        "metrics-path": "/metrics",
        "health-port": "8080",
        "health-path": "/health",
        "readiness-path": "/ready",
        "liveness-path": "/live",
        "enabled-features": ""
      }
    });

    // Return early for help
    if (parsed.help) {
      return { help: true } as CLIConfig;
    }

    // Validate required config only if not showing help
    const requiredEnvVars = [
      "LDAPTOID_IDP_TYPE",
      "LDAPTOID_IDP_BASE_URL", 
      "LDAPTOID_IDP_CLIENT_ID",
      "LDAPTOID_IDP_CLIENT_SECRET"
    ];

    for (const envVar of requiredEnvVars) {
      if (!Deno.env.get(envVar)) {
        throw new Error(`Required environment variable ${envVar} is not set`);
      }
    }

    return {
      ldapPort: parseInt(parsed["ldap-port"] as string),
      ldapBindDN: parsed["ldap-bind-dn"] as string || Deno.env.get("LDAPTOID_LDAP_BIND_DN"),
      ldapBindPassword: parsed["ldap-bind-password"] as string || Deno.env.get("LDAPTOID_LDAP_BIND_PASSWORD"),
      ldapBaseDN: parsed["ldap-base-dn"] as string || Deno.env.get("LDAPTOID_LDAP_BASE_DN") || "dc=example,dc=com",
      ldapSizeLimit: parseInt(parsed["ldap-size-limit"] as string),
      allowAnonymousBind: parsed["allow-anonymous-bind"] as boolean || Deno.env.get("LDAPTOID_ALLOW_ANONYMOUS_BIND") === "true",

      idpType: (parsed["idp-type"] as string || Deno.env.get("LDAPTOID_IDP_TYPE")) as "keycloak" | "entra" | "zitadel",
      idpBaseUrl: parsed["idp-base-url"] as string || Deno.env.get("LDAPTOID_IDP_BASE_URL")!,
      idpClientId: parsed["idp-client-id"] as string || Deno.env.get("LDAPTOID_IDP_CLIENT_ID")!,
      idpClientSecret: parsed["idp-client-secret"] as string || Deno.env.get("LDAPTOID_IDP_CLIENT_SECRET")!,
      idpRealm: parsed["idp-realm"] as string || Deno.env.get("LDAPTOID_IDP_REALM"),
      idpTenant: parsed["idp-tenant"] as string || Deno.env.get("LDAPTOID_IDP_TENANT"),
      idpOrganization: parsed["idp-organization"] as string || Deno.env.get("LDAPTOID_IDP_ORGANIZATION"),

      refreshIntervalMs: parseInt(parsed["refresh-interval-ms"] as string),
      maxBackoffMs: parseInt(parsed["max-backoff-ms"] as string),
      maxRetries: parseInt(parsed["max-retries"] as string),

      redisEnabled: parsed["redis-enabled"] as boolean || Deno.env.get("LDAPTOID_REDIS_ENABLED") === "true",
      redisHost: parsed["redis-host"] as string || Deno.env.get("LDAPTOID_REDIS_HOST") || "localhost",
      redisPort: parseInt(parsed["redis-port"] as string) || parseInt(Deno.env.get("LDAPTOID_REDIS_PORT") || "6379"),
      redisPassword: parsed["redis-password"] as string || Deno.env.get("LDAPTOID_REDIS_PASSWORD"),
      redisDatabase: parseInt(parsed["redis-database"] as string) || parseInt(Deno.env.get("LDAPTOID_REDIS_DATABASE") || "0"),

      metricsPort: parseInt(parsed["metrics-port"] as string),
      metricsPath: parsed["metrics-path"] as string,

      healthPort: parseInt(parsed["health-port"] as string),
      healthPath: parsed["health-path"] as string,
      readinessPath: parsed["readiness-path"] as string,
      livenessPath: parsed["liveness-path"] as string,

      enabledFeatures: (parsed["enabled-features"] as string || Deno.env.get("LDAPTOID_ENABLED_FEATURES") || "").split(",").filter(f => f.trim()),

      verbose: parsed.verbose as boolean || Deno.env.get("LDAPTOID_VERBOSE") === "true",
      help: parsed.help as boolean
    };
  }

  private async initializeServices(): Promise<void> {
    if (this.config.verbose) {
      console.log("Initializing services...");
    }

    // Initialize OAuth2 client
    this.oauthClient = new OAuth2Client();

    // Initialize feature flags
    this.featureFlagService = new DefaultFeatureFlagService();

    // Initialize metrics service
    this.metricsService = new PrometheusMetricsService();
    // Convert feature flags to Record format for metrics
    const flagsRecord: Record<string, boolean> = {};
    this.featureFlagService.getEnabledFlags().forEach(flag => {
      flagsRecord[flag] = true;
    });
    this.metricsService.updateFeatureFlags(flagsRecord);

    // Initialize ID allocators
    this.uidAllocator = new IdAllocator({ salt: "uid_" + this.config.idpBaseUrl, floor: 10000 });
    this.gidAllocator = new IdAllocator({ salt: "gid_" + this.config.idpBaseUrl, floor: 10000 });

    // Initialize Redis client (optional)
    if (this.config.redisEnabled) {
      this.redisClient = new RedisClient({
        host: this.config.redisHost,
        port: this.config.redisPort,
        password: this.config.redisPassword,
        database: this.config.redisDatabase
      });

      try {
        await this.redisClient.connect();
        if (this.config.verbose) {
          console.log("Connected to Redis");
        }
      } catch (error) {
        console.warn("Failed to connect to Redis (continuing without persistence):", error);
        this.redisClient = undefined;
      }
    }

    // Initialize adaptor based on IDP type with OAuth2 authentication
    this.adaptor = await this.createAdaptor();

    // Initialize snapshot builder
    this.snapshotBuilder = new SnapshotBuilder({
      uidAllocator: this.uidAllocator,
      gidAllocator: this.gidAllocator,
      enabledFeatures: this.featureFlagService.getEnabledFlags()
    });

    // Initialize search executor (will be updated with snapshot later)
    this.searchExecutor = new SearchExecutor(
      { users: [], groups: [], generatedAt: new Date().toISOString(), sequence: 0, featureFlags: this.featureFlagService.getEnabledFlags() }
    );

    // Initialize bind authenticator
    this.bindAuthenticator = new BindAuthenticator({
      allowAnonymousBind: this.config.allowAnonymousBind,
      bindDN: this.config.ldapBindDN,
      bindPassword: this.config.ldapBindPassword
    });

    // Initialize LDAP server
    this.ldapServer = new LDAPServer({
      port: this.config.ldapPort,
      bindDN: this.config.ldapBindDN,
      bindPassword: this.config.ldapBindPassword,
      baseDN: this.config.ldapBaseDN,
      sizeLimit: this.config.ldapSizeLimit
    });

    // Initialize refresh scheduler
    this.refreshScheduler = new RefreshScheduler(
      this.adaptor,
      this.snapshotBuilder,
      {
        refreshIntervalMs: this.config.refreshIntervalMs,
        maxBackoffMs: this.config.maxBackoffMs,
        maxRetries: this.config.maxRetries
      },
      this.metricsService
    );

    // Set up snapshot update callback
    this.refreshScheduler.setSnapshotUpdateCallback((snapshot) => {
      this.searchExecutor.updateSnapshot(snapshot);
      this.ldapServer.updateSnapshot(snapshot);
    });

    // Initialize health service
    this.healthService = new HealthService();
    this.healthService.setAdaptor(this.adaptor);
    this.healthService.setRefreshScheduler(this.refreshScheduler);
    this.healthService.setLDAPServer(this.ldapServer);
    if (this.redisClient) {
      this.healthService.setRedisClient(this.redisClient);
    }
  }

  private async createAdaptor(): Promise<Adaptor> {
    const oauthConfig = {
      baseUrl: this.config.idpBaseUrl,
      clientId: this.config.idpClientId,
      clientSecret: this.config.idpClientSecret,
      realm: this.config.idpRealm,
      tenant: this.config.idpTenant,
      organization: this.config.idpOrganization
    };

    // Get OAuth2 access token
    const accessToken = await this.oauthClient.getAccessToken(this.config.idpType, oauthConfig);

    switch (this.config.idpType) {
      case "keycloak":
        if (!this.config.idpRealm) {
          throw new Error("Keycloak realm is required (set LDAPTOID_IDP_REALM)");
        }
        return new KeycloakAdaptor(
          this.config.idpBaseUrl, 
          accessToken
        );

      case "entra":
        if (!this.config.idpTenant) {
          throw new Error("Entra tenant is required (set LDAPTOID_IDP_TENANT)");
        }
        return new EntraAdaptor(
          this.config.idpBaseUrl,
          accessToken
        );

      case "zitadel":
        return new ZitadelAdaptor(
          this.config.idpBaseUrl,
          accessToken
        );

      default:
        throw new Error(`Unsupported IDP type: ${this.config.idpType}`);
    }
  }

  private async startServices(): Promise<void> {
    if (this.config.verbose) {
      console.log("Starting services...");
    }

    // Start refresh scheduler (this will perform initial snapshot build)
    await this.refreshScheduler.start();

    // Start LDAP server
    this.ldapServer.start().catch(error => {
      console.error("LDAP server error:", error);
    });

    // Start metrics server
    this.metricsServer = Deno.serve(
      { port: this.config.metricsPort },
      (request) => {
        const url = new URL(request.url);
        if (url.pathname === this.config.metricsPath) {
          return this.metricsService.serveMetrics(request);
        }
        return new Response("Not Found", { status: 404 });
      }
    );

    // Start health server
    this.healthServer = Deno.serve(
      { port: this.config.healthPort },
      (request) => {
        const url = new URL(request.url);
        switch (url.pathname) {
          case this.config.healthPath:
            return this.healthService.serveHealthEndpoint(request);
          case this.config.readinessPath:
            return this.healthService.serveReadinessEndpoint(request);
          case this.config.livenessPath:
            return this.healthService.serveLivenessEndpoint(request);
          default:
            return new Response("Not Found", { status: 404 });
        }
      }
    );
  }

  private setupGracefulShutdown(): void {
    const shutdown = async () => {
      if (this.isShuttingDown) {
        return;
      }
      
      this.isShuttingDown = true;
      console.log("\n🛑 Shutting down gracefully...");

      try {
        // Stop accepting new connections
        this.ldapServer?.stop();
        
        // Stop refresh scheduler
        this.refreshScheduler?.stop();

        // Close Redis connection
        if (this.redisClient) {
          await this.redisClient.disconnect();
        }

        // Stop HTTP servers
        if (this.metricsServer) {
          await this.metricsServer.shutdown();
        }
        
        if (this.healthServer) {
          await this.healthServer.shutdown();
        }

        console.log("✅ Graceful shutdown complete");
        Deno.exit(0);

      } catch (error) {
        console.error("Error during shutdown:", error);
        Deno.exit(1);
      }
    };

    // Handle various termination signals
    Deno.addSignalListener("SIGTERM", shutdown);
    Deno.addSignalListener("SIGINT", shutdown);
    
    // Handle unhandled rejections
    addEventListener("unhandledrejection", (event) => {
      console.error("Unhandled promise rejection:", event.reason);
      shutdown();
    });
  }

  private printHelp(): void {
    console.log(`
LDAP-to-ID Proxy - Bridge legacy LDAP clients to modern identity providers

USAGE:
    ldaptoid [OPTIONS]

OPTIONS:
    -h, --help                          Show this help message
    -v, --verbose                       Enable verbose logging
    -p, --ldap-port <PORT>              LDAP server port (default: 389)
    --ldap-bind-dn <DN>                 LDAP bind DN for authentication
    --ldap-bind-password <PASSWORD>     LDAP bind password
    --ldap-base-dn <DN>                 LDAP base DN (default: dc=example,dc=com)
    --ldap-size-limit <SIZE>            Maximum search result size (default: 1000)
    --allow-anonymous-bind              Allow anonymous LDAP binds
    
    --idp-type <TYPE>                   Identity provider type (keycloak|entra|zitadel)
    --idp-base-url <URL>                Identity provider base URL
    --idp-client-id <ID>                Identity provider client ID
    --idp-client-secret <SECRET>        Identity provider client secret
    --idp-realm <REALM>                 Keycloak/Zitadel realm
    --idp-tenant <TENANT>               Entra tenant ID
    --idp-organization <ORG>            Zitadel organization (optional for v2)
    
    --refresh-interval-ms <MS>          Snapshot refresh interval (default: 300000)
    --max-backoff-ms <MS>               Maximum backoff delay (default: 300000)
    --max-retries <COUNT>               Maximum consecutive failures (default: 10)
    
    --redis-enabled                     Enable Redis persistence
    --redis-host <HOST>                 Redis host (default: localhost)
    --redis-port <PORT>                 Redis port (default: 6379)
    --redis-password <PASSWORD>         Redis password
    --redis-database <DB>               Redis database number (default: 0)
    
    --metrics-port <PORT>               Metrics server port (default: 9090)
    --health-port <PORT>                Health server port (default: 8080)
    
    --enabled-features <FEATURES>       Comma-separated feature flags

ENVIRONMENT VARIABLES:
    LDAPTOID_IDP_TYPE                   Identity provider type (required)
    LDAPTOID_IDP_BASE_URL               Identity provider base URL (required)
    LDAPTOID_IDP_CLIENT_ID              Identity provider client ID (required)
    LDAPTOID_IDP_CLIENT_SECRET          Identity provider client secret (required)
    LDAPTOID_IDP_REALM                  Keycloak/Zitadel realm
    LDAPTOID_IDP_TENANT                 Entra tenant ID
    LDAPTOID_IDP_ORGANIZATION           Zitadel organization
    LDAPTOID_LDAP_BIND_DN               LDAP bind DN
    LDAPTOID_LDAP_BIND_PASSWORD         LDAP bind password
    LDAPTOID_LDAP_BASE_DN               LDAP base DN
    LDAPTOID_ALLOW_ANONYMOUS_BIND       Allow anonymous binds (true/false)
    LDAPTOID_REDIS_ENABLED              Enable Redis (true/false)
    LDAPTOID_REDIS_HOST                 Redis host
    LDAPTOID_REDIS_PORT                 Redis port
    LDAPTOID_REDIS_PASSWORD             Redis password
    LDAPTOID_REDIS_DATABASE             Redis database
    LDAPTOID_ENABLED_FEATURES           Comma-separated feature flags
    LDAPTOID_VERBOSE                    Enable verbose logging (true/false)

EXAMPLES:
    # Basic Keycloak setup
    LDAPTOID_IDP_TYPE=keycloak \\
    LDAPTOID_IDP_BASE_URL=https://auth.example.com \\
    LDAPTOID_IDP_CLIENT_ID=ldap-proxy \\
    LDAPTOID_IDP_CLIENT_SECRET=secret \\
    LDAPTOID_IDP_REALM=company \\
    ldaptoid --verbose
    
    # Zitadel v2 with Redis persistence
    LDAPTOID_IDP_TYPE=zitadel \\
    LDAPTOID_IDP_BASE_URL=https://company.zitadel.cloud \\
    LDAPTOID_IDP_CLIENT_ID=12345 \\
    LDAPTOID_IDP_CLIENT_SECRET=secret \\
    LDAPTOID_REDIS_ENABLED=true \\
    ldaptoid --ldap-port 10389

For more information, visit: https://github.com/obiente/ldaptoid
`);
  }
}

// Main entry point
if (import.meta.main) {
  const main = new LDAPtoIDMain();
  await main.run(Deno.args);
}
