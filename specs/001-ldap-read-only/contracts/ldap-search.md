# LDAP Contract: Search

## Scope
Search over People & Groups subtrees. Support baseObject & subtree scopes. Minimal filter subset initially.

## Supported Filters (Phase 1)
- Equality: `(attr=value)` for uid, cn, gidNumber, uidNumber
- Presence: `(attr=*)`
- AND combination: `(&(filter1)(filter2))` (limit depth 5)
- OR / NOT: Deferred (return unwillingToPerform if used)

## Unsupported
- Substring filters
- Extensible match
- Approximate match

## Request Parameters
| Field | Supported | Notes |
|-------|-----------|-------|
| baseObject | Yes | e.g., `ou=people,<baseDN>` or `ou=groups,<baseDN>` |
| scope | baseObject, subtree | oneLevel deferred |
| derefAliases | never | fixed |
| sizeLimit | Enforced | Default TBD (see research) |
| timeLimit | Ignored | Respond as fast as possible |
| typesOnly | False | Not supported (return whole entries) |

## Response Entry Types
| Type | objectClass values | Required attrs |
|------|--------------------|----------------|
| User | top, person, organizationalPerson, inetOrgPerson, posixAccount | uid, cn, uidNumber, gidNumber, objectClass |
| Group | top, groupOfNames, posixGroup | cn, gidNumber, member (0..N), objectClass |

## Controls
- None required Phase 1
- Future: paged results (RFC 2696)

## Result Codes
| Scenario | Result Code | Notes |
|----------|-------------|-------|
| Success | success (0) | |
| Unsupported filter form | unwillingToPerform (53) | OR/NOT/substring |
| Attribute not present | success (0) | Just omitted |
| Size limit reached | sizeLimitExceeded (4) | Return partial + sizeLimit control (future) |

## Examples
### 1. All users
Filter: `(uid=*)` base: `ou=people,<baseDN>` scope: subtree

### 2. Specific user
Filter: `(uid=alice)` base: `ou=people,<baseDN>` scope: subtree

### 3. All groups
Filter: `(cn=*)` base: `ou=groups,<baseDN>` scope: subtree

## Test Cases
1. Basic presence filter returns >0 users.
2. Equality filter matches single user.
3. Unsupported OR filter returns unwillingToPerform.
4. Size limit truncates at configured default.
5. Group search returns member + memberOf overlay for users (via reverse index) — verification in integration.

## Open Questions
- Should baseDN itself be searchable at root? (RootDSE separate)
- Maximum AND depth enforced value? (Candidate: 5)
