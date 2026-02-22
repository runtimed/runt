#!/bin/bash
# E2E development helper — wraps common operations under one script
# Usage: ./e2e/dev.sh <command> [args...]
set -e

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BINARY="$PROJECT_ROOT/target/debug/notebook"

# Source .env for default config (port, etc.)
if [ -f "$PROJECT_ROOT/e2e/.env" ]; then
  set -a; source "$PROJECT_ROOT/e2e/.env"; set +a
fi

PORT="${WEBDRIVER_PORT:-${CONDUCTOR_PORT:-${PORT:-4444}}}"

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
    # Stop all processes listening on $PORT (safe — won't kill other notebook instances)
    PIDS=$(lsof -ti :"$PORT" 2>/dev/null || true)
    if [ -n "$PIDS" ]; then
      echo "$PIDS" | xargs kill 2>/dev/null && echo "Stopped processes on port $PORT" || echo "Failed to stop some processes"
    else
      echo "No process listening on port $PORT"
    fi
    ;;

  restart)
    # Stop + start
    $0 stop
    sleep 1
    $0 start
    ;;

  test)
    # Run E2E tests: ./e2e/dev.sh test [spec|all]
    #   no args  → notebook-execution only (quick smoke test)
    #   all      → all non-fixture specs
    #   <path>   → specific spec file
    cd "$PROJECT_ROOT"
    if [ "$2" = "all" ]; then
      WEBDRIVER_PORT="$PORT" pnpm exec wdio run e2e/wdio.conf.js
    elif [ -n "$2" ]; then
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

  test-fixture)
    # Run a single fixture test with a fresh app instance
    # Usage: ./e2e/dev.sh test-fixture <notebook-path> <spec-file>
    NOTEBOOK="$2"
    SPEC="$3"
    if [ -z "$NOTEBOOK" ] || [ -z "$SPEC" ]; then
      echo "Usage: ./e2e/dev.sh test-fixture <notebook-path> <spec-file>"
      exit 1
    fi
    cd "$PROJECT_ROOT"
    $0 stop 2>/dev/null || true
    sleep 1
    echo "Starting notebook with fixture: $NOTEBOOK"
    RUST_LOG="${RUST_LOG:-info}" "$BINARY" --webdriver-port "$PORT" "$NOTEBOOK" &
    echo "Waiting for WebDriver server..."
    for i in $(seq 1 30); do
      if curl -s "http://localhost:$PORT/status" >/dev/null 2>&1; then
        echo "Server ready"
        break
      fi
      sleep 1
    done
    TEST_EXIT=0
    E2E_SPEC="$SPEC" WEBDRIVER_PORT="$PORT" pnpm exec wdio run e2e/wdio.conf.js || TEST_EXIT=$?
    $0 stop 2>/dev/null || true
    exit $TEST_EXIT
    ;;

  test-fixtures)
    # Run all fixture-specific E2E tests (each gets a fresh app instance)
    cd "$PROJECT_ROOT"
    FAIL=0

    $0 test-fixture \
      crates/notebook/fixtures/audit-test/1-vanilla.ipynb \
      e2e/specs/vanilla-startup.spec.js || FAIL=1

    $0 test-fixture \
      crates/notebook/fixtures/audit-test/2-uv-inline.ipynb \
      e2e/specs/uv-inline-deps.spec.js || FAIL=1

    $0 test-fixture \
      crates/notebook/fixtures/audit-test/3-conda-inline.ipynb \
      e2e/specs/conda-inline-deps.spec.js || FAIL=1

    $0 test-fixture \
      crates/notebook/fixtures/audit-test/4-both-deps.ipynb \
      e2e/specs/both-deps-panel.spec.js || FAIL=1

    $0 test-fixture \
      crates/notebook/fixtures/audit-test/pyproject-project/5-pyproject.ipynb \
      e2e/specs/pyproject-startup.spec.js || FAIL=1

    $0 test-fixture \
      crates/notebook/fixtures/audit-test/pixi-project/6-pixi.ipynb \
      e2e/specs/pixi-env-detection.spec.js || FAIL=1

    $0 test-fixture \
      crates/notebook/fixtures/audit-test/conda-env-project/7-environment-yml.ipynb \
      e2e/specs/environment-yml-detection.spec.js || FAIL=1

    exit $FAIL
    ;;

  help|*)
    echo "Usage: ./e2e/dev.sh <command> [args...]"
    echo ""
    echo "Commands:"
    echo "  build              Rebuild Rust binary (incremental, embeds frontend)"
    echo "  build-full         Full rebuild (frontend + sidecars + Rust)"
    echo "  start              Start app with WebDriver server"
    echo "  stop               Stop the running app"
    echo "  restart            Stop + start"
    echo "  test [spec]        Run E2E tests (default: notebook-execution)"
    echo "  test-fixture <nb> <spec>  Run a fixture test (fresh app per test)"
    echo "  test-fixtures      Run all fixture tests"
    echo "  status             Check if WebDriver server is running"
    echo "  session            Create a session and print ID"
    echo "  exec 'js'          Execute JS in the app"
    echo "  cycle              Build + start + test in one shot"
    echo "  help               Show this help"
    ;;
esac
