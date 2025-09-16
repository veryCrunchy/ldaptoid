// Keycloak adaptor implementation
// Fetches users and groups from Keycloak REST API

import { Adaptor, RawUser, RawGroup } from "./types.ts";

export class KeycloakAdaptor implements Adaptor {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  async fetchUsers(): Promise<RawUser[]> {
    const response = await fetch(`${this.baseUrl}/users`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch users: ${response.statusText}`);
    }
    const data = await response.json();
    return data.map((u: any) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      enabled: u.enabled,
      displayName: u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.username,
    }));
  }

  async fetchGroups(): Promise<RawGroup[]> {
    const response = await fetch(`${this.baseUrl}/groups`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch groups: ${response.statusText}`);
    }
    const data = await response.json();
    return data.map((g: any) => ({
      id: g.id,
      name: g.name,
      description: g.attributes?.description?.[0],
      members: [], // Keycloak API requires additional calls for group members
    }));
  }

  async close(): Promise<void> {
    // No persistent connections to close in this implementation
  }
}

export default KeycloakAdaptor;
