"""runtimed - Python toolkit for Jupyter runtimes."""

from importlib.metadata import PackageNotFoundError, version

from runtimed._sidecar import BridgedSidecar, Sidecar, sidecar

__all__ = ["BridgedSidecar", "Sidecar", "sidecar"]
try:
    __version__ = version("runtimed")
except PackageNotFoundError:
    __version__ = "0.0.0-dev"
