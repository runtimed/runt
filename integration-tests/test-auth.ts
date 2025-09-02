#!/usr/bin/env deno run --allow-net --allow-env

/**
 * Simple test script to verify API authentication against preview.runt.run
 *
 * Usage:
 *   RUNT_API_KEY=your-token deno run --allow-net --allow-env test-auth.ts
 *   deno run --allow-net --allow-env test-auth.ts --token your-token
 */

import { parseArgs } from "jsr:@std/cli/parse-args";

async function testAuthentication(
  apiKey: string,
  baseUrl = "https://preview.runt.run",
) {
  const meEndpoint = `${baseUrl}/api/me`;

  console.log(`🔍 Testing authentication against: ${meEndpoint}`);
  console.log(`🔑 Using API key: ${apiKey.substring(0, 8)}...`);

  try {
    const response = await fetch(meEndpoint, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "User-Agent": "runt-auth-test/1.0",
      },
    });

    console.log(
      `📡 Response status: ${response.status} ${response.statusText}`,
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`❌ Authentication failed: ${errorText}`);
      return false;
    }

    const userInfo = await response.json();

    console.log("✅ Authentication successful!");
    console.log("👤 User info:");
    console.log(`   ID: ${userInfo.id}`);
    console.log(`   Email: ${userInfo.email}`);
    console.log(`   Name: ${userInfo.name || "Not provided"}`);

    return true;
  } catch (error) {
    console.log(
      `❌ Network error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}

async function main() {
  const args = parseArgs(Deno.args, {
    string: ["token", "url"],
    boolean: ["help"],
    alias: {
      t: "token",
      u: "url",
      h: "help",
    },
  });

  if (args.help) {
    console.log(`
Authentication Test Tool

Usage:
  deno run --allow-net --allow-env test-auth.ts [OPTIONS]

Options:
  --token, -t <token>    API token to test (overrides RUNT_API_KEY env var)
  --url, -u <url>        Base URL to test against (default: https://preview.runt.run)
  --help, -h             Show this help message

Examples:
  RUNT_API_KEY=your-token deno run --allow-net --allow-env test-auth.ts
  deno run --allow-net --allow-env test-auth.ts --token your-token
  deno run --allow-net --allow-env test-auth.ts --token your-token --url https://api.runt.run
    `);
    Deno.exit(0);
  }

  const apiKey = args.token || Deno.env.get("RUNT_API_KEY");
  const baseUrl = args.url || "https://preview.runt.run";

  if (!apiKey) {
    console.log("❌ No API key provided!");
    console.log("Set RUNT_API_KEY environment variable or use --token flag");
    Deno.exit(1);
  }

  console.log("🧪 Runt API Authentication Test\n");

  const success = await testAuthentication(apiKey, baseUrl);

  if (success) {
    console.log("\n✅ Authentication test passed!");
    Deno.exit(0);
  } else {
    console.log("\n❌ Authentication test failed!");
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
