#!/bin/bash
# Production deployment script for LDAP-to-ID proxy
# Handles environment validation, service deployment, and health checks

set -euo pipefail

# Configuration
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
readonly ENV_FILE="${PROJECT_DIR}/.env"
readonly COMPOSE_FILE="${PROJECT_DIR}/docker-compose.yml"

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $*"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $*"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*"
}

# Required environment variables
readonly REQUIRED_VARS=(
    "LDAPTOID_IDP_TYPE"
    "LDAPTOID_IDP_BASE_URL"
    "LDAPTOID_IDP_CLIENT_ID"
    "LDAPTOID_IDP_CLIENT_SECRET"
)

# Validate environment variables
validate_environment() {
    log_info "Validating environment configuration..."
    
    if [[ ! -f "$ENV_FILE" ]]; then
        log_error "Environment file not found: $ENV_FILE"
        log_info "Please copy .env.example to .env and configure your settings"
        exit 1
    fi
    
    # Source the environment file
    set -a
    # shellcheck source=/dev/null
    source "$ENV_FILE"
    set +a
    
    # Check required variables
    local missing_vars=()
    for var in "${REQUIRED_VARS[@]}"; do
        if [[ -z "${!var:-}" ]]; then
            missing_vars+=("$var")
        fi
    done
    
    if [[ ${#missing_vars[@]} -gt 0 ]]; then
        log_error "Missing required environment variables:"
        printf '%s\n' "${missing_vars[@]}"
        exit 1
    fi
    
    # Validate IDP type
    if [[ ! "$LDAPTOID_IDP_TYPE" =~ ^(keycloak|entra|zitadel)$ ]]; then
        log_error "Invalid LDAPTOID_IDP_TYPE: $LDAPTOID_IDP_TYPE"
        log_info "Must be one of: keycloak, entra, zitadel"
        exit 1
    fi
    
    # IDP-specific validation
    case "$LDAPTOID_IDP_TYPE" in
        keycloak)
            if [[ -z "${LDAPTOID_IDP_REALM:-}" ]]; then
                log_error "LDAPTOID_IDP_REALM is required for Keycloak"
                exit 1
            fi
            ;;
        entra)
            if [[ -z "${LDAPTOID_IDP_TENANT:-}" ]]; then
                log_error "LDAPTOID_IDP_TENANT is required for Entra ID"
                exit 1
            fi
            ;;
    esac
    
    log_success "Environment validation passed"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed"
        exit 1
    fi
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null; then
        log_error "Docker Compose is not installed"
        exit 1
    fi
    
    # Check if Docker daemon is running
    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running"
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

# Build or pull images
build_images() {
    log_info "Building/pulling Docker images..."
    
    cd "$PROJECT_DIR"
    
    # Build the main application image
    docker-compose build --pull ldaptoid
    
    # Pull other images
    docker-compose pull redis prometheus grafana redis-exporter
    
    log_success "Images ready"
}

# Deploy services
deploy_services() {
    log_info "Deploying services..."
    
    cd "$PROJECT_DIR"
    
    # Create and start services
    docker-compose up -d --remove-orphans
    
    log_success "Services deployed"
}

# Wait for services to be healthy
wait_for_services() {
    log_info "Waiting for services to be healthy..."
    
    local max_attempts=60
    local attempt=0
    
    while [[ $attempt -lt $max_attempts ]]; do
        if curl -sf http://localhost:8080/ready > /dev/null 2>&1; then
            break
        fi
        
        log_info "Waiting for LDAP-to-ID proxy to be ready... (attempt $((attempt + 1))/$max_attempts)"
        sleep 2
        ((attempt++))
    done
    
    if [[ $attempt -eq $max_attempts ]]; then
        log_error "LDAP-to-ID proxy failed to become ready"
        log_info "Checking service logs..."
        docker-compose logs ldaptoid
        exit 1
    fi
    
    log_success "LDAP-to-ID proxy is ready"
}

# Run health checks
run_health_checks() {
    log_info "Running health checks..."
    
    # Check LDAP-to-ID proxy health
    if ! curl -sf http://localhost:8080/health > /dev/null; then
        log_error "LDAP-to-ID proxy health check failed"
        return 1
    fi
    
    # Check metrics endpoint
    if ! curl -sf http://localhost:9090/metrics | grep -q "ldaptoid_"; then
        log_error "Metrics endpoint check failed"
        return 1
    fi
    
    # Check Redis connectivity
    if ! docker-compose exec -T redis redis-cli ping > /dev/null 2>&1; then
        log_error "Redis connectivity check failed"
        return 1
    fi
    
    # Check LDAP port accessibility
    if ! timeout 5 bash -c 'echo > /dev/tcp/localhost/389' 2>/dev/null; then
        log_error "LDAP port (389) is not accessible"
        return 1
    fi
    
    log_success "All health checks passed"
}

# Show service status
show_status() {
    log_info "Service status:"
    docker-compose ps
    
    echo ""
    log_info "Service endpoints:"
    echo "  LDAP Server:    ldap://localhost:389"
    echo "  Health Checks:  http://localhost:8080/health"
    echo "  Metrics:        http://localhost:9090/metrics"
    echo "  Grafana:        http://localhost:3000 (admin/admin)"
    echo "  Prometheus:     http://localhost:9091"
    echo ""
    
    log_info "Logs can be viewed with: docker-compose logs -f [service]"
}

# Cleanup function
cleanup() {
    if [[ "${1:-}" == "error" ]]; then
        log_error "Deployment failed. Checking logs..."
        docker-compose logs --tail=50
    fi
}

# Main deployment function
main() {
    trap 'cleanup error' ERR
    
    log_info "Starting LDAP-to-ID proxy deployment..."
    
    check_prerequisites
    validate_environment
    build_images
    deploy_services
    wait_for_services
    run_health_checks
    show_status
    
    log_success "Deployment completed successfully!"
    log_info "LDAP-to-ID proxy is now running and ready to accept connections"
}

# Parse command line arguments
case "${1:-deploy}" in
    deploy)
        main
        ;;
    stop)
        log_info "Stopping services..."
        cd "$PROJECT_DIR"
        docker-compose down
        log_success "Services stopped"
        ;;
    restart)
        log_info "Restarting services..."
        cd "$PROJECT_DIR"
        docker-compose restart
        log_success "Services restarted"
        ;;
    logs)
        cd "$PROJECT_DIR"
        docker-compose logs -f "${2:-}"
        ;;
    status)
        cd "$PROJECT_DIR"
        show_status
        ;;
    health)
        run_health_checks
        ;;
    *)
        echo "Usage: $0 {deploy|stop|restart|logs [service]|status|health}"
        echo ""
        echo "Commands:"
        echo "  deploy    - Deploy the full stack (default)"
        echo "  stop      - Stop all services"
        echo "  restart   - Restart all services"
        echo "  logs      - Show logs (optionally for specific service)"
        echo "  status    - Show service status and endpoints"
        echo "  health    - Run health checks"
        exit 1
        ;;
esac