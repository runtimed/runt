#!/bin/bash
# E2E development helper — wraps common operations under one script
# Usage: ./e2e/dev.sh <command> [args...]
set -e

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BINARY="$PROJECT_ROOT/target/debug/notebook"
PORT="${WEBDRIVER_PORT:-4444}"

case "${1:-help}" in
  build)
    # Rebuild with WebDriver support using cargo tauri build (embeds frontend)
    cd "$PROJECT_ROOT"
    cargo tauri build --debug --no-bundle --features webdriver-test \
      --config '{"build":{"beforeBuildCommand":""}}'
    echo "Binary ready: $BINARY"
    ;;

  build-full)
    # Full rebuild including frontend + sidecars
    cd "$PROJECT_ROOT"
    cargo xtask build-e2e
    ;;

  start)
    # Start the app with WebDriver server
    echo "Starting notebook with WebDriver on port $PORT..."
    RUST_LOG="${RUST_LOG:-info}" "$BINARY" --webdriver-port "$PORT"
    ;;

  stop)
    # Stop the running app
    pkill -f "target/debug/notebook" 2>/dev/null && echo "Stopped" || echo "Not running"
    ;;

  restart)
    # Stop + start
    $0 stop
    sleep 1
    $0 start
    ;;

  test)
    # Run E2E tests (optionally pass a spec file)
    cd "$PROJECT_ROOT"
    if [ -n "$2" ]; then
      E2E_SPEC="$2" WEBDRIVER_PORT="$PORT" pnpm exec wdio run e2e/wdio.conf.js
    else
      E2E_SPEC=e2e/specs/notebook-execution.spec.js WEBDRIVER_PORT="$PORT" pnpm exec wdio run e2e/wdio.conf.js
    fi
    ;;

  status)
    # Check if the WebDriver server is running
    curl -s "http://localhost:$PORT/status" 2>/dev/null || echo "Not running"
    ;;

  session)
    # Create a session and print the ID
    curl -s -X POST "http://localhost:$PORT/session" \
      -H 'Content-Type: application/json' \
      -d '{"capabilities":{}}' | python3 -c "import sys,json; print(json.load(sys.stdin)['value']['sessionId'])"
    ;;

  exec)
    # Execute JS in the app: ./e2e/dev.sh exec 'return document.title'
    shift
    SID=$($0 session)
    curl -s -X POST "http://localhost:$PORT/session/$SID/execute/sync" \
      -H 'Content-Type: application/json' \
      -d "{\"script\":\"$1\",\"args\":[]}" | python3 -c "import sys,json; print(json.load(sys.stdin)['value'])"
    ;;

  cycle)
    # Full cycle: stop, build, start in background, wait for ready, test
    $0 stop
    sleep 1
    $0 build
    $0 start &
    echo "Waiting for WebDriver server..."
    for i in $(seq 1 30); do
      if curl -s "http://localhost:$PORT/status" >/dev/null 2>&1; then
        echo "Server ready"
        break
      fi
      sleep 1
    done
    $0 test "${@:2}"
    ;;

  help|*)
    echo "Usage: ./e2e/dev.sh <command> [args...]"
    echo ""
    echo "Commands:"
    echo "  build       Rebuild Rust binary (incremental, embeds frontend)"
    echo "  build-full  Full rebuild (frontend + sidecars + Rust)"
    echo "  start       Start app with WebDriver server"
    echo "  stop        Stop the running app"
    echo "  restart     Stop + start"
    echo "  test [spec] Run E2E tests (default: notebook-execution)"
    echo "  status      Check if WebDriver server is running"
    echo "  session     Create a session and print ID"
    echo "  exec 'js'   Execute JS in the app"
    echo "  cycle       Build + start + test in one shot"
    echo "  help        Show this help"
    ;;
esac
