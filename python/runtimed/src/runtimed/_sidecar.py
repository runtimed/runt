"""Sidecar launcher for Jupyter kernels."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Optional, Union

from runtimed._binary import find_binary


class Sidecar:
    """Handle to a running sidecar viewer process."""

    def __init__(self, process: subprocess.Popen, connection_file: Path) -> None:
        self._process = process
        self._connection_file = connection_file

    @property
    def process(self) -> subprocess.Popen:
        """The underlying subprocess."""
        return self._process

    @property
    def connection_file(self) -> Path:
        """Path to the kernel connection file."""
        return self._connection_file

    @property
    def running(self) -> bool:
        """Whether the sidecar process is still running."""
        return self._process.poll() is None

    def close(self) -> None:
        """Terminate the sidecar process."""
        self._process.terminate()

    def __repr__(self) -> str:
        status = "running" if self.running else f"exited ({self._process.returncode})"
        kernel = self._connection_file.stem
        return f"Sidecar({kernel}, {status})"


def sidecar(
    connection_file: Optional[Union[str, Path]] = None,
    *,
    quiet: bool = True,
    dump: Optional[Union[str, Path]] = None,
) -> Sidecar:
    """Launch the sidecar viewer for a running Jupyter kernel.

    When called with no arguments from within a running IPython kernel,
    automatically detects the kernel's connection file.

    Args:
        connection_file: Path to a kernel connection JSON file.
            If None, auto-detects from the running kernel using
            ipykernel.connect.get_connection_file().
        quiet: Suppress sidecar log output. Defaults to True.
        dump: Optional path to dump all Jupyter messages as JSON.

    Returns:
        A Sidecar handle for the running viewer process.

    Raises:
        RuntimeError: If connection_file is None and no running kernel
            is detected (ipykernel not available or not in a kernel).
        FileNotFoundError: If the runt binary cannot be found.
        FileNotFoundError: If the connection file does not exist.

    Example:
        In a Jupyter console or notebook cell::

            import runtimed
            s = runtimed.sidecar()

        With an explicit connection file::

            import runtimed
            s = runtimed.sidecar("/path/to/kernel-12345.json")
    """
    if connection_file is None:
        connection_file = _get_kernel_connection_file()

    connection_path = Path(connection_file)
    if not connection_path.exists():
        raise FileNotFoundError(
            f"Kernel connection file not found: {connection_path}"
        )

    runt_bin = find_binary("runt")

    cmd: list[str] = [runt_bin, "sidecar"]
    if quiet:
        cmd.append("--quiet")
    if dump is not None:
        cmd.extend(["--dump", str(dump)])
    cmd.append(str(connection_path))

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    return Sidecar(proc, connection_path)


def _get_kernel_connection_file() -> str:
    """Auto-detect the connection file for the currently running kernel."""
    try:
        from ipykernel.connect import get_connection_file
    except ImportError:
        raise RuntimeError(
            "Cannot auto-detect kernel connection file: "
            "'ipykernel' is not installed.\n"
            "Install it with: pip install ipykernel\n"
            "Or provide connection_file explicitly: "
            "runtimed.sidecar('/path/to/kernel.json')"
        ) from None

    try:
        return get_connection_file()
    except RuntimeError as e:
        raise RuntimeError(
            "Cannot auto-detect kernel connection file. "
            "Are you running inside a Jupyter kernel?\n"
            f"Original error: {e}\n"
            "You can provide connection_file explicitly: "
            "runtimed.sidecar('/path/to/kernel.json')"
        ) from e
