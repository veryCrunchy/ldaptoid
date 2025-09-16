#!/bin/bash

# LDAP-to-ID Proxy - Standalone Configuration Helper
set -e

echo "🌐 LDAP-to-ID Proxy Standalone Setup"
echo "====================================="
echo ""

# Check if docker and docker-compose are installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

echo "✅ Docker and Docker Compose are installed"
echo ""

# Function to prompt for required configuration
configure_idp() {
    echo "📋 Identity Provider Configuration"
    echo "=================================="
    echo ""
    
    echo "Select your Identity Provider:"
    echo "1) Zitadel v2 (Recommended)"
    echo "2) Keycloak"
    echo "3) Microsoft Entra ID"
    echo ""
    read -p "Enter choice (1-3): " idp_choice
    
    case $idp_choice in
        1)
            IDP_TYPE="zitadel"
            echo "✅ Selected: Zitadel v2"
            ;;
        2)
            IDP_TYPE="keycloak"
            echo "✅ Selected: Keycloak"
            ;;
        3)
            IDP_TYPE="entra"
            echo "✅ Selected: Microsoft Entra ID"
            ;;
        *)
            echo "❌ Invalid choice. Defaulting to Zitadel."
            IDP_TYPE="zitadel"
            ;;
    esac
    
    echo ""
    read -p "Enter your IdP base URL (e.g., https://your-idp.example.com): " IDP_BASE_URL
    read -p "Enter your OAuth2 client ID: " IDP_CLIENT_ID
    read -s -p "Enter your OAuth2 client secret: " IDP_CLIENT_SECRET
    echo ""
    
    # IdP-specific configuration
    case $IDP_TYPE in
        "keycloak")
            read -p "Enter your Keycloak realm: " IDP_REALM
            ;;
        "entra")
            read -p "Enter your Entra ID tenant ID: " IDP_TENANT
            ;;
        "zitadel")
            read -p "Enter your Zitadel organization ID (optional, press Enter to skip): " IDP_ORGANIZATION
            ;;
    esac
    
    echo ""
    read -p "Enter your LDAP base DN (default: dc=company,dc=com): " LDAP_BASE_DN
    LDAP_BASE_DN=${LDAP_BASE_DN:-dc=company,dc=com}
}

# Function to update docker-compose file
update_compose_file() {
    echo "📝 Updating docker-compose.standalone.yml with your configuration..."
    
    # Create a temporary file with the updated configuration
    cp docker-compose.standalone.yml docker-compose.standalone.yml.bak
    
    # Use sed to replace the configuration values
    sed -i "s|LDAPTOID_IDP_TYPE: \".*\"|LDAPTOID_IDP_TYPE: \"$IDP_TYPE\"|" docker-compose.standalone.yml
    sed -i "s|LDAPTOID_IDP_BASE_URL: \".*\"|LDAPTOID_IDP_BASE_URL: \"$IDP_BASE_URL\"|" docker-compose.standalone.yml
    sed -i "s|LDAPTOID_IDP_CLIENT_ID: \".*\"|LDAPTOID_IDP_CLIENT_ID: \"$IDP_CLIENT_ID\"|" docker-compose.standalone.yml
    sed -i "s|LDAPTOID_IDP_CLIENT_SECRET: \".*\"|LDAPTOID_IDP_CLIENT_SECRET: \"$IDP_CLIENT_SECRET\"|" docker-compose.standalone.yml
    sed -i "s|LDAPTOID_LDAP_BASE_DN: \".*\"|LDAPTOID_LDAP_BASE_DN: \"$LDAP_BASE_DN\"|" docker-compose.standalone.yml
    
    # Add IdP-specific configuration
    case $IDP_TYPE in
        "keycloak")
            if [[ -n "$IDP_REALM" ]]; then
                sed -i "s|# LDAPTOID_IDP_REALM: \"your-realm\"|LDAPTOID_IDP_REALM: \"$IDP_REALM\"|" docker-compose.standalone.yml
            fi
            ;;
        "entra")
            if [[ -n "$IDP_TENANT" ]]; then
                sed -i "s|# LDAPTOID_IDP_TENANT: \"your-tenant-id\"|LDAPTOID_IDP_TENANT: \"$IDP_TENANT\"|" docker-compose.standalone.yml
            fi
            ;;
        "zitadel")
            if [[ -n "$IDP_ORGANIZATION" ]]; then
                sed -i "s|# LDAPTOID_IDP_ORGANIZATION: \"your-org-id\"|LDAPTOID_IDP_ORGANIZATION: \"$IDP_ORGANIZATION\"|" docker-compose.standalone.yml
            fi
            ;;
    esac
    
    echo "✅ Configuration updated successfully"
    echo ""
}

# Function to deploy the stack
deploy_stack() {
    echo "🚀 Deploying LDAP-to-ID Proxy Stack"
    echo "===================================="
    echo ""
    
    # Validate configuration file exists
    if [[ ! -f "docker-compose.standalone.yml" ]]; then
        echo "❌ docker-compose.standalone.yml not found"
        exit 1
    fi
    
    echo "Pulling latest images and starting services..."
    docker-compose -f docker-compose.standalone.yml pull
    docker-compose -f docker-compose.standalone.yml up -d
    
    echo ""
    echo "⏳ Waiting for services to be ready..."
    sleep 30
    
    # Check health
    echo "🔍 Checking service health..."
    
    if curl -sf http://localhost:8080/health > /dev/null 2>&1; then
        echo "✅ LDAP-to-ID Proxy is healthy"
    else
        echo "⚠️  LDAP-to-ID Proxy health check failed - check logs"
    fi
    
    if curl -sf http://localhost:3000/api/health > /dev/null 2>&1; then
        echo "✅ Grafana is accessible"
    else
        echo "⚠️  Grafana not yet ready - may need more time"
    fi
    
    echo ""
    echo "🎉 Deployment complete!"
    echo ""
    echo "📊 Access your services:"
    echo "   • LDAP Server: ldap://localhost:389"
    echo "   • Health Check: http://localhost:8080/health"
    echo "   • Grafana Dashboard: http://localhost:3000 (admin/admin)"
    echo "   • Prometheus: http://localhost:9091"
    echo ""
    echo "🧪 Test LDAP connection:"
    echo "   ldapsearch -H ldap://localhost:389 -x -b \"$LDAP_BASE_DN\" \"(objectclass=*)\""
    echo ""
    echo "📋 Management commands:"
    echo "   • View logs: docker-compose -f docker-compose.standalone.yml logs -f ldaptoid"
    echo "   • Stop services: docker-compose -f docker-compose.standalone.yml down"
    echo "   • Restart: docker-compose -f docker-compose.standalone.yml restart"
}

# Main execution
main() {
    if [[ "$1" == "--deploy-only" ]]; then
        echo "🚀 Deploying with existing configuration..."
        deploy_stack
        exit 0
    fi
    
    if [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]]; then
        echo "Usage: $0 [OPTIONS]"
        echo ""
        echo "Options:"
        echo "  --deploy-only    Deploy with existing docker-compose.standalone.yml"
        echo "  --help, -h       Show this help message"
        echo ""
        echo "Interactive mode (default): Configure and deploy"
        exit 0
    fi
    
    # Interactive configuration
    configure_idp
    update_compose_file
    
    echo "🔍 Configuration Summary:"
    echo "========================"
    echo "IdP Type: $IDP_TYPE"
    echo "IdP URL: $IDP_BASE_URL"
    echo "Client ID: $IDP_CLIENT_ID"
    echo "Base DN: $LDAP_BASE_DN"
    echo ""
    
    read -p "Do you want to deploy now? (y/N): " deploy_confirm
    if [[ "$deploy_confirm" =~ ^[Yy]$ ]]; then
        deploy_stack
    else
        echo ""
        echo "ℹ️  Configuration saved to docker-compose.standalone.yml"
        echo "   Deploy later with: docker-compose -f docker-compose.standalone.yml up -d"
        echo "   Or run: $0 --deploy-only"
    fi
}

# Run main function
main "$@"