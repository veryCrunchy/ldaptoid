// Zitadel adaptor implementation  
// Uses v2 resource-based API for users with fallback to management API for groups
// Based on research.md decisions for v2 API prioritization

import { Adaptor, RawUser, RawGroup } from "./types.ts";

export class ZitadelAdaptor implements Adaptor {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly orgId?: string;

  constructor(baseUrl: string, token: string, orgId?: string) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.orgId = orgId;
  }

  async fetchUsers(): Promise<RawUser[]> {
    // Use v2 resource-based API (preferred per research.md)
    const response = await fetch(`${this.baseUrl}/v2/users`, {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...(this.orgId && { 'x-zitadel-orgid': this.orgId })
      },
      body: JSON.stringify({
        query: {
          limit: 1000,
          asc: true
        }
      })
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch users from Zitadel v2 API: ${response.statusText}`);
    }
    
    const data = await response.json();
    return (data.result || []).map((u: any) => ({
      id: u.userId,
      username: u.details?.preferredUsername || u.userName || u.loginNames?.[0],
      email: u.contact?.email,
      enabled: u.state === 'USER_STATE_ACTIVE',
      displayName: u.profile?.displayName || u.profile?.givenName && u.profile?.familyName 
        ? `${u.profile.givenName} ${u.profile.familyName}`.trim()
        : u.userName,
    }));
  }

  fetchGroups(): Promise<RawGroup[]> {
    // Groups not yet available in v2 API - return empty per research.md decision
    // Future: Could implement organization/project mapping here
    // For now, synthetic groups will be the primary grouping mechanism
    return Promise.resolve([]);
  }

  async close(): Promise<void> {
    // No persistent connections to close in this implementation
  }
}

export default ZitadelAdaptor;