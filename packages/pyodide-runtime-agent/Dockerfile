FROM denoland/deno:latest

# Create working directory
WORKDIR /app

# Set default environment variables
ENV LIVESTORE_SYNC_URL=wss://anode-docworker.rgbkrk.workers.dev/api

# Cache the JSR package to improve startup time
RUN deno cache jsr:@runt/pyodide-runtime-agent@0.4.1

# Create cache directory for Pyodide packages
RUN mkdir -p /app/.runt/pyodide-cache

# Set permissions for cache directory
RUN chmod 755 /app/.runt/pyodide-cache

# Set HOME to app directory so cache utilities work correctly
ENV HOME=/app

# Run the pyodide runtime agent
CMD ["deno", "run", "--allow-all", "jsr:@runt/pyodide-runtime-agent@0.4.1"]
