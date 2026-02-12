//! Shared Jupyter message types for Tauri/WebView applications.
//!
//! This crate provides common serialization/deserialization utilities
//! for passing Jupyter messages between Rust backends and WebView frontends.
//!
//! # Features
//!
//! - Base64 encoding/decoding for binary buffers
//! - Intermediate deserialization struct for incoming messages
//! - Serializable output struct for outgoing messages
//! - Bidirectional conversion to/from `jupyter_protocol::JupyterMessage`

mod base64;
mod message;

pub use base64::{deserialize_buffers, serialize_buffers};
pub use message::{ConversionError, RawJupyterMessage, WebViewJupyterMessage};
