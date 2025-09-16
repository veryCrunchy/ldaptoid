// Feature flag service
// Provides runtime feature flag state management and introspection

import { FeatureFlag, parseFeatureFlags } from "../models/feature_flags.ts";

export interface FeatureFlagService {
  isEnabled(flag: FeatureFlag): boolean;
  listFlags(): Array<{ name: FeatureFlag; enabled: boolean; description: string }>;
  getEnabledFlags(): FeatureFlag[];
}

export class DefaultFeatureFlagService implements FeatureFlagService {
  private readonly enabledFlags: Set<FeatureFlag>;

  constructor(envValue?: string) {
    const flags = parseFeatureFlags(envValue);
    this.enabledFlags = new Set(flags);
  }

  isEnabled(flag: FeatureFlag): boolean {
    return this.enabledFlags.has(flag);
  }

  listFlags(): Array<{ name: FeatureFlag; enabled: boolean; description: string }> {
    const descriptions: Record<FeatureFlag, string> = {
      'synthetic_primary_group': 'Create synthetic primary groups for each user',
      'mirror_nested_groups': 'Mirror nested group relationships in LDAP structure'
    };

    const allFlags: FeatureFlag[] = ['synthetic_primary_group', 'mirror_nested_groups'];
    
    return allFlags.map(flag => ({
      name: flag,
      enabled: this.enabledFlags.has(flag),
      description: descriptions[flag]
    }));
  }

  getEnabledFlags(): FeatureFlag[] {
    return [...this.enabledFlags];
  }

  /** Get feature flag states for metrics export */
  getMetricsLabels(): Array<{ flag: string; enabled: string }> {
    return this.listFlags().map(f => ({
      flag: f.name,
      enabled: f.enabled.toString()
    }));
  }
}

export default DefaultFeatureFlagService;