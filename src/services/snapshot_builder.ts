// Snapshot builder service
// Constructs snapshots from adaptors with UID/GID allocation and group membership resolution

import { Adaptor, RawGroup } from "../adaptors/types.ts";
import { IdAllocator } from "./id_allocator.ts";
import { Snapshot, User, Group } from "../models/mod.ts";
import { FeatureFlag } from "../models/feature_flags.ts";

export interface SnapshotBuilderOptions {
  uidAllocator: IdAllocator;
  gidAllocator: IdAllocator;
  enabledFeatures: FeatureFlag[];
  maxGroupMembers?: number; // Default 5000 per research.md
}

export class SnapshotBuilder {
  private readonly uidAllocator: IdAllocator;
  private readonly gidAllocator: IdAllocator;
  private readonly enabledFeatures: Set<FeatureFlag>;
  private readonly maxGroupMembers: number;
  private sequenceCounter = 0;

  constructor(options: SnapshotBuilderOptions) {
    this.uidAllocator = options.uidAllocator;
    this.gidAllocator = options.gidAllocator;
    this.enabledFeatures = new Set(options.enabledFeatures);
    this.maxGroupMembers = options.maxGroupMembers ?? 5000;
  }

  async buildSnapshot(adaptor: Adaptor): Promise<Snapshot> {
    // Fetch raw data from adaptor
    const [rawUsers, rawGroups] = await Promise.all([
      adaptor.fetchUsers(),
      adaptor.fetchGroups()
    ]);

    // Convert adaptor users to domain users with POSIX attributes
    const users: User[] = rawUsers
      .filter(u => u.enabled) // Filter inactive users per research.md
      .map(user => ({
        id: user.id,
        username: user.username,
        displayName: user.displayName || user.username, // Fallback to username
        email: user.email,
        active: user.enabled,
        posixUid: this.uidAllocator.allocate(`user:${user.id}`).id,
        primaryGroupId: this.getSyntheticPrimaryGroupId(user.id),
        memberGroupIds: [], // Will be populated during group processing
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }));

    // Process groups
    const groups = this.processGroups(rawGroups, users);

    // Add synthetic primary groups if feature enabled
    if (this.enabledFeatures.has('synthetic_primary_group')) {
      const syntheticGroups = this.createSyntheticPrimaryGroups(users);
      groups.push(...syntheticGroups);
    }

    return {
      users,
      groups,
      generatedAt: new Date().toISOString(),
      sequence: ++this.sequenceCounter,
      featureFlags: [...this.enabledFeatures]
    };
  }

  private getSyntheticPrimaryGroupId(userId: string): string {
    if (this.enabledFeatures.has('synthetic_primary_group')) {
      return `synthetic:${userId}`;
    }
    // Default fallback group
    return 'users';
  }

  private processGroups(rawGroups: RawGroup[], users: User[]): Group[] {
    const userIdMap = new Map(users.map(u => [u.id, u]));
    
    return rawGroups.map(group => {
      const gid = this.gidAllocator.allocate(`group:${group.id}`).id;
      
      // Resolve member user IDs (adaptor groups use different schema)
      const memberUserIds = group.members || [];
      const truncated = memberUserIds.length > this.maxGroupMembers;
      const finalMemberIds = truncated ? memberUserIds.slice(0, this.maxGroupMembers) : memberUserIds;

      // Update user memberGroupIds
      finalMemberIds.forEach(userId => {
        const user = userIdMap.get(userId);
        if (user) {
          user.memberGroupIds.push(group.id);
        }
      });

      return {
        id: group.id,
        name: group.name,
        description: group.description,
        memberUserIds: finalMemberIds,
        memberGroupIds: [], // No nested groups in Phase 1
        posixGid: gid,
        isSynthetic: false,
        truncated
      };
    });
  }

  private createSyntheticPrimaryGroups(users: User[]): Group[] {
    return users.map(user => ({
      id: `synthetic:${user.id}`,
      name: `${user.username}-primary`,
      description: `Primary group for ${user.username}`,
      memberUserIds: [user.id],
      memberGroupIds: [],
      posixGid: this.gidAllocator.allocate(`synthetic:${user.id}`).id,
      isSynthetic: true,
      truncated: false
    }));
  }
}

export default SnapshotBuilder;