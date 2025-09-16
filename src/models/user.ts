export interface User {
  id: string; // Stable IdP identifier
  username: string; // Maps to LDAP uid
  displayName: string; // Maps to cn / gecos
  email?: string;
  active: boolean;
  posixUid: number; // uidNumber
  primaryGroupId: string; // SyntheticPrimaryGroup.id or real group id
  memberGroupIds: string[]; // Direct group memberships
  createdAt?: string;
  updatedAt?: string;
}

export function sanitizeUsername(raw: string): string {
  // Replace spaces with underscore and remove disallowed LDAP specials (basic pass)
  return raw.trim().replace(/\s+/g, "_").replace(/[^a-zA-Z0-9._-]/g, "");
}
