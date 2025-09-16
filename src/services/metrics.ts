// Prometheus Metrics Service
// Exposes operational metrics in Prometheus format for monitoring

export interface MetricsSnapshot {
  // Snapshot metrics
  snapshotRefreshTimestamp: number;
  snapshotRefreshSuccess: boolean;
  snapshotRefreshDurationMs: number;
  snapshotUserCount: number;
  snapshotGroupCount: number;

  // LDAP server metrics
  ldapConnectionsTotal: number;
  ldapConnectionsCurrent: number;
  ldapBindRequestsTotal: number;
  ldapBindSuccessTotal: number;
  ldapSearchRequestsTotal: number;
  ldapSearchEntriesTotal: number;

  // Feature flag metrics
  featureFlagsEnabled: Record<string, boolean>;

  // ID allocation metrics
  idAllocationCollisions: number;
  idAllocationFallbacks: number;

  // Error metrics
  adaptorErrors: Record<string, number>; // keyed by adaptor name
}

export interface MetricsCollector {
  // Snapshot events
  recordSnapshotRefresh(success: boolean, durationMs: number, userCount: number, groupCount: number): void;

  // LDAP events
  recordLDAPConnection(): void;
  recordLDAPDisconnection(): void;
  recordLDAPBind(success: boolean): void;
  recordLDAPSearch(entriesReturned: number): void;

  // ID allocation events
  recordIDCollision(): void;
  recordIDFallback(): void;

  // Error events
  recordAdaptorError(adaptorName: string): void;

  // State updates
  updateFeatureFlags(flags: Record<string, boolean>): void;
}

export class PrometheusMetricsService implements MetricsCollector {
  private snapshotRefreshTimestamp = 0;
  private snapshotRefreshSuccess = false;
  private snapshotRefreshDurationMs = 0;
  private snapshotUserCount = 0;
  private snapshotGroupCount = 0;

  private ldapConnectionsTotal = 0;
  private ldapConnectionsCurrent = 0;
  private ldapBindRequestsTotal = 0;
  private ldapBindSuccessTotal = 0;
  private ldapSearchRequestsTotal = 0;
  private ldapSearchEntriesTotal = 0;

  private featureFlagsEnabled: Record<string, boolean> = {};

  private idAllocationCollisions = 0;
  private idAllocationFallbacks = 0;

  private adaptorErrors: Record<string, number> = {};

  // MetricsCollector implementation
  recordSnapshotRefresh(success: boolean, durationMs: number, userCount: number, groupCount: number): void {
    this.snapshotRefreshTimestamp = Date.now();
    this.snapshotRefreshSuccess = success;
    this.snapshotRefreshDurationMs = durationMs;
    this.snapshotUserCount = userCount;
    this.snapshotGroupCount = groupCount;
  }

  recordLDAPConnection(): void {
    this.ldapConnectionsTotal++;
    this.ldapConnectionsCurrent++;
  }

  recordLDAPDisconnection(): void {
    this.ldapConnectionsCurrent = Math.max(0, this.ldapConnectionsCurrent - 1);
  }

  recordLDAPBind(success: boolean): void {
    this.ldapBindRequestsTotal++;
    if (success) {
      this.ldapBindSuccessTotal++;
    }
  }

  recordLDAPSearch(entriesReturned: number): void {
    this.ldapSearchRequestsTotal++;
    this.ldapSearchEntriesTotal += entriesReturned;
  }

  recordIDCollision(): void {
    this.idAllocationCollisions++;
  }

  recordIDFallback(): void {
    this.idAllocationFallbacks++;
  }

  recordAdaptorError(adaptorName: string): void {
    this.adaptorErrors[adaptorName] = (this.adaptorErrors[adaptorName] || 0) + 1;
  }

  updateFeatureFlags(flags: Record<string, boolean>): void {
    this.featureFlagsEnabled = { ...flags };
  }

  // Metrics exposure
  getSnapshot(): MetricsSnapshot {
    return {
      snapshotRefreshTimestamp: this.snapshotRefreshTimestamp,
      snapshotRefreshSuccess: this.snapshotRefreshSuccess,
      snapshotRefreshDurationMs: this.snapshotRefreshDurationMs,
      snapshotUserCount: this.snapshotUserCount,
      snapshotGroupCount: this.snapshotGroupCount,
      ldapConnectionsTotal: this.ldapConnectionsTotal,
      ldapConnectionsCurrent: this.ldapConnectionsCurrent,
      ldapBindRequestsTotal: this.ldapBindRequestsTotal,
      ldapBindSuccessTotal: this.ldapBindSuccessTotal,
      ldapSearchRequestsTotal: this.ldapSearchRequestsTotal,
      ldapSearchEntriesTotal: this.ldapSearchEntriesTotal,
      featureFlagsEnabled: { ...this.featureFlagsEnabled },
      idAllocationCollisions: this.idAllocationCollisions,
      idAllocationFallbacks: this.idAllocationFallbacks,
      adaptorErrors: { ...this.adaptorErrors },
    };
  }

  formatPrometheus(): string {
    const lines: string[] = [];
    const snapshot = this.getSnapshot();

    // Snapshot metrics
    lines.push("# HELP ldaptoid_snapshot_refresh_timestamp_seconds Timestamp of last snapshot refresh");
    lines.push("# TYPE ldaptoid_snapshot_refresh_timestamp_seconds gauge");
    lines.push(`ldaptoid_snapshot_refresh_timestamp_seconds ${snapshot.snapshotRefreshTimestamp / 1000}`);

    lines.push("# HELP ldaptoid_snapshot_refresh_success Boolean indicating if last refresh was successful");
    lines.push("# TYPE ldaptoid_snapshot_refresh_success gauge");
    lines.push(`ldaptoid_snapshot_refresh_success ${snapshot.snapshotRefreshSuccess ? 1 : 0}`);

    lines.push("# HELP ldaptoid_snapshot_refresh_duration_milliseconds Duration of last snapshot refresh");
    lines.push("# TYPE ldaptoid_snapshot_refresh_duration_milliseconds gauge");
    lines.push(`ldaptoid_snapshot_refresh_duration_milliseconds ${snapshot.snapshotRefreshDurationMs}`);

    lines.push("# HELP ldaptoid_snapshot_users_total Number of users in current snapshot");
    lines.push("# TYPE ldaptoid_snapshot_users_total gauge");
    lines.push(`ldaptoid_snapshot_users_total ${snapshot.snapshotUserCount}`);

    lines.push("# HELP ldaptoid_snapshot_groups_total Number of groups in current snapshot");
    lines.push("# TYPE ldaptoid_snapshot_groups_total gauge");
    lines.push(`ldaptoid_snapshot_groups_total ${snapshot.snapshotGroupCount}`);

    // LDAP server metrics
    lines.push("# HELP ldaptoid_ldap_connections_total Total number of LDAP connections");
    lines.push("# TYPE ldaptoid_ldap_connections_total counter");
    lines.push(`ldaptoid_ldap_connections_total ${snapshot.ldapConnectionsTotal}`);

    lines.push("# HELP ldaptoid_ldap_connections_current Current number of active LDAP connections");
    lines.push("# TYPE ldaptoid_ldap_connections_current gauge");
    lines.push(`ldaptoid_ldap_connections_current ${snapshot.ldapConnectionsCurrent}`);

    lines.push("# HELP ldaptoid_ldap_bind_requests_total Total number of LDAP bind requests");
    lines.push("# TYPE ldaptoid_ldap_bind_requests_total counter");
    lines.push(`ldaptoid_ldap_bind_requests_total ${snapshot.ldapBindRequestsTotal}`);

    lines.push("# HELP ldaptoid_ldap_bind_success_total Total number of successful LDAP bind requests");
    lines.push("# TYPE ldaptoid_ldap_bind_success_total counter");
    lines.push(`ldaptoid_ldap_bind_success_total ${snapshot.ldapBindSuccessTotal}`);

    lines.push("# HELP ldaptoid_ldap_search_requests_total Total number of LDAP search requests");
    lines.push("# TYPE ldaptoid_ldap_search_requests_total counter");
    lines.push(`ldaptoid_ldap_search_requests_total ${snapshot.ldapSearchRequestsTotal}`);

    lines.push("# HELP ldaptoid_ldap_search_entries_total Total number of LDAP search entries returned");
    lines.push("# TYPE ldaptoid_ldap_search_entries_total counter");
    lines.push(`ldaptoid_ldap_search_entries_total ${snapshot.ldapSearchEntriesTotal}`);

    // Feature flag metrics
    for (const [flag, enabled] of Object.entries(snapshot.featureFlagsEnabled)) {
      lines.push(`# HELP ldaptoid_feature_flag_enabled Feature flag status for ${flag}`);
      lines.push(`# TYPE ldaptoid_feature_flag_enabled gauge`);
      lines.push(`ldaptoid_feature_flag_enabled{flag="${flag}"} ${enabled ? 1 : 0}`);
    }

    // ID allocation metrics
    lines.push("# HELP ldaptoid_id_allocation_collisions_total Total number of ID allocation collisions");
    lines.push("# TYPE ldaptoid_id_allocation_collisions_total counter");
    lines.push(`ldaptoid_id_allocation_collisions_total ${snapshot.idAllocationCollisions}`);

    lines.push("# HELP ldaptoid_id_allocation_fallbacks_total Total number of ID allocation fallbacks to sequential");
    lines.push("# TYPE ldaptoid_id_allocation_fallbacks_total counter");
    lines.push(`ldaptoid_id_allocation_fallbacks_total ${snapshot.idAllocationFallbacks}`);

    // Adaptor error metrics
    for (const [adaptor, errorCount] of Object.entries(snapshot.adaptorErrors)) {
      lines.push(`# HELP ldaptoid_adaptor_errors_total Total number of errors from ${adaptor} adaptor`);
      lines.push(`# TYPE ldaptoid_adaptor_errors_total counter`);
      lines.push(`ldaptoid_adaptor_errors_total{adaptor="${adaptor}"} ${errorCount}`);
    }

    return lines.join("\n") + "\n";
  }

  serveMetrics(request: Request): Response {
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    const prometheusOutput = this.formatPrometheus();

    return new Response(prometheusOutput, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      },
    });
  }
}

export default PrometheusMetricsService;
