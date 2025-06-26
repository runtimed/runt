/**
 * # Python Package Management for Pyodide
 *
 * When you start a Python runtime in the browser, you want common packages
 * like numpy and pandas ready to go. But loading 20+ packages takes time.
 *
 * This module organizes packages into groups for smart loading:
 * - Bootstrap: Minimal packages needed for IPython setup (micropip, ipython)
 * - Essential: Always loaded (numpy, pandas, matplotlib, etc.)
 * - Preload: Core packages loaded first for fast startup
 * - On-demand: Useful packages loaded as needed
 *
 * The cache directory stores downloaded packages locally so subsequent
 * notebook sessions start faster. First-run detection optimizes the initial
 * loading strategy.
 */

/**
 * Bootstrap packages - minimal set needed for IPython setup
 * These are loaded via loadPyodide's packages option for maximum efficiency
 */
export function getBootstrapPackages(): string[] {
  return ["micropip", "ipython", "matplotlib"];
}

/**
 * Essential packages loaded by default in every Python runtime
 *
 * Covers data science, visualization, and web requests - the most
 * common needs for notebook computing.
 */
export function getEssentialPackages(): string[] {
  return [
    "ipython",
    "matplotlib",
    "numpy",
    "pandas",
    "polars",
    "duckdb",
    "pyarrow",
    "requests",
    "micropip",
    "pyodide-http",
    "scipy",
    "sympy",
    "bokeh",
    "scikit-learn",
    "altair",
    "geopandas",
    "rich",
    "networkx",
    "beautifulsoup4",
    "lxml",
    "pillow",
    "statsmodels",
  ];
}

/**
 * Where Pyodide packages are cached locally for faster loading
 */
export function getCacheDir(): string {
  // Try to get home directory, fallback to local directory
  const homeDir = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || ".";
  return `${homeDir}/.runt/pyodide-cache`;
}

/**
 * Cache config object for Pyodide initialization
 */
export function getCacheConfig(): { packageCacheDir: string } {
  return {
    packageCacheDir: getCacheDir(),
  };
}

/**
 * Detect if this is a first run by checking cache directory
 */
export function isFirstRun(): boolean {
  try {
    const cacheDir = getCacheDir();
    const stat = Deno.statSync(cacheDir);
    if (!stat.isDirectory) return true;

    // Check if cache has any .whl files (Pyodide package format)
    for (const entry of Deno.readDirSync(cacheDir)) {
      if (entry.name.endsWith(".whl")) {
        return false;
      }
    }
    return true;
  } catch {
    // Cache directory doesn't exist or can't be read
    return true;
  }
}

/**
 * High-priority packages loaded first for fast startup
 *
 * These cover 80% of common use cases and load quickly.
 */
export function getPreloadPackages(): string[] {
  return [
    "ipython",
    "numpy",
    "pandas",
    "matplotlib",
    "requests",
    "micropip",
    "pyodide-http",
    "rich",
  ];
}

/**
 * Useful packages loaded as needed to avoid startup bloat
 *
 * Still part of the essential set but lower priority.
 */
export function getOnDemandPackages(): string[] {
  return [
    "scipy",
    "polars",
    "duckdb",
    "pyarrow",
    "bokeh",
    "scikit-learn",
    "altair",
    "geopandas",
    "networkx",
    "beautifulsoup4",
    "lxml",
    "pillow",
    "statsmodels",
    "sympy",
  ];
}
