// Adaptor interface for IdP integrations (Keycloak, Entra, Zitadel, etc.)
// Defines methods for fetching users, groups, and optionally nested groups.

// Raw user data from IdP (before domain transformation)
export interface RawUser {
  id: string;
  username: string;
  email?: string;
  enabled: boolean;
  displayName?: string;
}

// Raw group data from IdP (before domain transformation)
export interface RawGroup {
  id: string;
  name: string;
  description?: string;
  members?: string[]; // User IDs
}

export interface Adaptor {
  /** Fetch all users from the IdP */
  fetchUsers(): Promise<RawUser[]>;

  /** Fetch all groups from the IdP */
  fetchGroups(): Promise<RawGroup[]>;

  /** Optional: Fetch nested group memberships */
  fetchNestedGroups?(): Promise<{ groupId: string; nestedGroupIds: string[] }[]>;

  /** Close any open connections or resources */
  close(): Promise<void>;
}

export default Adaptor;
