// Zitadel adaptor implementation
// Uses v2 resource-based API for users with fallback to management API for groups
// Based on research.md decisions for v2 API prioritization

import { Adaptor, RawGroup, RawUser } from "./types.ts";

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
    const requestBody: any = {
      query: {
        limit: 1000,
        asc: true,
      },
      sortingColumn: "USER_FIELD_NAME_UNSPECIFIED",
    };

    // Add organization filter if orgId is provided
    if (this.orgId) {
      requestBody.queries = [
        {
          organizationIdQuery: {
            organizationId: this.orgId,
          },
        },
      ];
    }

    console.log("[ZitadelAdaptor] Fetching users with request body:", JSON.stringify(requestBody, null, 2));

    const response = await fetch(`${this.baseUrl}/v2/users`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      console.error("[ZitadelAdaptor] Failed to fetch users:", response.status, response.statusText);
      throw new Error(`Failed to fetch users from Zitadel v2 API: ${response.statusText}`);
    }

    const data = await response.json();
    console.log("[ZitadelAdaptor] Raw API response:", JSON.stringify(data, null, 2));

    return (data.result || []).map((u: any) => {
      // Determine if this is a human or machine user
      const isHuman = !!u.human;
      const isMachine = !!u.machine;

      let email = "";
      let displayName = "";

      if (isHuman) {
        // Human user - extract from human object
        email = u.human.email?.email || "";
        const profile = u.human.profile || {};
        displayName = profile.displayName ||
          (profile.givenName && profile.familyName ? `${profile.givenName} ${profile.familyName}`.trim() : "");
      } else if (isMachine) {
        // Machine user - use machine name and description
        displayName = u.machine.description || u.machine.name || "";
      }

      return {
        id: u.userId,
        username: u.preferredLoginName || u.username || u.loginNames?.[0] || "",
        email: email,
        enabled: u.state === "USER_STATE_ACTIVE",
        displayName: displayName || u.preferredLoginName || u.username || u.loginNames?.[0] || "",
      };
    });
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
