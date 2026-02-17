# Runt Telemetry Service

A Cloudflare Worker + D1 service for collecting anonymous telemetry from Runt installations.

## Security Model

**No shared secrets.** Each Runt installation generates its own Ed25519 keypair:
- Private key stays local, never transmitted
- Public key serves as the anonymous install identifier
- Submissions are signed with the private key
- Server verifies signatures using the public key

This means:
- The codebase can be fully open source
- No secrets to configure on the server
- Each install is cryptographically identifiable but anonymous
- Tampered payloads are rejected

## Setup

1. Install dependencies:
   ```bash
   cd services/telemetry
   pnpm install
   ```

2. Create the D1 database:
   ```bash
   pnpm db:create
   ```

   Copy the `database_id` from the output and paste it into `wrangler.toml`.

3. Run the database migration:
   ```bash
   # For production
   pnpm db:migrate

   # For local development
   pnpm db:migrate:local
   ```

4. Deploy:
   ```bash
   pnpm deploy
   ```

## Local Development

```bash
pnpm dev
```

This starts a local Worker with a local D1 database.

## API

### POST /telemetry

Submit telemetry events.

**Request:**
```json
{
  "public_key": "ed25519-public-key-hex-64-chars",
  "signature": "ed25519-signature-hex-128-chars",
  "events": [
    {
      "event_type": "auto_launch",
      "data": {
        "runtime": "python",
        "success": true,
        "prewarmed": true,
        "duration_ms": 150
      },
      "timestamp": "2024-02-16T12:00:00Z"
    }
  ]
}
```

**Keypair storage:** Platform config dir (32-byte Ed25519 seed)
- macOS: `~/Library/Application Support/runt/telemetry-key`
- Linux: `~/.config/runt/telemetry-key`
- Windows: `%APPDATA%\runt\telemetry-key`

**Signature computation (Rust):**
```rust
use ed25519_dalek::{SigningKey, Signer};

// Load or generate keypair from ~/.runt/telemetry-key
let signing_key = load_or_create_telemetry_key()?;

let events_json = serde_json::to_string(&events)?;
let signature = signing_key.sign(events_json.as_bytes());
let signature_hex = hex::encode(signature.to_bytes());
let public_key_hex = hex::encode(signing_key.verifying_key().to_bytes());
```

**Response:**
```json
{
  "success": true,
  "count": 1
}
```

## Event Types

| Event | Description | Data Fields |
|-------|-------------|-------------|
| `auto_launch` | Kernel auto-launch attempt | `runtime`, `success`, `prewarmed`, `duration_ms`, `trust_status` |
| `kernel_start` | Manual kernel start | `runtime`, `trigger` (cell_execute, toolbar, etc.) |
| `app_open` | App opened | `notebook_type` (new, existing), `runtime` |
| `app_close` | App closed | `session_duration_ms` |

## Querying Data

```bash
# Count events by type
pnpm db:query "SELECT event_type, COUNT(*) FROM events GROUP BY event_type"

# Recent auto-launch success rate
pnpm db:query "SELECT
  json_extract(event_data, '$.success') as success,
  COUNT(*) as count
FROM events
WHERE event_type = 'auto_launch'
  AND created_at > datetime('now', '-7 days')
GROUP BY success"

# Unique installs per day
pnpm db:query "SELECT
  date(created_at) as day,
  COUNT(DISTINCT install_id) as unique_installs
FROM events
GROUP BY day
ORDER BY day DESC
LIMIT 30"
```
