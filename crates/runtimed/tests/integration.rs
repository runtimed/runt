//! Integration tests for runtimed daemon and client.
//!
//! These tests spawn a real daemon and test client interactions.

use std::time::Duration;

use runtimed::client::PoolClient;
use runtimed::daemon::{Daemon, DaemonConfig};
use runtimed::notebook_sync_client::NotebookSyncClient;
use runtimed::EnvType;
use tempfile::TempDir;
use tokio::time::sleep;

/// Create a test daemon configuration with a unique socket and lock path.
fn test_config(temp_dir: &TempDir) -> DaemonConfig {
    DaemonConfig {
        socket_path: temp_dir.path().join("test-runtimed.sock"),
        cache_dir: temp_dir.path().join("envs"),
        blob_store_dir: temp_dir.path().join("blobs"),
        notebook_docs_dir: temp_dir.path().join("notebook-docs"),
        uv_pool_size: 0, // Don't create real envs in tests
        conda_pool_size: 0,
        max_age_secs: 3600,
        lock_dir: Some(temp_dir.path().to_path_buf()),
    }
}

/// Wait for the daemon to be ready by polling the client.
async fn wait_for_daemon(client: &PoolClient, timeout: Duration) -> bool {
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        if client.ping().await.is_ok() {
            return true;
        }
        sleep(Duration::from_millis(50)).await;
    }
    false
}

#[tokio::test]
async fn test_daemon_ping_pong() {
    let temp_dir = TempDir::new().unwrap();
    let config = test_config(&temp_dir);
    let socket_path = config.socket_path.clone();

    // Spawn daemon
    let daemon = Daemon::new(config).unwrap();
    let daemon_handle = tokio::spawn(async move {
        daemon.run().await.ok();
    });

    // Create client and wait for daemon
    let client = PoolClient::new(socket_path);
    assert!(wait_for_daemon(&client, Duration::from_secs(5)).await);

    // Test ping
    let result = client.ping().await;
    assert!(result.is_ok());

    // Shutdown
    let shutdown_result = client.shutdown().await;
    assert!(shutdown_result.is_ok());

    // Wait for daemon to exit
    let _ = tokio::time::timeout(Duration::from_secs(2), daemon_handle).await;
}

#[tokio::test]
async fn test_daemon_status() {
    let temp_dir = TempDir::new().unwrap();
    let config = test_config(&temp_dir);
    let socket_path = config.socket_path.clone();

    let daemon = Daemon::new(config).unwrap();
    let daemon_handle = tokio::spawn(async move {
        daemon.run().await.ok();
    });

    let client = PoolClient::new(socket_path);
    assert!(wait_for_daemon(&client, Duration::from_secs(5)).await);

    // Get status
    let stats = client.status().await.unwrap();
    assert_eq!(stats.uv_available, 0);
    assert_eq!(stats.conda_available, 0);

    // Shutdown
    client.shutdown().await.ok();
    let _ = tokio::time::timeout(Duration::from_secs(2), daemon_handle).await;
}

#[tokio::test]
async fn test_daemon_take_empty_pool() {
    let temp_dir = TempDir::new().unwrap();
    let config = test_config(&temp_dir);
    let socket_path = config.socket_path.clone();

    let daemon = Daemon::new(config).unwrap();
    let daemon_handle = tokio::spawn(async move {
        daemon.run().await.ok();
    });

    let client = PoolClient::new(socket_path);
    assert!(wait_for_daemon(&client, Duration::from_secs(5)).await);

    // Try to take from empty pool
    let result = client.take(EnvType::Uv).await.unwrap();
    assert!(result.is_none());

    let result = client.take(EnvType::Conda).await.unwrap();
    assert!(result.is_none());

    // Shutdown
    client.shutdown().await.ok();
    let _ = tokio::time::timeout(Duration::from_secs(2), daemon_handle).await;
}

#[tokio::test]
async fn test_singleton_prevents_second_daemon() {
    let temp_dir = TempDir::new().unwrap();
    let config1 = test_config(&temp_dir);
    let socket_path = config1.socket_path.clone();

    // Start first daemon
    let daemon1 = Daemon::new(config1).unwrap();
    let daemon_handle = tokio::spawn(async move {
        daemon1.run().await.ok();
    });

    let client = PoolClient::new(socket_path.clone());
    assert!(wait_for_daemon(&client, Duration::from_secs(5)).await);

    // Try to start second daemon with same paths - should fail
    let config2 = DaemonConfig {
        socket_path: socket_path.clone(),
        cache_dir: temp_dir.path().join("envs"),
        blob_store_dir: temp_dir.path().join("blobs"),
        notebook_docs_dir: temp_dir.path().join("notebook-docs"),
        uv_pool_size: 0,
        conda_pool_size: 0,
        max_age_secs: 3600,
        lock_dir: Some(temp_dir.path().to_path_buf()),
    };

    let result = Daemon::new(config2);
    assert!(result.is_err());

    // Shutdown first daemon
    client.shutdown().await.ok();
    let _ = tokio::time::timeout(Duration::from_secs(2), daemon_handle).await;
}

#[tokio::test]
async fn test_client_timeout_when_no_daemon() {
    let temp_dir = TempDir::new().unwrap();
    let socket_path = temp_dir.path().join("nonexistent.sock");

    let client = PoolClient::new(socket_path).with_timeout(Duration::from_millis(100));

    // Should fail to connect
    let result = client.ping().await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_multiple_client_connections() {
    let temp_dir = TempDir::new().unwrap();
    let config = test_config(&temp_dir);
    let socket_path = config.socket_path.clone();

    let daemon = Daemon::new(config).unwrap();
    let daemon_handle = tokio::spawn(async move {
        daemon.run().await.ok();
    });

    let client1 = PoolClient::new(socket_path.clone());
    let client2 = PoolClient::new(socket_path.clone());
    let client3 = PoolClient::new(socket_path.clone());

    assert!(wait_for_daemon(&client1, Duration::from_secs(5)).await);

    // All clients should be able to ping concurrently
    let (r1, r2, r3) = tokio::join!(client1.ping(), client2.ping(), client3.ping());

    assert!(r1.is_ok());
    assert!(r2.is_ok());
    assert!(r3.is_ok());

    // Shutdown
    client1.shutdown().await.ok();
    let _ = tokio::time::timeout(Duration::from_secs(2), daemon_handle).await;
}

#[tokio::test]
async fn test_try_get_pooled_env_no_daemon() {
    // Use a temp dir so we don't accidentally connect to a real running daemon
    let temp_dir = TempDir::new().unwrap();
    let socket_path = temp_dir.path().join("nonexistent.sock");

    let client = PoolClient::new(socket_path);
    let result = client.take(EnvType::Uv).await;
    assert!(result.is_err(), "should fail when daemon is not running");
}

#[tokio::test]
async fn test_settings_sync_via_unified_socket() {
    use runtimed::sync_client::SyncClient;

    let temp_dir = TempDir::new().unwrap();
    let config = test_config(&temp_dir);
    let socket_path = config.socket_path.clone();

    let daemon = Daemon::new(config).unwrap();
    let daemon_handle = tokio::spawn(async move {
        daemon.run().await.ok();
    });

    // Wait for daemon to be ready (via pool channel)
    let pool_client = PoolClient::new(socket_path.clone());
    assert!(wait_for_daemon(&pool_client, Duration::from_secs(5)).await);

    // Connect a SyncClient through the unified socket
    let sync_client = SyncClient::connect_with_timeout(socket_path, Duration::from_secs(2))
        .await
        .expect("SyncClient should connect via unified socket");

    // Read settings — verifies the sync handshake completed and we have
    // a valid local replica. Exact values depend on persisted state.
    let settings = sync_client.get_all();
    // Smoke check: theme field is populated (any valid variant)
    let _ = serde_json::to_string(&settings.theme).unwrap();

    // Shutdown
    pool_client.shutdown().await.ok();
    let _ = tokio::time::timeout(Duration::from_secs(2), daemon_handle).await;
}

#[tokio::test]
async fn test_blob_server_health() {
    let temp_dir = TempDir::new().unwrap();
    let config = test_config(&temp_dir);
    let socket_path = config.socket_path.clone();

    let daemon = Daemon::new(config).unwrap();
    let daemon_handle = tokio::spawn(async move {
        daemon.run().await.ok();
    });

    let client = PoolClient::new(socket_path);
    assert!(wait_for_daemon(&client, Duration::from_secs(5)).await);

    // Read daemon info to find blob port
    let info_path = temp_dir.path().join("daemon.json");
    let info_json = tokio::fs::read_to_string(&info_path)
        .await
        .expect("daemon.json should exist");
    let info: serde_json::Value = serde_json::from_str(&info_json).unwrap();
    let blob_port = info["blob_port"].as_u64().expect("blob_port should be set");

    // Hit the health endpoint
    let resp = reqwest::get(format!("http://127.0.0.1:{}/health", blob_port))
        .await
        .expect("health request should succeed");
    assert_eq!(resp.status(), 200);
    let body = resp.text().await.unwrap();
    assert_eq!(body, "OK");

    // Hit a non-existent blob — should 404
    let fake_hash = "a".repeat(64);
    let resp = reqwest::get(format!("http://127.0.0.1:{}/blob/{}", blob_port, fake_hash))
        .await
        .expect("blob request should succeed");
    assert_eq!(resp.status(), 404);

    // Shutdown
    client.shutdown().await.ok();
    let _ = tokio::time::timeout(Duration::from_secs(2), daemon_handle).await;
}

#[tokio::test]
async fn test_notebook_sync_via_unified_socket() {
    let temp_dir = TempDir::new().unwrap();
    let config = test_config(&temp_dir);
    let socket_path = config.socket_path.clone();

    let daemon = Daemon::new(config).unwrap();
    let daemon_handle = tokio::spawn(async move {
        daemon.run().await.ok();
    });

    // Wait for daemon to be ready
    let pool_client = PoolClient::new(socket_path.clone());
    assert!(wait_for_daemon(&pool_client, Duration::from_secs(5)).await);

    // Connect first client — should get empty notebook
    let mut client1 = NotebookSyncClient::connect(socket_path.clone(), "test-notebook".to_string())
        .await
        .expect("client1 should connect");

    let cells = client1.get_cells();
    assert!(cells.is_empty(), "new notebook should have no cells");

    // Add a cell from client1
    client1.add_cell(0, "cell-1", "code").await.unwrap();
    client1
        .update_source("cell-1", "print('hello')")
        .await
        .unwrap();

    // Give the daemon a moment to process and persist
    sleep(Duration::from_millis(100)).await;

    // Connect second client to the same notebook — should see the cell
    let client2 = NotebookSyncClient::connect(socket_path.clone(), "test-notebook".to_string())
        .await
        .expect("client2 should connect");

    let cells = client2.get_cells();
    assert_eq!(cells.len(), 1, "client2 should see the cell from client1");
    assert_eq!(cells[0].id, "cell-1");
    assert_eq!(cells[0].source, "print('hello')");
    assert_eq!(cells[0].cell_type, "code");

    // Connect to a different notebook — should be independent
    let client3 = NotebookSyncClient::connect(socket_path.clone(), "other-notebook".to_string())
        .await
        .expect("client3 should connect");

    let cells = client3.get_cells();
    assert!(cells.is_empty(), "different notebook should have no cells");

    // Shutdown
    pool_client.shutdown().await.ok();
    let _ = tokio::time::timeout(Duration::from_secs(2), daemon_handle).await;
}

#[tokio::test]
async fn test_notebook_sync_cross_window_propagation() {
    let temp_dir = TempDir::new().unwrap();
    let config = test_config(&temp_dir);
    let socket_path = config.socket_path.clone();

    let daemon = Daemon::new(config).unwrap();
    let daemon_handle = tokio::spawn(async move {
        daemon.run().await.ok();
    });

    let pool_client = PoolClient::new(socket_path.clone());
    assert!(wait_for_daemon(&pool_client, Duration::from_secs(5)).await);

    // Both clients connect to the same notebook
    let mut client1 = NotebookSyncClient::connect(socket_path.clone(), "shared-nb".to_string())
        .await
        .unwrap();
    let mut client2 = NotebookSyncClient::connect(socket_path.clone(), "shared-nb".to_string())
        .await
        .unwrap();

    // Client1 adds a cell
    client1.add_cell(0, "c1", "code").await.unwrap();
    client1.update_source("c1", "x = 42").await.unwrap();
    client1.set_execution_count("c1", "1").await.unwrap();

    // Client2 should receive the changes
    let cells = client2.recv_changes().await.unwrap();
    assert!(!cells.is_empty(), "client2 should receive propagated cells");

    // May need additional recv rounds for full convergence
    let mut final_cells = cells;
    for _ in 0..5 {
        match tokio::time::timeout(Duration::from_millis(200), client2.recv_changes()).await {
            Ok(Ok(cells)) => final_cells = cells,
            _ => break,
        }
    }

    // Verify client2 has the cell
    let cell = final_cells.iter().find(|c| c.id == "c1");
    assert!(cell.is_some(), "client2 should have cell c1");
    let cell = cell.unwrap();
    assert_eq!(cell.source, "x = 42");
    assert_eq!(cell.execution_count, "1");

    // Shutdown
    pool_client.shutdown().await.ok();
    let _ = tokio::time::timeout(Duration::from_secs(2), daemon_handle).await;
}
