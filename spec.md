# LDAPtOID Specification (Draft)

Status: Draft v0.1
Authors: TBD
Last Updated: 2025-09-16

## 1. Overview

LDAPT OID (LDAPtOID) is a high‑performance, read‑only LDAP proxy that exposes an LDAP 3 compatible directory tree backed by one (or more, future) OpenID Connect / OAuth2 Identity Providers (IdPs). Inspired by Apricot (LDAP proxy for OpenID Connect) and re‑implemented for performance, portability, and modern tooling using TypeScript on Deno v2.

## 2. Goals
* Provide an RFC 4511 compliant (subset) read‑only LDAP interface over IdP user/group data.
* Fast cold & warm queries (low p99 latency) via aggressive in‑memory + optional distributed cache.
* Configurable background refresh and on‑demand stale eviction (similar to Apricot, improved).
* Support multiple IdP backends (Phase 1: Keycloak, Microsoft Entra; Phase 2: Okta, Auth0, generic OIDC). 
* Provide POSIX attributes (uidNumber, gidNumber, homeDirectory, loginShell) deterministically.
* Support synthetic primary groups and mirrored groups (feature‑flagged) analogous to Apricot.
* Ship a single self‑contained Deno executable or container image (small, minimal deps).
* First‑class observability (structured logs, metrics, health & readiness probes, tracing hooks).
* Secure by default: principle of least privilege, input validation, explicit failure modes.

## 3. Non‑Goals
* Write operations (Add/Modify/Delete/Rename) – strictly read‑only.
* Acting as an actual IdP or issuing tokens.
* Full LDAP feature parity (no referrals, no advanced schema negotiation initially).
* Serving as a general directory for arbitrary object classes beyond user/group scope (initially).

## 4. High‑Level Architecture
```
				  +-------------------+
   LDAP Client --> |  LDAP Frontend    | 389 / 636 (StartTLS/TLS)
 (ldapsearch, PAM) |  (Protocol Layer) |  <- Strict read-only handlers
				  +----------+--------+
							 |
							 v
				  +-------------------+
				  |  Directory View   |  In-memory tree projection
				  |  Builder          |  (Users, Groups, Synthetic Nodes)
				  +----------+--------+
							 |
				Cache Hits? / Miss
							 |
	 +-----------------------+-----------------------+
	 |                                               |
	 v                                               v
 +--------+                                 +------------------+
 |  L1    |  (Process memory: maps,        |   Backend Adapt.  |
 | Cache  |   radix indices, TTL buckets)  | (Keycloak, Entra) |
 +---+----+                                 +--------+---------+
	 |                                               |
	 v                                               v
 +--------+   Optional                         +--------------+
 |  L2    | <---------- gRPC / TCP -----------> |  IdP APIs    |
 | Redis  |   (Future multi-node)              |  (REST/Graph) |
 +--------+                                     +--------------+
```

Key layers:
1. Protocol Layer: Implements minimal LDAP v3 operations (Bind (simple), Search, Unbind, RootDSE). Explicitly rejects Add / Modify / Delete / ModifyDN / Extended.
2. Directory View Builder: Transforms canonical IdP entities into LDAP entries with objectClass sets (inetOrgPerson, posixAccount, groupOfNames, posixGroup, overlays) including synthetic attributes.
3. Caching: Two-tier (in-memory + optional Redis) for UID/GID assignments and materialized entry snapshots. Versioned for invalidation.
4. Backend Adaptors: Abstract interface (listUsers, listGroups, getUserGroups, incrementalDelta(sinceCursor?)). Concrete implementations for Keycloak & Microsoft Entra.
5. Refresh Coordinator: Orchestrates background refresh (interval) and lazy refresh when stale.
6. Observability & Control: Metrics endpoints (HTTP), health/readiness signals, structured logging, optional OpenTelemetry exporter.

Concurrency Model (Deno):
* Use Deno workers or structured concurrency (AbortSignal) for background refresh & metrics server.
* Atomic snapshot swaps (immutable object graphs) to keep search path lock-free.
* Backpressure: limit concurrent backend fetch pages; token bucket for expensive refresh.

Security Boundaries:
* LDAP layer sanitizes filters before evaluation (or uses safe query engine).
* Backend tokens stored only in memory; no logging of secrets.
* Optional TLS termination inside process; support proxy TLS offload.

Extensibility Strategy:
* New backend adaptors implement a TypeScript interface and register via a map similar to Apricot's OAuthClientMap.
* Feature flags enumerated centrally, validated at startup.

## 5. Core Concepts
| Concept | Description |
|---------|-------------|
| Directory Snapshot | Immutable in-memory representation of all exported LDAP entries with indexes. |
| Synthetic Primary Group | One per user (posixGroup) whose CN == user CN if enabled. |
| Mirrored Group | Group-of-groups containing primary groups of members (not posixGroup). |
| UID/GID Allocator | Deterministic or cached mapping from stable IdP identifiers to numeric uidNumber/gidNumber. |
| Backend Adaptor | Module that translates IdP API responses to canonical User/Group DTOs. |
| Overlay Attributes | Additional attributes (memberOf, oauth_id) layered onto base object classes. |
| Refresh Cursor | Opaque backend-specific state for incremental sync (Phase 2). |

Canonical Data Transfer Objects (DTOs):
```
UserDTO {
	id: string            // Stable backend user ID
	username: string      // Login / preferred username
	displayName: string
	email?: string
	firstName?: string
	lastName?: string
	groups: string[]      // Backend group IDs (raw)
	domain?: string       // For domain filtering (Keycloak attribute)
	active: boolean
}

GroupDTO {
	id: string            // Stable backend group ID
	name: string          // Human-readable
	description?: string
	memberUserIds: string[]
}
```

LDAP Entry Mapping Principles:
* Deterministic DN layout.
* Avoid collisions by strict normalisation (lowercasing domain components, encoding special characters per RFC 4514 if needed).
* Only export active, domain-validated users.
* Provide stable uidNumber/gidNumber assignment: hash(id) -> number within allocated range with collision resolution persisted in cache.

## 6. Functional Requirements
FR-01 Provide anonymous bind optionally (config flag to disable).
FR-02 Support simple bind (username DN + empty or ignored password) for identity existence (no password verification against IdP in Phase 1). Future: optional password pass-through (if possible) or token auth.
FR-03 Support search operations scoped to Base, One, Subtree under exported suffix.
FR-04 Evaluate filters for objectClass, CN, member, memberOf, uid, gidNumber, uidNumber.
FR-05 Provide RootDSE with namingContexts and supportedControls (minimal list).
FR-06 Reject write operations with LDAPProtocolError.
FR-07 Export users and groups; optionally primary groups and mirrored groups.
FR-08 Background refresh if enabled; otherwise on-demand stale detection (age > refreshInterval).
FR-09 Configurable refresh interval (seconds).
FR-10 Expose metrics endpoint (HTTP, default 8080) with Prometheus format counters/gauges.
FR-11 Health endpoint returns 200 when last snapshot load succeeded within health threshold.
FR-12 Graceful shutdown flushes allocator cache to Redis if configured.
FR-13 TLS support for LDAP (LDAPS) and StartTLS (Phase 2) if keys provided.
FR-14 Support multi-valued member and memberOf attributes.
FR-15 Deterministic ordering of attributes (cosmetic, for test determinism).
FR-16 Provide command-line & environment variable configuration parity.
FR-17 Pluggable backend selection via --backend flag.
FR-18 Domain filtering (Keycloak) can be disabled via flag.
FR-19 Refresh concurrency limited (config: maxBackendConcurrency).
FR-20 Provide dry-run mode to print planned DN tree for diagnostics.

Non-Functional Requirements:
NFR-01 p50 search latency < 10ms (warm, in-memory), p99 < 50ms for <50k entries.
NFR-02 Initial full sync for 10k users + 2k groups completes < 30s with concurrency=8.
NFR-03 Memory footprint < 256MB for 10k users + synthetic groups (excluding Deno runtime) target.
NFR-04 Zero unhandled promise rejections; process exit code non-zero on fatal config errors.
NFR-05 100% typed codebase (TypeScript strict). 
NFR-06 >90% coverage for core logic (mapping, filter evaluation) by Phase 1 release.
NFR-07 Logs are JSON by default; human-friendly when --pretty-logs enabled.
NFR-08 All external API calls time out (config default 10s) and are retried (exponential backoff) except non-idempotent future ops.
NFR-09 Security scanning for dependencies in CI.
NFR-10 Build artifact reproducible (Deno lock file enforced).

## 7. LDAP Data Model & Object Classes
Implemented object classes (subset):
* top
* person / organizationalPerson / inetOrgPerson (user identity chain)
* posixAccount (auxiliary)
* groupOfNames (groups, mirrored group-of-groups)
* posixGroup (primary & regular groups when enabled)
* Overlay: memberOf (calculated), oauthEntry (id, username alias) – represented as additional attributes rather than formal objectClass if schema registration omitted.

Attribute Generation:
| LDAP Attribute | Source / Derivation |
|----------------|---------------------|
| cn             | user.username OR group.name |
| sn             | user.lastName (fallback '-') |
| givenName      | user.firstName |
| displayName    | user.displayName |
| mail           | user.email |
| uid            | user.username |
| uidNumber      | UID allocator (user) |
| gidNumber      | Primary group gidNumber (same as primary group uidNumber) |
| homeDirectory  | `/home/{username}` (configurable template) |
| loginShell     | `/bin/bash` (configurable) |
| member         | DNs of user members (groupOfNames) |
| memberOf       | Computed inverse edges |
| description    | group.description |
| objectClass    | As per mapping list |

DN Layout Suffix: `DC=<domainLeft>,DC=<domainRight>,...`
Organizational Units: `OU=users`, `OU=groups`.
Example:
```
dc=example,dc=com
ou=users,dc=example,dc=com
ou=groups,dc=example,dc=com
cn=john.doe,ou=users,dc=example,dc=com
cn=engineering,ou=groups,dc=example,dc=com
```

Primary Group (if enabled):
```
cn=john.doe,ou=groups,dc=example,dc=com
member: cn=john.doe,ou=users,dc=example,dc=com
```

Mirrored Group (if enabled):
```
cn=Primary user groups for engineering,ou=groups,dc=example,dc=com
member: cn=john.doe,ou=groups,dc=example,dc=com   # primary group DN
```

## 8. Distinguished Name (DN) Layout
Rules:
1. Domain split by '.' mapped to sequence of DC components (lower-case).
2. CN uses raw username / group name; escape commas, plus, equals, leading/trailing spaces per RFC 4514.
3. Synthetic groups follow pattern `Primary user groups for <group name>`.
4. No nested OU depth beyond users/groups in Phase 1.
5. Optional prefix override for CN (config: --user-cn-attribute) in Phase 2.

Validation & Normalisation:
* Reject usernames with control chars.
* Replace whitespace runs with single space.
* Lowercase domain, preserve username case for display but use lowercase for login attribute uniqueness.

## 9. Feature Flags
| Flag | CLI | Env | Default | Purpose |
|------|-----|-----|---------|---------|
| Anonymous Binds | --disable-anonymous-binds (negated) | DISABLE_ANONYMOUS_BINDS | Enabled | Allow unauthenticated search |
| Primary Groups | --disable-primary-groups (negated) | DISABLE_PRIMARY_GROUPS | Enabled | Create per-user posixGroup |
| Mirrored Groups | --disable-mirrored-groups (negated) | DISABLE_MIRRORED_GROUPS | Enabled | Create group-of-groups |
| Domain Verification | --disable-user-domain-verification (negated) | DISABLE_USER_DOMAIN_VERIFICATION | Enabled | Filter users by domain attribute |
| Background Refresh | --background-refresh | BACKGROUND_REFRESH | Disabled | Periodic refresh |
| Pretty Logs | --pretty-logs | PRETTY_LOGS | Disabled | Human log output |
| Dry Run | --dry-run | DRY_RUN | Disabled | Output tree then exit |

## 10. Configuration
Sources (precedence high→low): CLI args > Environment variables > Config file (Phase 2) > Defaults.

Core Parameters:
| Name | CLI | Env | Default | Notes |
|------|-----|-----|---------|-------|
| backend | --backend | BACKEND | (required) | keycloak | microsoftentra |
| clientId | --client-id | CLIENT_ID | (required) | OAuth client credential |
| clientSecret | --client-secret | CLIENT_SECRET | (required) | Kept in memory only |
| domain | --domain | DOMAIN | (required) | example.com |
| port | --port | PORT | 1389 | LDAP (plain) |
| tlsPort | --tls-port | TLS_PORT | 1636 | LDAPS |
| tlsCertificate | --tls-certificate | TLS_CERTIFICATE | - | PEM path |
| tlsPrivateKey | --tls-private-key | TLS_PRIVATE_KEY | - | PEM path |
| refreshInterval | --refresh-interval | REFRESH_INTERVAL | 60 | seconds |
| backgroundRefresh | --background-refresh | BACKGROUND_REFRESH | false | |
| redisHost | --redis-host | REDIS_HOST | - | Optional |
| redisPort | --redis-port | REDIS_PORT | - | Optional |
| maxBackendConcurrency | --max-backend-concurrency | MAX_BACKEND_CONCURRENCY | 8 | Parallel fetches |
| requestTimeoutMs | --request-timeout-ms | REQUEST_TIMEOUT_MS | 10000 | Backend HTTP |
| logLevel | --log-level | LOG_LEVEL | info | trace/debug/info/warn/error |
| metricsPort | --metrics-port | METRICS_PORT | 8080 | HTTP metrics |
| loginShell | --login-shell | LOGIN_SHELL | /bin/bash | |
| homeDirTemplate | --home-dir-template | HOME_DIR_TEMPLATE | /home/{username} | |
| userDomainAttr (Keycloak) | --keycloak-domain-attribute | KEYCLOAK_DOMAIN_ATTRIBUTE | domain | |
| entraTenantId | --entra-tenant-id | ENTRA_TENANT_ID | - | |

Validation: startup fails (exit code 1) if required fields absent or inconsistent TLS options (must supply both cert+key).

## 11. Caching Strategy
Components:
1. UID/GID Cache: stable mapping persisted to Redis keyspace `ldaptoid:uid:{type}:{identifier}`. In-memory write-through map for speed.
2. Snapshot Cache: current immutable directory tree; new snapshot built in parallel and swapped.
3. Filter Plan Cache: parsed LDAP filters -> predicate functions (LRU, size 1024 entries).

Invalidation:
* Full rebuild on schedule or on-demand stale detection.
* Future incremental: apply delta events (backend dependent) to existing snapshot.

Collision Handling:
* UID range allocation user [2000..60000), group [3000..60000) (configurable future).
* If hash collision occurs, linear probe upward until free; persist mapping.

## 12. Refresh & Sync Strategy
Modes:
* Lazy: On first request after stale TTL.
* Background: Periodic timer kicks off refresh if not already running.

Refresh Algorithm (Full):
1. Fetch all groups (paged) -> Map groupId→GroupDTO.
2. Fetch all users (paged) -> Map userId→UserDTO.
3. Filter users by domain (if enabled).
4. Build membership edges user↔groups.
5. Allocate / retrieve uidNumber & gidNumber.
6. Produce base LDAP entries.
7. Inject primary groups (if enabled) and mirrored groups (if enabled).
8. Compute memberOf for each user & group-of-groups membership.
9. Freeze & swap snapshot pointer.
10. Emit metrics (duration, counts, errors).

Concurrency: fetch pages concurrently up to maxBackendConcurrency; builder runs single-threaded to ensure determinism.

Backoff & Retry: retry transient backend failures (HTTP 5xx / network) with exponential backoff up to 3 attempts; abort refresh if >20% pages failed.

## 13. API / Backend Adaptors
TypeScript Interface:
```
interface BackendAdaptor {
	init(): Promise<void>; // validate credentials
	listUsers(): AsyncIterable<UserDTO>;
	listGroups(): AsyncIterable<GroupDTO>;
	// Phase 2:
	// listUserDeltas(since: string): AsyncIterable<UserDelta>;
	// listGroupDeltas(since: string): AsyncIterable<GroupDelta>;
}
```

Keycloak Implementation: uses admin REST endpoints (service account). Domain filtering via custom user attribute. Paged queries (max page size config).

Microsoft Entra Implementation: uses MS Graph API (application credentials) with selective fields.

Future: Generic OIDC adaptor requiring configurable endpoints & claims mapping.

## 14. Security
* Input Validation: LDAP filters parsed via safe parser; reject unsupported constructs.
* Denial-of-Service Controls: limit result size (sizeLimit config, default 5000) & execution time (timeLimit).
* Memory Safety: Immutable snapshot prevents concurrent mutation races.
* Secrets Handling: clientSecret never logged; masked in debug dumps.
* TLS: modern ciphers (Deno defaults) with option to disable weak protocols.
* Authentication: simple bind accepted only for existing user DNs (no password check) Phase 1; future pluggable bind strategies.
* Principle of Least Privilege: minimal OAuth scopes (read users/groups only).
* Auditing: option to log query metadata (filter, base DN, size) at debug level without PII attribute values.

## 15. Performance Targets
See NFR list. Bench Harness Plan:
* Synthetic generator for X users & Y groups.
* Benchmark operations: search by base all subtree, search by uid, enumerate groups, list members.
* Metrics captured: latency distribution, GC pauses, memory usage snapshot pre/post refresh.

Optimisations:
* Precompute attribute arrays as contiguous typed arrays for frequent filter fields (uid, objectClass) to accelerate scans.
* Index maps: uid -> entry pointer, cn -> entry pointer, member -> set pointer.
* Filter Execution: transform LDAP filter tree to predicate; attempt index-driven evaluation (e.g., (uid=foo)).

## 16. Observability
Metrics (Prometheus):
* ldaptoid_refresh_duration_seconds (histogram)
* ldaptoid_refresh_last_success_timestamp (gauge)
* ldaptoid_entries_total (gauge)
* ldaptoid_users_total (gauge)
* ldaptoid_groups_total (gauge)
* ldaptoid_primary_groups_total (gauge)
* ldaptoid_mirrored_groups_total (gauge)
* ldaptoid_backend_requests_total{backend,endpoint,code}
* ldaptoid_backend_request_duration_seconds{backend,endpoint}
* ldaptoid_ldap_requests_total{op}
* ldaptoid_ldap_request_duration_seconds{op}

Logging Fields: timestamp, level, msg, op, correlationId (if propagated), refreshId, counts.

Tracing (optional Phase 2): OpenTelemetry spans for refresh & selected LDAP searches.

Diagnostic Endpoints (/healthz, /readyz, /metrics) served over HTTP (separate from LDAP port).

## 17. Deployment & Packaging
Artifacts:
* Deno compile single binary (linux-amd64, arm64) with embedded version & git commit.
* Container: distroless (gcr.io/distroless/base) or scratch with CA cert bundle.
* Helm Chart (Phase 2) with configMap for env, secret for credentials, service for LDAP & metrics.

Runtime Requirements: outbound HTTPS to IdP & optional Redis. No inbound HTTP except metrics.

Upgrade Strategy: rolling update; snapshot warmed before readiness true.

## 18. Testing Strategy
Test Layers:
1. Unit: filter parser, DN builder, UID allocator, backend adaptors (API mocks).
2. Integration: full refresh building snapshot from fixture JSON.
3. LDAP Protocol Tests: using ldapjs or similar client against running instance (spawn in test harness).
4. Performance: benchmark script (excluded from CI, run nightly).
5. Security: fuzz filters (property-based tests) to ensure parser robustness.

Fixtures: YAML/JSON representing users & groups with edge cases (empty groups, large membership, invalid domain, unicode names).

Coverage gating in CI (Codecov / built-in tooling).

## 19. Failure Modes & Recovery
| Failure | Detection | Mitigation |
|---------|-----------|------------|
| Backend timeout | HTTP timeout error | Retry with backoff; mark refresh partial failure |
| Refresh crash | Uncaught exception | Snapshot pointer unchanged; health shows stale; next cycle retries |
| Redis unavailable | Connection error | Fall back to in-memory only; warn |
| UID collision overflow | Allocation loop > threshold | Log error; skip user/group; metric increment |
| Memory pressure | OOM risk (RSS > limit) | Optional limit triggers process exit (K8s restarts) |

Startup Hard Failures: invalid config, missing required TLS file, backend credential rejection.

Graceful Shutdown: stop accepting new LDAP connections, finish active search ops, abort long refresh, flush mapping if possible.

## 20. Roadmap / Phases
Phase 1 (MVP): Keycloak + Entra full sync, read-only LDAP, primary & mirrored groups, metrics, Redis optional, TLS.
Phase 1.1: Optimised filter evaluation, dry-run, improved logging.
Phase 2: Incremental refresh (delta), generic OIDC adaptor, tracing, StartTLS, Helm chart.
Phase 3: Horizontal sharding (multiple instances share Redis allocator), distributed cache version vector.
Phase 4: Advanced features (attribute mapping config file, multi-domain support, ACLs).

## 21. Open Questions
1. Should we support password verification via IdP token exchange? (Security implications).
2. Do we need StartTLS early or is LDAPS sufficient for target environments?
3. Strategy for multi-domain: separate trees vs aggregated OU per domain?
4. Handling extremely large groups (100k members): streaming attribute values vs truncation with sizeLimit?
5. Exposure of custom attributes: allow pass-through list? Schema compliance concerns.
6. Should UID/GID ranges be configurable per deployment? (Likely yes, Phase 2).
7. FIPS / compliance constraints for crypto libraries under Deno?

