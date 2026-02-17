/**
 * Runt Analytics Worker
 *
 * Accepts analytics events from Runt installations, validates them via Ed25519
 * signatures, and stores them in D1 for analysis.
 *
 * No shared secrets - each install generates its own keypair. The public key
 * serves as the install_id, and the private key signs submissions.
 */

export interface Env {
  DB: D1Database;
}

interface AnalyticsEvent {
  event_type: string;
  data?: Record<string, unknown>;
  timestamp?: string;
}

interface AnalyticsPayload {
  // Public key (hex-encoded) - serves as the install identifier
  public_key: string;
  // Ed25519 signature over the events JSON (hex-encoded)
  signature: string;
  events: AnalyticsEvent[];
}

// Verify Ed25519 signature using WebCrypto
async function verifyEd25519Signature(
  message: string,
  signatureHex: string,
  publicKeyHex: string
): Promise<boolean> {
  try {
    // Convert hex strings to Uint8Array
    const signature = hexToBytes(signatureHex);
    const publicKeyBytes = hexToBytes(publicKeyHex);
    const messageBytes = new TextEncoder().encode(message);

    // Import the public key
    const publicKey = await crypto.subtle.importKey(
      "raw",
      publicKeyBytes,
      { name: "Ed25519" },
      false,
      ["verify"]
    );

    // Verify the signature
    return await crypto.subtle.verify(
      "Ed25519",
      publicKey,
      signature,
      messageBytes
    );
  } catch (e) {
    console.error("Signature verification failed:", e);
    return false;
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS headers for browser-based submissions (if ever needed)
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Only accept POST to /events
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/events") {
      return new Response("Not Found", { status: 404 });
    }

    try {
      const body = await request.text();
      const payload: AnalyticsPayload = JSON.parse(body);

      // Validate required fields
      if (!payload.public_key || !payload.signature || !payload.events) {
        return new Response(
          JSON.stringify({ error: "Missing required fields" }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      // Validate public key format (Ed25519 public keys are 32 bytes = 64 hex chars)
      if (payload.public_key.length !== 64 || !/^[0-9a-f]+$/i.test(payload.public_key)) {
        return new Response(
          JSON.stringify({ error: "Invalid public key format" }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      // Verify Ed25519 signature over the events JSON
      const signedContent = JSON.stringify(payload.events);
      const isValid = await verifyEd25519Signature(
        signedContent,
        payload.signature,
        payload.public_key
      );

      if (!isValid) {
        return new Response(
          JSON.stringify({ error: "Invalid signature" }),
          { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      // Rate limit: max 100 events per request
      if (payload.events.length > 100) {
        return new Response(
          JSON.stringify({ error: "Too many events (max 100)" }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      // Insert events into D1 (public key serves as install_id)
      const stmt = env.DB.prepare(
        "INSERT OR IGNORE INTO events (install_id, event_type, event_data, created_at) VALUES (?, ?, ?, ?)"
      );

      const batch = payload.events.map(event =>
        stmt.bind(
          payload.public_key,
          event.event_type,
          event.data ? JSON.stringify(event.data) : null,
          event.timestamp || new Date().toISOString()
        )
      );

      await env.DB.batch(batch);

      return new Response(
        JSON.stringify({ success: true, count: payload.events.length }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );

    } catch (e) {
      console.error("Analytics error:", e);
      return new Response(
        JSON.stringify({ error: "Internal error" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }
  },
};
