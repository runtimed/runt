//! Anonymous analytics collection using Ed25519 signatures.
//!
//! # Security Model
//!
//! Each installation generates a unique Ed25519 keypair on first use:
//! - Private key stays local, used to sign analytics submissions
//! - Public key serves as an anonymous but stable install identifier
//! - Server verifies signatures without needing shared secrets
//!
//! This allows the codebase to be fully open source while still preventing
//! tampering with analytics data.

use ed25519_dalek::{Signer, SigningKey};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;

/// Analytics endpoint URL
const ANALYTICS_URL: &str = "https://analytics.runt.dev/events";

/// Global signing key, lazily initialized
static SIGNING_KEY: OnceLock<Option<SigningKey>> = OnceLock::new();

/// An analytics event to be sent to the server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyticsEvent {
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
}

impl AnalyticsEvent {
    /// Create a new analytics event with the current timestamp.
    pub fn new(event_type: impl Into<String>) -> Self {
        Self {
            event_type: event_type.into(),
            data: None,
            timestamp: Some(chrono::Utc::now().to_rfc3339()),
        }
    }

    /// Add data to the event.
    pub fn with_data(mut self, data: serde_json::Value) -> Self {
        self.data = Some(data);
        self
    }
}

/// Payload sent to the analytics server.
#[derive(Debug, Serialize)]
struct AnalyticsPayload {
    public_key: String,
    signature: String,
    events: Vec<AnalyticsEvent>,
}

/// Path to the analytics key file.
fn analytics_key_path() -> Option<PathBuf> {
    // Allow override for testing
    if let Ok(path) = std::env::var("RUNT_ANALYTICS_KEY_PATH") {
        return Some(PathBuf::from(path));
    }
    dirs::config_dir().map(|d| d.join("runt").join("analytics-key"))
}

/// Get or create the analytics signing key.
///
/// The key is stored as a 32-byte seed in the config directory.
/// Returns None if key generation/loading fails (analytics will be disabled).
fn get_or_create_signing_key() -> Option<SigningKey> {
    let key_path = analytics_key_path()?;

    if key_path.exists() {
        // Read existing key
        let key_bytes = std::fs::read(&key_path).ok()?;
        if key_bytes.len() != 32 {
            log::warn!("Analytics key file is corrupted, regenerating");
            return create_new_key(&key_path);
        }
        let seed: [u8; 32] = key_bytes.try_into().ok()?;
        Some(SigningKey::from_bytes(&seed))
    } else {
        create_new_key(&key_path)
    }
}

/// Create a new signing key and save it to disk.
fn create_new_key(key_path: &PathBuf) -> Option<SigningKey> {
    use rand::rngs::OsRng;

    // Ensure parent directory exists
    if let Some(parent) = key_path.parent() {
        std::fs::create_dir_all(parent).ok()?;
    }

    // Generate new key
    let signing_key = SigningKey::generate(&mut OsRng);

    // Save seed to disk
    std::fs::write(key_path, signing_key.to_bytes()).ok()?;

    log::info!("Generated new analytics key");
    Some(signing_key)
}

/// Get the lazily-initialized signing key.
fn signing_key() -> Option<&'static SigningKey> {
    SIGNING_KEY
        .get_or_init(get_or_create_signing_key)
        .as_ref()
}

/// Get the public key as a hex string (serves as install ID).
pub fn get_install_id() -> Option<String> {
    signing_key().map(|k| hex::encode(k.verifying_key().to_bytes()))
}

/// Send analytics events to the server.
///
/// This is fire-and-forget: errors are logged but not propagated.
/// The function returns immediately and sends in the background.
pub fn send_events(events: Vec<AnalyticsEvent>) {
    if events.is_empty() {
        return;
    }

    let Some(key) = signing_key() else {
        log::debug!("Analytics disabled (no signing key)");
        return;
    };

    // Sign the events
    let events_json = match serde_json::to_string(&events) {
        Ok(json) => json,
        Err(e) => {
            log::warn!("Failed to serialize analytics events: {}", e);
            return;
        }
    };

    let signature = key.sign(events_json.as_bytes());
    let payload = AnalyticsPayload {
        public_key: hex::encode(key.verifying_key().to_bytes()),
        signature: hex::encode(signature.to_bytes()),
        events,
    };

    // Send in background
    tokio::spawn(async move {
        send_payload(payload).await;
    });
}

/// Send a single event (convenience wrapper).
pub fn send_event(event: AnalyticsEvent) {
    send_events(vec![event]);
}

/// Actually send the payload to the server.
async fn send_payload(payload: AnalyticsPayload) {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            log::debug!("Failed to create HTTP client for analytics: {}", e);
            return;
        }
    };

    match client
        .post(ANALYTICS_URL)
        .json(&payload)
        .send()
        .await
    {
        Ok(response) => {
            if response.status().is_success() {
                log::debug!("Analytics sent successfully");
            } else {
                log::debug!(
                    "Analytics server returned {}: {:?}",
                    response.status(),
                    response.text().await.ok()
                );
            }
        }
        Err(e) => {
            // Network errors are expected when offline - don't spam logs
            log::debug!("Failed to send analytics (server may be offline): {}", e);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use tempfile::tempdir;

    #[test]
    fn test_analytics_event_new() {
        let event = AnalyticsEvent::new("test_event");
        assert_eq!(event.event_type, "test_event");
        assert!(event.timestamp.is_some());
        assert!(event.data.is_none());
    }

    #[test]
    fn test_analytics_event_with_data() {
        let event = AnalyticsEvent::new("test_event")
            .with_data(serde_json::json!({"key": "value"}));
        assert!(event.data.is_some());
        assert_eq!(event.data.unwrap()["key"], "value");
    }

    #[test]
    #[serial]
    fn test_key_generation_and_loading() {
        let temp_dir = tempdir().unwrap();
        let key_path = temp_dir.path().join("analytics-key");

        std::env::set_var("RUNT_ANALYTICS_KEY_PATH", key_path.to_str().unwrap());

        // First call should generate
        let key1 = get_or_create_signing_key().unwrap();

        // Second call should load the same key
        let key2 = get_or_create_signing_key().unwrap();

        assert_eq!(key1.to_bytes(), key2.to_bytes());

        std::env::remove_var("RUNT_ANALYTICS_KEY_PATH");
    }

    #[test]
    #[serial]
    fn test_signature_verification() {
        use ed25519_dalek::Verifier;

        let temp_dir = tempdir().unwrap();
        let key_path = temp_dir.path().join("analytics-key");
        std::env::set_var("RUNT_ANALYTICS_KEY_PATH", key_path.to_str().unwrap());

        let key = get_or_create_signing_key().unwrap();
        let message = b"test message";
        let signature = key.sign(message);

        // Verify the signature
        assert!(key.verifying_key().verify(message, &signature).is_ok());

        std::env::remove_var("RUNT_ANALYTICS_KEY_PATH");
    }
}
