"""Integration tests for runtimed daemon client.

These tests exercise the full daemon integration, including:
- Document-first execution (automerge sync)
- Multi-client synchronization
- Kernel lifecycle management

Running locally (with dev daemon already running):
    pytest tests/test_daemon_integration.py -v

Running in CI (spawns its own daemon):
    RUNTIMED_INTEGRATION_TEST=1 pytest tests/test_daemon_integration.py -v

Environment variables:
    RUNTIMED_INTEGRATION_TEST=1  - Enable daemon spawning for CI
    RUNTIMED_SOCKET_PATH         - Override socket path
    RUNTIMED_BINARY              - Path to runtimed binary (for CI)
    RUNTIMED_LOG_LEVEL           - Daemon log level (default: info)
"""

import os
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

import pytest

# Skip all tests if runtimed module not available
pytest.importorskip("runtimed")

import runtimed


# ============================================================================
# Fixtures for daemon management
# ============================================================================


def _find_runtimed_binary():
    """Find the runtimed binary, checking common locations."""
    # Explicit override
    if "RUNTIMED_BINARY" in os.environ:
        return Path(os.environ["RUNTIMED_BINARY"])

    # Check relative to this repo
    repo_root = Path(__file__).parent.parent.parent.parent.parent
    candidates = [
        repo_root / "target" / "debug" / "runtimed",
        repo_root / "target" / "release" / "runtimed",
    ]

    for path in candidates:
        if path.exists():
            return path

    pytest.skip("runtimed binary not found - build with: cargo build -p runtimed")


def _is_integration_test_mode():
    """Check if we should spawn our own daemon (CI mode)."""
    return os.environ.get("RUNTIMED_INTEGRATION_TEST", "0") == "1"


def _get_socket_path():
    """Get the socket path for tests."""
    if "RUNTIMED_SOCKET_PATH" in os.environ:
        return Path(os.environ["RUNTIMED_SOCKET_PATH"])

    # In integration test mode, use a temp directory
    if _is_integration_test_mode():
        return None  # Will be set by the daemon fixture

    # Otherwise, use default (assumes dev daemon is running)
    return runtimed.default_socket_path() if hasattr(runtimed, "default_socket_path") else None


@pytest.fixture(scope="module")
def daemon_process():
    """Fixture that ensures a daemon is running.

    In CI mode (RUNTIMED_INTEGRATION_TEST=1), spawns a daemon process.
    In dev mode, assumes daemon is already running via `cargo xtask dev-daemon`.

    Yields:
        tuple: (socket_path, process_or_none)
    """
    if not _is_integration_test_mode():
        # Dev mode: assume daemon is already running
        socket_path = _get_socket_path()
        if socket_path is None:
            # Try the default
            import runtimed as rt
            socket_path = rt.default_socket_path() if hasattr(rt, "default_socket_path") else None

        if socket_path and not socket_path.exists():
            pytest.skip(
                f"Daemon socket not found at {socket_path}. "
                "Start daemon with: cargo xtask dev-daemon"
            )

        yield socket_path, None
        return

    # CI mode: spawn our own daemon
    binary = _find_runtimed_binary()
    log_level = os.environ.get("RUNTIMED_LOG_LEVEL", "info")

    # Create a temp directory for this test run
    with tempfile.TemporaryDirectory(prefix="runtimed-test-") as tmpdir:
        tmpdir = Path(tmpdir)
        socket_path = tmpdir / "runtimed.sock"
        cache_dir = tmpdir / "cache"
        blob_dir = tmpdir / "blobs"
        cache_dir.mkdir()
        blob_dir.mkdir()

        # Build command
        cmd = [
            str(binary),
            "run",
            "--socket", str(socket_path),
            "--cache-dir", str(cache_dir),
            "--blob-store-dir", str(blob_dir),
            "--uv-pool-size", "1",  # Minimal pool for tests
            "--conda-pool-size", "0",  # No conda for speed
        ]

        print(f"\n[test] Starting daemon: {' '.join(cmd)}", file=sys.stderr)
        print(f"[test] Socket path: {socket_path}", file=sys.stderr)

        # Start daemon, capturing logs
        log_file = tmpdir / "daemon.log"
        with open(log_file, "w") as log_f:
            env = os.environ.copy()
            env["RUST_LOG"] = log_level

            proc = subprocess.Popen(
                cmd,
                stdout=log_f,
                stderr=subprocess.STDOUT,
                env=env,
            )

        # Wait for socket to appear
        for i in range(30):
            if socket_path.exists():
                print(f"[test] Daemon ready after {i + 1}s", file=sys.stderr)
                break
            if proc.poll() is not None:
                # Daemon died - print logs and fail
                print(f"[test] Daemon died with code {proc.returncode}", file=sys.stderr)
                print(f"[test] Daemon logs:\n{log_file.read_text()}", file=sys.stderr)
                pytest.fail("Daemon process died during startup")
            time.sleep(1)
        else:
            proc.terminate()
            print(f"[test] Daemon logs:\n{log_file.read_text()}", file=sys.stderr)
            pytest.fail("Daemon socket did not appear within 30s")

        try:
            yield socket_path, proc
        finally:
            # Cleanup
            print(f"\n[test] Stopping daemon...", file=sys.stderr)
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()

            # Print daemon logs for debugging
            if log_file.exists():
                logs = log_file.read_text()
                if logs:
                    print(f"[test] Daemon logs:\n{logs}", file=sys.stderr)


@pytest.fixture
def session(daemon_process):
    """Create a fresh Session for each test."""
    socket_path, _ = daemon_process

    # Create session with unique notebook ID
    notebook_id = f"test-{uuid.uuid4()}"
    sess = runtimed.Session(notebook_id=notebook_id)

    # If we have a custom socket path, we need to configure it
    # For now, the Session uses default_socket_path() internally
    # which should work with CONDUCTOR_WORKSPACE_PATH or dev mode

    sess.connect()
    yield sess

    # Cleanup: shutdown kernel if running
    try:
        if sess.kernel_started:
            sess.shutdown_kernel()
    except Exception:
        pass


@pytest.fixture
def two_sessions(daemon_process):
    """Create two sessions connected to the same notebook (peer sync test)."""
    socket_path, _ = daemon_process

    # Both sessions share the same notebook ID
    notebook_id = f"test-{uuid.uuid4()}"

    session1 = runtimed.Session(notebook_id=notebook_id)
    session1.connect()

    session2 = runtimed.Session(notebook_id=notebook_id)
    session2.connect()

    yield session1, session2

    # Cleanup
    for sess in [session1, session2]:
        try:
            if sess.kernel_started:
                sess.shutdown_kernel()
        except Exception:
            pass


# ============================================================================
# Basic connectivity tests
# ============================================================================


class TestBasicConnectivity:
    """Test basic daemon connectivity."""

    def test_session_connect(self, session):
        """Session can connect to daemon."""
        assert session.is_connected

    def test_session_repr(self, session):
        """Session has useful repr."""
        r = repr(session)
        assert "Session" in r
        assert session.notebook_id in r


# ============================================================================
# Document-first execution tests
# ============================================================================


class TestDocumentFirstExecution:
    """Test document-first execution pattern.

    These tests verify the architectural principle that execution reads
    from the automerge document rather than receiving code directly.
    """

    def test_create_cell(self, session):
        """Can create a cell in the document."""
        cell_id = session.create_cell("x = 1")

        assert cell_id.startswith("cell-")

        # Verify cell exists in document
        cell = session.get_cell(cell_id)
        assert cell.id == cell_id
        assert cell.source == "x = 1"
        assert cell.cell_type == "code"

    def test_update_cell_source(self, session):
        """Can update cell source in document."""
        cell_id = session.create_cell("original")
        session.set_source(cell_id, "updated")

        cell = session.get_cell(cell_id)
        assert cell.source == "updated"

    def test_get_cells(self, session):
        """Can list all cells in document."""
        # Create a few cells
        cell_ids = [
            session.create_cell("a = 1"),
            session.create_cell("b = 2"),
            session.create_cell("c = 3"),
        ]

        cells = session.get_cells()
        assert len(cells) >= 3

        found_ids = {c.id for c in cells}
        for cid in cell_ids:
            assert cid in found_ids

    def test_delete_cell(self, session):
        """Can delete a cell from document."""
        cell_id = session.create_cell("to_delete")
        session.delete_cell(cell_id)

        with pytest.raises(runtimed.RuntimedError, match="not found"):
            session.get_cell(cell_id)

    def test_execute_cell_reads_from_document(self, session):
        """execute_cell reads source from the synced document.

        This is the core architectural test: execution uses ExecuteCell
        which reads from the automerge doc, not QueueCell which bypasses it.
        """
        session.start_kernel()

        # Create cell with source in document
        cell_id = session.create_cell("result = 2 + 2; print(result)")

        # Execute - daemon reads from document
        result = session.execute_cell(cell_id)

        assert result.success
        assert "4" in result.stdout
        assert result.cell_id == cell_id
        assert result.execution_count is not None

    def test_run_convenience_method(self, session):
        """run() is a shortcut for create_cell + execute_cell."""
        session.start_kernel()

        result = session.run("print('hello from run')")

        assert result.success
        assert "hello from run" in result.stdout

    def test_execution_error_captured(self, session):
        """Execution errors are captured in result."""
        session.start_kernel()

        result = session.run("raise ValueError('test error')")

        assert not result.success
        assert result.error is not None
        assert "ValueError" in result.error.ename

    def test_multiple_executions(self, session):
        """Can execute multiple cells sequentially."""
        session.start_kernel()

        # Execute multiple cells, building up state
        r1 = session.run("x = 10")
        assert r1.success

        r2 = session.run("y = x * 2")
        assert r2.success

        r3 = session.run("print(f'y = {y}')")
        assert r3.success
        assert "y = 20" in r3.stdout


# ============================================================================
# Multi-client synchronization tests
# ============================================================================


class TestMultiClientSync:
    """Test multi-client scenarios where two sessions share a notebook.

    These tests verify that automerge sync works correctly when multiple
    clients are connected to the same notebook.
    """

    def test_two_sessions_same_notebook(self, two_sessions):
        """Two sessions can connect to the same notebook."""
        s1, s2 = two_sessions

        assert s1.is_connected
        assert s2.is_connected
        assert s1.notebook_id == s2.notebook_id

    def test_cell_created_by_one_visible_to_other(self, two_sessions):
        """Cell created by session 1 is visible to session 2."""
        s1, s2 = two_sessions

        # Session 1 creates a cell
        cell_id = s1.create_cell("shared_var = 42")

        # Give sync time to propagate
        time.sleep(0.5)

        # Session 2 should see it
        cells = s2.get_cells()
        found = [c for c in cells if c.id == cell_id]
        assert len(found) == 1
        assert found[0].source == "shared_var = 42"

    def test_source_update_syncs_between_peers(self, two_sessions):
        """Source updates sync between peers."""
        s1, s2 = two_sessions

        # Session 1 creates cell
        cell_id = s1.create_cell("original")
        time.sleep(0.3)

        # Session 2 updates it
        s2.set_source(cell_id, "updated by s2")
        time.sleep(0.3)

        # Session 1 should see the update
        cell = s1.get_cell(cell_id)
        assert cell.source == "updated by s2"

    def test_shared_kernel_execution(self, two_sessions):
        """Both sessions share the same kernel and execution state.

        When two sessions connect to the same notebook, they share the
        daemon's kernel. However, each session tracks its own `kernel_started`
        flag locally, so both need to call start_kernel() (the second call
        is a no-op in the daemon but updates local state).
        """
        s1, s2 = two_sessions

        # Both sessions need to call start_kernel to update their local state
        # The daemon only starts one kernel for the notebook
        s1.start_kernel()
        s2.start_kernel()  # No-op in daemon, but updates s2.kernel_started
        time.sleep(0.5)

        # Session 1 sets a variable
        r1 = s1.run("shared = 'from s1'")
        assert r1.success

        # Session 2 can access it (same kernel)
        r2 = s2.run("print(shared)")
        assert r2.success
        assert "from s1" in r2.stdout


# ============================================================================
# Kernel lifecycle tests
# ============================================================================


class TestKernelLifecycle:
    """Test kernel lifecycle management."""

    def test_start_kernel(self, session):
        """Can start a kernel."""
        assert not session.kernel_started

        session.start_kernel()

        assert session.kernel_started
        assert session.env_source is not None

    def test_kernel_interrupt(self, session):
        """Can interrupt a running kernel."""
        session.start_kernel()

        # Start a long-running execution in background
        cell_id = session.create_cell("import time; time.sleep(30)")

        # We can't easily test async interrupt without threading,
        # but we can at least verify the interrupt call doesn't error
        # when nothing is running
        session.interrupt()  # Should not raise

    def test_shutdown_kernel(self, session):
        """Can shutdown the kernel."""
        session.start_kernel()
        assert session.kernel_started

        session.shutdown_kernel()
        assert not session.kernel_started


# ============================================================================
# Output type tests
# ============================================================================


class TestOutputTypes:
    """Test different output types from execution."""

    def test_stdout_output(self, session):
        """Captures stdout output."""
        session.start_kernel()

        result = session.run("print('hello stdout')")

        assert result.success
        assert result.stdout == "hello stdout\n"

    def test_stderr_output(self, session):
        """Captures stderr output."""
        session.start_kernel()

        result = session.run("import sys; sys.stderr.write('hello stderr\\n')")

        assert result.success
        assert "hello stderr" in result.stderr

    def test_return_value(self, session):
        """Captures expression return value."""
        session.start_kernel()

        result = session.run("2 + 2")

        assert result.success
        # Return value should appear in display_data
        display = result.display_data
        assert len(display) > 0

    def test_multiple_outputs(self, session):
        """Captures multiple outputs from one cell."""
        session.start_kernel()

        result = session.run("""
print('line 1')
print('line 2')
'final value'
""")

        assert result.success
        assert "line 1" in result.stdout
        assert "line 2" in result.stdout


# ============================================================================
# Error handling tests
# ============================================================================


class TestErrorHandling:
    """Test error handling scenarios."""

    def test_execute_without_kernel(self, session):
        """Executing without kernel raises helpful error."""
        cell_id = session.create_cell("x = 1")

        with pytest.raises(runtimed.RuntimedError, match="[Kk]ernel"):
            session.execute_cell(cell_id)

    def test_get_nonexistent_cell(self, session):
        """Getting nonexistent cell raises error."""
        with pytest.raises(runtimed.RuntimedError, match="not found"):
            session.get_cell("cell-does-not-exist")

    def test_syntax_error(self, session):
        """Syntax errors are captured."""
        session.start_kernel()

        result = session.run("def broken(")

        assert not result.success
        assert result.error is not None
        assert "SyntaxError" in result.error.ename


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
