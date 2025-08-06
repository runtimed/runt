#!/usr/bin/env deno run --allow-read --allow-write

import { parseArgs } from "jsr:@std/cli@^1.0.0";
import { walk } from "jsr:@std/fs@^1.0.0";

interface PackageJson {
  name?: string;
  version: string;
  [key: string]: unknown;
}

interface DenoJson {
  name?: string;
  version: string;
  imports?: Record<string, string>;
  [key: string]: unknown;
}

function parseVersion(version: string): [number, number, number] {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Invalid version format: ${version}`);
  }
  return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
}

function bumpVersion(
  currentVersion: string,
  bumpType: "patch" | "minor" | "major",
): string {
  const [major, minor, patch] = parseVersion(currentVersion);

  switch (bumpType) {
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "major":
      return `${major + 1}.0.0`;
    default:
      throw new Error(`Unknown bump type: ${bumpType}`);
  }
}

function updateJsrDependencies(
  imports: Record<string, string>,
  newVersion: string,
): Record<string, string> {
  const updated = { ...imports };

  for (const [key, value] of Object.entries(updated)) {
    // Update JSR dependencies for @runt/* packages
    if (key.startsWith("@runt/") && value.startsWith("jsr:@runt/")) {
      // Replace version in format: jsr:@runt/package@^0.11.0
      updated[key] = value.replace(/@\^[\d.]+$/, `@^${newVersion}`);
    }
  }

  return updated;
}

async function findPackageFiles(): Promise<
  { denoJsonFiles: string[]; packageJsonFiles: string[] }
> {
  const denoJsonFiles: string[] = [];
  const packageJsonFiles: string[] = [];

  for await (
    const entry of walk("packages", {
      includeDirs: false,
      match: [/deno\.json$/, /package\.json$/],
    })
  ) {
    if (entry.name === "deno.json") {
      denoJsonFiles.push(entry.path);
    } else if (entry.name === "package.json") {
      packageJsonFiles.push(entry.path);
    }
  }

  return { denoJsonFiles, packageJsonFiles };
}

async function updateDenoJson(
  filePath: string,
  newVersion: string,
): Promise<void> {
  const content = await Deno.readTextFile(filePath);
  const config: DenoJson = JSON.parse(content);

  // Update version
  config.version = newVersion;

  // Update JSR dependencies if they exist
  if (config.imports) {
    config.imports = updateJsrDependencies(config.imports, newVersion);
  }

  // Write back with pretty formatting
  await Deno.writeTextFile(filePath, JSON.stringify(config, null, 2) + "\n");
  console.log(`✅ Updated ${filePath} to version ${newVersion}`);
}

async function updatePackageJson(
  filePath: string,
  newVersion: string,
): Promise<void> {
  const content = await Deno.readTextFile(filePath);
  const pkg: PackageJson = JSON.parse(content);

  // Update version
  pkg.version = newVersion;

  // Write back with pretty formatting
  await Deno.writeTextFile(filePath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`✅ Updated ${filePath} to version ${newVersion}`);
}

async function getCurrentVersion(): Promise<string> {
  // Get current version from schema package (our reference package)
  const schemaConfig = JSON.parse(
    await Deno.readTextFile("packages/schema/deno.json"),
  );
  return schemaConfig.version;
}

async function main() {
  const args = parseArgs(Deno.args, {
    alias: {
      h: "help",
      v: "version",
    },
  });

  if (args.help || args._.length === 0) {
    console.log(`
Usage: deno task publish <version|bump-type>

Examples:
  deno task publish 0.11.1           # Set specific version
  deno task publish patch            # Bump patch version (0.11.0 -> 0.11.1)
  deno task publish minor            # Bump minor version (0.11.0 -> 0.12.0)
  deno task publish major            # Bump major version (0.11.0 -> 1.0.0)

This script will:
- Update version in all package deno.json files
- Update version in package.json files
- Update internal @runt/* JSR dependencies to use the new version
`);
    Deno.exit(0);
  }

  const versionArg = args._[0] as string;
  const currentVersion = await getCurrentVersion();

  let newVersion: string;

  if (["patch", "minor", "major"].includes(versionArg)) {
    newVersion = bumpVersion(
      currentVersion,
      versionArg as "patch" | "minor" | "major",
    );
    console.log(
      `🚀 Bumping ${versionArg} version: ${currentVersion} -> ${newVersion}`,
    );
  } else {
    // Validate version format
    parseVersion(versionArg); // This will throw if invalid
    newVersion = versionArg;
    console.log(`🚀 Setting version to: ${newVersion}`);
  }

  try {
    const { denoJsonFiles, packageJsonFiles } = await findPackageFiles();

    console.log(
      `\nFound ${denoJsonFiles.length} deno.json files and ${packageJsonFiles.length} package.json files\n`,
    );

    // Update all deno.json files
    for (const file of denoJsonFiles) {
      await updateDenoJson(file, newVersion);
    }

    // Update all package.json files
    for (const file of packageJsonFiles) {
      await updatePackageJson(file, newVersion);
    }

    console.log(
      `\n🎉 Successfully updated all packages to version ${newVersion}`,
    );
    console.log(`\nNext steps:`);
    console.log(`  1. Run 'deno task ci' to verify everything works`);
    console.log(`  2. Commit your changes`);
    console.log(`  3. Run 'deno task publish:dry-run' to test publishing`);
  } catch (error) {
    console.error(`❌ Error updating versions: ${error.message}`);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
