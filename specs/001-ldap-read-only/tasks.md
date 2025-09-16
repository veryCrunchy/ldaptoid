# Tasks: LDAP Read-only Proxy over OIDC IdP

**Input**: Design documents from `/specs/001-ldap-read-only/` **Prerequisites**: All Phase 0 & 1 design artifacts
present (plan.md, research.md, data-model.md, contracts/*, quickstart.md). Setup & model tasks completed; contract &
integration test skeletons added and currently failing as intended.

Remaining tasks focus on core service implementation, integration wiring, and polish. Completed tasks are marked
accordingly. Parallel markers [P] only used where files are independent.

## Phase 3.1: Setup

- [x] T001 Initialize Deno project structure (create `src/`, `tests/`, `src/models/`, `src/services/`, `src/cli/`,
      `tests/contract/`, `tests/integration/`, `tests/unit/`)
  - Files: N/A (directory scaffold)
- [x] T002 Create base config files (`deno.json`, `README.md` stub, `.editorconfig`)
  - Files: `deno.json`, `README.md`, `.editorconfig`
- [x] T003 [P] Add lint & format configuration in `deno.json` (lint rules, import map placeholder)
  - File: `deno.json`
- [x] T004 Add Makefile or task runner script (`scripts/dev.sh`) for common commands (optional)
  - File: `scripts/dev.sh`
- [x] T005 Define environment example file (`.env.example`) documenting required IdP credentials (Keycloak, Entra,
      Zitadel placeholder)
  - File: `.env.example`
- [x] T006 [P] Add `src/cli/main.ts` entrypoint with argument parsing skeleton (no logic)
  - File: `src/cli/main.ts`

## Phase 3.2: Tests First (Design Artifact Generation + TDD)

- [x] T007 Create `research.md` resolving NEEDS CLARIFICATION (LDAP lib choice, hash algo, limits, inactive criteria,
      feature flag exposure, Zitadel mapping)
  - File: `specs/001-ldap-read-only/research.md`
- [x] T008 Create `data-model.md` with entities: User, Group, SyntheticPrimaryGroup, MirroredGroup, Snapshot,
      FeatureFlags, BackendAdaptor
  - File: `specs/001-ldap-read-only/data-model.md`
- [x] T009 [P] Create `contracts/ldap-search.md` describing search request/response contract & attribute mapping
      examples
  - File: `specs/001-ldap-read-only/contracts/ldap-search.md`
- [x] T010 [P] Create `contracts/ldap-bind.md` describing simple bind expectations & errors
  - File: `specs/001-ldap-read-only/contracts/ldap-bind.md`
- [x] T011 [P] Create `contracts/ldap-rootdse.md` describing RootDSE attribute set
  - File: `specs/001-ldap-read-only/contracts/ldap-rootdse.md`
- [x] T012 [P] Create `quickstart.md` with scenario: run server, perform bind, search users, metrics check, feature flag
      list
  - File: `specs/001-ldap-read-only/quickstart.md`
- [x] T013 Generate failing contract test: Bind success & invalid credentials (`tests/contract/bind_test.ts`)
  - File: `tests/contract/bind_test.ts`
- [x] T014 [P] Failing contract test: RootDSE retrieval (`tests/contract/rootdse_test.ts`)
  - File: `tests/contract/rootdse_test.ts`
- [x] T015 [P] Failing contract test: Basic user search filter (uid=*) returns expected attributes
      (`tests/contract/search_basic_test.ts`)
  - File: `tests/contract/search_basic_test.ts`
- [x] T016 [P] Failing contract test: Group membership expansion & memberOf overlay
      (`tests/contract/search_group_membership_test.ts`)
  - File: `tests/contract/search_group_membership_test.ts`
- [x] T017 Integration test (failing): Snapshot refresh interval & consistent results during refresh
      (`tests/integration/snapshot_refresh_test.ts`)
  - File: `tests/integration/snapshot_refresh_test.ts`
- [x] T018 [P] Integration test: Feature flags appear in metrics or introspection endpoint
      (`tests/integration/feature_flags_test.ts`)
  - File: `tests/integration/feature_flags_test.ts`
- [x] T019 [P] Integration test: Deterministic UID/GID stable across restarts with Redis configured
      (`tests/integration/uid_gid_stability_test.ts`)
  - File: `tests/integration/uid_gid_stability_test.ts`
- [x] T020 Integration test: Inactive user filtering criteria enforced (`tests/integration/inactive_users_test.ts`)
  - File: `tests/integration/inactive_users_test.ts`

## Phase 3.3: Core Implementation (Only after tests exist & fail)

- [x] T021 Implement domain models & types (`src/models/*.ts`) from `data-model.md`
  - Files: `src/models/user.ts`, `src/models/group.ts`, `src/models/snapshot.ts`, `src/models/feature_flags.ts`
- [x] T022 [P] Implement UID/GID allocator with deterministic hashing & collision handling
      (`src/services/id_allocator.ts`)
  - File: `src/services/id_allocator.ts`
- [x] T023 [P] Implement BackendAdaptor interface & Keycloak adaptor skeleton (`src/adaptors/keycloak_adaptor.ts`)
  - File: `src/adaptors/keycloak_adaptor.ts`
- [x] T024 Implement Entra adaptor skeleton (`src/adaptors/entra_adaptor.ts`)
  - File: `src/adaptors/entra_adaptor.ts`
- [x] T025 Implement Zitadel adaptor (v2 API focused) (`src/adaptors/zitadel_adaptor.ts`)
  - File: `src/adaptors/zitadel_adaptor.ts`
- [x] T026 Snapshot builder service (full refresh logic) (`src/services/snapshot_builder.ts`)
  - File: `src/services/snapshot_builder.ts`
- [ ] T027 [P] Feature flag registry & introspection exposure (`src/services/feature_flags.ts`)
  - File: `src/services/feature_flags.ts`
- [ ] T028 LDAP protocol layer skeleton: decode/encode minimal ops (Bind, Search, Unbind, RootDSE)
      (`src/services/protocol/ldap_protocol.ts`)
  - File: `src/services/protocol/ldap_protocol.ts`
- [ ] T029 LDAP server listener & request dispatcher (`src/cli/server.ts`)
  - File: `src/cli/server.ts`
- [ ] T030 [P] Metrics exporter (Prometheus text endpoint) (`src/services/metrics.ts`)
  - File: `src/services/metrics.ts`
- [ ] T031 Integrate metrics & feature flags into server (`src/cli/server.ts`)
  - File: `src/cli/server.ts`
- [ ] T032 Implement search execution over snapshot (filters subset) (`src/services/search_executor.ts`)
  - File: `src/services/search_executor.ts`
- [ ] T033 [P] Implement bind auth validation using snapshot / adaptor credentials (`src/services/bind_auth.ts`)
  - File: `src/services/bind_auth.ts`
- [ ] T034 Implement group membership expansion & memberOf overlay population (`src/services/group_overlay.ts`)
  - File: `src/services/group_overlay.ts`
- [ ] T035 Implement inactive user filtering logic (`src/services/inactive_filter.ts`)
  - File: `src/services/inactive_filter.ts`
- [ ] T036 Wire UID/GID allocator persistence (Redis optional) (`src/services/id_allocator.ts`)
  - File: `src/services/id_allocator.ts`

## Phase 3.4: Integration

- [ ] T037 Compose periodic snapshot refresh scheduler (`src/services/refresh_scheduler.ts`)
  - File: `src/services/refresh_scheduler.ts`
- [ ] T038 [P] Implement Redis integration wrapper & health probe (`src/services/redis_client.ts`)
  - File: `src/services/redis_client.ts`
- [ ] T039 Integrate adaptors into snapshot builder (`src/services/snapshot_builder.ts`)
  - File: `src/services/snapshot_builder.ts`
- [ ] T040 Logging abstraction & structured JSON logger (`src/services/logging.ts`)
  - File: `src/services/logging.ts`
- [ ] T041 [P] Expose health/readiness HTTP endpoint (`src/cli/health_endpoint.ts`)
  - File: `src/cli/health_endpoint.ts`
- [ ] T042 Wire health endpoint & metrics server start sequence (`src/cli/server.ts`)
  - File: `src/cli/server.ts`

## Phase 3.5: Polish

- [ ] T043 Unit tests: UID/GID collision handling (`tests/unit/id_allocator_test.ts`)
  - File: `tests/unit/id_allocator_test.ts`
- [ ] T044 [P] Unit tests: Search filter edge cases (`tests/unit/search_filters_test.ts`)
  - File: `tests/unit/search_filters_test.ts`
- [ ] T045 [P] Unit tests: Group overlay correctness (`tests/unit/group_overlay_test.ts`)
  - File: `tests/unit/group_overlay_test.ts`
- [ ] T046 Performance test harness (simulate 10k users) (`tests/perf/perf_snapshot_test.ts`)
  - File: `tests/perf/perf_snapshot_test.ts`
- [ ] T047 Documentation: Update `README.md` with usage & config (`README.md`)
  - File: `README.md`
- [ ] T048 [P] Documentation: Architecture diagram & metrics reference (`docs/architecture.md`)
  - File: `docs/architecture.md`
- [ ] T049 Security review checklist & threat model doc (`docs/security.md`)
  - File: `docs/security.md`
- [ ] T050 Release prep: version tag, changelog init (`CHANGELOG.md`)
  - File: `CHANGELOG.md`

## Dependencies

- T001 → T002 → T003 (parallel with T006) & T004/T005
- Research/design (T007-T012) precede contract tests (T013-T020) but can start in parallel after T002 scaffolding
- All tests (T013-T020) must exist & fail before any core impl (T021+)
- Models (T021) precede services using them (T022-T028,T032-T036)
- Protocol (T028) precedes server listener (T029)
- Metrics (T030) precedes integration (T031)
- Snapshot builder (T026) precedes refresh scheduler (T037) & integration (T039)
- Redis client (T038) precedes allocator persistence (T036) finalization if using Redis

## Parallel Execution Examples

```
# Example 1: After scaffolding
Run in parallel: T003, T006

# Example 2: Contract docs
Run in parallel: T009, T010, T011, T012

# Example 3: Contract tests
Run in parallel: T014, T015, T016 (T013 must be separate due to overlapping bind setup), then T018, T019 can run after T017 started.

# Example 4: Core services
Run in parallel: T022, T023, T027, T030, T033 (independent files)
```

## Validation Checklist

- [ ] All contract markdown files created (search, bind, rootdse)
- [ ] All contract tests exist & fail initially
- [ ] All entities have model definitions
- [ ] Snapshot & overlay logic covered by integration tests
- [ ] UID/GID stability & inactive filtering tested
- [ ] No [P] tasks share a file path
- [ ] README & architecture docs updated before release prep

---

Generated for feature `001-ldap-read-only` on 2025-09-16.
