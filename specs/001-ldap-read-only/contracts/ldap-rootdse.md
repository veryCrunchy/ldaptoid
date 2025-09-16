# LDAP Contract: RootDSE

## Scope
Return server capabilities and naming contexts.

## Request
- baseObject: empty DN
- scope: baseObject
- filter: `(objectClass=*)`

## Response Attributes (Phase 1)
| Attribute | Value | Notes |
|-----------|-------|-------|
| namingContexts | `<baseDN>` | Configured base DN |
| supportedLDAPVersion | 3 | Fixed |
| vendorName | `ldaptoid` | Identifier |
| vendorVersion | TBD | Injected at build time |
| supportedControl | (omitted) | No controls yet |
| supportedSASLMechanisms | (omitted) | Simple only |

## Test Cases
1. RootDSE search returns namingContexts & supportedLDAPVersion.
2. Unknown attribute requested is ignored.

## Open Questions
- Include `monitorContext` or `configContext`? (Likely no Phase 1)
- Expose feature flags here? (Maybe later separate subtree)
