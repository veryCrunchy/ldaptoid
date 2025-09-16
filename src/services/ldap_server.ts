// LDAP Server Implementation
// TCP server handling LDAP protocol requests with read-only operations

import {
  BindRequest,
  BindResponse,
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
import { Snapshot } from "../models/mod.ts";

export interface LDAPServerOptions {
  port?: number;
  bindDN?: string;
  bindPassword?: string;
  baseDN: string;
  sizeLimit?: number;
}

export class LDAPServer {
  private readonly port: number;
  private readonly bindDN?: string;
  private readonly bindPassword?: string;
  private readonly baseDN: string;
  private readonly sizeLimit: number;
  private server?: Deno.TcpListener;
  private currentSnapshot?: Snapshot;

  constructor(options: LDAPServerOptions) {
    this.port = options.port ?? LDAP_PORT;
    this.bindDN = options.bindDN;
    this.bindPassword = options.bindPassword;
    this.baseDN = options.baseDN;
    this.sizeLimit = options.sizeLimit ?? 1000;
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
    const buffer = new Uint8Array(4096);
    let authenticated = false;

    try {
      while (true) {
        const bytesRead = await conn.read(buffer);
        if (bytesRead === null) break;

        const requestData = buffer.slice(0, bytesRead);
        const message = LDAPCodec.decode(requestData);

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
              await this.handleSearch(conn, message.messageID, message.protocolOp as SearchRequest);
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
    } finally {
      conn.close();
    }
  }

  private handleBind(request: BindRequest): BindResponse {
    // Anonymous bind allowed if no bind credentials configured
    if (!this.bindDN && !this.bindPassword) {
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

  private async handleSearch(conn: Deno.Conn, messageID: number, request: SearchRequest): Promise<void> {
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

    // Placeholder search implementation - real implementation would:
    // 1. Parse and evaluate the filter against snapshot entries
    // 2. Apply size/time limits
    // 3. Generate appropriate LDAP entries with requested attributes

    const entries: SearchResultEntry[] = [];
    let entryCount = 0;

    // Example: Return RootDSE for empty base search
    if (request.baseObject === "" && request.scope === 0) {
      entries.push({
        type: LDAPMessageType.SearchResultEntry,
        objectName: "",
        attributes: [
          { type: "objectClass", vals: ["top", "rootDSE"] },
          { type: "namingContexts", vals: [this.baseDN] },
          { type: "supportedLDAPVersion", vals: ["3"] },
          { type: "supportedExtension", vals: [] },
        ],
      });
    }

    // Send each entry
    for (const entry of entries) {
      if (entryCount >= this.sizeLimit) {
        break;
      }

      const entryMessage: LDAPMessage = {
        messageID,
        protocolOp: entry,
      };
      await conn.write(LDAPCodec.encode(entryMessage));
      entryCount++;
    }

    // Send search done
    const doneResponse: LDAPMessage = {
      messageID,
      protocolOp: {
        type: LDAPMessageType.SearchResultDone,
        resultCode: entryCount >= this.sizeLimit ? LDAPResultCode.SizeLimitExceeded : LDAPResultCode.Success,
        matchedDN: "",
        diagnosticMessage: entryCount >= this.sizeLimit ? "Size limit exceeded" : "Search completed",
      },
    };
    await conn.write(LDAPCodec.encode(doneResponse));
  }
}

export default LDAPServer;
