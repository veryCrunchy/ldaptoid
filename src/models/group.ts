export interface Group {
  id: string; // IdP or synthetic id
  name: string; // LDAP cn
  description?: string;
  memberUserIds: string[]; // Direct users
  memberGroupIds: string[]; // Nested groups (if any)
  posixGid: number; // gidNumber
  isSynthetic: boolean;
  truncated?: boolean; // True if membership list truncated due to threshold
}

export function ensureUniqueGroupName(name: string, collisionIndex?: number): string {
  if (collisionIndex === undefined || collisionIndex === 0) return name;
  return `${name}_${collisionIndex}`;
}
