# Dockerfile for Tauri E2E testing
# Enables running E2E tests on macOS via Docker (Linux container)

FROM ivangabriele/tauri:debian-bookworm-20

# Install additional test dependencies
RUN apt-get update && apt-get install -y \
    xvfb \
    webkit2gtk-driver \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/notebook/package.json apps/notebook/
COPY apps/sidecar/package.json apps/sidecar/

# Install JS dependencies
RUN corepack enable && pnpm install --frozen-lockfile

# Copy Rust files for caching
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY crates/ crates/

# Copy remaining source code
COPY . .

# Build frontend assets
RUN pnpm run isolated-renderer:build
RUN pnpm --dir apps/notebook build

# Install tauri-cli for building
RUN cargo install tauri-cli --locked

# Generate icons (needed for bundling)
RUN cargo xtask icons

# Build Tauri app for Linux using tauri-cli
# This ensures frontend is properly embedded (not using devUrl)
# Use --config to disable beforeBuildCommand since we already built the frontend
WORKDIR /app/crates/notebook
RUN cargo tauri build --ci --config '{"build":{"beforeBuildCommand":""}}'
WORKDIR /app

# Expose WebDriver ports
EXPOSE 4444 4445

# Default command starts Xvfb and tauri-driver
CMD ["bash", "-c", "Xvfb :99 -screen 0 1920x1080x24 & sleep 2 && DISPLAY=:99 tauri-driver --port 4444"]
