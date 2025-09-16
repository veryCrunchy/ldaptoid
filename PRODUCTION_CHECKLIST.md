# Production Readiness Checklist

Use this checklist to verify your LDAP-to-ID proxy deployment is ready for production use.

## Pre-Deployment

### ✅ Configuration
- [ ] `.env` file configured with all required variables
- [ ] IdP client credentials tested and working
- [ ] LDAP base DN matches your organization structure
- [ ] Feature flags configured for your requirements
- [ ] Redis password set (if using persistence)
- [ ] Log level appropriate for production (INFO or WARN)

### ✅ Security
- [ ] Client secrets stored securely (not in source control)
- [ ] Network access restricted appropriately
- [ ] HTTPS endpoints configured for external access
- [ ] Container runs as non-root user
- [ ] Security scanning passed in CI/CD

### ✅ Identity Provider Setup
- [ ] OAuth2 application configured correctly
- [ ] Required permissions granted (User.Read, Group.Read)
- [ ] Service account roles assigned (if applicable)
- [ ] Token endpoint accessible from deployment environment
- [ ] Rate limits understood and configured

## Deployment

### ✅ Infrastructure
- [ ] Docker and Docker Compose installed
- [ ] System resources meet minimum requirements (2 CPU, 4GB RAM)
- [ ] Persistent storage configured for Redis
- [ ] Backup strategy implemented
- [ ] Log rotation configured

### ✅ Networking
- [ ] LDAP port (389) accessible to clients
- [ ] Health check port (8080) accessible for monitoring
- [ ] Metrics port (9090) secured appropriately
- [ ] Outbound HTTPS access to IdP confirmed
- [ ] Firewall rules configured

### ✅ Monitoring
- [ ] Prometheus metrics collection working
- [ ] Grafana dashboards configured
- [ ] Health check endpoints responding
- [ ] Log aggregation configured
- [ ] Alerting rules defined

## Post-Deployment

### ✅ Functional Testing
- [ ] LDAP bind authentication working
- [ ] User search returns expected results
- [ ] Group membership correctly reflected
- [ ] Nested groups resolved (if enabled)
- [ ] Primary group synthesis working (if enabled)

### ✅ Performance Testing
- [ ] Response times acceptable under expected load
- [ ] Memory usage stable over time
- [ ] OAuth2 token refresh working automatically
- [ ] Redis persistence functioning correctly
- [ ] No memory leaks detected

### ✅ Operational Readiness
- [ ] Deployment automation tested
- [ ] Backup and recovery procedures validated
- [ ] Monitoring alerts configured and tested
- [ ] Log analysis capabilities confirmed
- [ ] Team trained on operations and troubleshooting

## Production Verification Commands

### Test OAuth2 Authentication
```bash
# This should be automated in the deployment
curl -X POST "${LDAPTOID_IDP_BASE_URL}/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=${LDAPTOID_IDP_CLIENT_ID}" \
  -d "client_secret=${LDAPTOID_IDP_CLIENT_SECRET}"
```

### Test LDAP Functionality
```bash
# Test anonymous bind
ldapsearch -H ldap://localhost:389 -x -b "${LDAPTOID_LDAP_BASE_DN}" "(objectclass=*)" | head -20

# Test authenticated bind (with real user)
ldapsearch -H ldap://localhost:389 -D "uid=testuser,ou=users,${LDAPTOID_LDAP_BASE_DN}" -w password -b "${LDAPTOID_LDAP_BASE_DN}" "(uid=testuser)"

# Test group search
ldapsearch -H ldap://localhost:389 -x -b "${LDAPTOID_LDAP_BASE_DN}" "(objectclass=groupOfNames)"
```

### Verify Health and Metrics
```bash
# Health endpoints
curl http://localhost:8080/health | jq
curl http://localhost:8080/live
curl http://localhost:8080/ready

# Metrics
curl http://localhost:9090/metrics | grep ldaptoid_ | head -10
```

### Load Testing (Optional)
```bash
# Install ldap-utils for testing
sudo apt-get install ldap-utils

# Simple load test
for i in {1..100}; do
  ldapsearch -H ldap://localhost:389 -x -b "${LDAPTOID_LDAP_BASE_DN}" "(uid=*)" &
done
wait

# Check metrics after load test
curl http://localhost:9090/metrics | grep ldaptoid_ldap_requests_total
```

## Troubleshooting Checklist

### ✅ Common Issues
- [ ] IdP connectivity verified
- [ ] DNS resolution working for IdP endpoints
- [ ] Client credentials valid and not expired
- [ ] Required IdP permissions granted
- [ ] Base DN exists in directory structure
- [ ] Memory and CPU resources sufficient
- [ ] No port conflicts on 389, 8080, 9090

### ✅ Debug Mode
```bash
# Enable debug logging
LDAPTOID_LOG_LEVEL=DEBUG
LDAPTOID_VERBOSE=true

# Restart service
docker-compose restart ldaptoid

# Monitor logs
docker-compose logs -f ldaptoid
```

## Performance Baselines

Record these metrics after successful deployment:

- **Startup Time**: _____ seconds
- **Token Refresh Time**: _____ milliseconds
- **Snapshot Size**: _____ users, _____ groups
- **Memory Usage**: _____ MB baseline, _____ MB after full load
- **Response Time**: _____ ms for user search, _____ ms for bind

## Sign-Off

### Technical Review
- [ ] Infrastructure team approval
- [ ] Security team approval
- [ ] Application team approval

### Business Review
- [ ] Functional requirements validated
- [ ] Performance requirements met
- [ ] Security requirements satisfied
- [ ] Operational procedures documented

### Final Approval
- [ ] Go-live approval granted
- [ ] Rollback plan prepared
- [ ] Support team notified
- [ ] Documentation complete

**Production Go-Live Date**: _______________

**Deployment Lead**: _______________

**Technical Contact**: _______________

---

*This checklist should be completed and signed off before production deployment.*