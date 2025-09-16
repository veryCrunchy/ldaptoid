// LDAP Search Executor Service
// Evaluates LDAP filters against snapshot data and generates search results

import {
  SearchRequest,
  SearchResultEntry,
  Filter,
  FilterType,
  LDAPMessageType,
  AndFilter,
  OrFilter,
  NotFilter,
  EqualityMatchFilter,
  SubstringsFilter,
  PresentFilter,
  SubstringFilter as _SubstringFilter,
  SearchScope as Scope,
} from "../protocol/ldap.ts";
import { Snapshot, User, Group } from "../models/mod.ts";

export interface SearchOptions {
  sizeLimit?: number;
  timeLimit?: number; // seconds
}

export interface SearchResult {
  entries: SearchResultEntry[];
  sizeLimitExceeded: boolean;
  timeLimitExceeded: boolean;
  entriesReturned: number;
}

export class SearchExecutor {
  constructor(private snapshot: Snapshot) {}

  updateSnapshot(snapshot: Snapshot): void {
    this.snapshot = snapshot;
  }

  executeSearch(request: SearchRequest, options: SearchOptions = {}): SearchResult {
    const startTime = Date.now();
    const sizeLimit = options.sizeLimit ?? 1000;
    const timeLimit = (options.timeLimit ?? 30) * 1000; // convert to ms

    const entries: SearchResultEntry[] = [];
    let sizeLimitExceeded = false;
    let timeLimitExceeded = false;

    // Handle RootDSE request (empty base with base scope)
    if (request.baseObject === "" && request.scope === Scope.BaseObject) {
      const rootDSE = this.createRootDSE(request.attributes);
      if (this.evaluateFilter(request.filter, null, "rootDSE")) {
        entries.push(rootDSE);
      }
      return {
        entries,
        sizeLimitExceeded: false,
        timeLimitExceeded: false,
        entriesReturned: entries.length,
      };
    }

    // Get candidate entries based on scope
    const candidates = this.getCandidateEntries(request.baseObject, request.scope);

    for (const candidate of candidates) {
      // Check time limit
      if (Date.now() - startTime > timeLimit) {
        timeLimitExceeded = true;
        break;
      }

      // Check size limit
      if (entries.length >= sizeLimit) {
        sizeLimitExceeded = true;
        break;
      }

      // Evaluate filter
      if (this.evaluateFilter(request.filter, candidate.entity, candidate.type)) {
        const entry = this.createSearchResultEntry(candidate, request.attributes);
        entries.push(entry);
      }
    }

    return {
      entries,
      sizeLimitExceeded,
      timeLimitExceeded,
      entriesReturned: entries.length,
    };
  }

  private getCandidateEntries(
    baseObject: string,
    scope: Scope
  ): Array<{ entity: User | Group | null; dn: string; type: "user" | "group" | "rootDSE" }> {
    const candidates: Array<{
      entity: User | Group | null;
      dn: string;
      type: "user" | "group" | "rootDSE";
    }> = [];

    // Parse base DN to understand what we're searching in
    const baseDN = baseObject.toLowerCase();

    switch (scope) {
      case Scope.BaseObject: {
        // Only return the base object itself
        const baseEntity = this.findEntityByDN(baseObject);
        if (baseEntity) {
          candidates.push(baseEntity);
        }
        break;
      }
      case Scope.SingleLevel:
        // Return immediate children of base object
        if (baseDN.includes("ou=users") || baseDN.includes("ou=people")) {
          // Users under this OU
          for (const user of this.snapshot.users) {
            candidates.push({
              entity: user,
              dn: `uid=${user.username},${baseObject}`,
              type: "user",
            });
          }
        } else if (baseDN.includes("ou=groups")) {
          // Groups under this OU
          for (const group of this.snapshot.groups) {
            candidates.push({
              entity: group,
              dn: `cn=${group.name},${baseObject}`,
              type: "group",
            });
          }
        }
        break;

      case Scope.WholeSubtree:
        // Return everything under base object
        // Add all users
        for (const user of this.snapshot.users) {
          candidates.push({
            entity: user,
            dn: `uid=${user.username},ou=users,${baseObject}`,
            type: "user",
          });
        }

        // Add all groups
        for (const group of this.snapshot.groups) {
          candidates.push({
            entity: group,
            dn: `cn=${group.name},ou=groups,${baseObject}`,
            type: "group",
          });
        }
        break;
    }

    return candidates;
  }

  private findEntityByDN(
    dn: string
  ): { entity: User | Group | null; dn: string; type: "user" | "group" | "rootDSE" } | null {
    const lowerDN = dn.toLowerCase();

    // Check if it's a user DN
    const uidMatch = lowerDN.match(/uid=([^,]+)/);
    if (uidMatch) {
      const uid = uidMatch[1];
      const user = this.snapshot.users.find((u) => u.username === uid);
      if (user) {
        return { entity: user, dn, type: "user" };
      }
    }

    // Check if it's a group DN
    const cnMatch = lowerDN.match(/cn=([^,]+)/);
    if (cnMatch) {
      const cn = cnMatch[1];
      const group = this.snapshot.groups.find((g) => g.name === cn);
      if (group) {
        return { entity: group, dn, type: "group" };
      }
    }

    return null;
  }

  private evaluateFilter(
    filter: Filter,
    entity: User | Group | null,
    entityType: "user" | "group" | "rootDSE"
  ): boolean {
    switch (filter.type) {
      case FilterType.And:
        return (filter as AndFilter).filters.every((f) =>
          this.evaluateFilter(f, entity, entityType)
        );

      case FilterType.Or:
        return (filter as OrFilter).filters.some((f) => this.evaluateFilter(f, entity, entityType));

      case FilterType.Not:
        return !this.evaluateFilter((filter as NotFilter).filter, entity, entityType);

      case FilterType.EqualityMatch: {
        const eqFilter = filter as EqualityMatchFilter;
        return this.evaluateEqualityFilter(
          eqFilter.attributeDesc,
          eqFilter.assertionValue,
          entity,
          entityType
        );
      }

      case FilterType.Substrings: {
        const subFilter = filter as SubstringsFilter;
        // Convert SubstringFilter[] to the expected format
        const substrings = {
          initial: subFilter.substrings.find((s) => s.initial)?.initial,
          any: subFilter.substrings.filter((s) => s.any).flatMap((s) => s.any || []),
          final: subFilter.substrings.find((s) => s.final)?.final,
        };
        return this.evaluateSubstringsFilter(subFilter.type_, substrings, entity, entityType);
      }
      case FilterType.Present: {
        const presFilter = filter as PresentFilter;
        return this.evaluatePresentFilter(presFilter.attributeDesc, entity, entityType);
      }

      case FilterType.GreaterOrEqual:
      case FilterType.LessOrEqual:
      case FilterType.ApproxMatch:
        // Not implemented for this minimal LDAP server
        return false;

      default:
        return false;
    }
  }

  private evaluateEqualityFilter(
    attribute: string,
    value: string,
    entity: User | Group | null,
    entityType: "user" | "group" | "rootDSE"
  ): boolean {
    const attrLower = attribute.toLowerCase();
    const valueLower = value.toLowerCase();

    // Handle RootDSE attributes
    if (entityType === "rootDSE") {
      switch (attrLower) {
        case "objectclass":
          return valueLower === "top" || valueLower === "rootdse";
        default:
          return false;
      }
    }

    if (!entity) return false;

    // Common attributes
    switch (attrLower) {
      case "objectclass":
        if (entityType === "user") {
          return [
            "top",
            "person",
            "organizationalperson",
            "inetorgperson",
            "posixaccount",
          ].includes(valueLower);
        } else if (entityType === "group") {
          return ["top", "groupofnames", "posixgroup"].includes(valueLower);
        }
        return false;

      case "uid":
        return entityType === "user" && (entity as User).username.toLowerCase() === valueLower;

      case "cn":
        if (entityType === "user") {
          return (entity as User).displayName.toLowerCase() === valueLower;
        } else if (entityType === "group") {
          return (entity as Group).name.toLowerCase() === valueLower;
        }
        return false;

      case "displayname":
        return entityType === "user" && (entity as User).displayName?.toLowerCase() === valueLower;

      case "mail":
        return entityType === "user" && (entity as User).email?.toLowerCase() === valueLower;

      case "memberuid":
        return (
          entityType === "group" &&
          (entity as Group).memberUserIds.some((uid: string) => uid.toLowerCase() === valueLower)
        );

      default:
        return false;
    }
  }

  private evaluateSubstringsFilter(
    attribute: string,
    substrings: { initial?: string; any?: string[]; final?: string },
    entity: User | Group | null,
    entityType: "user" | "group" | "rootDSE"
  ): boolean {
    if (entityType === "rootDSE" || !entity) return false;

    const attrValue = this.getAttributeValue(attribute, entity, entityType);
    if (!attrValue) return false;

    const value = attrValue.toLowerCase();

    // Check initial substring
    if (substrings.initial && !value.startsWith(substrings.initial.toLowerCase())) {
      return false;
    }

    // Check final substring
    if (substrings.final && !value.endsWith(substrings.final.toLowerCase())) {
      return false;
    }

    // Check any substrings
    if (substrings.any) {
      for (const any of substrings.any) {
        if (!value.includes(any.toLowerCase())) {
          return false;
        }
      }
    }

    return true;
  }

  private evaluatePresentFilter(
    attribute: string,
    entity: User | Group | null,
    entityType: "user" | "group" | "rootDSE"
  ): boolean {
    if (entityType === "rootDSE") {
      return ["objectclass", "namingcontexts", "supportedldapversion"].includes(
        attribute.toLowerCase()
      );
    }

    if (!entity) return false;

    const value = this.getAttributeValue(attribute, entity, entityType);
    return value !== null && value !== undefined;
  }

  private getAttributeValue(
    attribute: string,
    entity: User | Group,
    entityType: "user" | "group"
  ): string | null {
    const attrLower = attribute.toLowerCase();

    if (entityType === "user") {
      const user = entity as User;
      switch (attrLower) {
        case "uid":
          return user.username;
        case "cn":
          return user.displayName;
        case "displayname":
          return user.displayName || null;
        case "mail":
          return user.email || null;
        case "givenname":
          return null; // Not available in our User model
        case "sn":
          return null; // Not available in our User model
        case "uidnumber":
          return user.posixUid.toString();
        case "gidnumber":
          return user.posixUid.toString(); // Use posixUid for primary group
        case "homedirectory":
          return null; // Not available in our User model
        case "loginshell":
          return null; // Not available in our User model
        default:
          return null;
      }
    } else if (entityType === "group") {
      const group = entity as Group;
      switch (attrLower) {
        case "cn":
          return group.name;
        case "gidnumber":
          return group.posixGid.toString();
        case "description":
          return group.description || null;
        default:
          return null;
      }
    }

    return null;
  }

  private createRootDSE(requestedAttributes: string[]): SearchResultEntry {
    const attributes = [];

    const allAttrs = requestedAttributes.length === 0 || requestedAttributes.includes("*");

    if (allAttrs || requestedAttributes.includes("objectClass")) {
      attributes.push({ type: "objectClass", vals: ["top", "rootDSE"] });
    }

    if (allAttrs || requestedAttributes.includes("namingContexts")) {
      attributes.push({ type: "namingContexts", vals: ["dc=example,dc=com"] });
    }

    if (allAttrs || requestedAttributes.includes("supportedLDAPVersion")) {
      attributes.push({ type: "supportedLDAPVersion", vals: ["3"] });
    }

    return {
      type: LDAPMessageType.SearchResultEntry,
      objectName: "",
      attributes,
    };
  }

  private createSearchResultEntry(
    candidate: { entity: User | Group | null; dn: string; type: "user" | "group" | "rootDSE" },
    requestedAttributes: string[]
  ): SearchResultEntry {
    const attributes = [];
    const allAttrs = requestedAttributes.length === 0 || requestedAttributes.includes("*");
    const entity = candidate.entity;

    if (!entity) {
      return {
        type: LDAPMessageType.SearchResultEntry,
        objectName: candidate.dn,
        attributes: [],
      };
    }

    if (candidate.type === "user") {
      const user = entity as User;

      if (allAttrs || requestedAttributes.includes("objectClass")) {
        attributes.push({
          type: "objectClass",
          vals: ["top", "person", "organizationalPerson", "inetOrgPerson", "posixAccount"],
        });
      }

      if (allAttrs || requestedAttributes.includes("uid")) {
        attributes.push({ type: "uid", vals: [user.username] });
      }

      if (allAttrs || requestedAttributes.includes("cn")) {
        attributes.push({ type: "cn", vals: [user.displayName] });
      }

      if ((allAttrs || requestedAttributes.includes("displayName")) && user.displayName) {
        attributes.push({ type: "displayName", vals: [user.displayName] });
      }

      if ((allAttrs || requestedAttributes.includes("mail")) && user.email) {
        attributes.push({ type: "mail", vals: [user.email] });
      }

      // Skip givenName and sn as they're not in our User model

      if (allAttrs || requestedAttributes.includes("uidNumber")) {
        attributes.push({ type: "uidNumber", vals: [user.posixUid.toString()] });
      }

      if (allAttrs || requestedAttributes.includes("gidNumber")) {
        attributes.push({ type: "gidNumber", vals: [user.posixUid.toString()] }); // Use posixUid as primary GID
      }

      // Skip homeDirectory and loginShell as they're not in our User model
    } else if (candidate.type === "group") {
      const group = entity as Group;

      if (allAttrs || requestedAttributes.includes("objectClass")) {
        attributes.push({
          type: "objectClass",
          vals: ["top", "groupOfNames", "posixGroup"],
        });
      }

      if (allAttrs || requestedAttributes.includes("cn")) {
        attributes.push({ type: "cn", vals: [group.name] });
      }

      if (allAttrs || requestedAttributes.includes("gidNumber")) {
        attributes.push({ type: "gidNumber", vals: [group.posixGid.toString()] });
      }

      if ((allAttrs || requestedAttributes.includes("description")) && group.description) {
        attributes.push({ type: "description", vals: [group.description] });
      }

      if (allAttrs || requestedAttributes.includes("memberUid")) {
        attributes.push({ type: "memberUid", vals: group.memberUserIds });
      }
    }

    return {
      type: LDAPMessageType.SearchResultEntry,
      objectName: candidate.dn,
      attributes,
    };
  }
}

export default SearchExecutor;
