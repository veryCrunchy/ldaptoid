// Entra adaptor implementation
// Fetches users and groups from Microsoft Entra (Azure AD) Graph API

import { Adaptor, RawGroup, RawUser } from "./types.ts";

export class EntraAdaptor implements Adaptor {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  async fetchUsers(): Promise<RawUser[]> {
    const response = await fetch(`${this.baseUrl}/v1.0/users`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch users: ${response.statusText}`);
    }
    const data = await response.json();
    return data.value.map((u: any) => ({
      id: u.id,
      username: u.userPrincipalName,
      email: u.mail,
      enabled: u.accountEnabled,
      displayName: u.displayName,
    }));
  }

  async fetchGroups(): Promise<RawGroup[]> {
    const response = await fetch(`${this.baseUrl}/v1.0/groups`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch groups: ${response.statusText}`);
    }
    const data = await response.json();
    return data.value.map((g: any) => ({
      id: g.id,
      name: g.displayName,
      description: g.description,
      members: [], // Additional calls required for group members
    }));
  }

  async close(): Promise<void> {
    // No persistent connections to close in this implementation
  }
}

export default EntraAdaptor;
