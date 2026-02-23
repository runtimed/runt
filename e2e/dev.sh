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

# --- Pre-flight checks ---

require_binary() {
  if [ ! -f "$BINARY" ]; then
    echo "Error: E2E binary not found at $BINARY"
    echo ""
    echo "Build it first:"
    echo "  ./e2e/dev.sh build       # incremental (skips frontend rebuild)"
    echo "  ./e2e/dev.sh build-full  # full rebuild (frontend + sidecars + Rust)"
    echo ""
    echo "Note: If you changed frontend code (data-testid, components, etc.),"
    echo "use build-full or run 'pnpm --dir apps/notebook build' before build."
    exit 1
  fi
}

require_running() {
  if ! curl -s "http://localhost:$PORT/status" >/dev/null 2>&1; then
    echo "Error: No WebDriver server on port $PORT"
    echo ""
    echo "The app must be running for 'test' commands. Either:"
    echo "  ./e2e/dev.sh start       # start in foreground (Ctrl+C to stop)"
    echo "  ./e2e/dev.sh cycle       # build + start + test in one shot"
    echo ""
    echo "Or use test-fixture which starts its own app instance:"
    echo "  ./e2e/dev.sh test-fixture <notebook-path> <spec-file>"
    exit 1
  fi
}

wait_for_server() {
  local max_wait="${1:-30}"
  echo "Waiting for WebDriver server on port $PORT..."
  for i in $(seq 1 "$max_wait"); do
    if curl -s "http://localhost:$PORT/status" >/dev/null 2>&1; then
      echo "Server ready (${i}s)"
      return 0
    fi
    sleep 1
  done
  echo "Error: WebDriver server did not start within ${max_wait}s"
  echo "Check the app logs for errors."
  return 1
}

case "${1:-help}" in
  build)
    # Rebuild with WebDriver support using cargo tauri build (embeds frontend)
    cd "$PROJECT_ROOT"
    cargo tauri build --debug --no-bundle --features webdriver-test \
      --config '{"build":{"beforeBuildCommand":""}}'
    echo ""
    echo "Binary ready: $BINARY"
    echo "Note: This skipped the frontend build. If you changed React components,"
    echo "run 'pnpm --dir apps/notebook build' first or use './e2e/dev.sh build-full'."
    ;;

  build-full)
    # Full rebuild including frontend + sidecars
    cd "$PROJECT_ROOT"
    cargo xtask build-e2e
    ;;

  start)
    # Start the app with WebDriver server
    require_binary
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
    require_running
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
    wait_for_server 30
    $0 test "${@:2}"
    ;;

  test-fixture)
    # Run a single fixture test with a fresh app instance
    # Usage: ./e2e/dev.sh test-fixture <notebook-path> <spec-file>
    NOTEBOOK="$2"
    SPEC="$3"
    if [ -z "$NOTEBOOK" ] || [ -z "$SPEC" ]; then
      echo "Usage: ./e2e/dev.sh test-fixture <notebook-path> <spec-file>"
      echo ""
      echo "Example:"
      echo "  ./e2e/dev.sh test-fixture \\"
      echo "    crates/notebook/fixtures/audit-test/1-vanilla.ipynb \\"
      echo "    e2e/specs/vanilla-startup.spec.js"
      echo ""
      echo "Run all fixture tests:  ./e2e/dev.sh test-fixtures"
      exit 1
    fi
    cd "$PROJECT_ROOT"
    require_binary
    if [ ! -f "$NOTEBOOK" ]; then
      echo "Error: Notebook file not found: $NOTEBOOK"
      echo ""
      echo "Available fixtures:"
      ls crates/notebook/fixtures/audit-test/*.ipynb \
         crates/notebook/fixtures/audit-test/*/*.ipynb 2>/dev/null | sed 's/^/  /'
      exit 1
    fi
    if [ ! -f "$SPEC" ]; then
      echo "Error: Spec file not found: $SPEC"
      echo ""
      echo "Available specs:"
      ls e2e/specs/*.spec.js 2>/dev/null | sed 's/^/  /'
      exit 1
    fi
    $0 stop 2>/dev/null || true
    sleep 1
    echo "Starting notebook with fixture: $NOTEBOOK"
    RUST_LOG="${RUST_LOG:-info}" "$BINARY" --webdriver-port "$PORT" "$NOTEBOOK" &
    wait_for_server 30
    TEST_EXIT=0
    E2E_SPEC="$SPEC" WEBDRIVER_PORT="$PORT" pnpm exec wdio run e2e/wdio.conf.js || TEST_EXIT=$?
    $0 stop 2>/dev/null || true
    exit $TEST_EXIT
    ;;

  test-fixtures)
    # Run all fixture-specific E2E tests (each gets a fresh app instance)
    cd "$PROJECT_ROOT"
    require_binary
    FAIL=0
    PASSED=0
    TOTAL=0
    FAILED_SPECS=""

    run_fixture() {
      local notebook="$1" spec="$2"
      TOTAL=$((TOTAL + 1))
      local spec_name
      spec_name=$(basename "$spec")
      echo ""
      echo "━━━ [$TOTAL] $spec_name ━━━"
      if $0 test-fixture "$notebook" "$spec"; then
        PASSED=$((PASSED + 1))
      else
        FAIL=1
        FAILED_SPECS="$FAILED_SPECS  - $spec_name\n"
      fi
    }

    run_fixture crates/notebook/fixtures/audit-test/1-vanilla.ipynb \
                e2e/specs/vanilla-startup.spec.js

    run_fixture crates/notebook/fixtures/audit-test/2-uv-inline.ipynb \
                e2e/specs/uv-inline-deps.spec.js

    run_fixture crates/notebook/fixtures/audit-test/3-conda-inline.ipynb \
                e2e/specs/conda-inline-deps.spec.js

    run_fixture crates/notebook/fixtures/audit-test/4-both-deps.ipynb \
                e2e/specs/both-deps-panel.spec.js

    run_fixture crates/notebook/fixtures/audit-test/pyproject-project/5-pyproject.ipynb \
                e2e/specs/pyproject-startup.spec.js

    run_fixture crates/notebook/fixtures/audit-test/pixi-project/6-pixi.ipynb \
                e2e/specs/pixi-env-detection.spec.js

    run_fixture crates/notebook/fixtures/audit-test/conda-env-project/7-environment-yml.ipynb \
                e2e/specs/environment-yml-detection.spec.js

    run_fixture crates/notebook/fixtures/audit-test/2-uv-inline.ipynb \
                e2e/specs/deps-panel.spec.js

    run_fixture crates/notebook/fixtures/audit-test/3-conda-inline.ipynb \
                e2e/specs/conda-deps-panel.spec.js

    run_fixture crates/notebook/fixtures/audit-test/2-uv-inline.ipynb \
                e2e/specs/trust-decline.spec.js

    run_fixture crates/notebook/fixtures/audit-test/8-multi-cell.ipynb \
                e2e/specs/run-all-cells.spec.js

    run_fixture crates/notebook/fixtures/audit-test/10-run-all-error.ipynb \
                e2e/specs/run-all-error-stops.spec.js

    run_fixture crates/notebook/fixtures/audit-test/9-html-output.ipynb \
                e2e/specs/iframe-isolation.spec.js

    run_fixture crates/notebook/fixtures/audit-test/1-vanilla.ipynb \
                e2e/specs/settings-panel.spec.js

    run_fixture crates/notebook/fixtures/audit-test/11-rich-outputs.ipynb \
                e2e/specs/rich-outputs.spec.js

    run_fixture crates/notebook/fixtures/audit-test/12-error-outputs.ipynb \
                e2e/specs/error-handling.spec.js

    # Summary
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Fixture tests: $PASSED/$TOTAL passed"
    if [ $FAIL -ne 0 ]; then
      echo ""
      echo "Failed:"
      echo -e "$FAILED_SPECS"
    fi
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    $0 test-fixture \
      crates/notebook/fixtures/audit-test/10-deno.ipynb \
      e2e/specs/deno-runtime.spec.js || FAIL=1

    $0 test-fixture \
      crates/notebook/fixtures/audit-test/1-vanilla.ipynb \
      e2e/specs/save-dirty-state.spec.js || FAIL=1

    exit $FAIL
    ;;

  help|*)
    echo "Usage: ./e2e/dev.sh <command> [args...]"
    echo ""
    echo "Quick start:"
    echo "  ./e2e/dev.sh build-full              # first time: full build"
    echo "  ./e2e/dev.sh test-fixture <nb> <spec> # run one fixture test"
    echo "  ./e2e/dev.sh test-fixtures            # run all fixture tests"
    echo ""
    echo "Build:"
    echo "  build              Rebuild Rust binary (skips frontend — fast)"
    echo "  build-full         Full rebuild (frontend + sidecars + Rust)"
    echo ""
    echo "Run:"
    echo "  start              Start app with WebDriver server (foreground)"
    echo "  stop               Stop the running app"
    echo "  restart            Stop + start"
    echo "  cycle              Build + start + test in one shot"
    echo ""
    echo "Test:"
    echo "  test [spec|all]    Run E2E tests (requires app already running)"
    echo "  test-fixture <nb> <spec>  Run a fixture test (starts fresh app)"
    echo "  test-fixtures      Run all fixture tests with summary"
    echo ""
    echo "Debug:"
    echo "  status             Check if WebDriver server is running"
    echo "  session            Create a session and print ID"
    echo "  exec 'js'          Execute JS in the app"
    echo ""
    echo "Common patterns:"
    echo "  # Iterating on a single test:"
    echo "  ./e2e/dev.sh build   # after Rust changes (skip frontend)"
    echo "  ./e2e/dev.sh start   # leave running in one terminal"
    echo "  ./e2e/dev.sh test e2e/specs/my-test.spec.js  # in another"
    echo ""
    echo "  # Changed React components (data-testid, etc.):"
    echo "  pnpm --dir apps/notebook build   # rebuild frontend first"
    echo "  ./e2e/dev.sh build               # then rebuild Rust (embeds frontend)"
    ;;
esac
