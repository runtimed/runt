import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  getBootstrapPackages,
  getCacheConfig,
  getCacheDir,
  getEssentialPackages,
  getOnDemandPackages,
  getPreloadPackages,
  isFirstRun,
} from "../src/cache-utils.ts";

Deno.test("getCacheDir", () => {
  const cacheDir = getCacheDir();
  assertEquals(typeof cacheDir, "string");
  // Should end with .runt/pyodide-cache regardless of home directory
  assertEquals(cacheDir.endsWith("/.runt/pyodide-cache"), true);
});

Deno.test("getCacheConfig", () => {
  const config = getCacheConfig();
  assertEquals(typeof config, "object");
  assertExists(config.packageCacheDir);
  assertEquals(config.packageCacheDir, getCacheDir());
});

Deno.test("getEssentialPackages", () => {
  const packages = getEssentialPackages();

  // Basic structure checks
  assertEquals(Array.isArray(packages), true);
  assertEquals(packages.length > 0, true);

  // Check that all entries are non-empty strings
  for (const pkg of packages) {
    assertEquals(typeof pkg, "string");
    assertEquals(pkg.length > 0, true);
  }

  // Check for core packages that should be included
  const corePackages = [
    "numpy",
    "pandas",
    "matplotlib",
    "ipython",
    "scipy",
    "requests",
    "micropip",
  ];

  for (const corePackage of corePackages) {
    assertEquals(
      packages.includes(corePackage),
      true,
      `Essential packages should include ${corePackage}`,
    );
  }

  // Check for no duplicates
  const uniquePackages = [...new Set(packages)];
  assertEquals(
    packages.length,
    uniquePackages.length,
    "Should not have duplicate packages",
  );
});

Deno.test("getPreloadPackages", () => {
  const preloadPackages = getPreloadPackages();
  const essentialPackages = getEssentialPackages();

  // Basic structure checks
  assertEquals(Array.isArray(preloadPackages), true);
  assertEquals(preloadPackages.length > 0, true);

  // All entries should be non-empty strings
  for (const pkg of preloadPackages) {
    assertEquals(typeof pkg, "string");
    assertEquals(pkg.length > 0, true);
  }

  // Preload should be a subset of essential packages
  assertEquals(preloadPackages.length <= essentialPackages.length, true);

  for (const pkg of preloadPackages) {
    assertEquals(
      essentialPackages.includes(pkg),
      true,
      `Preload package ${pkg} should be in essential packages`,
    );
  }

  // Should include core scientific packages
  const expectedPreload = ["numpy", "pandas", "matplotlib"];
  for (const pkg of expectedPreload) {
    assertEquals(
      preloadPackages.includes(pkg),
      true,
      `Preload should include ${pkg}`,
    );
  }

  // Check for no duplicates
  const uniquePackages = [...new Set(preloadPackages)];
  assertEquals(
    preloadPackages.length,
    uniquePackages.length,
    "Should not have duplicate packages",
  );
});

Deno.test("getOnDemandPackages", () => {
  const onDemandPackages = getOnDemandPackages();

  // Basic structure checks
  assertEquals(Array.isArray(onDemandPackages), true);
  assertEquals(onDemandPackages.length > 0, true);

  // All entries should be non-empty strings
  for (const pkg of onDemandPackages) {
    assertEquals(typeof pkg, "string");
    assertEquals(pkg.length > 0, true);
  }

  // Should include some expected packages
  const expectedOnDemand = ["polars", "duckdb", "bokeh"];
  for (const pkg of expectedOnDemand) {
    assertEquals(
      onDemandPackages.includes(pkg),
      true,
      `On-demand should include ${pkg}`,
    );
  }

  // Check for no duplicates
  const uniquePackages = [...new Set(onDemandPackages)];
  assertEquals(
    onDemandPackages.length,
    uniquePackages.length,
    "Should not have duplicate packages",
  );
});

Deno.test("getBootstrapPackages", () => {
  const bootstrapPackages = getBootstrapPackages();

  // Basic structure checks
  assertEquals(Array.isArray(bootstrapPackages), true);
  assertEquals(bootstrapPackages.length > 0, true);

  // All entries should be non-empty strings
  for (const pkg of bootstrapPackages) {
    assertEquals(typeof pkg, "string");
    assertEquals(pkg.length > 0, true);
  }

  // Should include core bootstrap packages
  assertEquals(
    bootstrapPackages.includes("micropip"),
    true,
    "Bootstrap should include micropip",
  );
  assertEquals(
    bootstrapPackages.includes("ipython"),
    true,
    "Bootstrap should include ipython",
  );
  assertEquals(
    bootstrapPackages.includes("matplotlib"),
    true,
    "Bootstrap should include matplotlib",
  );

  // Should be minimal - only essential packages for IPython setup
  assertEquals(
    bootstrapPackages.length <= 5,
    true,
    "Bootstrap should be minimal (≤5 packages)",
  );

  // Check for no duplicates
  const uniquePackages = [...new Set(bootstrapPackages)];
  assertEquals(
    bootstrapPackages.length,
    uniquePackages.length,
    "Should not have duplicate packages",
  );

  // Bootstrap packages should be subset of essential packages
  const essentialPackages = getEssentialPackages();
  for (const pkg of bootstrapPackages) {
    assertEquals(
      essentialPackages.includes(pkg),
      true,
      `Bootstrap package ${pkg} should be in essential packages`,
    );
  }
});

Deno.test("isFirstRun", () => {
  const firstRun = isFirstRun();

  // Should return a boolean
  assertEquals(typeof firstRun, "boolean");

  // On CI or clean environment, this is likely true
  // But we can't make assumptions about the test environment
  // Just verify it executes without error
});

Deno.test("package categorization consistency", () => {
  const essential = getEssentialPackages();
  const preload = getPreloadPackages();
  const onDemand = getOnDemandPackages();

  // Preload should be subset of essential
  for (const pkg of preload) {
    assertEquals(
      essential.includes(pkg),
      true,
      `Preload package ${pkg} should be in essential packages`,
    );
  }

  // On-demand should be subset of essential
  for (const pkg of onDemand) {
    assertEquals(
      essential.includes(pkg),
      true,
      `On-demand package ${pkg} should be in essential packages`,
    );
  }

  // Essential should contain all preload + on-demand packages
  const combinedPackages = [...preload, ...onDemand];
  for (const pkg of combinedPackages) {
    assertEquals(
      essential.includes(pkg),
      true,
      `Essential should contain ${pkg} from preload or on-demand`,
    );
  }
});

Deno.test("package lists have expected sizes", () => {
  const essential = getEssentialPackages();
  const preload = getPreloadPackages();
  const onDemand = getOnDemandPackages();

  // Essential should be largest
  assertEquals(essential.length >= preload.length, true);
  assertEquals(essential.length >= onDemand.length, true);

  // Should have reasonable sizes (not empty, not too large)
  assertEquals(
    essential.length >= 10,
    true,
    "Essential should have at least 10 packages",
  );
  assertEquals(
    essential.length <= 50,
    true,
    "Essential should not exceed 50 packages",
  );

  assertEquals(
    preload.length >= 5,
    true,
    "Preload should have at least 5 packages",
  );
  assertEquals(
    preload.length <= 15,
    true,
    "Preload should not exceed 15 packages",
  );

  assertEquals(
    onDemand.length >= 5,
    true,
    "On-demand should have at least 5 packages",
  );
  assertEquals(
    onDemand.length <= 25,
    true,
    "On-demand should not exceed 25 packages",
  );
});
