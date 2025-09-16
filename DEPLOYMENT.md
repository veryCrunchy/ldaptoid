# LDAP-to-ID Proxy - Production Deployment Guide

This guide covers deploying the LDAP-to-ID proxy in production environments with proper security, monitoring, and operational practices.

## Quick Start

1. **Clone and Configure**
   ```bash
   git clone https://github.com/obiente/ldaptoid.git
   cd ldaptoid
   cp .env.example .env
   # Edit .env with your configuration
   ```

2. **Deploy**
   ```bash
   ./scripts/deploy.sh
   ```

3. **Verify**
   ```bash
   # Check health
   curl http://localhost:8080/health
   
   # Test LDAP
   ldapsearch -H ldap://localhost:389 -x -b "dc=company,dc=com" "(objectclass=*)"
   ```

## Prerequisites

### System Requirements
- **CPU**: 2+ cores recommended
- **Memory**: 4GB+ RAM recommended
- **Storage**: 10GB+ for logs and persistence
- **Network**: Outbound HTTPS access to IdP

### Software Dependencies
- Docker 20.10+
- Docker Compose 2.0+
- curl (for health checks)
- Optional: LDAP utilities for testing

## Configuration

### Environment Variables

Copy `.env.example` to `.env` and configure:

#### Required Configuration
```bash
# Identity Provider
LDAPTOID_IDP_TYPE=zitadel                    # keycloak|entra|zitadel
LDAPTOID_IDP_BASE_URL=https://company.zitadel.cloud
LDAPTOID_IDP_CLIENT_ID=your-client-id
LDAPTOID_IDP_CLIENT_SECRET=your-client-secret

# IdP-Specific
LDAPTOID_IDP_REALM=company                   # For Keycloak
LDAPTOID_IDP_TENANT=tenant-id                # For Entra ID
LDAPTOID_IDP_ORGANIZATION=org-id             # For Zitadel v2 (optional)

# LDAP
LDAPTOID_LDAP_BASE_DN=dc=company,dc=com
```

#### Optional Configuration
```bash
# Redis Persistence (Recommended)
LDAPTOID_REDIS_ENABLED=true
REDIS_PASSWORD=secure-password

# Feature Flags
LDAPTOID_ENABLED_FEATURES=synthetic_primary_group,mirror_nested_groups

# Operational
LDAPTOID_VERBOSE=false
LDAPTOID_REFRESH_INTERVAL_MS=300000
```

### Identity Provider Setup

#### Zitadel v2 (Recommended)
1. Create a new application in Zitadel
2. Set application type to "API"
3. Note the client ID and generate a client secret
4. Grant necessary permissions for user/group access

#### Keycloak
1. Create a new client in your realm
2. Set client authentication to "On"
3. Set authorization to "Off"
4. Set service accounts roles to "On"
5. Configure service account roles for user/group access

#### Microsoft Entra ID
1. Register a new application in Azure AD
2. Create a client secret
3. Grant "User.Read.All" and "Group.Read.All" permissions
4. Admin consent for the permissions

## Deployment

### Using Docker Compose (Recommended)

The provided `docker-compose.yml` includes:
- LDAP-to-ID proxy
- Redis for persistence
- Prometheus for metrics
- Grafana for visualization
- Redis exporter for Redis metrics

```bash
# Deploy full stack
./scripts/deploy.sh

# Individual operations
./scripts/deploy.sh stop     # Stop services
./scripts/deploy.sh restart  # Restart services
./scripts/deploy.sh logs     # View logs
./scripts/deploy.sh status   # Show status
./scripts/deploy.sh health   # Run health checks
```

### Using Docker

```bash
# Build image
docker build -t ldaptoid:latest .

# Run container
docker run -d \
  --name ldaptoid \
  --env-file .env \
  -p 389:389 \
  -p 8080:8080 \
  -p 9090:9090 \
  ldaptoid:latest
```

### Using Kubernetes

Example Kubernetes manifests:

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ldaptoid
spec:
  replicas: 2
  selector:
    matchLabels:
      app: ldaptoid
  template:
    metadata:
      labels:
        app: ldaptoid
    spec:
      containers:
      - name: ldaptoid
        image: ghcr.io/obiente/ldaptoid:latest
        ports:
        - containerPort: 389
        - containerPort: 8080
        - containerPort: 9090
        env:
        - name: LDAPTOID_IDP_TYPE
          value: "zitadel"
        # Add other environment variables
        livenessProbe:
          httpGet:
            path: /live
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /ready
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 10
```

## Security

### Network Security
- Use TLS/SSL for all external connections
- Restrict access to management ports (8080, 9090)
- Use VPN or private networks for LDAP port (389)

### Secrets Management
- Store sensitive environment variables in secret management systems
- Rotate OAuth2 client secrets regularly
- Use Redis AUTH for Redis connections

### Container Security
- The provided Dockerfile uses distroless base images
- Runs as non-root user
- Minimal attack surface

## Monitoring

### Health Checks
- **Liveness**: `GET /live` - Basic service health
- **Readiness**: `GET /ready` - Service ready to accept traffic
- **Health**: `GET /health` - Detailed component status

### Metrics

Prometheus metrics available at `/metrics`:

#### Core Metrics
- `ldaptoid_snapshot_refresh_duration_milliseconds` - Snapshot refresh time
- `ldaptoid_ldap_connections_total` - Total LDAP connections
- `ldaptoid_ldap_bind_requests_total` - LDAP bind attempts
- `ldaptoid_ldap_search_requests_total` - LDAP search requests

#### Business Metrics
- `ldaptoid_snapshot_users_total` - Number of users in snapshot
- `ldaptoid_snapshot_groups_total` - Number of groups in snapshot
- `ldaptoid_feature_flag_enabled` - Feature flag status

### Grafana Dashboards

Access Grafana at `http://localhost:3000` (admin/admin by default)

Pre-configured dashboards monitor:
- LDAP request rates and latency
- OAuth2 token refresh status
- Redis performance
- Error rates and types

### Logging

Structured JSON logs with configurable levels:
```bash
# Set log level
LDAPTOID_LOG_LEVEL=INFO  # DEBUG|INFO|WARN|ERROR|FATAL

# Enable verbose mode
LDAPTOID_VERBOSE=true
```

## Troubleshooting

### Common Issues

#### OAuth2 Authentication Failures
```bash
# Check IdP connectivity
curl -v https://your-idp.com

# Verify client credentials
curl -X POST https://your-idp.com/oauth/token \
  -d "grant_type=client_credentials" \
  -d "client_id=your-client" \
  -d "client_secret=your-secret"
```

#### LDAP Connection Issues
```bash
# Test LDAP port
nc -v localhost 389

# Check health status
curl http://localhost:8080/health | jq
```

#### Performance Issues
```bash
# Check metrics
curl http://localhost:9090/metrics | grep ldaptoid_

# View resource usage
docker stats ldaptoid
```

### Log Analysis

```bash
# View real-time logs
docker-compose logs -f ldaptoid

# Search for errors
docker-compose logs ldaptoid | grep -i error

# Filter by log level
docker-compose logs ldaptoid | jq 'select(.level=="ERROR")'
```

## Backup and Recovery

### Redis Data Backup
```bash
# Create backup
docker-compose exec redis redis-cli BGSAVE

# Copy backup file
docker cp ldaptoid-redis:/data/dump.rdb ./backup/
```

### Configuration Backup
```bash
# Backup environment and compose files
tar -czf backup-$(date +%Y%m%d).tar.gz .env docker-compose.yml
```

## Performance Tuning

### Scaling Considerations
- **Horizontal**: Run multiple instances behind a load balancer
- **Vertical**: Increase memory for larger user/group datasets
- **Redis**: Use Redis Cluster for high availability

### Configuration Tuning
```bash
# Adjust refresh intervals
LDAPTOID_REFRESH_INTERVAL_MS=300000  # 5 minutes

# Tune connection limits
LDAPTOID_LDAP_SIZE_LIMIT=1000       # Max search results

# Optimize Redis
REDIS_MAXMEMORY=256mb
REDIS_MAXMEMORY_POLICY=allkeys-lru
```

## Maintenance

### Updates
```bash
# Pull latest image
docker-compose pull ldaptoid

# Restart with new image
docker-compose up -d --force-recreate ldaptoid
```

### Health Monitoring
```bash
# Automated health check
#!/bin/bash
if ! curl -sf http://localhost:8080/health > /dev/null; then
  echo "Service unhealthy, restarting..."
  docker-compose restart ldaptoid
fi
```

## Support

### Community
- GitHub Issues: Report bugs and feature requests
- Discussions: Ask questions and share experiences

### Enterprise Support
- Professional services available
- Custom deployment assistance
- Extended monitoring and alerting

## License

MIT License - see LICENSE file for details.