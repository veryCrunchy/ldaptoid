# Feature Specification: LDAP Read-only Proxy over OIDC IdP

**Feature Branch**: `001-ldap-read-only`  
**Created**: 2025-09-16  
**Status**: Draft  
**Input**: User description: "LDAP read-only proxy over OIDC IdP (Keycloak, Microsoft Entra) providing user/group directory with optional primary and mirrored groups, deterministic POSIX IDs, background refresh, metrics, and feature flags"

## Execution Flow (main)
```
1. Parse user description from Input
	→ Parsed key domain: "LDAP read-only proxy"; scope: users, groups, optional synthetic group variants
2. Extract key concepts from description
	→ Actors: Directory consumers (apps, services, admins)
	→ Actions: Query directory, retrieve user/group attributes
	→ Data: Users, Groups, Primary Groups (optional), Mirrored Groups (optional), POSIX numeric IDs
	→ Constraints: Read-only, deterministic IDs, feature flags, observability (metrics), background refresh
3. For each unclear aspect:
	→ Marked below with [NEEDS CLARIFICATION: …]
4. Fill User Scenarios & Testing section
	→ Drafted primary & edge scenarios
5. Generate Functional Requirements
	→ Enumerated FR list; ambiguous items flagged
6. Identify Key Entities (data involved)
	→ Users, Groups, Synthetic Groups, Directory Snapshot
7. Run Review Checklist
	→ Pending removal of all [NEEDS CLARIFICATION] before acceptance
8. Return: SUCCESS (spec ready for planning once clarifications resolved)
```

---

## ⚡ Quick Guidelines
- ✅ Focus on WHAT users need and WHY
- ❌ Avoid HOW to implement (no tech stack, APIs, code structure)
- 👥 Written for business stakeholders, not developers

---

## User Scenarios & Testing *(mandatory)*

### Primary User Story
As an infrastructure engineer, I need a standard LDAP directory view of our existing identity provider’s users and groups so legacy systems and POSIX-oriented services (e.g., SSH, CI runners, file servers) can consume identity and group membership data without custom integration to each IdP API.

### Acceptance Scenarios
1. **Given** the proxy is configured with an IdP credential and a domain, **When** a tool issues an anonymous directory search under the base domain, **Then** the user and group organizational units are returned without error (if anonymous access allowed).
2. **Given** feature flags for primary groups and mirrored groups are enabled, **When** a client searches for a specific user, **Then** results include the user’s entry plus a synthetic primary group entry and (if applicable) mirrored group entry references.
3. **Given** background refresh is enabled, **When** new users are added in the IdP, **Then** the directory reflects these within the defined refresh window without manual intervention.
4. **Given** deterministic numeric identifiers are promised, **When** the same user is queried across sessions/restarts, **Then** the numeric user and group identifiers remain stable.
5. **Given** metrics are enabled, **When** an operator inspects operational telemetry, **Then** they can see counts of users, groups, last refresh time, and error counters.

### Edge Cases
- What happens when the IdP returns a user missing a required attribute? → [NEEDS CLARIFICATION: Should user be omitted or partially returned?]
- How does system handle a group with extremely large membership (e.g., tens of thousands)? → [NEEDS CLARIFICATION: Do we need result size limits or pagination expectations?]
- Behavior when all synthetic features are disabled (primary + mirrored groups) → Directory still functional with only base users and groups.
- If two different IdP groups map to identical display names → [NEEDS CLARIFICATION: Collision resolution policy for naming] 
- If an IdP is temporarily unavailable during refresh → Prior snapshot should continue to serve reads until next successful refresh.
- If deterministic ID space becomes exhausted or collision occurs → [NEEDS CLARIFICATION: Do we fail fast, extend range, or skip affected entities?]

## Requirements *(mandatory)*

### Functional Requirements
- **FR-001**: System MUST present a read-only LDAP-style directory of users and groups from a connected OIDC/OAuth2 IdP.
- **FR-002**: System MUST allow optional inclusion of a per-user synthetic “primary group” representing that user alone when the feature is enabled.
- **FR-003**: System MUST allow optional inclusion of “mirrored groups” aggregating users’ primary groups when the feature is enabled.
- **FR-004**: System MUST provide deterministic numeric identifiers for users and groups (stable across restarts) given unchanged underlying IdP identifiers.
- **FR-005**: System MUST allow directory queries without authentication when anonymous access is enabled.
- **FR-006**: System MUST disallow any write operations (create, modify, delete, rename, password changes).
- **FR-007**: System MUST allow operators to toggle features (primary groups, mirrored groups, anonymous access, domain filtering) at startup via feature flags.
- **FR-008**: System MUST perform data refresh either on-demand (triggered by staleness) or periodically when background refresh is enabled.
- **FR-009**: System MUST continue serving the last successful snapshot if a refresh attempt fails.
- **FR-010**: System MUST expose operational metrics including counts of entities and last refresh outcome.
- **FR-011**: System MUST filter users by a configured domain attribute when domain verification is enabled.
- **FR-012**: System MUST provide a way to disable domain verification feature.
- **FR-013**: System MUST ensure group membership is reflected bidirectionally (user lists group; group lists user) in responses.
- **FR-014**: System MUST ensure that disabling a synthetic feature (e.g., primary groups) removes corresponding entries from subsequent snapshots.
- **FR-015**: System MUST produce a base directory structure containing separate collections (e.g., organizational units) for users and groups.
- **FR-016**: System MUST supply a health indicator showing whether the last refresh succeeded within an acceptable timeframe.
- **FR-017**: System MUST allow a “dry run” mode that outputs the planned directory logical structure without activating as a live service.
- **FR-018**: System MUST preserve stable identifiers for groups even if membership composition changes.
- **FR-019**: System MUST prevent exposure of users flagged inactive or disabled in the IdP. [NEEDS CLARIFICATION: Exact criteria for inactivity]
- **FR-020**: System MUST define and enforce a maximum reasonable result size for a single directory query. [NEEDS CLARIFICATION: Exact numeric limit]
- **FR-021**: System MUST provide a means to identify its version (for operations & audit).
- **FR-022**: System MUST reject queries using unsupported or unsafe filter constructs with a clear error outcome.
- **FR-023**: System MUST maintain ordering consistency of multi-valued attributes for predictability in tests and audits.
- **FR-024**: System MUST return an appropriate error status when configuration prerequisites (credentials, domain) are missing at startup.
- **FR-025**: System MUST allow operators to obtain a list of active feature flags at runtime. [NEEDS CLARIFICATION: Exposed via which interface?]

### Ambiguities / Clarifications Needed
- User attribute mandatory set (which fields are required vs optional)?
- Maximum supported directory object count performance target?
- Retention or cache invalidation policy for removed users (grace period vs immediate removal)?
- Are mirrored groups required for all groups or only selected ones? (Currently assumed: all)
- Audit logging scope (query filters? counts? actor identity?)

### Key Entities *(include if feature involves data)*
- **User**: Represents an individual identity from the IdP. Attributes include unique stable identifier, human-readable name(s), contact email (optional), group memberships.
- **Group**: Represents a collection of users; attributes include stable identifier, name, optional description, list of member user identifiers.
- **Primary Group (Synthetic)**: Optional per-user singleton grouping enabling POSIX-style primary association.
- **Mirrored Group (Synthetic)**: Optional group-of-groups summarizing the primary groups of users belonging to an original source group.
- **Directory Snapshot**: Cohesive, immutable view of all exported entities used to satisfy read queries.
- **Feature Flag Set**: Configuration structure controlling inclusion/exclusion of optional behaviors.

---

## Review & Acceptance Checklist
*GATE: To be satisfied prior to declaring spec final*

### Content Quality
- [ ] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

### Requirement Completeness
- [ ] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous (except those flagged)
- [ ] Success criteria are measurable (need numeric targets for size limit, refresh interval guarantees)
- [x] Scope is clearly bounded (read-only, user & group centric)
- [ ] Dependencies and assumptions identified (IdP availability, credential scope) – PARTIAL

---

## Execution Status
*Initial drafting status*

- [x] User description parsed
- [x] Key concepts extracted
- [x] Ambiguities marked
- [x] User scenarios defined
- [x] Requirements generated
- [x] Entities identified
- [ ] Review checklist passed (pending clarifications)

