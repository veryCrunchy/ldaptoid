export type FeatureFlag =
  | "synthetic_primary_group"
  | "mirror_nested_groups";

export interface FeatureFlagState {
  name: FeatureFlag;
  enabled: boolean;
  description: string;
}

export function parseFeatureFlags(envValue: string | undefined): FeatureFlag[] {
  if (!envValue) return [];
  const allowed: FeatureFlag[] = ["synthetic_primary_group", "mirror_nested_groups"];
  const set = new Set(
    envValue.split(",")
      .map((v) => v.trim())
      .filter((v) => allowed.includes(v as FeatureFlag)),
  );
  return [...set] as FeatureFlag[];
}
