//! Unified connection framing and handshake for the runtimed socket.
//!
//! All connections to the daemon use length-prefixed binary framing:
//!
//! ```text
//! [4 bytes: payload length (big-endian u32)] [payload bytes]
//! ```
//!
//! The first frame on every connection is a JSON handshake declaring the
//! channel. After the handshake, the daemon routes the connection to the
//! appropriate handler.

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

/// Maximum frame size for data frames: 100 MiB (matches blob size limit).
const MAX_FRAME_SIZE: usize = 100 * 1024 * 1024;

/// Maximum frame size for control/handshake frames: 64 KiB.
/// Applied to the initial handshake and JSON request/response traffic
/// so that oversized frames can't force large allocations before channel
/// routing has occurred.
const MAX_CONTROL_FRAME_SIZE: usize = 64 * 1024;

/// Channel handshake — the first frame on every connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "channel", rename_all = "snake_case")]
pub enum Handshake {
    /// Pool IPC: environment take/return/status/ping.
    Pool,
    /// Automerge settings sync.
    SettingsSync,
    /// Automerge notebook sync (per-notebook room).
    NotebookSync { notebook_id: String },
    /// Blob store: write blobs, query port.
    Blob,
}

/// Frame kind for notebook sync channel.
///
/// After the initial handshake, frames on the notebook sync channel include
/// a 1-byte kind indicator to distinguish between Automerge sync messages
/// and JSON requests (like append_output).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum FrameKind {
    /// Automerge sync message (binary).
    AutomergeSync = 0x00,
    /// JSON request/response for operations like append_output.
    JsonRequest = 0x01,
}

/// Send a length-prefixed frame.
pub async fn send_frame<W: AsyncWrite + Unpin>(writer: &mut W, data: &[u8]) -> std::io::Result<()> {
    let len = (data.len() as u32).to_be_bytes();
    writer.write_all(&len).await?;
    writer.write_all(data).await?;
    writer.flush().await?;
    Ok(())
}

/// Receive a length-prefixed frame with a caller-specified size limit.
/// Returns `None` on clean disconnect (EOF).
async fn recv_frame_with_limit<R: AsyncRead + Unpin>(
    reader: &mut R,
    max_size: usize,
) -> std::io::Result<Option<Vec<u8>>> {
    let mut len_buf = [0u8; 4];
    match reader.read_exact(&mut len_buf).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let len = u32::from_be_bytes(len_buf) as usize;

    if len > max_size {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("frame too large: {} bytes (max {})", len, max_size),
        ));
    }

    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf).await?;
    Ok(Some(buf))
}

/// Receive a length-prefixed frame (up to 100 MiB for data payloads).
/// Returns `None` on clean disconnect (EOF).
pub async fn recv_frame<R: AsyncRead + Unpin>(reader: &mut R) -> std::io::Result<Option<Vec<u8>>> {
    recv_frame_with_limit(reader, MAX_FRAME_SIZE).await
}

/// Receive a length-prefixed frame with the control/handshake size limit
/// (64 KiB). Use this for handshake and JSON request/response traffic to
/// prevent oversized frames from forcing large allocations.
pub async fn recv_control_frame<R: AsyncRead + Unpin>(
    reader: &mut R,
) -> std::io::Result<Option<Vec<u8>>> {
    recv_frame_with_limit(reader, MAX_CONTROL_FRAME_SIZE).await
}

/// Send a value as a JSON-encoded length-prefixed frame.
pub async fn send_json_frame<W: AsyncWrite + Unpin, T: Serialize>(
    writer: &mut W,
    value: &T,
) -> anyhow::Result<()> {
    let data = serde_json::to_vec(value)?;
    send_frame(writer, &data).await?;
    Ok(())
}

/// Receive and deserialize a JSON-encoded length-prefixed frame.
/// Returns `None` on clean disconnect (EOF).
pub async fn recv_json_frame<R: AsyncRead + Unpin, T: DeserializeOwned>(
    reader: &mut R,
) -> anyhow::Result<Option<T>> {
    match recv_frame(reader).await? {
        Some(data) => {
            let value = serde_json::from_slice(&data)?;
            Ok(Some(value))
        }
        None => Ok(None),
    }
}

/// Send a frame with a kind prefix byte.
///
/// The frame format is: `[4 bytes: length] [1 byte: kind] [payload bytes]`
///
/// Used on the notebook sync channel to distinguish Automerge sync messages
/// from JSON requests.
pub async fn send_typed_frame<W: AsyncWrite + Unpin>(
    writer: &mut W,
    kind: FrameKind,
    data: &[u8],
) -> std::io::Result<()> {
    let mut frame = Vec::with_capacity(1 + data.len());
    frame.push(kind as u8);
    frame.extend_from_slice(data);
    send_frame(writer, &frame).await
}

/// Receive a frame and extract the kind prefix byte.
///
/// The frame format is: `[4 bytes: length] [1 byte: kind] [payload bytes]`
///
/// Returns `None` on clean disconnect (EOF).
/// Returns an error if the frame is empty or has an unknown kind.
pub async fn recv_typed_frame<R: AsyncRead + Unpin>(
    reader: &mut R,
) -> std::io::Result<Option<(FrameKind, Vec<u8>)>> {
    match recv_frame(reader).await? {
        Some(frame) if frame.is_empty() => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "empty typed frame",
        )),
        Some(frame) => {
            let kind = match frame[0] {
                0x00 => FrameKind::AutomergeSync,
                0x01 => FrameKind::JsonRequest,
                k => {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        format!("unknown frame kind: 0x{:02x}", k),
                    ))
                }
            };
            Ok(Some((kind, frame[1..].to_vec())))
        }
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_frame_roundtrip() {
        let data = b"hello world";

        let mut buf = Vec::new();
        send_frame(&mut buf, data).await.unwrap();
        assert_eq!(buf.len(), 4 + data.len());

        let mut cursor = std::io::Cursor::new(buf);
        let received = recv_frame(&mut cursor).await.unwrap().unwrap();
        assert_eq!(received, data);
    }

    #[tokio::test]
    async fn test_frame_eof() {
        let buf: &[u8] = &[];
        let mut cursor = std::io::Cursor::new(buf);
        let result = recv_frame(&mut cursor).await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_frame_too_large() {
        let len_bytes = (MAX_FRAME_SIZE as u32 + 1).to_be_bytes();
        let mut cursor = std::io::Cursor::new(len_bytes.to_vec());
        let result = recv_frame(&mut cursor).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_control_frame_rejects_oversized() {
        // A frame larger than 64 KiB should be rejected by recv_control_frame
        let oversized_len = (MAX_CONTROL_FRAME_SIZE as u32 + 1).to_be_bytes();
        let mut cursor = std::io::Cursor::new(oversized_len.to_vec());
        let result = recv_control_frame(&mut cursor).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_control_frame_accepts_small() {
        let data = b"small control payload";
        let mut buf = Vec::new();
        send_frame(&mut buf, data).await.unwrap();

        let mut cursor = std::io::Cursor::new(buf);
        let received = recv_control_frame(&mut cursor).await.unwrap().unwrap();
        assert_eq!(received, data);
    }

    #[tokio::test]
    async fn test_json_frame_roundtrip() {
        let handshake = Handshake::Pool;

        let mut buf = Vec::new();
        send_json_frame(&mut buf, &handshake).await.unwrap();

        let mut cursor = std::io::Cursor::new(buf);
        let received: Handshake = recv_json_frame(&mut cursor).await.unwrap().unwrap();
        assert!(matches!(received, Handshake::Pool));
    }

    #[tokio::test]
    async fn test_handshake_serialization() {
        // Pool
        let json = serde_json::to_string(&Handshake::Pool).unwrap();
        assert_eq!(json, r#"{"channel":"pool"}"#);

        // SettingsSync
        let json = serde_json::to_string(&Handshake::SettingsSync).unwrap();
        assert_eq!(json, r#"{"channel":"settings_sync"}"#);

        // NotebookSync
        let json = serde_json::to_string(&Handshake::NotebookSync {
            notebook_id: "abc".into(),
        })
        .unwrap();
        assert_eq!(json, r#"{"channel":"notebook_sync","notebook_id":"abc"}"#);

        // Blob
        let json = serde_json::to_string(&Handshake::Blob).unwrap();
        assert_eq!(json, r#"{"channel":"blob"}"#);
    }

    #[tokio::test]
    async fn test_multiple_frames_on_same_stream() {
        let mut buf = Vec::new();
        send_frame(&mut buf, b"first").await.unwrap();
        send_frame(&mut buf, b"second").await.unwrap();
        send_frame(&mut buf, b"third").await.unwrap();

        let mut cursor = std::io::Cursor::new(buf);
        assert_eq!(recv_frame(&mut cursor).await.unwrap().unwrap(), b"first");
        assert_eq!(recv_frame(&mut cursor).await.unwrap().unwrap(), b"second");
        assert_eq!(recv_frame(&mut cursor).await.unwrap().unwrap(), b"third");
        // EOF
        assert!(recv_frame(&mut cursor).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn test_typed_frame_roundtrip_automerge() {
        let data = b"automerge sync message";

        let mut buf = Vec::new();
        send_typed_frame(&mut buf, FrameKind::AutomergeSync, data)
            .await
            .unwrap();

        // Frame should be 4 (length) + 1 (kind) + data.len()
        assert_eq!(buf.len(), 4 + 1 + data.len());

        let mut cursor = std::io::Cursor::new(buf);
        let (kind, received) = recv_typed_frame(&mut cursor).await.unwrap().unwrap();
        assert_eq!(kind, FrameKind::AutomergeSync);
        assert_eq!(received, data);
    }

    #[tokio::test]
    async fn test_typed_frame_roundtrip_json() {
        let data = b"{\"action\":\"append_output\"}";

        let mut buf = Vec::new();
        send_typed_frame(&mut buf, FrameKind::JsonRequest, data)
            .await
            .unwrap();

        let mut cursor = std::io::Cursor::new(buf);
        let (kind, received) = recv_typed_frame(&mut cursor).await.unwrap().unwrap();
        assert_eq!(kind, FrameKind::JsonRequest);
        assert_eq!(received, data);
    }

    #[tokio::test]
    async fn test_typed_frame_eof() {
        let buf: &[u8] = &[];
        let mut cursor = std::io::Cursor::new(buf);
        let result = recv_typed_frame(&mut cursor).await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_typed_frame_empty_payload() {
        // A frame with only the length prefix (no kind byte) should error
        let len_bytes = (0u32).to_be_bytes();
        let mut cursor = std::io::Cursor::new(len_bytes.to_vec());
        let result = recv_typed_frame(&mut cursor).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_typed_frame_unknown_kind() {
        // Create a frame with an invalid kind byte (0xFF)
        let mut buf = Vec::new();
        send_frame(&mut buf, &[0xFF, 0x01, 0x02, 0x03])
            .await
            .unwrap();

        let mut cursor = std::io::Cursor::new(buf);
        let result = recv_typed_frame(&mut cursor).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("unknown frame kind"));
    }

    #[tokio::test]
    async fn test_mixed_typed_frames() {
        let mut buf = Vec::new();
        send_typed_frame(&mut buf, FrameKind::AutomergeSync, b"sync1")
            .await
            .unwrap();
        send_typed_frame(&mut buf, FrameKind::JsonRequest, b"json1")
            .await
            .unwrap();
        send_typed_frame(&mut buf, FrameKind::AutomergeSync, b"sync2")
            .await
            .unwrap();

        let mut cursor = std::io::Cursor::new(buf);

        let (kind, data) = recv_typed_frame(&mut cursor).await.unwrap().unwrap();
        assert_eq!(kind, FrameKind::AutomergeSync);
        assert_eq!(data, b"sync1");

        let (kind, data) = recv_typed_frame(&mut cursor).await.unwrap().unwrap();
        assert_eq!(kind, FrameKind::JsonRequest);
        assert_eq!(data, b"json1");

        let (kind, data) = recv_typed_frame(&mut cursor).await.unwrap().unwrap();
        assert_eq!(kind, FrameKind::AutomergeSync);
        assert_eq!(data, b"sync2");

        // EOF
        assert!(recv_typed_frame(&mut cursor).await.unwrap().is_none());
    }
}
