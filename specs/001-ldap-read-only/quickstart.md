# Quickstart: LDAP Read-only Proxy

## Prerequisites

- Deno v2 installed
- Redis (optional) running on localhost:6379 if persistence desired
- IdP credentials (Keycloak realm URL + client creds; Entra tenant ID + app reg; Zitadel placeholder)

## 1. Configure Environment

Create `.env` (or export env vars):

```
LDAPTOID_BASE_DN=dc=example,dc=org
LDAPTOID_KEYCLOAK_URL=https://keycloak.example.org/realms/main
LDAPTOID_KEYCLOAK_CLIENT_ID=...
LDAPTOID_KEYCLOAK_CLIENT_SECRET=...
LDAPTOID_ENTRA_TENANT_ID=...
LDAPTOID_ENTRA_CLIENT_ID=...
LDAPTOID_ENTRA_CLIENT_SECRET=...
LDAPTOID_REDIS_URL=redis://localhost:6379
LDAPTOID_FEATURES=synthetic_primary_group,mirror_nested_groups
```

## 2. Run Server (placeholder)

```
deno run -A src/cli/server.ts --config deno.json
```

(Expected: will fail until implemented.)

## 3. Perform Simple Bind (after implementation)

```
ldapwhoami -x -H ldap://localhost:389 -D "uid=alice,ou=people,dc=example,dc=org" -w secret
```

## 4. Search Users

```
ldapsearch -x -H ldap://localhost:389 -b "ou=people,dc=example,dc=org" '(uid=*)' uid uidNumber gidNumber memberOf
```

## 5. Check Metrics (placeholder)

```
curl http://localhost:9600/metrics | grep ldaptoid
```

## 6. Verify Feature Flags Exposure (placeholder)

Method TBD: metrics label or endpoint.

## 7. Snapshot Refresh Behavior Test

1. Start server.
2. Trigger manual refresh endpoint/CLI (TBD) while performing search — results consistent.

## 8. Redis Persistence Test

1. Record uidNumber of user.
2. Restart service.
3. Confirm uidNumber unchanged.

## 9. Cleanup

Stop server, clear Redis keys (`redis-cli FLUSHDB` if test instance).

## Notes

- Early phase: many steps will fail until corresponding tasks complete.
- Use integration tests to automate scenarios above.
