// OAuth2 client service for identity provider authentication
// Implements client credentials flow for Keycloak, Entra ID, and Zitadel

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export interface CachedToken {
  token: string;
  expiresAt: number;
  scope?: string;
}

export interface OAuthConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  realm?: string;      // For Keycloak/Zitadel
  tenant?: string;     // For Entra ID
  organization?: string; // For Zitadel v2
}

export class OAuth2Client {
  private tokenCache: Map<string, CachedToken> = new Map();
  private readonly bufferSeconds = 30; // Refresh token 30 seconds before expiry

  /**
   * Get an access token for the specified IdP configuration
   * Uses cached token if valid, otherwise fetches a new one
   */
  async getAccessToken(idpType: "keycloak" | "entra" | "zitadel", config: OAuthConfig): Promise<string> {
    const cacheKey = this.getCacheKey(idpType, config);
    const cached = this.tokenCache.get(cacheKey);
    
    // Return cached token if still valid
    if (cached && cached.expiresAt > Date.now() + (this.bufferSeconds * 1000)) {
      return cached.token;
    }

    // Fetch new token
    const tokenResponse = await this.fetchToken(idpType, config);
    
    // Cache the new token
    const cachedToken: CachedToken = {
      token: tokenResponse.access_token,
      expiresAt: Date.now() + (tokenResponse.expires_in * 1000),
      scope: tokenResponse.scope
    };
    this.tokenCache.set(cacheKey, cachedToken);

    return tokenResponse.access_token;
  }

  /**
   * Fetch a new access token from the identity provider
   */
  private async fetchToken(idpType: "keycloak" | "entra" | "zitadel", config: OAuthConfig): Promise<TokenResponse> {
    switch (idpType) {
      case "keycloak":
        return await this.fetchKeycloakToken(config);
      case "entra":
        return await this.fetchEntraToken(config);
      case "zitadel":
        return await this.fetchZitadelToken(config);
      default:
        throw new Error(`Unsupported IdP type: ${idpType}`);
    }
  }

  /**
   * Fetch access token from Keycloak using client credentials flow
   */
  private async fetchKeycloakToken(config: OAuthConfig): Promise<TokenResponse> {
    if (!config.realm) {
      throw new Error("Keycloak realm is required");
    }

    const tokenUrl = `${config.baseUrl}/realms/${config.realm}/protocol/openid-connect/token`;
    
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: "openid profile email" // Standard Keycloak scopes
    });

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body: body.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Keycloak OAuth failed (${response.status}): ${errorText}`);
    }

    return await response.json() as TokenResponse;
  }

  /**
   * Fetch access token from Microsoft Entra ID using client credentials flow
   */
  private async fetchEntraToken(config: OAuthConfig): Promise<TokenResponse> {
    if (!config.tenant) {
      throw new Error("Entra tenant is required");
    }

    const tokenUrl = `https://login.microsoftonline.com/${config.tenant}/oauth2/v2.0/token`;
    
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: "https://graph.microsoft.com/.default" // Microsoft Graph API scope
    });

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body: body.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Entra OAuth failed (${response.status}): ${errorText}`);
    }

    return await response.json() as TokenResponse;
  }

  /**
   * Fetch access token from Zitadel using client credentials flow
   */
  private async fetchZitadelToken(config: OAuthConfig): Promise<TokenResponse> {
    // Zitadel v2 uses the standard OAuth2 endpoint
    const tokenUrl = `${config.baseUrl}/oauth/v2/token`;
    
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: "urn:zitadel:iam:org:projects:roles" // Zitadel v2 scope for user/group access
    });

    // Add organization scope if specified (for Zitadel v2 multi-org)
    if (config.organization) {
      body.set("scope", `${body.get("scope")} urn:zitadel:iam:org:id:${config.organization}`);
    }

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "User-Agent": "ldaptoid/1.0"
      },
      body: body.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Zitadel OAuth failed (${response.status}): ${errorText}`);
    }

    return await response.json() as TokenResponse;
  }

  /**
   * Generate cache key for token storage
   */
  private getCacheKey(idpType: string, config: OAuthConfig): string {
    const parts = [idpType, config.baseUrl, config.clientId];
    if (config.realm) parts.push(config.realm);
    if (config.tenant) parts.push(config.tenant);
    if (config.organization) parts.push(config.organization);
    return parts.join("|");
  }

  /**
   * Clear all cached tokens (useful for testing or forced refresh)
   */
  clearTokenCache(): void {
    this.tokenCache.clear();
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.tokenCache.size,
      keys: Array.from(this.tokenCache.keys())
    };
  }

  /**
   * Validate token expiry for health checks
   */
  hasValidToken(idpType: "keycloak" | "entra" | "zitadel", config: OAuthConfig): boolean {
    const cacheKey = this.getCacheKey(idpType, config);
    const cached = this.tokenCache.get(cacheKey);
    return cached ? cached.expiresAt > Date.now() + (this.bufferSeconds * 1000) : false;
  }
}

export default OAuth2Client;