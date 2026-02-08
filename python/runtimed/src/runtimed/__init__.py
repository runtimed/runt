"""runtimed - Python toolkit for Jupyter runtimes."""

from importlib.metadata import version

from runtimed._sidecar import Sidecar, sidecar

__all__ = ["Sidecar", "sidecar"]
__version__ = version("runtimed")
