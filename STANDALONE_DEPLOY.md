# LDAP-to-ID Proxy - Copy & Paste Deployment

This is a **completely standalone** Docker Compose configuration that can be copy-pasted into any deployment platform
like Dokploy, Coolify, Portainer, or used directly with Docker Compose.

## 🚀 One-File Deployment

**Just copy the `docker-compose.standalone.yml` file** - that's it! No repository cloning, no build dependencies, no
additional files needed.

### Quick Deploy

1. **Copy** the `docker-compose.standalone.yml` file to your deployment platform
2. **Edit** the IdP configuration (4 environment variables)
3. **Deploy** with `docker-compose up -d`

### Example Dokploy/Coolify Deployment

1. Create a new Docker Compose service
2. Paste the contents of `docker-compose.standalone.yml`
3. Update these environment variables:
   ```yaml
   LDAPTOID_IDP_TYPE: "zitadel" # Change to your IdP
   LDAPTOID_IDP_BASE_URL: "https://your-idp.com" # Your IdP URL
   LDAPTOID_IDP_CLIENT_ID: "your-client-id" # Your client ID
   LDAPTOID_IDP_CLIENT_SECRET: "your-secret" # Your client secret
   ```
4. Deploy!

## 📋 Required Configuration

Edit these **4 environment variables** in the compose file:

```yaml
environment:
  LDAPTOID_IDP_TYPE: "zitadel" # keycloak|entra|zitadel
  LDAPTOID_IDP_BASE_URL: "https://your-idp.example.com"
  LDAPTOID_IDP_CLIENT_ID: "your-client-id"
  LDAPTOID_IDP_CLIENT_SECRET: "your-client-secret"
```

### Optional IdP-Specific Configuration

Uncomment and configure as needed:

```yaml
# For Keycloak:
# LDAPTOID_IDP_REALM: "your-realm"

# For Microsoft Entra ID:
# LDAPTOID_IDP_TENANT: "your-tenant-id"

# For Zitadel v2:
# LDAPTOID_IDP_ORGANIZATION: "your-org-id"
```

## 🌐 What Gets Deployed

- **LDAP-to-ID Proxy** - Main service (ports: 389, 8080, 9090)
- **Redis** - Persistence for UID/GID mappings
- **Prometheus** - Metrics collection (port 9091)
- **Grafana** - Monitoring dashboard (port 3000, admin/admin)
- **Redis Exporter** - Redis metrics

## 🧪 Testing After Deployment

```bash
# Health check
curl http://your-server:8080/health

# Test LDAP
ldapsearch -H ldap://your-server:389 -x -b "dc=company,dc=com" "(objectclass=*)"

# Access monitoring
# Grafana: http://your-server:3000 (admin/admin)
# Prometheus: http://your-server:9091
```

## 🔧 Default Settings

The configuration includes sensible production defaults:

- **LDAP Base DN**: `dc=company,dc=com`
- **Features**: Synthetic primary groups + nested group mirroring
- **Redis**: 256MB limit, persistence enabled
- **Logging**: INFO level, structured JSON
- **Refresh**: 5-minute intervals
- **Security**: Non-root containers, internal networking

## 🐳 Platform-Specific Instructions

### Dokploy

1. Create new service → Docker Compose
2. Paste the `docker-compose.standalone.yml` content
3. Edit environment variables
4. Deploy

### Coolify

1. New Resource → Docker Compose
2. Paste the configuration
3. Set environment variables
4. Deploy

### Portainer

1. Stacks → Add Stack
2. Paste the compose file
3. Update environment variables
4. Deploy

### Raw Docker Compose

```bash
# Save as docker-compose.yml and run:
docker-compose up -d
```

## 🔒 Security Notes

- **Change default passwords** in production:
  - Redis password: `REDIS_PASSWORD` in compose file
  - Grafana password: `GF_SECURITY_ADMIN_PASSWORD`
- **Restrict network access** to necessary ports
- **Use HTTPS** for external endpoints
- **Store secrets securely** in your platform's secret management

## 📊 Monitoring URLs

After deployment, access these services:

- **LDAP Server**: `ldap://your-server:389`
- **Health API**: `http://your-server:8080/health`
- **Metrics API**: `http://your-server:9090/metrics`
- **Grafana Dashboard**: `http://your-server:3000` (admin/admin)
- **Prometheus**: `http://your-server:9091`

## 🔧 Customization

### Change Redis Password

```yaml
# In redis service:
command:
  - redis-server
  - --requirepass
  - "your-secure-password" # Change this

# In ldaptoid service:
environment:
  LDAPTOID_REDIS_PASSWORD: "your-secure-password" # Change this

# In redis-exporter service:
environment:
  REDIS_PASSWORD: "your-secure-password" # Change this
```

### Adjust Resource Limits

```yaml
# Add to any service:
deploy:
  resources:
    limits:
      memory: 512M
      cpus: "0.5"
```

### Custom Base DN

```yaml
# In ldaptoid service:
environment:
  LDAPTOID_LDAP_BASE_DN: "dc=yourcompany,dc=local"
```

## 🐛 Troubleshooting

### Service Not Starting

```bash
# Check logs
docker-compose -f docker-compose.standalone.yml logs ldaptoid

# Check all service status
docker-compose -f docker-compose.standalone.yml ps
```

### LDAP Connection Issues

```bash
# Verify LDAP port is accessible
nc -v your-server 389

# Check service health
curl http://your-server:8080/health
```

### IdP Authentication Issues

```bash
# Test IdP connectivity
curl -v https://your-idp.example.com

# Check service logs for OAuth errors
docker-compose logs ldaptoid | grep -i oauth
```

## 📚 Full Documentation

For advanced configuration and production deployment guides:

- [Main Repository](https://github.com/obiente/ldaptoid)
- [Production Deployment Guide](https://github.com/obiente/ldaptoid/blob/main/DEPLOYMENT.md)
- [Production Checklist](https://github.com/obiente/ldaptoid/blob/main/PRODUCTION_CHECKLIST.md)

---

**The complete LDAP-to-ID proxy in a single copy-pasteable file! 🎉**
