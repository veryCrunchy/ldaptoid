# Multi-stage Dockerfile for LDAP-to-ID proxy
# Production-ready with security scanning and minimal runtime

# Build stage
FROM denoland/deno:2.1.4 AS builder

# Create app directory
WORKDIR /app

# Copy configuration files
COPY deno.json ./
COPY deno.lock* ./

# Copy source code
COPY src/ ./src/
COPY test_integration.ts ./

# Cache dependencies
RUN deno cache src/cli/main.ts

# Run tests
RUN deno task test:integration

# Type check
RUN deno task check

# Build the binary
RUN deno task build

# Production stage
FROM gcr.io/distroless/cc-debian12:nonroot AS production

# Copy the compiled binary from builder
COPY --from=builder /app/bin/ldaptoid /usr/local/bin/ldaptoid

# Create non-root user (already exists in distroless)
USER nonroot

# Expose ports
EXPOSE 389/tcp 8080/tcp 9090/tcp

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD ["/usr/local/bin/ldaptoid", "--help"] || exit 1

# Set default command
ENTRYPOINT ["/usr/local/bin/ldaptoid"]

# Labels for metadata
LABEL org.opencontainers.image.title="LDAP-to-ID Proxy"
LABEL org.opencontainers.image.description="Bridge legacy LDAP clients to modern identity providers"
LABEL org.opencontainers.image.vendor="Obiente"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.source="https://github.com/obiente/ldaptoid"
LABEL org.opencontainers.image.documentation="https://github.com/obiente/ldaptoid/blob/main/README.md"

# Development stage (optional, for debugging)
FROM denoland/deno:2.1.4 AS development

WORKDIR /app

# Copy all files for development
COPY . .

# Install dependencies
RUN deno cache src/cli/main.ts

# Create non-root user for development
RUN groupadd -r appuser && useradd -r -g appuser appuser
RUN chown -R appuser:appuser /app
USER appuser

# Expose ports
EXPOSE 389/tcp 8080/tcp 9090/tcp

# Default to development mode
CMD ["deno", "task", "dev"]