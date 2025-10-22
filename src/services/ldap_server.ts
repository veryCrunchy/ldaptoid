// LDAP Server Implementation
// TCP server handling LDAP protocol requests with read-only operations

import {
  BindRequest,
  BindResponse,
  Filter,
  FilterType,
  LDAP_PORT,
  LDAPCodec,
  LDAPMessage,
  LDAPMessageType,
  LDAPResultCode,
  SearchRequest,
  SearchResultDone as _SearchResultDone,
  SearchResultEntry,
  UnbindRequest as _UnbindRequest,
} from "../protocol/ldap.ts";
import { Snapshot, User } from "../models/mod.ts";

export interface LDAPServerOptions {
  port?: number;
  bindDN?: string;
  bindPassword?: string;
  baseDN: string;
  sizeLimit?: number;
  allowAnonymousBind?: boolean;
}

export class LDAPServer {
  private readonly port: number;
  private readonly bindDN?: string;
  private readonly bindPassword?: string;
  private readonly baseDN: string;
  private readonly sizeLimit: number;
  private readonly allowAnonymousBind: boolean;
  private server?: Deno.TcpListener;
  private currentSnapshot?: Snapshot;

  constructor(options: LDAPServerOptions) {
    this.port = options.port ?? LDAP_PORT;
    this.bindDN = options.bindDN;
    this.bindPassword = options.bindPassword;
    this.baseDN = options.baseDN;
    this.sizeLimit = options.sizeLimit ?? 1000;
    this.allowAnonymousBind = options.allowAnonymousBind ?? false;
  }

  async start(): Promise<void> {
    this.server = Deno.listen({ port: this.port });
    console.log(`LDAP server listening on port ${this.port}`);

    for await (const conn of this.server) {
      this.handleConnection(conn).catch((err) => {
        console.error("Connection error:", err);
      });
    }
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = undefined;
    }
  }

  updateSnapshot(snapshot: Snapshot): void {
    this.currentSnapshot = snapshot;
  }

  private async handleConnection(conn: Deno.Conn): Promise<void> {
    const readBuf = new Uint8Array(0);
    let buffer = readBuf;
    let authenticated = false;

    try {
      const tmp = new Uint8Array(8192);
      while (true) {
        const bytesRead = await conn.read(tmp);
        if (bytesRead === null) break;

        // Append incoming bytes to buffer
        const incoming = tmp.slice(0, bytesRead);
        const newBuf = new Uint8Array(buffer.length + incoming.length);
        newBuf.set(buffer, 0);
        newBuf.set(incoming, buffer.length);
        buffer = newBuf;

        // If buffer doesn't start with ASN.1 SEQUENCE (0x30), attempt to resynchronize
        if (buffer.length > 0 && buffer[0] !== 0x30) {
          const idx = buffer.indexOf(0x30);
          // eslint-disable-next-line no-console
          console.warn(`Resync: buffer did not start with 0x30, dropping ${idx >= 0 ? idx : buffer.length} bytes`);
          if (idx >= 0) {
            buffer = buffer.slice(idx);
          } else {
            // No sequence tag found yet; wait for more data but cap buffer to avoid unbounded growth
            if (buffer.length > 16 * 1024) {
              // eslint-disable-next-line no-console
              console.warn("Buffer overflow without sequence tag, truncating buffer");
              buffer = buffer.slice(-8 * 1024);
            }
            // Try again later when more data arrives
            break;
          }
        }

        // Try to decode as many complete messages as available
        let loop = true;
        while (loop) {
          const decoded = LDAPCodec.tryDecode(buffer);
          if (!decoded) {
            // No complete message yet - helpful debug when buffer grows
            if (buffer.length > 0) {
              const dump = Array.from(buffer.slice(0, 64)).map((b) => b.toString(16).padStart(2, "0")).join(" ");
              // eslint-disable-next-line no-console
              console.debug(`No complete LDAP message yet (buffer ${buffer.length} bytes). Head: ${dump}`);
            }
            loop = false;
            break;
          }

          const { message, consumed } = decoded;
          // Advance buffer
          buffer = buffer.slice(consumed);

          let response: LDAPMessage;

          switch (message.protocolOp.type) {
            case LDAPMessageType.BindRequest: {
              const bindResult = this.handleBind(message.protocolOp as BindRequest);
              authenticated = bindResult.resultCode === LDAPResultCode.Success;
              response = {
                messageID: message.messageID,
                protocolOp: bindResult,
              };
              break;
            }

            case LDAPMessageType.SearchRequest: {
              if (!authenticated && this.bindDN) {
                response = {
                  messageID: message.messageID,
                  protocolOp: {
                    type: LDAPMessageType.SearchResultDone,
                    resultCode: LDAPResultCode.InsufficientAccessRights,
                    matchedDN: "",
                    diagnosticMessage: "Authentication required",
                  },
                };
              } else {
                // For search requests, we need to send multiple messages
                await this.handleSearch(
                  conn,
                  message.messageID,
                  message.protocolOp as SearchRequest,
                  (message as any).controls as any[] | undefined,
                );
                continue;
              }
              break;
            }

            case LDAPMessageType.UnbindRequest: {
              // Client is disconnecting
              return;
            }

            default: {
              response = {
                messageID: message.messageID,
                protocolOp: {
                  type: LDAPMessageType.SearchResultDone,
                  resultCode: LDAPResultCode.ProtocolError,
                  matchedDN: "",
                  diagnosticMessage: "Unsupported operation",
                },
              };
            }
          }

          const responseData = LDAPCodec.encode(response);
          await conn.write(responseData);
        }
      }
    } catch (err) {
      // On parse error, log raw buffer for debugging and close
      // eslint-disable-next-line no-console
      console.error("Connection error / parse failure:", err);
      // Dump first 256 bytes of buffer as hex for debugging
      const dump = Array.from(buffer.slice(0, 256)).map((b) => b.toString(16).padStart(2, "0")).join(" ");
      // eslint-disable-next-line no-console
      console.debug(`Buffer dump (first 256 bytes): ${dump}`);
    } finally {
      conn.close();
    }
  }

  private handleBind(request: BindRequest): BindResponse {
    // Anonymous bind allowed if no bind credentials configured or explicitly allowed
    if (this.allowAnonymousBind || (!this.bindDN && !this.bindPassword)) {
      return {
        type: LDAPMessageType.BindResponse,
        resultCode: LDAPResultCode.Success,
        matchedDN: "",
        diagnosticMessage: "Anonymous bind successful",
      };
    }

    // Check credentials if configured
    if (request.authentication.type === "simple") {
      const valid = request.name === this.bindDN &&
        request.authentication.password === this.bindPassword;

      return {
        type: LDAPMessageType.BindResponse,
        resultCode: valid ? LDAPResultCode.Success : LDAPResultCode.InvalidCredentials,
        matchedDN: valid ? request.name : "",
        diagnosticMessage: valid ? "Bind successful" : "Invalid credentials",
      };
    }

    return {
      type: LDAPMessageType.BindResponse,
      resultCode: LDAPResultCode.AuthMethodNotSupported,
      matchedDN: "",
      diagnosticMessage: "Only simple authentication supported",
    };
  }

  private async handleSearch(
    conn: Deno.Conn,
    messageID: number,
    request: SearchRequest,
    controls?: Array<{ controlType: string; controlValue?: Uint8Array }>,
  ): Promise<void> {
    console.log(`=== LDAP Search Request ===`);
    console.log(`Base Object: "${request.baseObject}"`);
    console.log(`Scope: ${request.scope}`);
    console.log(`Filter:`, JSON.stringify(request.filter, null, 2));
    console.log(`Attributes:`, request.attributes);

    if (!this.currentSnapshot) {
      console.log("ERROR: No directory snapshot available");
      const errorResponse: LDAPMessage = {
        messageID,
        protocolOp: {
          type: LDAPMessageType.SearchResultDone,
          resultCode: LDAPResultCode.Unavailable,
          matchedDN: "",
          diagnosticMessage: "No directory snapshot available",
        },
      };
      await conn.write(LDAPCodec.encode(errorResponse));
      return;
    }

    console.log(
      `Snapshot data: ${this.currentSnapshot.users.length} users, ${this.currentSnapshot.groups.length} groups`,
    );

    try {
      const normalizedRequest = this.normalizeSearchRequest(request);
      console.log(`Normalized base object: "${normalizedRequest.baseObject}"`);
      const searchContext = this.createSearchContext(normalizedRequest);

      if (!this.isBaseObjectInScope(normalizedRequest.baseObject)) {
        console.log("Base object not in scope, returning empty result");
        await this.sendSearchDone(conn, messageID, [], LDAPResultCode.Success, "Search completed");
        return;
      }

      const entries = this.executeSearch(searchContext);
      console.log(`Found ${entries.length} entries before limits`);
      const limitedEntries = this.applyLimits(entries, normalizedRequest.sizeLimit);
      console.log(`Sending ${limitedEntries.length} entries after limits`);

      await this.sendSearchResults(conn, messageID, limitedEntries);

      const resultCode = entries.length >= this.sizeLimit ? LDAPResultCode.SizeLimitExceeded : LDAPResultCode.Success;
      const message = entries.length >= this.sizeLimit ? "Size limit exceeded" : "Search completed";

      await this.sendSearchDone(conn, messageID, controls, resultCode, message);
    } catch (error) {
      console.error("Search error:", error);
      await this.sendSearchDone(conn, messageID, [], LDAPResultCode.OperationsError, "Internal search error");
    }
  }

  private normalizeSearchRequest(request: SearchRequest): SearchRequest {
    const normalizeString = (raw: string | undefined): string => {
      if (!raw) return "";
      // Remove TLV encoding artifacts and normalize (0x04 is OCTET STRING tag)
      if (raw.charCodeAt(0) === 4 && raw.length > 2) {
        const cleaned = raw.slice(2).trim();
        return cleaned || raw.trim();
      }
      return raw.trim();
    };

    const normalizedAttrs = (request.attributes || []).map(normalizeString).filter(Boolean);
    const normalizedFilter = this.normalizeFilter(request.filter);

    return {
      ...request,
      baseObject: normalizeString(request.baseObject),
      attributes: normalizedAttrs,
      filter: normalizedFilter,
    };
  }

  private normalizeFilter(filter: Filter): Filter {
    if (!filter) return filter;

    const normalizeString = (str: string | undefined): string => {
      if (!str) return "";
      // Remove TLV encoding artifacts and normalize (0x04 is OCTET STRING tag)
      if (str.charCodeAt(0) === 4 && str.length > 2) {
        const cleaned = str.slice(2).trim();
        return cleaned || str.trim();
      }
      return str.trim();
    };

    switch (filter.type) {
      case FilterType.And:
      case FilterType.Or:
        return {
          ...filter,
          filters: (filter as any).filters.map((f: Filter) => this.normalizeFilter(f)),
        };
      case FilterType.Not:
        return {
          ...filter,
          filter: this.normalizeFilter((filter as any).filter),
        };
      case FilterType.EqualityMatch:
        return {
          ...filter,
          attributeDesc: normalizeString((filter as any).attributeDesc),
          assertionValue: normalizeString((filter as any).assertionValue),
        };
      case FilterType.Substrings: {
        const subFilter = filter as any;
        return {
          ...filter,
          type_: normalizeString(subFilter.type_),
          substrings: (subFilter.substrings || []).map((s: any) => ({
            ...s,
            initial: s.initial ? normalizeString(s.initial) : undefined,
            final: s.final ? normalizeString(s.final) : undefined,
            any: s.any ? s.any.map(normalizeString) : undefined,
          })),
        };
      }
      case FilterType.Present:
        return {
          ...filter,
          attributeDesc: normalizeString((filter as any).attributeDesc),
        };
      case FilterType.GreaterOrEqual:
      case FilterType.LessOrEqual:
      case FilterType.ApproxMatch:
        return {
          ...filter,
          attributeDesc: normalizeString((filter as any).attributeDesc),
          assertionValue: normalizeString((filter as any).assertionValue),
        };
      default:
        return filter;
    }
  }

  private createSearchContext(request: SearchRequest) {
    const users = this.currentSnapshot?.users || [];
    const groups = this.currentSnapshot?.groups || [];

    return {
      request,
      users,
      groups,
      userDNBase: `ou=users,${this.baseDN}`,
      groupDNBase: `ou=groups,${this.baseDN}`,
      baseDN: this.baseDN,
    };
  }

  private isBaseObjectInScope(baseObject: string): boolean {
    // Root DSE (empty base object) is always in scope
    if (!baseObject || baseObject === "") {
      console.log(`Root DSE search - always in scope`);
      return true;
    }

    const normalizeDN = (dn: string) => dn.toLowerCase().replace(/\s+/g, "");
    const normalizedBase = normalizeDN(baseObject);
    const normalizedServerBase = normalizeDN(this.baseDN);

    console.log(`Checking base object scope:`);
    console.log(`  - Base object: "${baseObject}" -> "${normalizedBase}"`);
    console.log(`  - Server base: "${this.baseDN}" -> "${normalizedServerBase}"`);

    // Allow exact match or if base is under server's DN
    const result = normalizedBase === normalizedServerBase ||
      normalizedBase.endsWith("," + normalizedServerBase);

    console.log(`  - Result: ${result}`);
    return result;
  }

  private executeSearch(context: any): SearchResultEntry[] {
    const entries: SearchResultEntry[] = [];
    const { request, users, groups } = context;

    console.log(`=== Execute Search ===`);
    console.log(`Base Object: "${request.baseObject}"`);
    console.log(`Scope: ${request.scope}`);
    console.log(`Users count: ${users.length}`);
    console.log(`Groups count: ${groups.length}`);

    // Handle special cases for Root DSE
    if (request.baseObject === "") {
      console.log("Handling Root DSE search");
      if (request.scope === 0) { // Base scope for Root DSE
        console.log("Root DSE base scope search - creating Root DSE entry");
        const rootEntry = this.createRootDSEEntry(context);
        if (rootEntry) {
          console.log("Root DSE entry created, checking filter match");
          const rootAttrs = this.buildAttributesMapFromEntry(rootEntry);
          console.log("Root DSE attributes:", Object.keys(rootAttrs));
          const matchesFilter = this.matchesFilter(request.filter, null, rootAttrs);
          console.log("Root DSE filter match result:", matchesFilter);
          if (matchesFilter) {
            console.log("Adding Root DSE entry to results");
            entries.push(rootEntry);
          }
        }
        return entries;
      }
    }

    // Handle base DN search
    if (request.baseObject === this.baseDN) {
      console.log("Handling base DN search");
      if (request.scope === 0) { // Base scope
        // For base scope on the server's base DN, we might want to return the base DN entry itself
        // For now, continue with normal search logic
      }
    }

    // Search users
    console.log("Searching users...");
    for (const user of users) {
      const userAttrs = this.buildUserAttributes(user, context);
      const userDN = userAttrs.dn as string;

      console.log(`Checking user: ${user.username}, DN: ${userDN}`);
      console.log(`  - Scope check: ${this.isInSearchScope(userDN, request.baseObject, request.scope)}`);
      console.log(`  - Filter check: ${this.matchesFilter(request.filter, user, userAttrs)}`);

      if (
        this.isInSearchScope(userDN, request.baseObject, request.scope) &&
        this.matchesFilter(request.filter, user, userAttrs)
      ) {
        console.log(`  - MATCH: Adding user ${user.username}`);
        const entry = this.createUserEntry(userAttrs, request.attributes, request.typesOnly);
        entries.push(entry);
      } else {
        console.log(`  - NO MATCH: Skipping user ${user.username}`);
        // Debug: If scope matches but filter doesn't, show user attributes
        if (this.isInSearchScope(userDN, request.baseObject, request.scope)) {
          console.log(`  - Scope matched but filter failed. User attributes:`, Object.keys(userAttrs));
          console.log(`  - objectClass values:`, userAttrs.objectClass);
        }
      }
    }

    // Search groups
    console.log("Searching groups...");
    for (const group of groups) {
      const groupAttrs = this.buildGroupAttributes(group, context);
      const groupDN = groupAttrs.dn as string;

      console.log(`Checking group: ${group.name}, DN: ${groupDN}`);
      console.log(`  - Scope check: ${this.isInSearchScope(groupDN, request.baseObject, request.scope)}`);
      console.log(`  - Filter check: ${this.matchesFilter(request.filter, group, groupAttrs)}`);

      if (
        this.isInSearchScope(groupDN, request.baseObject, request.scope) &&
        this.matchesFilter(request.filter, group, groupAttrs)
      ) {
        console.log(`  - MATCH: Adding group ${group.name}`);
        const entry = this.createGroupEntry(groupAttrs, request.attributes, request.typesOnly);
        entries.push(entry);
      } else {
        console.log(`  - NO MATCH: Skipping group ${group.name}`);
      }
    }

    // Add organizational units if in scope
    if (request.scope !== 0) { // Not base scope
      console.log("Adding organizational units...");
      const ouEntries = this.createOUEntries(context, request);
      console.log(`Found ${ouEntries.length} OU entries`);
      entries.push(...ouEntries);
    }

    console.log(`Total entries found: ${entries.length}`);
    return entries;
  }

  private buildUserAttributes(user: User, context: any): Record<string, string | string[]> {
    const { groups, userDNBase, groupDNBase } = context;

    const findGroupById = (id?: string) => groups.find((g: any) => g.id === id);
    const primaryGroup = findGroupById(user.primaryGroupId);
    const gidNumber = primaryGroup ? String(primaryGroup.posixGid) : "10000";

    // Parse display name
    const parts = (user.displayName || user.username || "").trim().split(/\s+/).filter(Boolean);
    const givenName: string = parts.length > 0 && parts[0] ? parts[0] : (user.username || "unknown");
    const sn: string = parts.length > 1 ? parts.slice(1).join(" ") : givenName;

    const dn = `uid=${user.username},${userDNBase}`;
    const memberOfDNs = (user.memberGroupIds || [])
      .map((gid) => findGroupById(gid))
      .filter(Boolean)
      .map((g: any) => `cn=${g.name},${groupDNBase}`);

    return {
      dn,
      objectClass: ["top", "person", "organizationalPerson", "inetOrgPerson", "posixAccount"],
      uid: user.username,
      cn: user.displayName || user.username,
      sn: sn,
      givenName: givenName,
      displayName: user.displayName || user.username,
      mail: user.email || "",
      userPrincipalName: user.email || "",
      uidNumber: String(user.posixUid),
      gidNumber,
      homeDirectory: `/home/${user.username}`,
      loginShell: "/bin/bash",
      memberOf: memberOfDNs,
      userAccountControl: "512", // Normal account
      description: `User account for ${user.displayName || user.username}`,
    };
  }

  private buildGroupAttributes(group: any, context: any): Record<string, string | string[]> {
    const { groupDNBase, users } = context;
    const dn = `cn=${group.name},${groupDNBase}`;

    // Find members
    const memberDNs = users
      .filter((u: User) => u.memberGroupIds?.includes(group.id) || u.primaryGroupId === group.id)
      .map((u: User) => `uid=${u.username},ou=users,${context.baseDN}`);

    return {
      dn,
      objectClass: ["top", "group", "posixGroup"],
      cn: group.name,
      gidNumber: String(group.posixGid),
      description: group.description || `Group ${group.name}`,
      member: memberDNs,
      memberUid: users
        .filter((u: User) => u.memberGroupIds?.includes(group.id) || u.primaryGroupId === group.id)
        .map((u: User) => u.username),
    };
  }

  private createRootDSEEntry(context: any): SearchResultEntry | null {
    const attrs: Record<string, string | string[]> = {
      objectClass: ["top", "rootDSE"],
      namingContexts: [context.baseDN],
      supportedLDAPVersion: ["3"],
      supportedControl: ["1.2.840.113556.1.4.319"], // Paged results
      supportedExtension: [],
      vendorName: "LDAPtoID",
      vendorVersion: "1.0.0",
    };

    return {
      type: LDAPMessageType.SearchResultEntry,
      objectName: "",
      attributes: Object.entries(attrs).map(([type, vals]) => ({
        type,
        vals: Array.isArray(vals) ? vals : [vals],
      })),
    };
  }

  private createOUEntries(context: any, request: SearchRequest): SearchResultEntry[] {
    const entries: SearchResultEntry[] = [];
    const { baseDN } = context;

    // Create users OU
    const usersOU = {
      dn: `ou=users,${baseDN}`,
      objectClass: ["top", "organizationalUnit"],
      ou: "users",
      description: "Users organizational unit",
    };

    if (
      this.isInSearchScope(usersOU.dn, request.baseObject, request.scope) &&
      this.matchesFilter(request.filter, null, usersOU)
    ) {
      entries.push({
        type: LDAPMessageType.SearchResultEntry,
        objectName: usersOU.dn,
        attributes: this.buildAttributeList(usersOU, request.attributes, request.typesOnly),
      });
    }

    // Create groups OU
    const groupsOU = {
      dn: `ou=groups,${baseDN}`,
      objectClass: ["top", "organizationalUnit"],
      ou: "groups",
      description: "Groups organizational unit",
    };

    if (
      this.isInSearchScope(groupsOU.dn, request.baseObject, request.scope) &&
      this.matchesFilter(request.filter, null, groupsOU)
    ) {
      entries.push({
        type: LDAPMessageType.SearchResultEntry,
        objectName: groupsOU.dn,
        attributes: this.buildAttributeList(groupsOU, request.attributes, request.typesOnly),
      });
    }

    return entries;
  }

  private isInSearchScope(entryDN: string, baseObject: string, scope: number): boolean {
    const normalizeDN = (dn: string) => dn.toLowerCase().replace(/\s+/g, "");
    const normalizedEntry = normalizeDN(entryDN);
    const normalizedBase = normalizeDN(baseObject);

    console.log(`    Scope check: entry="${entryDN}" base="${baseObject}" scope=${scope}`);
    console.log(`    Normalized: entry="${normalizedEntry}" base="${normalizedBase}"`);

    switch (scope) {
      case 0: { // Base
        const baseResult = normalizedEntry === normalizedBase;
        console.log(`    Base scope result: ${baseResult}`);
        return baseResult;
      }
      case 1: { // One level
        if (normalizedEntry === normalizedBase) {
          console.log(`    One level: entry equals base, returning false`);
          return false;
        }
        const entryParts = normalizedEntry.split(",");
        const parentDN = entryParts.slice(1).join(",");
        const oneResult = parentDN === normalizedBase;
        console.log(`    One level: parentDN="${parentDN}" base="${normalizedBase}" result=${oneResult}`);
        return oneResult;
      }
      case 2: { // Subtree
        const subtreeResult = normalizedEntry === normalizedBase || normalizedEntry.endsWith("," + normalizedBase);
        console.log(`    Subtree result: ${subtreeResult}`);
        return subtreeResult;
      }
      default: {
        console.log(`    Unknown scope ${scope}, returning false`);
        return false;
      }
    }
  }

  private matchesFilter(filter: Filter, entry: any, attrs: Record<string, any>): boolean {
    if (!filter) return true;

    const getAttrValues = (name: string): string[] => {
      const normalizedName = this.normalizeStringValue(name).toLowerCase();
      for (const [key, value] of Object.entries(attrs)) {
        if (key.toLowerCase() === normalizedName) {
          if (value === undefined || value === null) return [];
          return Array.isArray(value) ? value.map(String) : [String(value)];
        }
      }
      return [];
    };

    const compareString = (a: string, b: string): boolean => {
      return a.toLowerCase() === b.toLowerCase();
    };

    switch (filter.type) {
      case FilterType.And:
        return (filter as any).filters.every((f: Filter) => this.matchesFilter(f, entry, attrs));

      case FilterType.Or:
        return (filter as any).filters.some((f: Filter) => this.matchesFilter(f, entry, attrs));

      case FilterType.Not:
        return !this.matchesFilter((filter as any).filter, entry, attrs);

      case FilterType.EqualityMatch: {
        const f = filter as any;
        const normalizedAttr = f.attributeDesc ? this.normalizeStringValue(f.attributeDesc) : "";
        const normalizedValue = f.assertionValue ? this.normalizeStringValue(f.assertionValue) : "";
        const values = getAttrValues(normalizedAttr);
        const match = values.some((v) => this.normalizeStringValue(v).toLowerCase() === normalizedValue.toLowerCase());
        return match;
      }

      case FilterType.Present: {
        const f = filter as any;
        const normalizedAttr = f.attributeDesc ? this.normalizeStringValue(f.attributeDesc) : "";
        const values = getAttrValues(normalizedAttr);
        const hasValues = values.length > 0 && values.some((v) => v !== "");
        return hasValues;
      }

      case FilterType.Substrings: {
        const f = filter as any;
        const values = getAttrValues(f.type_);
        const combinedValue = values.join(" ").toLowerCase();

        for (const substring of f.substrings || []) {
          if (substring.initial && !combinedValue.startsWith(substring.initial.toLowerCase())) {
            return false;
          }
          if (substring.final && !combinedValue.endsWith(substring.final.toLowerCase())) {
            return false;
          }
          if (substring.any) {
            for (const anyPart of substring.any) {
              if (!combinedValue.includes(anyPart.toLowerCase())) {
                return false;
              }
            }
          }
        }
        return true;
      }

      case FilterType.GreaterOrEqual: {
        const f = filter as any;
        const values = getAttrValues(f.attributeDesc);
        return values.some((v) => v >= f.assertionValue);
      }

      case FilterType.LessOrEqual: {
        const f = filter as any;
        const values = getAttrValues(f.attributeDesc);
        return values.some((v) => v <= f.assertionValue);
      }

      case FilterType.ApproxMatch: {
        const f = filter as any;
        const values = getAttrValues(f.attributeDesc);
        return values.some((v) => compareString(v, f.assertionValue));
      }

      default:
        return false;
    }
  }

  private createUserEntry(attrs: Record<string, any>, requestedAttrs: string[], typesOnly: boolean): SearchResultEntry {
    return {
      type: LDAPMessageType.SearchResultEntry,
      objectName: attrs.dn as string,
      attributes: this.buildAttributeList(attrs, requestedAttrs, typesOnly),
    };
  }

  private createGroupEntry(
    attrs: Record<string, any>,
    requestedAttrs: string[],
    typesOnly: boolean,
  ): SearchResultEntry {
    return {
      type: LDAPMessageType.SearchResultEntry,
      objectName: attrs.dn as string,
      attributes: this.buildAttributeList(attrs, requestedAttrs, typesOnly),
    };
  }

  private buildAttributeList(attrs: Record<string, any>, requestedAttrs: string[], typesOnly: boolean): any[] {
    const result: any[] = [];
    const wantedAttrs = requestedAttrs.length > 0 ? new Set(requestedAttrs.map((a) => a.toLowerCase())) : null;

    for (const [attrName, attrValue] of Object.entries(attrs)) {
      if (attrName === "dn") continue; // DN is handled separately

      const lowerAttrName = attrName.toLowerCase();
      if (wantedAttrs && !wantedAttrs.has(lowerAttrName)) continue;

      const values = Array.isArray(attrValue) ? attrValue : [attrValue];
      const stringValues = values.map(String).filter((v) => v !== "");

      if (stringValues.length > 0) {
        result.push({
          type: attrName,
          vals: typesOnly ? [] : stringValues,
        });
      }
    }

    return result;
  }

  private normalizeStringValue(raw: string | undefined): string {
    if (!raw) return "";

    // Handle different string encodings - check for control characters at start
    let cleaned = raw;

    // Remove ASN.1 TLV encoding artifacts - try different approaches
    if (raw.length > 0) {
      const firstByte = raw.charCodeAt(0);

      // Method 1: Check for ASN.1 OCTET STRING (0x04) or UTF8String (0x0C)
      if (firstByte === 4 || firstByte === 12) {
        if (raw.length > 2) {
          cleaned = raw.slice(2);
        }
      } // Method 2: Check for any control character followed by length byte
      else if (firstByte <= 0x1F && raw.length > 2) {
        const lengthByte = raw.charCodeAt(1);
        if (lengthByte > 0 && lengthByte <= raw.length - 2) {
          cleaned = raw.slice(2);
        }
      }
    }

    // Remove any remaining non-printable characters
    cleaned = cleaned.split("").filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 32 && code <= 126; // Keep only printable ASCII
    }).join("");

    // Fallback: if we still have control characters, just extract letters/numbers
    if (cleaned.length === 0 || cleaned.split("").some((c) => c.charCodeAt(0) < 32)) {
      cleaned = raw.replace(/[^\w]/g, ""); // Keep only word characters
    }

    return cleaned.trim() || raw.trim();
  }

  private buildAttributesMapFromEntry(entry: SearchResultEntry): Record<string, any> {
    const attrs: Record<string, any> = {};
    for (const attr of entry.attributes) {
      attrs[attr.type] = attr.vals;
    }
    return attrs;
  }

  private applyLimits(entries: SearchResultEntry[], clientSizeLimit: number): SearchResultEntry[] {
    const effectiveLimit = Math.min(
      this.sizeLimit,
      clientSizeLimit > 0 ? clientSizeLimit : this.sizeLimit,
    );

    return entries.slice(0, effectiveLimit);
  }

  private async sendSearchResults(conn: Deno.Conn, messageID: number, entries: SearchResultEntry[]): Promise<void> {
    for (const entry of entries) {
      const message: LDAPMessage = {
        messageID,
        protocolOp: entry,
      };
      await conn.write(LDAPCodec.encode(message));
    }
  }

  private async sendSearchDone(
    conn: Deno.Conn,
    messageID: number,
    controls: any[] | undefined,
    resultCode: LDAPResultCode,
    message: string,
  ): Promise<void> {
    const response: LDAPMessage = {
      messageID,
      protocolOp: {
        type: LDAPMessageType.SearchResultDone,
        resultCode,
        matchedDN: "",
        diagnosticMessage: message,
      },
    };

    // Handle paged results control
    if (controls) {
      for (const c of controls) {
        if (c.controlType === "1.2.840.113556.1.4.319") {
          const ctrlVal = LDAPCodec.encodePagedControlValue(0, new Uint8Array());
          response.controls = [{ controlType: c.controlType, criticality: false, controlValue: ctrlVal }];
          break;
        }
      }
    }

    await conn.write(LDAPCodec.encode(response));
  }
}

export default LDAPServer;
