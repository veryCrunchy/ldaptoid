# LDAPtOID

Read-only LDAP projection of OIDC / OAuth2 identity providers (Keycloak, Microsoft Entra; Zitadel upcoming) providing users & groups with deterministic POSIX IDs, optional synthetic primary & mirrored groups, snapshot refresh, metrics, and feature flags.

## Status
Planning complete. Implementation in progress (see `specs/001-ldap-read-only/`).

## Features (Phase 1 Scope)
- Read-only LDAP v3 (Bind, Search, Unbind, RootDSE)
- Deterministic uidNumber / gidNumber allocation
- Optional synthetic primary groups & mirrored groups
- Background snapshot refresh with resilience
- Metrics endpoint (Prometheus text format)
- Feature flags exposed via metrics & CLI

## Roadmap (Short)
| Phase | Focus |
|-------|-------|
| 1 | Core read-only, Keycloak + Entra adaptors, metrics |
| 2 | Zitadel adaptor, paging for large groups, delta refresh |
| 3 | StartTLS, extended metrics, tracing |

## Development
See `specs/001-ldap-read-only/tasks.md` for ordered tasks (TDD first).

```bash
# Run dev (after implementation scaffolding)
deno task dev

# Run tests
deno task test
```

## Configuration (Preview)
Environment variables (see `.env.example`):
- `LDAPTOID_BASE_DN`
- `LDAPTOID_KEYCLOAK_URL`, `LDAPTOID_KEYCLOAK_CLIENT_ID`, `LDAPTOID_KEYCLOAK_CLIENT_SECRET`
- `LDAPTOID_ENTRA_TENANT_ID`, `LDAPTOID_ENTRA_CLIENT_ID`, `LDAPTOID_ENTRA_CLIENT_SECRET`
- `LDAPTOID_REDIS_URL` (optional)
- `LDAPTOID_FEATURES` (comma list)
- `LDAPTOID_SIZE_LIMIT` (optional override, default 1000)

## License
TBD
