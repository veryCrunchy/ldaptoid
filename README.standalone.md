# LDAP-to-ID Proxy - Standalone Deployment

This directory contains a ready-to-go Docker Compose setup that requires minimal configuration.

## Quick Start

### 1. Configure Identity Provider

Edit `docker-compose.standalone.yml` and update these environment variables:

```yaml
# Required IdP configuration - CONFIGURE THESE BEFORE RUNNING
LDAPTOID_IDP_TYPE: "zitadel"  # Change to: keycloak|entra|zitadel
LDAPTOID_IDP_BASE_URL: "https://your-idp.example.com"  # Change to your IdP URL
LDAPTOID_IDP_CLIENT_ID: "your-client-id"  # Change to your client ID
LDAPTOID_IDP_CLIENT_SECRET: "your-client-secret"  # Change to your client secret
```

For IdP-specific configuration, uncomment and configure:
- **Keycloak**: `LDAPTOID_IDP_REALM`
- **Entra ID**: `LDAPTOID_IDP_TENANT`
- **Zitadel v2**: `LDAPTOID_IDP_ORGANIZATION`

### 2. Deploy

```bash
# Deploy the full stack
docker-compose -f docker-compose.standalone.yml up -d

# Check status
docker-compose -f docker-compose.standalone.yml ps

# View logs
docker-compose -f docker-compose.standalone.yml logs -f ldaptoid
```

### 3. Verify Deployment

```bash
# Health check
curl http://localhost:8080/health

# Test LDAP
ldapsearch -H ldap://localhost:389 -x -b "dc=company,dc=com" "(objectclass=*)"

# Access monitoring
# Grafana: http://localhost:3000 (admin/admin)
# Prometheus: http://localhost:9091
```

## What's Included

- **LDAP-to-ID Proxy** - Main service on port 389 (LDAP), 8080 (health), 9090 (metrics)
- **Redis** - Persistence layer for UID/GID mappings
- **Prometheus** - Metrics collection on port 9091
- **Grafana** - Visualization dashboard on port 3000
- **Redis Exporter** - Redis metrics for monitoring

## Default Configuration

The standalone setup includes sensible defaults:

- **Base DN**: `dc=company,dc=com`
- **Features**: Synthetic primary groups and nested group mirroring enabled
- **Redis**: Persistence enabled with 256MB memory limit
- **Logging**: INFO level, structured JSON format
- **Refresh**: 5-minute interval for user/group data

## Management Commands

```bash
# Stop all services
docker-compose -f docker-compose.standalone.yml down

# Stop and remove volumes (DELETES DATA)
docker-compose -f docker-compose.standalone.yml down -v

# Restart a specific service
docker-compose -f docker-compose.standalone.yml restart ldaptoid

# View service logs
docker-compose -f docker-compose.standalone.yml logs -f [service-name]

# Update to latest images
docker-compose -f docker-compose.standalone.yml pull
docker-compose -f docker-compose.standalone.yml up -d
```

## Monitoring & Metrics

### Grafana Dashboard
- URL: http://localhost:3000
- Login: admin/admin
- Prometheus datasource auto-configured

### Key Metrics
- LDAP connection count and response times
- User/group snapshot size and refresh duration
- Redis performance and memory usage
- Error rates and health status

### Health Endpoints
- **Service Health**: http://localhost:8080/health
- **Liveness**: http://localhost:8080/live
- **Readiness**: http://localhost:8080/ready
- **Metrics**: http://localhost:9090/metrics

## Troubleshooting

### Common Issues

**Identity Provider Connection Errors**
```bash
# Check IdP connectivity
curl -v https://your-idp.example.com

# Verify OAuth2 configuration
docker-compose -f docker-compose.standalone.yml logs ldaptoid | grep -i oauth
```

**LDAP Connection Issues**
```bash
# Check if LDAP port is accessible
nc -v localhost 389

# Test basic LDAP functionality
ldapsearch -H ldap://localhost:389 -x -s base -b "" "(objectclass=*)"
```

**Redis Connection Issues**
```bash
# Check Redis health
docker-compose -f docker-compose.standalone.yml exec redis redis-cli -a ldaptoid-redis-secret ping

# View Redis logs
docker-compose -f docker-compose.standalone.yml logs redis
```

### Logs Analysis

```bash
# Filter for errors
docker-compose -f docker-compose.standalone.yml logs ldaptoid | grep -i error

# Watch real-time logs
docker-compose -f docker-compose.standalone.yml logs -f --tail=100 ldaptoid

# Export logs for analysis
docker-compose -f docker-compose.standalone.yml logs --no-color ldaptoid > ldaptoid.log
```

## Security Notes

- **Change default passwords** in production
- **Use secrets management** for sensitive values
- **Restrict network access** to necessary ports
- **Monitor access logs** for suspicious activity
- **Keep images updated** regularly

## Production Considerations

For production deployment:

1. **Use environment files** instead of inline configuration
2. **Configure proper SSL/TLS** termination
3. **Set up log rotation** and centralized logging
4. **Implement backup strategy** for Redis data
5. **Configure alerting** for critical metrics
6. **Use orchestration platform** (Kubernetes, Docker Swarm) for HA

For advanced configuration options, see the main [deployment guide](DEPLOYMENT.md).