"""
Bootstrap utilities for Runt Runtime

This module provides utilities for bootstrapping the Python environment
with necessary packages, particularly for micropip package installation
and environment setup.
"""

import micropip


async def bootstrap_micropip_packages():
    """Bootstrap essential micropip packages for the runtime environment

    Note: this _must_ be run on start of this ipython session
    """
    try:
        # Install pydantic for the function registry system (fallback)
        await micropip.install("pydantic")
        print("Installed pydantic via micropip")

        # Install seaborn for plotting capabilities
        await micropip.install("seaborn")
        print("Installed seaborn via micropip")

    except Exception as e:
        print(f"Warning: Failed to install packages: {e}")


async def install_package(package_name: str, fallback_to_micropip: bool = True):
    """Install a single package, with optional micropip fallback

    Args:
        package_name: Name of the package to install
        fallback_to_micropip: Whether to try micropip if pyodide.loadPackage fails
    """
    try:
        # First try to load via Pyodide's package system
        import js

        pyodide = js.pyodide

        try:
            await pyodide.loadPackage(package_name)
            print(f"Loaded {package_name} via Pyodide package system")
            return True
        except Exception as pyodide_error:
            if fallback_to_micropip:
                print(
                    f"Pyodide package load failed for {package_name}: {pyodide_error}"
                )
                print(f"Trying micropip for {package_name}...")
                await micropip.install(package_name)
                print(f"Installed {package_name} via micropip")
                return True
            else:
                raise pyodide_error

    except Exception as e:
        print(f"Failed to install {package_name}: {e}")
        return False


async def install_packages(package_names: list, fail_fast: bool = False):
    """Install multiple packages

    Args:
        package_names: List of package names to install
        fail_fast: Whether to stop on first failure or continue with remaining packages
    """
    results = {}

    for package_name in package_names:
        try:
            success = await install_package(package_name)
            results[package_name] = success
            if not success and fail_fast:
                break
        except Exception as e:
            results[package_name] = False
            print(f"Error installing {package_name}: {e}")
            if fail_fast:
                break

    return results


def get_installed_packages():
    """Get information about currently installed packages"""
    try:
        import js

        pyodide = js.pyodide

        # Get packages loaded via Pyodide
        loaded_packages = pyodide.loadedPackages.to_py()

        # Get packages installed via micropip
        micropip_packages = {}
        try:
            import importlib.metadata

            for dist in importlib.metadata.distributions():
                micropip_packages[dist.metadata["Name"]] = dist.version
        except Exception as e:
            print(f"Could not get micropip package info: {e}")

        return {
            "pyodide_packages": loaded_packages,
            "micropip_packages": micropip_packages,
        }

    except Exception as e:
        print(f"Error getting package information: {e}")
        return {}


def print_package_info():
    """Print information about installed packages"""
    info = get_installed_packages()

    print("=== Package Information ===")

    if info.get("pyodide_packages"):
        print(f"\nPyodide Packages ({len(info['pyodide_packages'])}):")
        for name, source in info["pyodide_packages"].items():
            print(f"  {name}: {source}")

    if info.get("micropip_packages"):
        print(f"\nMicropip Packages ({len(info['micropip_packages'])}):")
        for name, version in info["micropip_packages"].items():
            print(f"  {name}: {version}")

    print("=" * 30)
