// LDAP Protocol Implementation
// Minimal BER/LDAP v3 subset for read-only operations (Bind, Search, Unbind, RootDSE)
import { BaseBlock, Constructed, Enumerated, fromBER, Integer, OctetString, Sequence, Set } from "asn1js";

// LDAP Message Types
export enum LDAPMessageType {
  BindRequest = 0,
  BindResponse = 1,
  UnbindRequest = 2,
  SearchRequest = 3,
  SearchResultEntry = 4,
  SearchResultDone = 5,
  SearchResultReference = 19,
}

// LDAP Result Codes
export enum LDAPResultCode {
  Success = 0,
  OperationsError = 1,
  ProtocolError = 2,
  TimeLimitExceeded = 3,
  SizeLimitExceeded = 4,
  CompareFalse = 5,
  CompareTrue = 6,
  AuthMethodNotSupported = 7,
  StrongerAuthRequired = 8,
  InvalidCredentials = 49,
  InsufficientAccessRights = 50,
  Busy = 51,
  Unavailable = 52,
  UnwillingToPerform = 53,
  LoopDetect = 54,
  NamingViolation = 64,
  ObjectClassViolation = 65,
  NotAllowedOnNonLeaf = 66,
  NotAllowedOnRdn = 67,
  EntryAlreadyExists = 68,
  ObjectClassModsProhibited = 69,
  AffectsMultipleDsas = 71,
  Other = 80,
}

// LDAP Search Scope
export enum SearchScope {
  BaseObject = 0,
  SingleLevel = 1,
  WholeSubtree = 2,
}

// Alias for compatibility
export const Scope = SearchScope;

// LDAP Search Deref Aliases
export enum DerefAliases {
  NeverDerefAliases = 0,
  DerefInSearching = 1,
  DerefFindingBaseObj = 2,
  DerefAlways = 3,
}

// LDAP Filter Types
export enum FilterType {
  And = 0,
  Or = 1,
  Not = 2,
  EqualityMatch = 3,
  Substrings = 4,
  GreaterOrEqual = 5,
  LessOrEqual = 6,
  Present = 7,
  ApproxMatch = 8,
  ExtensibleMatch = 9,
}

// Basic LDAP Message Structure
export interface LDAPMessage {
  messageID: number;
  protocolOp: LDAPProtocolOp;
  controls?: LDAPControl[];
}

export interface LDAPControl {
  controlType: string;
  criticality?: boolean;
  controlValue?: Uint8Array;
}

export type LDAPProtocolOp =
  | BindRequest
  | BindResponse
  | UnbindRequest
  | SearchRequest
  | SearchResultEntry
  | SearchResultDone;

export interface BindRequest {
  type: LDAPMessageType.BindRequest;
  version: number;
  name: string; // DN
  authentication: SimpleAuthentication | SaslAuthentication;
}

export interface SimpleAuthentication {
  type: "simple";
  password: string;
}

export interface SaslAuthentication {
  type: "sasl";
  mechanism: string;
  credentials?: Uint8Array;
}

export interface BindResponse {
  type: LDAPMessageType.BindResponse;
  resultCode: LDAPResultCode;
  matchedDN: string;
  diagnosticMessage: string;
  referral?: string[];
  serverSaslCreds?: Uint8Array;
}

export interface UnbindRequest {
  type: LDAPMessageType.UnbindRequest;
}

export interface SearchRequest {
  type: LDAPMessageType.SearchRequest;
  baseObject: string; // DN
  scope: SearchScope;
  derefAliases: DerefAliases;
  sizeLimit: number;
  timeLimit: number;
  typesOnly: boolean;
  filter: Filter;
  attributes: string[];
}

export interface SearchResultEntry {
  type: LDAPMessageType.SearchResultEntry;
  objectName: string; // DN
  attributes: PartialAttribute[];
}

export interface SearchResultDone {
  type: LDAPMessageType.SearchResultDone;
  resultCode: LDAPResultCode;
  matchedDN: string;
  diagnosticMessage: string;
  referral?: string[];
}

export interface PartialAttribute {
  type: string; // attribute name
  vals: string[]; // attribute values
}

// Filter definitions
export type Filter =
  | AndFilter
  | OrFilter
  | NotFilter
  | EqualityMatchFilter
  | SubstringsFilter
  | PresentFilter
  | GreaterOrEqualFilter
  | LessOrEqualFilter
  | ApproxMatchFilter;

export interface AndFilter {
  type: FilterType.And;
  filters: Filter[];
}

export interface OrFilter {
  type: FilterType.Or;
  filters: Filter[];
}

export interface NotFilter {
  type: FilterType.Not;
  filter: Filter;
}

export interface EqualityMatchFilter {
  type: FilterType.EqualityMatch;
  attributeDesc: string;
  assertionValue: string;
}

export interface SubstringsFilter {
  type: FilterType.Substrings;
  type_: string; // attribute name
  substrings: SubstringFilter[];
}

export interface SubstringFilter {
  initial?: string;
  any?: string[];
  final?: string;
}

export interface PresentFilter {
  type: FilterType.Present;
  attributeDesc: string;
}

export interface GreaterOrEqualFilter {
  type: FilterType.GreaterOrEqual;
  attributeDesc: string;
  assertionValue: string;
}

export interface LessOrEqualFilter {
  type: FilterType.LessOrEqual;
  attributeDesc: string;
  assertionValue: string;
}

export interface ApproxMatchFilter {
  type: FilterType.ApproxMatch;
  attributeDesc: string;
  assertionValue: string;
}

// ---------- Helpers ----------
function requireBlock<T extends BaseBlock>(block: BaseBlock | undefined, msg: string): T {
  if (!block) throw new Error(msg);
  return block as T;
}

function asConstructed(block: BaseBlock | undefined, msg: string): Constructed {
  const b = requireBlock<Constructed>(block, msg);
  if (!(b instanceof Constructed)) throw new Error(msg);
  return b;
}

function asInteger(block: BaseBlock | undefined, msg: string): Integer {
  const b = requireBlock<Integer>(block, msg);
  if (!(b instanceof Integer)) throw new Error(msg);
  return b;
}

function asOctetString(block: BaseBlock | undefined, msg: string): OctetString {
  const b = requireBlock<OctetString>(block, msg);
  if (!(b instanceof OctetString)) throw new Error(msg);
  return b;
}

function decodeString(block: BaseBlock | undefined, msg: string): string {
  const b = requireBlock<BaseBlock>(block, msg);
  const view = (b as any).valueBeforeDecodeView;
  if (view instanceof Uint8Array) {
    // If the value appears to be a full TLV (starts with OCTET STRING tag 0x04),
    // try to decode the inner value using fromBER to get the real octet string content.
    try {
      if (view.length > 0 && view[0] === 0x04) {
        const innerAb = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
        const inner = fromBER(innerAb as ArrayBuffer);
        if (inner && inner.result) {
          const innerView = (inner.result as any).valueBeforeDecodeView;
          if (innerView instanceof Uint8Array) {
            return new TextDecoder().decode(innerView);
          }
        }
      }
    } catch (_e) {
      // fall back to raw decode
    }

    return new TextDecoder().decode(view);
  }
  return "";
}

function decodeBytes(block: BaseBlock | undefined): Uint8Array | undefined {
  if (!block) return undefined;
  const view = (block as any).valueBeforeDecodeView;
  return view instanceof Uint8Array ? view : undefined;
}

// ---------- Codec ----------
export class LDAPCodec {
  static decode(data: Uint8Array): LDAPMessage {
    // Force a copy into a guaranteed ArrayBuffer
    const ab: ArrayBuffer = new Uint8Array(data).buffer;

    const result = fromBER(ab);
    if (result.offset === -1 || !result.result) {
      throw new Error("Failed to decode BER");
    }

    const root = asConstructed(result.result as BaseBlock, "LDAPMessage must be a sequence");
    const blocks = root.valueBlock.value;
    if (!Array.isArray(blocks) || blocks.length < 2) {
      throw new Error("Invalid LDAPMessage structure");
    }

    const messageIDBlock = asInteger(blocks[0], "messageID must be Integer");
    const protocolOpBlock = requireBlock<BaseBlock>(blocks[1], "Missing protocolOp");
    // Optional controls may be present as a context-specific tag [0]
    let controls: LDAPControl[] | undefined;
    if (blocks.length > 2) {
      const controlsBlock = blocks[2];
      if (controlsBlock && controlsBlock.idBlock.tagClass === 3 && controlsBlock.idBlock.tagNumber === 0) {
        // controlsBlock is CONTEXT [0] containing a SEQUENCE OF Control
        try {
          const controlsSeq = asConstructed(controlsBlock, "controls must be constructed").valueBlock.value;
          if (Array.isArray(controlsSeq)) {
            controls = [];
            for (const c of controlsSeq) {
              try {
                const ctrlSeq = asConstructed(c, "control must be sequence").valueBlock.value;
                const controlType = decodeString(ctrlSeq[0], "controlType must be OctetString");
                let criticality: boolean | undefined;
                let controlValue: Uint8Array | undefined;
                if (ctrlSeq.length >= 2) {
                  // criticality is BOOLEAN (optional) or controlValue depending on presence
                  const maybe = ctrlSeq[1];
                  // primitive boolean has tagClass UNIVERSAL and tagNumber 1
                  if (
                    maybe &&
                    ((maybe.idBlock.tagClass === 1 && maybe.idBlock.tagNumber === 1) ||
                      (maybe.idBlock.tagClass === 1 && typeof (maybe as any).valueBlock.valueBoolean !== "undefined"))
                  ) {
                    // boolean
                    criticality = !!(maybe as any).valueBlock.value;
                    if (ctrlSeq.length >= 3) {
                      controlValue = decodeBytes(ctrlSeq[2]);
                    }
                  } else if (maybe) {
                    controlValue = decodeBytes(maybe);
                  }
                }
                controls.push({ controlType, criticality, controlValue });
              } catch (_e) {
                // ignore malformed control
              }
            }
          }
        } catch (_e) {
          // ignore controls parse errors
        }
      }
    }

    const messageID = messageIDBlock.valueBlock.valueDec;

    // BindRequest: [APPLICATION/CONTEXT 0]
    // ProtocolOp may be encoded using APPLICATION or CONTEXT_SPECIFIC tag class
    const protoTagClass = protocolOpBlock.idBlock.tagClass;
    const protoTagNumber = protocolOpBlock.idBlock.tagNumber;

    // BindRequest: [APPLICATION/CONTEXT 0]
    if (protoTagNumber === 0 && (protoTagClass === 2 || protoTagClass === 3)) {
      const bindSeq = asConstructed(protocolOpBlock, "BindRequest must be constructed").valueBlock.value;
      if (!Array.isArray(bindSeq) || bindSeq.length < 3) {
        throw new Error("BindRequest must contain version, name, and authentication");
      }

      const versionBlock = asInteger(bindSeq[0], "BindRequest version must be Integer");
      const nameBlock = asOctetString(bindSeq[1], "BindRequest name must be OctetString");
      const authBlock = requireBlock<BaseBlock>(bindSeq[2], "Missing authentication block");

      const version = versionBlock.valueBlock.valueDec;
      const name = decodeString(nameBlock, "Invalid DN");

      // The authentication choice may be encoded using APPLICATION or CONTEXT tag classes
      // Log tag info to help debug unknown authentication choices
      const tagClass = authBlock.idBlock.tagClass;
      const tagNumber = authBlock.idBlock.tagNumber;
      try {
        // Helpful debug log to inspect incoming auth blocks during test failures
        // tagClass values: 1=UNIVERSAL, 2=APPLICATION, 3=CONTEXT_SPECIFIC, 4=PRIVATE
        // We'll accept both APPLICATION and CONTEXT_SPECIFIC encodings for simple/sasl
        // since some BER encodings use context-specific tags.
        // eslint-disable-next-line no-console
        console.debug(`BindRequest auth block: tagClass=${tagClass}, tagNumber=${tagNumber}`);
      } catch (_e) {
        // ignore logging errors
      }

      const isSimple = (tagClass === 2 || tagClass === 3) && tagNumber === 0;
      const isSasl = (tagClass === 2 || tagClass === 3) && tagNumber === 3;

      let authentication: SimpleAuthentication | SaslAuthentication;

      if (isSimple) {
        // Simple authentication is usually a primitive octet string containing the password
        // Try to decode as string; if that fails, fall back to raw bytes -> empty string
        let password = "";
        try {
          password = decodeString(authBlock, "Invalid simple password");
        } catch (_err) {
          const raw = decodeBytes(authBlock);
          if (raw) {
            try {
              password = new TextDecoder().decode(raw);
            } catch (_e) {
              password = "";
            }
          }
        }
        authentication = { type: "simple", password };
      } else if (isSasl) {
        const saslSeq = asConstructed(authBlock, "SASL auth must be constructed").valueBlock.value;
        if (saslSeq.length < 1) throw new Error("SASL sequence must contain mechanism");

        const mechanism = decodeString(saslSeq[0], "SASL mechanism must be OctetString");
        const credentials = decodeBytes(saslSeq[1]);

        authentication = { type: "sasl", mechanism, credentials };
      } else {
        // Unknown auth choice: attempt a best-effort decode as a simple password
        // This makes the decoder more robust to variations in BER tag classes.
        // eslint-disable-next-line no-console
        console.warn(
          `Unsupported authentication choice in BindRequest - attempting fallback (tagClass=${tagClass}, tagNumber=${tagNumber})`,
        );
        let password = "";
        try {
          password = decodeString(authBlock, "Invalid auth password fallback");
        } catch (_err) {
          const raw = decodeBytes(authBlock);
          if (raw) {
            try {
              password = new TextDecoder().decode(raw);
            } catch (_e) {
              password = "";
            }
          }
        }

        authentication = { type: "simple", password };
      }

      return {
        messageID,
        protocolOp: {
          type: LDAPMessageType.BindRequest,
          version,
          name,
          authentication,
        },
        controls,
      };
    }

    // SearchRequest: [APPLICATION 3]
    if (protoTagNumber === 3 && (protoTagClass === 2 || protoTagClass === 3)) {
      const seq = asConstructed(protocolOpBlock, "SearchRequest must be constructed").valueBlock.value;
      if (!Array.isArray(seq) || seq.length < 7) {
        throw new Error("SearchRequest must contain required fields");
      }

      const baseObjectBlock = asOctetString(seq[0], "SearchRequest baseObject must be OctetString");
      const scopeBlock = asInteger(seq[1], "SearchRequest scope must be Integer");
      const derefBlock = asInteger(seq[2], "SearchRequest derefAliases must be Integer");
      const sizeLimitBlock = asInteger(seq[3], "SearchRequest sizeLimit must be Integer");
      const timeLimitBlock = asInteger(seq[4], "SearchRequest timeLimit must be Integer");
      const typesOnlyBlock = requireBlock<BaseBlock>(seq[5], "SearchRequest typesOnly must be Boolean");
      // filter is seq[6] - complex; we'll parse minimally
      const attributesBlock = seq[7];

      const baseObject = decodeString(baseObjectBlock, "Invalid baseObject");
      const scope = scopeBlock.valueBlock.valueDec as SearchScope;
      const derefAliases = derefBlock.valueBlock.valueDec as DerefAliases;
      const sizeLimit = sizeLimitBlock.valueBlock.valueDec;
      const timeLimit = timeLimitBlock.valueBlock.valueDec;
      const typesOnly =
        (typesOnlyBlock && (typesOnlyBlock.idBlock.tagNumber === 1 || (typesOnlyBlock.idBlock.tagClass === 1)))
          // try to read boolean value
          ? ((typesOnlyBlock as any).valueBlock.value ? true : false)
          : false;

      // Parse attributes sequence (if present)
      const attrs: string[] = [];
      try {
        const attrsConstructed = asConstructed(attributesBlock, "attributes must be constructed").valueBlock.value;
        for (const a of attrsConstructed) {
          const s = decodeString(a, "attribute must be OctetString");
          if (s) attrs.push(s);
        }
      } catch (_e) {
        // ignore attribute parse errors, leave attrs empty
      }

      // Parse filter using a robust helper; on error default to (objectClass=*)
      let filter: Filter;
      try {
        const filterBlock = seq[6];
        filter = LDAPCodec.parseFilter(filterBlock);
      } catch (err) {
        // Log and fallback to broader filter
        // eslint-disable-next-line no-console
        console.warn("Failed to parse search filter, defaulting to (objectClass=*)", err);
        filter = { type: FilterType.Present, attributeDesc: "objectClass" };
      }

      // Log the parsed SearchRequest details for debugging
      // eslint-disable-next-line no-console
      console.debug("Parsed SearchRequest:", {
        baseObject,
        scope,
        derefAliases,
        sizeLimit,
        timeLimit,
        typesOnly,
        filter,
        attributes: attrs,
      });

      return {
        messageID,
        protocolOp: {
          type: LDAPMessageType.SearchRequest,
          baseObject,
          scope,
          derefAliases,
          sizeLimit,
          timeLimit,
          typesOnly,
          filter: filter as any,
          attributes: attrs,
        },
        controls,
      };
    }

    throw new Error("Unsupported LDAP message type");
  }

  // Helper to parse LDAP filter structures (supports common types used by ldapsearch)
  private static parseFilter(block: BaseBlock | undefined): Filter {
    if (!block) throw new Error("Missing filter block");

    const tagNumber = block.idBlock.tagNumber;
    // AND (0), OR (1), NOT (2) are context-specific constructed sequences
    if (tagNumber === FilterType.And) {
      const seq = asConstructed(block, "And filter must be constructed").valueBlock.value;
      const filters: Filter[] = [];
      if (Array.isArray(seq)) {
        for (const b of seq) {
          filters.push(this.parseFilter(b));
        }
      }
      return { type: FilterType.And, filters };
    }

    if (tagNumber === FilterType.Or) {
      const seq = asConstructed(block, "Or filter must be constructed").valueBlock.value;
      const filters: Filter[] = [];
      if (Array.isArray(seq)) {
        for (const b of seq) {
          filters.push(this.parseFilter(b));
        }
      }
      return { type: FilterType.Or, filters };
    }

    if (tagNumber === FilterType.Not) {
      const inner = asConstructed(block, "Not filter must be constructed").valueBlock.value;
      if (!Array.isArray(inner) || inner.length < 1) throw new Error("Invalid Not filter");
      return { type: FilterType.Not, filter: this.parseFilter(inner[0]) };
    }

    // EqualityMatch (3) -> SEQUENCE { attributeDesc, assertionValue }
    if (tagNumber === FilterType.EqualityMatch) {
      const seq = asConstructed(block, "Equality filter must be constructed").valueBlock.value;
      const attributeDesc = decodeString(seq[0], "Equality attribute must be OctetString");
      const assertionValue = decodeString(seq[1], "Equality value must be OctetString");
      return { type: FilterType.EqualityMatch, attributeDesc, assertionValue };
    }

    // Substrings (4) -> SEQUENCE { type, SEQUENCE OF CHOICE }
    if (tagNumber === FilterType.Substrings) {
      const seq = asConstructed(block, "Substrings filter must be constructed").valueBlock.value;
      const type_ = decodeString(seq[0], "Substrings type must be OctetString");
      const subsConstructed = asConstructed(seq[1], "Substrings list must be constructed").valueBlock.value;
      const substrings: SubstringFilter[] = [];
      // Each child is a context-specific (0=initial,1=any,2=final) with an octetstring
      for (const s of subsConstructed) {
        const t = s.idBlock.tagNumber;
        const val = decodeString(s, "Substring component must be OctetString");
        if (t === 0) {
          substrings.push({ initial: val });
        } else if (t === 1) {
          // any; may be multiple entries, convert to array
          const last = substrings[substrings.length - 1];
          if (last && last.any) {
            last.any.push(val);
          } else {
            substrings.push({ any: [val] });
          }
        } else if (t === 2) {
          substrings.push({ final: val });
        }
      }
      // Flatten substrings into a single SubstringsFilter representation
      const combined: SubstringsFilter = { type: FilterType.Substrings, type_: type_, substrings };
      return combined;
    }

    // Present (7) -> attributeDesc (OctetString)
    if (tagNumber === FilterType.Present) {
      const attributeDesc = decodeString(block, "Present attribute must be OctetString");
      return { type: FilterType.Present, attributeDesc };
    }

    // Fallback: attempt to decode as equality on objectClass if possible
    try {
      const guess = decodeString(block, "fallback");
      // if decoded to a non-empty string, treat as Present
      if (guess) return { type: FilterType.Present, attributeDesc: guess };
    } catch (_e) {
      // ignore
    }

    throw new Error(`Unsupported or unrecognized filter tag ${block.idBlock.tagNumber}`);
  }

  // Try to decode a message from possibly partial data. Returns null if no complete
  // message could be decoded yet. On success returns { message, consumed } where
  // consumed is the number of bytes consumed from the input buffer.
  static tryDecode(data: Uint8Array): { message: LDAPMessage; consumed: number } | null {
    const ab: ArrayBuffer = new Uint8Array(data).buffer;
    const result = fromBER(ab);
    // If fromBER failed (offset === -1) treat as incomplete data and return null
    if (result.offset === -1 || !result.result) {
      return null;
    }

    try {
      const root = asConstructed(result.result as BaseBlock, "LDAPMessage must be a sequence");
      const blocks = root.valueBlock.value;
      if (!Array.isArray(blocks) || blocks.length < 2) {
        return null;
      }

      const messageIDBlock = asInteger(blocks[0], "messageID must be Integer");
      const _protocolOpBlock = requireBlock<BaseBlock>(blocks[1], "Missing protocolOp");

      const _messageID = messageIDBlock.valueBlock.valueDec;

      // Reuse decode logic by constructing a temporary view of the consumed bytes
      const consumed = result.offset;
      const slice = new Uint8Array(ab).slice(0, consumed);
      const message = this.decode(slice);
      return { message, consumed };
    } catch (_e) {
      // If any parsing error occurs, treat as incomplete so caller can try again
      return null;
    }
  }

  static encode(message: LDAPMessage): Uint8Array {
    // Helper to create OctetString from JS string
    const strToOctet = (s: string) => {
      const enc = new TextEncoder().encode(s ?? "");
      return new OctetString({ valueHex: enc.buffer });
    };

    // Create protocolOp sequence depending on message type
    let protocolSeq: Sequence;

    switch (message.protocolOp.type) {
      case LDAPMessageType.BindResponse: {
        const op = message.protocolOp as BindResponse;
        protocolSeq = new Sequence({
          value: [
            new Enumerated({ value: op.resultCode }),
            strToOctet(op.matchedDN || ""),
            strToOctet(op.diagnosticMessage || ""),
          ],
        });
        // tag as [APPLICATION 1]
        protocolSeq.idBlock.tagClass = 2;
        protocolSeq.idBlock.tagNumber = 1;
        break;
      }

      case LDAPMessageType.SearchResultEntry: {
        const op = message.protocolOp as SearchResultEntry;
        // Build attributes sequence
        const attrs = (op.attributes || []).map((a) => {
          const vals = (a.vals || []).map((v) => new OctetString({ valueHex: new TextEncoder().encode(v).buffer }));
          return new Sequence({
            value: [
              new OctetString({ valueHex: new TextEncoder().encode(a.type || "").buffer }),
              new Set({ value: vals }),
            ],
          });
        });

        const attrsSeq = new Sequence({ value: attrs });

        protocolSeq = new Sequence({
          value: [
            new OctetString({ valueHex: new TextEncoder().encode(op.objectName || "").buffer }),
            attrsSeq,
          ],
        });
        protocolSeq.idBlock.tagClass = 2;
        protocolSeq.idBlock.tagNumber = 4;
        break;
      }

      case LDAPMessageType.SearchResultDone: {
        const op = message.protocolOp as SearchResultDone;
        protocolSeq = new Sequence({
          value: [
            new Enumerated({ value: op.resultCode }),
            strToOctet(op.matchedDN || ""),
            strToOctet(op.diagnosticMessage || ""),
          ],
        });
        protocolSeq.idBlock.tagClass = 2;
        protocolSeq.idBlock.tagNumber = 5;
        break;
      }

      default:
        throw new Error("Cannot encode unsupported protocolOp type");
    }

    const seqValue: BaseBlock[] = [new Integer({ value: message.messageID }), protocolSeq];
    // Append controls if present on the message
    if (message.controls && message.controls.length > 0) {
      const ctrlBlocks: BaseBlock[] = [];
      for (const c of message.controls) {
        const ctrlValue: BaseBlock[] = [];
        // controlType
        ctrlValue.push(new OctetString({ valueHex: new TextEncoder().encode(c.controlType).buffer }));
        // criticality
        if (typeof c.criticality !== "undefined") {
          // ASN.1 BOOLEAN
          const b = new Integer({ value: c.criticality ? 1 : 0 });
          // integer used for boolean here due to asn1js helper limitations; should be BOOLEAN
          ctrlValue.push(b);
        }
        // controlValue
        if (c.controlValue) {
          const buf = c.controlValue instanceof Uint8Array ? c.controlValue : new Uint8Array(c.controlValue);
          ctrlValue.push(new OctetString({ valueHex: buf.buffer as ArrayBuffer }));
        }
        const ctrlSeq = new Sequence({ value: ctrlValue });
        ctrlBlocks.push(ctrlSeq);
      }

      const controlsSeq = new Sequence({ value: ctrlBlocks });
      // tag as [0] CONTEXT-SPECIFIC constructed
      controlsSeq.idBlock.tagClass = 3;
      controlsSeq.idBlock.tagNumber = 0;
      seqValue.push(controlsSeq as unknown as BaseBlock);
    }

    const messageSeq = new Sequence({ value: seqValue });
    const ber = messageSeq.toBER(false);
    return new Uint8Array(ber);
  }

  // Build the BER-encoded controlValue for the Simple Paged Results control
  // returns Uint8Array of the inner SEQUENCE { size INTEGER, cookie OCTET STRING }
  static encodePagedControlValue(size: number, cookie?: Uint8Array): Uint8Array {
    const sizeInt = new Integer({ value: size });
    const cookieOct = new OctetString({ valueHex: (cookie || new Uint8Array()).buffer as ArrayBuffer });
    const seq = new Sequence({ value: [sizeInt, cookieOct] });
    const ber = seq.toBER(false);
    return new Uint8Array(ber);
  }
}

// LDAP Constants
export const LDAP_VERSION = 3;
export const LDAP_PORT = 389;
export const LDAPS_PORT = 636;
