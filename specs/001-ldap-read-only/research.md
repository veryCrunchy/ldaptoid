# Research: LDAP Read-only Proxy over OIDC IdP

Generated: 2025-09-16
Status: FINAL (all Phase 1 decisions resolved)

## Decision Log Format
Each section:
- Decision
- Rationale
- Alternatives Considered
- Risks & Mitigations
- Follow-ups

---
## 1. LDAP Protocol Handling (Library vs Custom)
Decision: Custom minimal BER/LDAP v3 subset codec implemented in TypeScript (Bind, Search, Unbind, RootDSE only) + pluggable encoder modules.
Rationale: Existing Node ldapjs not Deno-native; wasm adds build/tooling complexity; subset is small and testable; avoids external dependency risk.
Alternatives Considered: Port ldapjs (complex dependency tree); WASM compiled C library (FFI overhead); generic ASN.1 library (overkill for subset).
Risks & Mitigations: Encoding/decoding bugs → contract tests + corpus-based fuzz inputs; future op expansion cost manageable.
Follow-ups: Add fuzz harness (phase after MVP) using random filter generation.

## 2. Supported Operations Surface
Decision: Restrict to Bind(Simple), Search, Unbind, RootDSE in Phase 1.
Rationale: Meets feature spec; avoids complexity of modify ops.
Alternatives Considered: Add Compare early.
Risks & Mitigations: Client expecting Compare may fail → Document clearly in RootDSE.
Follow-ups: Reassess after adoption feedback.

## 3. UID/GID Deterministic Allocation Algorithm
Decision: FNV-1a 64-bit hash of stable IdP ID string, modulo configurable range (default start 1000) → truncate to 31-bit signed positive; collision resolution via salted rehash attempts (append ':1'..':4'), final fallback to sequential counter persisted.
Rationale: FNV-1a fast, stable, low collision for expected cardinality (<100k); simpler than Murmur3 to implement natively.
Alternatives Considered: Murmur3 (requires external lib), SHA-256 (slower), CRC32 (higher collision).
Risks & Mitigations: Rare collisions cluster → unit tests simulate; sequential fallback ensures progress.
Follow-ups: Monitor collision metric `ldaptoid_id_collisions_total`.

## 4. Group Membership Cardinality Strategy
Decision: Emit full `member` list up to 5000 entries; if >5000, truncate and set internal flag for future paging feature (return partial list; doc limitation). Maintain `ldaptoid_group_truncated_total` metric.
Rationale: Keeps typical enterprise groups intact; large (edge) groups still partially usable.
Alternatives Considered: Hard fail (hurts usability), always truncated at smaller threshold (less useful).
Risks & Mitigations: Clients misinterpret partial membership → Document; consider RFC 2696 paging Phase 2.
Follow-ups: Evaluate demand for paging before 100k scale.

## 5. Size Limit Default (FR-020)
Decision: Default search size limit 1000 entries; configurable via `LDAPTOID_SIZE_LIMIT`; enforce `sizeLimitExceeded` return code when truncated.
Rationale: Aligned with common directory server defaults; balances performance & completeness for typical queries.
Alternatives Considered: 500 (might truncate legitimate org queries); unlimited (risk memory spikes).
Risks & Mitigations: Client needing >1000 should narrow filters or raise config; metric `ldaptoid_search_truncated_total`.
Follow-ups: Reassess after real usage telemetry.

## 6. Inactive User Criteria Mapping
Decision: Exclude users if: Keycloak: `user.enabled == false`; Entra: `accountEnabled == false`; Zitadel: status in {"DEACTIVATED","LOCKED"}; treat deletion as removal next snapshot.
Rationale: Aligns with each IdP's canonical active flag / status set.
Alternatives Considered: Expose inactive with attribute flag (increases complexity, limited need).
Risks & Mitigations: Status field drift in upstream APIs → version pin & adaptor tests.
Follow-ups: Add adaptor-specific fixture tests.

## 7. Feature Flag Exposure Mechanism
Decision: Expose via metrics as single gauge `ldaptoid_feature_flags{flag="<name>"} 1|0` plus CLI `--list-flags`; no LDAP subtree in Phase 1.
Rationale: Zero extra network surface (metrics endpoint already present); simple scraping.
Alternatives Considered: Separate endpoint (extra code), LDAP feature subtree (schema overhead).
Risks & Mitigations: Cardinality growth → keep flag set < 12; review before adding new flags.
Follow-ups: Add doc section in README.

## 8. StartTLS & Certificate Reload Scheduling
Decision: Defer StartTLS to later phase; support static TLS first.
Rationale: Reduce initial complexity.
Alternatives Considered: Immediate StartTLS.
Risks & Mitigations: Some clients require StartTLS → Document limitation.
Follow-ups: Capture demand metric.

## 9. Zitadel Inclusion Strategy
Decision: Stub adaptor returning empty lists until Phase 2; mapping fields planned: id, preferredUsername→username, displayName, email, state→active.
Rationale: De-risks scope while cementing interface.
Alternatives Considered: Immediate full adaptor (slows baseline delivery).
Risks & Mitigations: Users expect Zitadel early → communicate roadmap.
Follow-ups: Add full adaptor task in future feature branch.

## 10. Hash Collision Handling Policy
Decision: Attempt up to 5 salted rehashes (suffix ':n'); if still collision, allocate next sequential id from Redis-backed counter; persist collision mapping.
Rationale: Ensures uniqueness without unbounded loops; preserves determinism for non-colliding majority.
Alternatives Considered: Immediate sequential fallback (higher state reliance); probabilistic Cuckoo-like reassign (complexity).
Risks & Mitigations: Redis unavailable → keep in-memory map & mark metrics `ldaptoid_id_persistence_degraded`.
Follow-ups: Add resilience test simulating Redis outage.

## 11. Metrics Schema
Decision: Initial metrics: 
- Counter `ldaptoid_refresh_total{result="success|failure"}`
- Histogram `ldaptoid_snapshot_build_seconds` (buckets: .5,1,2,5,10,30)
- Gauge `ldaptoid_users`
- Gauge `ldaptoid_groups`
- Gauge `ldaptoid_snapshot_age_seconds`
- Counter `ldaptoid_id_collisions_total`
- Counter `ldaptoid_search_truncated_total`
- Counter `ldaptoid_group_truncated_total`
- Gauge `ldaptoid_feature_flags{flag="<name>"}`
Rationale: Covers freshness, size, performance, error surfaces.
Alternatives Considered: Per-filter histogram (too granular early), per-adaptor breakdown (add later).
Risks & Mitigations: Histogram cost → moderate bucket count.
Follow-ups: Add per-adaptor success/failure counters Phase 2.

## 12. Performance Bench Harness Design
Decision: Provide `scripts/gen_dataset.ts` to generate deterministic synthetic dataset (seeded PRNG) for N users (10k default) & group distributions; benchmark script `scripts/bench_snapshot.ts` measuring build time & memory.
Rationale: Repeatable CI/perf runs; isolates regression detection.
Alternatives Considered: Embedding JSON fixture (less flexible), on-demand random (non-repeatable).
Risks & Mitigations: Drift if script changes → version outputs with checksum.
Follow-ups: Add CI job after initial implementation.

---
## Open Follow-ups Summary Table
| # | Topic | Status | Target Resolution |
|---|-------|--------|-------------------|
| 1 | Fuzz harness for LDAP codec | Deferred | Post MVP |
| 2 | Paging for large groups | Deferred | Phase 2 planning |
| 3 | Delta refresh (incremental) | Deferred | Separate feature branch |
| 4 | Zitadel full adaptor | Deferred | After baseline stable |
| 5 | StartTLS support | Deferred | Security hardening phase |

---
(All required Phase 1 decisions finalized; deferred items tracked.)
