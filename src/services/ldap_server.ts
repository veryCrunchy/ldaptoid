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
    if (!this.currentSnapshot) {
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

    // Detailed debug logging for incoming search
    // eslint-disable-next-line no-console
    console.debug(
      "HandleSearch: baseObject=",
      request.baseObject,
      "scope=",
      request.scope,
      "sizeLimit=",
      request.sizeLimit,
      "typesOnly=",
      request.typesOnly,
      "attributes=",
      request.attributes,
      "filter=",
      request.filter,
    );

    // Helper to normalize decoded strings that may contain leading TLV bytes (e.g. 0x04 length-prefixed)
    const normalizeString = (raw: string | undefined): string => {
      if (!raw) return "";
      // Find first printable ascii char (letter/number) and return from there
      const m = raw.match(/[A-Za-z0-9]/);
      if (m && m.index !== undefined) {
        return raw.slice(m.index).trim();
      }
      return raw.trim();
    };

    // Normalize attributes list in the request (in-place copy)
    const reqAttrs = (request.attributes || []).map((a) => normalizeString(a));

    // Normalize filter in place so matching logic works regardless of codec oddities
    const normalizeFilterInPlace = (f: any) => {
      if (!f) return;
      switch (f.type) {
        case 0: // And
        case 1: // Or
          if (Array.isArray(f.filters)) f.filters.forEach((sf: any) => normalizeFilterInPlace(sf));
          break;
        case 2: // Not
          if (f.filter) normalizeFilterInPlace(f.filter);
          break;
        case 3: // EqualityMatch
          f.attributeDesc = normalizeString(f.attributeDesc);
          f.assertionValue = normalizeString(f.assertionValue);
          break;
        case 4: // Substrings
          f.type_ = normalizeString(f.type_);
          if (Array.isArray(f.substrings)) {
            for (const s of f.substrings) {
              if (s.initial) s.initial = normalizeString(s.initial);
              if (s.final) s.final = normalizeString(s.final);
              if (Array.isArray(s.any)) s.any = s.any.map((x: string) => normalizeString(x));
            }
          }
          break;
        case 7: // Present
          f.attributeDesc = normalizeString(f.attributeDesc);
          break;
        default:
          break;
      }
    };

    normalizeFilterInPlace(request.filter as any);
    // eslint-disable-next-line no-console
    console.debug("Normalized SearchRequest:", {
      baseObject: request.baseObject,
      filter: request.filter,
      attributes: reqAttrs,
    });

    // Simple search implementation: evaluate filter against snapshot users
    const entries: SearchResultEntry[] = [];
    let entryCount = 0;

    // Helper: determine if baseObject is within this server's baseDN
    const baseMatches = (bn: string) => {
      if (!bn || bn === "") return true;
      // simple suffix check
      return bn.toLowerCase().endsWith(this.baseDN.toLowerCase());
    };

    if (!baseMatches(request.baseObject)) {
      // No entries if search is outside configured baseDN
      // eslint-disable-next-line no-console
      console.debug(`Search baseObject ${request.baseObject} is outside server baseDN ${this.baseDN}`);
    } else {
      // Evaluate each user against the filter and map attributes to LDAP spec
      const users = this.currentSnapshot.users || [];
      const groups = this.currentSnapshot.groups || [];
      // eslint-disable-next-line no-console
      console.debug(`Searching snapshot with ${users.length} users and ${groups.length} groups`);

      // DN bases
      const userDNBase = `ou=users,${this.baseDN}`;
      const groupDNBase = `ou=groups,${this.baseDN}`;

      // Helper to retrieve group object by id
      const findGroupById = (id?: string) => groups.find((g) => g.id === id);

      // Helper to build a map of user attributes for matching
      const buildUserAttrs = (user: User) => {
        const primaryGroup = findGroupById(user.primaryGroupId);
        const gidNumber = primaryGroup ? String(primaryGroup.posixGid) : "0";
        // split displayName into givenName/sn (best-effort)
        const parts = (user.displayName || "").trim().split(/\s+/);
        const givenName = parts.length > 0 ? parts[0] : "";
        const sn = parts.length > 1 ? parts.slice(1).join(" ") : givenName;
        const dn = `uid=${user.username},${userDNBase}`;

        const memberOfDNs = (user.memberGroupIds || [])
          .map((gid) => findGroupById(gid))
          .filter(Boolean)
          .map((g: any) => `cn=${g.name},${groupDNBase}`);

        return {
          dn,
          objectClass: ["top", "person", "organizationalPerson", "inetOrgPerson", "posixAccount"],
          uid: user.username,
          cn: user.displayName,
          sn,
          givenName,
          mail: user.email || "",
          uidNumber: String(user.posixUid),
          gidNumber,
          homeDirectory: `/home/${user.username}`,
          loginShell: "/bin/bash",
          memberOf: memberOfDNs,
        } as Record<string, string | string[]>;
      };

      const getAttrValues = (attrs: Record<string, any>, name: string): string[] => {
        const v = attrs[name];
        if (v === undefined || v === null) return [];
        return Array.isArray(v) ? v.map(String) : [String(v)];
      };

      const matchesFilter = (f: Filter, user: User): boolean => {
        const attrs = buildUserAttrs(user);
        const evalEquality = (attr: string, val: string) => {
          const vs = getAttrValues(attrs, attr);
          return vs.some((x) => x === val || x.toLowerCase() === val.toLowerCase());
        };
        const evalPresent = (attr: string) => {
          const vs = getAttrValues(attrs, attr);
          return vs.length > 0 && vs.some((x) => x !== "");
        };
        const evalSubstring = (attr: string, subs: any[]) => {
          const vs = getAttrValues(attrs, attr).join(" ");
          for (const part of subs) {
            if (part.initial && !vs.startsWith(part.initial)) return false;
            if (part.final && !vs.endsWith(part.final)) return false;
            if (part.any) {
              for (const a of part.any) {
                if (!vs.includes(a)) return false;
              }
            }
          }
          return true;
        };

        switch (f.type) {
          case FilterType.Present:
            return evalPresent((f as any).attributeDesc || "");
          case FilterType.EqualityMatch:
            return evalEquality((f as any).attributeDesc || "", (f as any).assertionValue || "");
          case FilterType.Substrings:
            return evalSubstring((f as any).type_ || "", (f as any).substrings || []);
          case FilterType.And:
            return (f as any).filters.every((sub: Filter) => matchesFilter(sub, user));
          case FilterType.Or:
            return (f as any).filters.some((sub: Filter) => matchesFilter(sub, user));
          case FilterType.Not:
            return !matchesFilter((f as any).filter, user);
          default:
            return false;
        }
      };

      for (const user of users) {
        // request.sizeLimit == 0 means 'no limit' from the client side
        const clientLimit = request.sizeLimit && request.sizeLimit > 0 ? request.sizeLimit : Infinity;
        if (entryCount >= this.sizeLimit || entryCount >= clientLimit) break;
        try {
          if (matchesFilter(request.filter, user)) {
            const uattrs = buildUserAttrs(user);
            const attrsToReturn: any[] = [];
            const want = reqAttrs.filter((a) => !!a).map((a) => a.toLowerCase());
            const include = (name: string) => (want.length === 0 || want.includes(name.toLowerCase()));

            // Standard LDAP attributes mapping
            if (include("objectclass")) {
              attrsToReturn.push({ type: "objectClass", vals: (uattrs.objectClass as string[]) });
            }
            if (include("uid")) attrsToReturn.push({ type: "uid", vals: [uattrs.uid] });
            if (include("cn")) attrsToReturn.push({ type: "cn", vals: [uattrs.cn] });
            if (include("sn")) attrsToReturn.push({ type: "sn", vals: [uattrs.sn] });
            if (include("givenname")) attrsToReturn.push({ type: "givenName", vals: [uattrs.givenName] });
            if (include("mail") && uattrs.mail) attrsToReturn.push({ type: "mail", vals: [uattrs.mail] });
            if (include("uidnumber")) attrsToReturn.push({ type: "uidNumber", vals: [uattrs.uidNumber] });
            if (include("gidnumber")) attrsToReturn.push({ type: "gidNumber", vals: [uattrs.gidNumber] });
            if (include("homedirectory")) attrsToReturn.push({ type: "homeDirectory", vals: [uattrs.homeDirectory] });
            if (include("loginshell")) attrsToReturn.push({ type: "loginShell", vals: [uattrs.loginShell] });
            if (include("memberof")) attrsToReturn.push({ type: "memberOf", vals: (uattrs.memberOf as string[]) });

            entries.push({
              type: LDAPMessageType.SearchResultEntry,
              objectName: String(uattrs.dn),
              attributes: attrsToReturn,
            });
            entryCount++;
          }
        } catch (e) {
          // log and continue
          // eslint-disable-next-line no-console
          console.warn("Error evaluating filter for user", user.username, e);
        }
      }
    }

    // Send each entry
    for (const entry of entries) {
      const entryMessage: LDAPMessage = {
        messageID,
        protocolOp: entry,
      };
      await conn.write(LDAPCodec.encode(entryMessage));
    }

    // Send search done
    const doneResponse: LDAPMessage = {
      messageID,
      protocolOp: {
        type: LDAPMessageType.SearchResultDone,
        resultCode: entries.length >= this.sizeLimit ? LDAPResultCode.SizeLimitExceeded : LDAPResultCode.Success,
        matchedDN: "",
        diagnosticMessage: entries.length >= this.sizeLimit ? "Size limit exceeded" : "Search completed",
      },
    };

    // If client requested paged results control, echo it back with empty cookie to indicate no more pages
    if (controls && controls.length > 0) {
      for (const c of controls) {
        if (c.controlType === "1.2.840.113556.1.4.319") {
          const ctrlVal = LDAPCodec.encodePagedControlValue(0, new Uint8Array());
          doneResponse.controls = [{ controlType: c.controlType, criticality: false, controlValue: ctrlVal }];
          break;
        }
      }
    }
    await conn.write(LDAPCodec.encode(doneResponse));
  }
}

export default LDAPServer;
