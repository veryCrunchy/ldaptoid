# LDAP Contract: Bind (Simple)

## Scope

Simple Bind with DN + password (no SASL). Read-only service; bind validates credentials or returns invalidCredentials.

## Request

- Operation: BindRequest
- Version: 3
- Name (DN): `uid=<username>,ou=people,<baseDN>`
- Authentication: simple password

## Responses

| Scenario            | Result Code             | Description                                        |
| ------------------- | ----------------------- | -------------------------------------------------- |
| Success             | success (0)             | Credentials valid                                  |
| Invalid credentials | invalidCredentials (49) | Username or password mismatch                      |
| User inactive       | invalidCredentials (49) | Treat inactive as auth failure (avoid enumeration) |
| Entry not found     | invalidCredentials (49) | Do not reveal existence                            |
| Server error        | other (80)              | Unexpected condition                               |

## Error Handling Principles

- Do not distinguish inactive vs bad password.
- Latency target < 20ms (in-memory snapshot check).
- No network call to IdP at bind time (uses snapshot only).

## Test Cases

1. Valid credentials → success.
2. Wrong password → invalidCredentials.
3. Inactive user → invalidCredentials.
4. Unknown user → invalidCredentials.
5. Snapshot not yet built → temporarilyUnavailable? (TBD) or fail; decision pending.

## Open Questions

- Return code when snapshot empty at startup? (Consider operationsError vs unwillingToPerform)
