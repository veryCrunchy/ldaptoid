// Bind Authentication Service
// Validates LDAP bind credentials and provides authentication results

import { LDAPResultCode } from "../protocol/ldap.ts";

export interface BindCredentials {
  dn: string;
  password: string;
}

export interface BindResult {
  success: boolean;
  resultCode: LDAPResultCode;
  matchedDN?: string;
  diagnosticMessage: string;
}

export interface BindAuthenticatorOptions {
  allowAnonymousBind?: boolean;
  bindDN?: string;
  bindPassword?: string;
}

export class BindAuthenticator {
  private readonly allowAnonymousBind: boolean;
  private readonly bindDN?: string;
  private readonly bindPassword?: string;

  constructor(options: BindAuthenticatorOptions = {}) {
    this.allowAnonymousBind = options.allowAnonymousBind ?? false;
    this.bindDN = options.bindDN;
    this.bindPassword = options.bindPassword;
  }

  authenticate(credentials: BindCredentials): BindResult {
    // Handle anonymous bind (empty DN and password)
    if (credentials.dn === "" && credentials.password === "") {
      if (this.allowAnonymousBind) {
        return {
          success: true,
          resultCode: LDAPResultCode.Success,
          matchedDN: "",
          diagnosticMessage: "Anonymous bind successful",
        };
      } else {
        return {
          success: false,
          resultCode: LDAPResultCode.InsufficientAccessRights,
          diagnosticMessage: "Anonymous bind not allowed",
        };
      }
    }

    // Handle simple DN bind (non-empty DN, empty password)
    if (credentials.dn !== "" && credentials.password === "") {
      return {
        success: false,
        resultCode: LDAPResultCode.InvalidCredentials,
        diagnosticMessage: "Simple bind requires password",
      };
    }

    // Handle configured bind credentials
    if (this.bindDN && this.bindPassword) {
      if (credentials.dn === this.bindDN && credentials.password === this.bindPassword) {
        return {
          success: true,
          resultCode: LDAPResultCode.Success,
          matchedDN: credentials.dn,
          diagnosticMessage: "Bind successful",
        };
      } else {
        return {
          success: false,
          resultCode: LDAPResultCode.InvalidCredentials,
          diagnosticMessage: "Invalid credentials",
        };
      }
    }

    // No authentication configured - deny all non-anonymous binds
    return {
      success: false,
      resultCode: LDAPResultCode.InvalidCredentials,
      diagnosticMessage: "Authentication not configured",
    };
  }

  validateDN(dn: string): boolean {
    // Basic DN validation - check for basic LDAP DN format
    if (dn === "") return true; // Empty DN is valid for anonymous

    // Simple validation: should contain at least one component with =
    const components = dn.split(",").map((c) => c.trim());
    for (const component of components) {
      if (!component.includes("=") || component.startsWith("=") || component.endsWith("=")) {
        return false;
      }
    }

    return true;
  }

  requiresAuthentication(): boolean {
    return !this.allowAnonymousBind || (this.bindDN !== undefined && this.bindPassword !== undefined);
  }

  getConfiguredBindDN(): string | undefined {
    return this.bindDN;
  }
}

export default BindAuthenticator;
