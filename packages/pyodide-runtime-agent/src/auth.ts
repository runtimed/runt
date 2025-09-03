// Authentication utilities for Anode runtime agents
//
// This module provides utilities for authenticating with the Anode API
// and discovering user identity. These should be used by CLI tools
// before creating runtime agents.

import { logger } from "@runt/lib";

/**
 * Options for user identity discovery
 */
export interface DiscoverUserIdentityOptions {
  /** Authentication token for API requests */
  authToken: string;
  /** Sync URL to derive API endpoint from */
  syncUrl: string;
  /** Skip authentication in test environments */
  skipInTests?: boolean;
}

/**
 * User information returned from identity discovery
 */
export interface UserInfo {
  id: string;
  email: string;
  name?: string;
}

/**
 * Discover authenticated user identity via /api/me endpoint
 *
 * This should be called before creating runtime agents to get the clientId.
 *
 * @param options - Configuration for identity discovery
 * @returns Promise resolving to user ID
 * @throws Error if authentication fails
 */
export async function discoverUserIdentity(
  options: DiscoverUserIdentityOptions,
): Promise<string> {
  const { authToken, syncUrl, skipInTests = true } = options;

  // Skip authentication in test environments if enabled
  if (skipInTests) {
    const isTestEnvironment = Deno.env.get("DENO_TESTING") === "true" ||
      Deno.args.some((arg) => arg.includes("test")) ||
      // Detect when running via deno test command
      Deno.args.some((arg) => arg.endsWith(".test.ts")) ||
      // Detect test files by checking if they end with .test.ts
      (typeof Deno !== "undefined" && Deno.mainModule &&
        Deno.mainModule.includes(".test.ts")) ||
      // Check if auth token looks like a test token
      authToken === "test-token";

    if (isTestEnvironment) {
      logger.debug("Skipping authentication in test environment");
      return "test-user-id";
    }
  }

  // Convert sync URL to API base URL
  const parsedSyncUrl = new URL(syncUrl);
  // Convert WebSocket URLs to HTTP URLs
  const protocol = parsedSyncUrl.protocol === "wss:" ? "https:" : "http:";
  const apiBaseUrl = `${protocol}//${parsedSyncUrl.host}`;
  const meEndpoint = `${apiBaseUrl}/api/me`;

  try {
    const response = await fetch(meEndpoint, {
      headers: {
        "Authorization": `Bearer ${authToken}`,
        "User-Agent": "runt-runtime-agent/1.0",
      },
    });

    if (!response.ok) {
      let errorBody = "";
      try {
        errorBody = await response.text();
      } catch (_) {
        errorBody = "Unable to read response body";
      }

      logger.error("Authentication request failed", {
        endpoint: meEndpoint,
        status: response.status,
        statusText: response.statusText,
        responseBody: errorBody,
      });

      throw new Error(
        `HTTP ${response.status} ${response.statusText}: ${errorBody}`,
      );
    }

    const userInfo = await response.json() as UserInfo;

    if (!userInfo.id) {
      logger.error("Invalid user info response", {
        endpoint: meEndpoint,
        responseBody: JSON.stringify(userInfo),
      });
      throw new Error("User ID not found in response");
    }

    logger.debug("User identity discovered", {
      userId: userInfo.id,
      email: userInfo.email,
      name: userInfo.name,
    });

    return userInfo.id;
  } catch (error) {
    // If we haven't already logged the error above, log it here
    if (!(error instanceof Error && error.message.startsWith("HTTP "))) {
      logger.error("Network or parsing error during identity discovery", {
        endpoint: meEndpoint,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error
          ? error.constructor.name
          : typeof error,
      });
    }

    // Pretty console output for authentication failure
    const hostname = parsedSyncUrl.hostname;

    console.log(`\n❌ \x1b[31mAuthentication Failed\x1b[0m`);
    console.log(`   \x1b[36mEndpoint:\x1b[0m https://${hostname}`);
    console.log(
      `   \x1b[36mError:\x1b[0m    ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    console.log(
      `\n\x1b[33m💡 Check your RUNT_API_KEY and network connection\x1b[0m\n`,
    );

    throw new Error(
      `Authentication failed: Could not verify identity with ${meEndpoint}. ` +
        `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Generate a client ID for runtime agents
 *
 * @param runtimeId - The runtime ID
 * @returns Generated client ID in the format "runtime-{runtimeId}"
 */
export function generateRuntimeClientId(runtimeId: string): string {
  return `runtime-${runtimeId}`;
}
