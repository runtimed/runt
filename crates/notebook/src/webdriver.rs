//! Built-in W3C WebDriver server for native E2E testing.
//!
//! When the `webdriver-test` feature is enabled and `--webdriver-port` is passed,
//! this module starts an HTTP server that speaks the W3C WebDriver protocol.
//! It controls the app's WebView via `webview.eval()` and receives results
//! via HTTP (the JS bridge fetches back to the server), enabling E2E tests
//! to run without Docker or tauri-driver.
//!
//! Only the subset of WebDriver endpoints used by the E2E test suite is implemented.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::{delete, get, post},
    Router,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Manager, WebviewWindow};
use tokio::sync::{oneshot, Mutex};
use tower_http::cors::{Any, CorsLayer};

/// The W3C WebDriver element identifier key
const W3C_ELEMENT_KEY: &str = "element-6066-11e4-a52e-4f735466cecf";

/// Shared state for the WebDriver server
pub struct WebDriverState {
    app_handle: AppHandle,
    /// Pending requests waiting for results from the JS bridge
    pending: Mutex<HashMap<String, oneshot::Sender<String>>>,
    /// Current session ID (we only support one session)
    session_id: String,
}

impl WebDriverState {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            app_handle,
            pending: Mutex::new(HashMap::new()),
            session_id: uuid::Uuid::new_v4().to_string(),
        }
    }

    /// Get the main webview window
    fn window(&self) -> Option<WebviewWindow> {
        self.app_handle.get_webview_window("main")
    }

    /// Execute a command in the JS bridge and wait for the result
    async fn exec_bridge(&self, command: &str, params: Value) -> Result<Value, String> {
        let request_id = uuid::Uuid::new_v4().to_string();

        // Create a oneshot channel for the response
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.pending.lock().await;
            pending.insert(request_id.clone(), tx);
        }

        // Build the JS eval call
        let js = format!(
            "window.__TEST_BRIDGE.exec({}, {}, {})",
            serde_json::to_string(&request_id).unwrap(),
            serde_json::to_string(command).unwrap(),
            serde_json::to_string(&params).unwrap(),
        );

        // Execute in the webview
        let window = self.window().ok_or("no window available")?;
        window
            .eval(&js)
            .map_err(|e| format!("eval failed: {}", e))?;

        // Wait for the result with a timeout
        let result = tokio::time::timeout(std::time::Duration::from_secs(30), rx)
            .await
            .map_err(|_| "bridge command timed out".to_string())?
            .map_err(|_| "bridge channel closed".to_string())?;

        let parsed: Value =
            serde_json::from_str(&result).map_err(|e| format!("invalid JSON from bridge: {}", e))?;

        if let Some(error) = parsed.get("error").and_then(|e| e.as_str()) {
            Err(error.to_string())
        } else {
            Ok(parsed)
        }
    }

    /// Called by the Tauri IPC handler when the JS bridge sends a result
    pub async fn handle_result(&self, request_id: String, result: String) {
        let mut pending = self.pending.lock().await;
        if let Some(tx) = pending.remove(&request_id) {
            let _ = tx.send(result);
        }
    }
}

type SharedState = Arc<WebDriverState>;

// ============================================================
// W3C WebDriver response helpers
// ============================================================

fn w3c_value(value: Value) -> Json<Value> {
    Json(json!({ "value": value }))
}

fn w3c_error(error: &str, message: &str) -> (StatusCode, Json<Value>) {
    let status = match error {
        "no such element" => StatusCode::NOT_FOUND,
        "stale element reference" => StatusCode::NOT_FOUND,
        "no such frame" => StatusCode::NOT_FOUND,
        "invalid argument" => StatusCode::BAD_REQUEST,
        "no such session" => StatusCode::NOT_FOUND,
        "unknown command" => StatusCode::NOT_FOUND,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };

    (
        status,
        Json(json!({
            "value": {
                "error": error,
                "message": message,
                "stacktrace": ""
            }
        })),
    )
}

fn w3c_element(element_id: &str) -> Value {
    json!({ W3C_ELEMENT_KEY: element_id })
}

// ============================================================
// Route handlers
// ============================================================

/// POST /session — Create a new session (app is already running, so this is mostly a no-op)
async fn new_session(
    State(state): State<SharedState>,
    Json(_body): Json<Value>,
) -> Json<Value> {
    w3c_value(json!({
        "sessionId": state.session_id,
        "capabilities": {
            "browserName": "wry",
            "browserVersion": "embedded",
            "platformName": std::env::consts::OS,
            "acceptInsecureCerts": false,
            "timeouts": {
                "implicit": 0,
                "pageLoad": 300000,
                "script": 30000
            }
        }
    }))
}

/// DELETE /session/{session_id} — Delete session
async fn delete_session(
    State(_state): State<SharedState>,
    Path(_session_id): Path<String>,
) -> Json<Value> {
    w3c_value(Value::Null)
}

/// GET /status — Server status
async fn status() -> Json<Value> {
    Json(json!({
        "value": {
            "ready": true,
            "message": "runt webdriver server"
        }
    }))
}

/// POST /session/{session_id}/element — Find element
async fn find_element(
    State(state): State<SharedState>,
    Path(_session_id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let using = body
        .get("using")
        .and_then(|v| v.as_str())
        .ok_or_else(|| w3c_error("invalid argument", "missing 'using'"))?;
    let value = body
        .get("value")
        .and_then(|v| v.as_str())
        .ok_or_else(|| w3c_error("invalid argument", "missing 'value'"))?;

    let result = state
        .exec_bridge(
            "findElement",
            json!({ "using": using, "value": value }),
        )
        .await
        .map_err(|e| w3c_error("no such element", &e))?;

    let element_id = result
        .get("elementId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| w3c_error("no such element", "element not found"))?;

    Ok(w3c_value(w3c_element(element_id)))
}

/// POST /session/{session_id}/elements — Find elements
async fn find_elements(
    State(state): State<SharedState>,
    Path(_session_id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let using = body
        .get("using")
        .and_then(|v| v.as_str())
        .ok_or_else(|| w3c_error("invalid argument", "missing 'using'"))?;
    let value = body
        .get("value")
        .and_then(|v| v.as_str())
        .ok_or_else(|| w3c_error("invalid argument", "missing 'value'"))?;

    let result = state
        .exec_bridge(
            "findElements",
            json!({ "using": using, "value": value }),
        )
        .await
        .map_err(|e| w3c_error("no such element", &e))?;

    let element_ids = result
        .get("elementIds")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let elements: Vec<Value> = element_ids
        .iter()
        .filter_map(|id| id.as_str())
        .map(|id| w3c_element(id))
        .collect();

    Ok(w3c_value(Value::Array(elements)))
}

/// POST /session/{session_id}/element/{element_id}/element — Find child element
async fn find_element_from_element(
    State(state): State<SharedState>,
    Path((_session_id, element_id)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let using = body
        .get("using")
        .and_then(|v| v.as_str())
        .ok_or_else(|| w3c_error("invalid argument", "missing 'using'"))?;
    let value = body
        .get("value")
        .and_then(|v| v.as_str())
        .ok_or_else(|| w3c_error("invalid argument", "missing 'value'"))?;

    let result = state
        .exec_bridge(
            "findElement",
            json!({ "using": using, "value": value, "parentId": element_id }),
        )
        .await
        .map_err(|e| w3c_error("no such element", &e))?;

    let child_id = result
        .get("elementId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| w3c_error("no such element", "element not found"))?;

    Ok(w3c_value(w3c_element(child_id)))
}

/// POST /session/{session_id}/element/{element_id}/elements — Find child elements
async fn find_elements_from_element(
    State(state): State<SharedState>,
    Path((_session_id, element_id)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let using = body
        .get("using")
        .and_then(|v| v.as_str())
        .ok_or_else(|| w3c_error("invalid argument", "missing 'using'"))?;
    let value = body
        .get("value")
        .and_then(|v| v.as_str())
        .ok_or_else(|| w3c_error("invalid argument", "missing 'value'"))?;

    let result = state
        .exec_bridge(
            "findElements",
            json!({ "using": using, "value": value, "parentId": element_id }),
        )
        .await
        .map_err(|e| w3c_error("no such element", &e))?;

    let element_ids = result
        .get("elementIds")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let elements: Vec<Value> = element_ids
        .iter()
        .filter_map(|id| id.as_str())
        .map(|id| w3c_element(id))
        .collect();

    Ok(w3c_value(Value::Array(elements)))
}

/// POST /session/{session_id}/element/{element_id}/click — Click element
async fn click_element(
    State(state): State<SharedState>,
    Path((_session_id, element_id)): Path<(String, String)>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    state
        .exec_bridge("clickElement", json!({ "elementId": element_id }))
        .await
        .map_err(|e| w3c_error("stale element reference", &e))?;

    Ok(w3c_value(Value::Null))
}

/// GET /session/{session_id}/element/{element_id}/text — Get element text
async fn get_element_text(
    State(state): State<SharedState>,
    Path((_session_id, element_id)): Path<(String, String)>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let result = state
        .exec_bridge("getElementText", json!({ "elementId": element_id }))
        .await
        .map_err(|e| w3c_error("stale element reference", &e))?;

    let text = result
        .get("text")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    Ok(w3c_value(Value::String(text.to_string())))
}

/// GET /session/{session_id}/element/{element_id}/name — Get element tag name
async fn get_element_tag_name(
    State(state): State<SharedState>,
    Path((_session_id, element_id)): Path<(String, String)>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let result = state
        .exec_bridge("getElementTagName", json!({ "elementId": element_id }))
        .await
        .map_err(|e| w3c_error("stale element reference", &e))?;

    let tag = result
        .get("tagName")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    Ok(w3c_value(Value::String(tag.to_string())))
}

/// GET /session/{session_id}/element/{element_id}/attribute/{name} — Get attribute
async fn get_element_attribute(
    State(state): State<SharedState>,
    Path((_session_id, element_id, name)): Path<(String, String, String)>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let result = state
        .exec_bridge(
            "getElementAttribute",
            json!({ "elementId": element_id, "name": name }),
        )
        .await
        .map_err(|e| w3c_error("stale element reference", &e))?;

    let value = result.get("value").cloned().unwrap_or(Value::Null);
    Ok(w3c_value(value))
}

/// GET /session/{session_id}/element/{element_id}/css/{property_name} — Get CSS value
async fn get_element_css_value(
    State(state): State<SharedState>,
    Path((_session_id, element_id, property_name)): Path<(String, String, String)>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let result = state
        .exec_bridge(
            "getElementCssValue",
            json!({ "elementId": element_id, "propertyName": property_name }),
        )
        .await
        .map_err(|e| w3c_error("stale element reference", &e))?;

    let value = result
        .get("value")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    Ok(w3c_value(Value::String(value.to_string())))
}

/// GET /session/{session_id}/element/{element_id}/displayed — Is displayed
async fn is_element_displayed(
    State(state): State<SharedState>,
    Path((_session_id, element_id)): Path<(String, String)>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let result = state
        .exec_bridge("isElementDisplayed", json!({ "elementId": element_id }))
        .await
        .map_err(|e| w3c_error("stale element reference", &e))?;

    let displayed = result
        .get("displayed")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    Ok(w3c_value(Value::Bool(displayed)))
}

/// GET /session/{session_id}/element/{element_id}/enabled — Is enabled
async fn is_element_enabled(
    State(state): State<SharedState>,
    Path((_session_id, element_id)): Path<(String, String)>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let result = state
        .exec_bridge("isElementEnabled", json!({ "elementId": element_id }))
        .await
        .map_err(|e| w3c_error("stale element reference", &e))?;

    let enabled = result
        .get("enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    Ok(w3c_value(Value::Bool(enabled)))
}

/// GET /session/{session_id}/element/{element_id}/rect — Get element rect
async fn get_element_rect(
    State(state): State<SharedState>,
    Path((_session_id, element_id)): Path<(String, String)>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let result = state
        .exec_bridge("getElementRect", json!({ "elementId": element_id }))
        .await
        .map_err(|e| w3c_error("stale element reference", &e))?;

    Ok(w3c_value(json!({
        "x": result.get("x").unwrap_or(&json!(0)),
        "y": result.get("y").unwrap_or(&json!(0)),
        "width": result.get("width").unwrap_or(&json!(0)),
        "height": result.get("height").unwrap_or(&json!(0)),
    })))
}

/// POST /session/{session_id}/element/{element_id}/clear — Clear element
async fn clear_element(
    State(state): State<SharedState>,
    Path((_session_id, element_id)): Path<(String, String)>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    state
        .exec_bridge("clearElement", json!({ "elementId": element_id }))
        .await
        .map_err(|e| w3c_error("stale element reference", &e))?;

    Ok(w3c_value(Value::Null))
}

/// POST /session/{session_id}/element/{element_id}/value — Send keys to element
async fn send_keys_to_element(
    State(state): State<SharedState>,
    Path((_session_id, element_id)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let text = body
        .get("text")
        .and_then(|v| v.as_str())
        .ok_or_else(|| w3c_error("invalid argument", "missing 'text'"))?;

    state
        .exec_bridge(
            "sendKeysToElement",
            json!({ "elementId": element_id, "text": text }),
        )
        .await
        .map_err(|e| w3c_error("stale element reference", &e))?;

    Ok(w3c_value(Value::Null))
}

/// POST /session/{session_id}/actions — Perform actions (keyboard/mouse)
async fn perform_actions(
    State(state): State<SharedState>,
    Path(_session_id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let actions = body
        .get("actions")
        .cloned()
        .unwrap_or(Value::Array(vec![]));

    // Check if there are any pause actions that need server-side delays
    if let Some(action_list) = actions.as_array() {
        for action_seq in action_list {
            if let Some(seq_actions) = action_seq.get("actions").and_then(|a| a.as_array()) {
                for action in seq_actions {
                    if action.get("type").and_then(|t| t.as_str()) == Some("pause") {
                        if let Some(duration) = action.get("duration").and_then(|d| d.as_u64()) {
                            if duration > 0 {
                                tokio::time::sleep(std::time::Duration::from_millis(duration))
                                    .await;
                            }
                        }
                    }
                }
            }
        }
    }

    state
        .exec_bridge("performActions", json!({ "actions": actions }))
        .await
        .map_err(|e| w3c_error("unknown error", &e))?;

    Ok(w3c_value(Value::Null))
}

/// DELETE /session/{session_id}/actions — Release actions
async fn release_actions(
    Path(_session_id): Path<String>,
) -> Json<Value> {
    w3c_value(Value::Null)
}

/// POST /session/{session_id}/frame — Switch to frame
async fn switch_to_frame(
    State(state): State<SharedState>,
    Path(_session_id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let frame_id = body.get("id").cloned().unwrap_or(Value::Null);

    state
        .exec_bridge("switchToFrame", json!({ "frameId": frame_id }))
        .await
        .map_err(|e| w3c_error("no such frame", &e))?;

    Ok(w3c_value(Value::Null))
}

/// POST /session/{session_id}/frame/parent — Switch to parent frame
async fn switch_to_parent_frame(
    State(state): State<SharedState>,
    Path(_session_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    state
        .exec_bridge("switchToParentFrame", json!({}))
        .await
        .map_err(|e| w3c_error("no such frame", &e))?;

    Ok(w3c_value(Value::Null))
}

/// GET /session/{session_id}/title — Get page title
async fn get_title(
    State(state): State<SharedState>,
    Path(_session_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let result = state
        .exec_bridge("getTitle", json!({}))
        .await
        .map_err(|e| w3c_error("unknown error", &e))?;

    let title = result
        .get("value")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    Ok(w3c_value(Value::String(title.to_string())))
}

/// GET /session/{session_id}/url — Get current URL
async fn get_url(
    State(state): State<SharedState>,
    Path(_session_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let result = state
        .exec_bridge("getUrl", json!({}))
        .await
        .map_err(|e| w3c_error("unknown error", &e))?;

    let url = result
        .get("value")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    Ok(w3c_value(Value::String(url.to_string())))
}

/// GET /session/{session_id}/screenshot — Take screenshot
async fn take_screenshot(
    State(state): State<SharedState>,
    Path(_session_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let result = state
        .exec_bridge("screenshot", json!({}))
        .await
        .map_err(|e| w3c_error("unknown error", &e))?;

    let screenshot = result
        .get("screenshot")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    Ok(w3c_value(Value::String(screenshot.to_string())))
}

/// GET /session/{session_id}/element/{element_id}/screenshot — Element screenshot
async fn take_element_screenshot(
    State(state): State<SharedState>,
    Path((_session_id, _element_id)): Path<(String, String)>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // For now, just take a full page screenshot
    let result = state
        .exec_bridge("screenshot", json!({}))
        .await
        .map_err(|e| w3c_error("unknown error", &e))?;

    let screenshot = result
        .get("screenshot")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    Ok(w3c_value(Value::String(screenshot.to_string())))
}

/// POST /session/{session_id}/execute/sync — Execute script
async fn execute_script(
    State(state): State<SharedState>,
    Path(_session_id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let script = body
        .get("script")
        .and_then(|v| v.as_str())
        .ok_or_else(|| w3c_error("invalid argument", "missing 'script'"))?;
    let args = body
        .get("args")
        .cloned()
        .unwrap_or(Value::Array(vec![]));

    let result = state
        .exec_bridge(
            "executeScript",
            json!({ "script": script, "args": args }),
        )
        .await
        .map_err(|e| w3c_error("javascript error", &e))?;

    let value = result.get("value").cloned().unwrap_or(Value::Null);
    Ok(w3c_value(value))
}

/// GET /session/{session_id}/source — Get page source
async fn get_page_source(
    State(state): State<SharedState>,
    Path(_session_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let result = state
        .exec_bridge("getPageSource", json!({}))
        .await
        .map_err(|e| w3c_error("unknown error", &e))?;

    let source = result
        .get("value")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    Ok(w3c_value(Value::String(source.to_string())))
}

/// GET /session/{session_id}/window — Get window handle
async fn get_window_handle(
    Path(_session_id): Path<String>,
) -> Json<Value> {
    w3c_value(Value::String("main".to_string()))
}

/// GET /session/{session_id}/window/handles — Get all window handles
async fn get_window_handles(
    Path(_session_id): Path<String>,
) -> Json<Value> {
    w3c_value(json!(["main"]))
}

/// GET /session/{session_id}/window/rect — Get window rect
async fn get_window_rect(
    Path(_session_id): Path<String>,
) -> Json<Value> {
    w3c_value(json!({
        "x": 0,
        "y": 0,
        "width": 1920,
        "height": 1080
    }))
}

/// POST /session/{session_id}/timeouts — Set timeouts (no-op for now)
async fn set_timeouts(
    Path(_session_id): Path<String>,
    Json(_body): Json<Value>,
) -> Json<Value> {
    w3c_value(Value::Null)
}

/// GET /session/{session_id}/element/active — Get active element
async fn get_active_element(
    State(state): State<SharedState>,
    Path(_session_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let result = state
        .exec_bridge(
            "executeScript",
            json!({ "script": "return document.activeElement", "args": [] }),
        )
        .await
        .map_err(|e| w3c_error("unknown error", &e))?;

    if let Some(element_ref) = result.get("value") {
        Ok(w3c_value(element_ref.clone()))
    } else {
        Err(w3c_error("no such element", "no active element"))
    }
}

// ============================================================
// Router and server startup
// ============================================================

/// POST /__bridge_result — Receives results from the JS bridge via fetch()
async fn bridge_result(
    State(state): State<SharedState>,
    Json(body): Json<Value>,
) -> StatusCode {
    let request_id = body
        .get("requestId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let result = body
        .get("result")
        .and_then(|v| v.as_str())
        .unwrap_or("{}")
        .to_string();

    state.handle_result(request_id, result).await;
    StatusCode::OK
}

/// Build the axum router with all WebDriver routes
fn build_router(state: SharedState) -> Router {
    // CORS layer to allow the WebView (tauri://localhost) to fetch to our server
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        // Bridge result endpoint (JS bridge → Rust server)
        .route("/__bridge_result", post(bridge_result))
        // Session management
        .route("/status", get(status))
        .route("/session", post(new_session))
        .route("/session/{session_id}", delete(delete_session))
        // Timeouts
        .route("/session/{session_id}/timeouts", post(set_timeouts))
        // Navigation
        .route("/session/{session_id}/url", get(get_url))
        .route("/session/{session_id}/title", get(get_title))
        .route("/session/{session_id}/source", get(get_page_source))
        // Window
        .route("/session/{session_id}/window", get(get_window_handle))
        .route(
            "/session/{session_id}/window/handles",
            get(get_window_handles),
        )
        .route(
            "/session/{session_id}/window/rect",
            get(get_window_rect),
        )
        // Frame
        .route("/session/{session_id}/frame", post(switch_to_frame))
        .route(
            "/session/{session_id}/frame/parent",
            post(switch_to_parent_frame),
        )
        // Elements
        .route("/session/{session_id}/element", post(find_element))
        .route(
            "/session/{session_id}/element/active",
            get(get_active_element),
        )
        .route("/session/{session_id}/elements", post(find_elements))
        .route(
            "/session/{session_id}/element/{element_id}/element",
            post(find_element_from_element),
        )
        .route(
            "/session/{session_id}/element/{element_id}/elements",
            post(find_elements_from_element),
        )
        .route(
            "/session/{session_id}/element/{element_id}/click",
            post(click_element),
        )
        .route(
            "/session/{session_id}/element/{element_id}/text",
            get(get_element_text),
        )
        .route(
            "/session/{session_id}/element/{element_id}/name",
            get(get_element_tag_name),
        )
        .route(
            "/session/{session_id}/element/{element_id}/attribute/{name}",
            get(get_element_attribute),
        )
        .route(
            "/session/{session_id}/element/{element_id}/css/{property_name}",
            get(get_element_css_value),
        )
        .route(
            "/session/{session_id}/element/{element_id}/displayed",
            get(is_element_displayed),
        )
        .route(
            "/session/{session_id}/element/{element_id}/enabled",
            get(is_element_enabled),
        )
        .route(
            "/session/{session_id}/element/{element_id}/rect",
            get(get_element_rect),
        )
        .route(
            "/session/{session_id}/element/{element_id}/clear",
            post(clear_element),
        )
        .route(
            "/session/{session_id}/element/{element_id}/value",
            post(send_keys_to_element),
        )
        // Actions
        .route("/session/{session_id}/actions", post(perform_actions))
        .route(
            "/session/{session_id}/actions",
            delete(release_actions),
        )
        // Screenshots
        .route(
            "/session/{session_id}/screenshot",
            get(take_screenshot),
        )
        .route(
            "/session/{session_id}/element/{element_id}/screenshot",
            get(take_element_screenshot),
        )
        // Script execution
        .route(
            "/session/{session_id}/execute/sync",
            post(execute_script),
        )
        .layer(cors)
        .with_state(state)
}

/// The JS bridge script to inject into the WebView
const BRIDGE_JS: &str = include_str!("webdriver_bridge.js");

/// Start the WebDriver server on the given port.
/// This should be called from the Tauri setup hook.
pub fn start_server(app_handle: AppHandle, port: u16) {
    let state = Arc::new(WebDriverState::new(app_handle.clone()));
    let state_for_server = state.clone();

    // Inject the JS bridge into the WebView
    let app_for_inject = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        // Wait for the window to be ready
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;

        if let Some(window) = app_for_inject.get_webview_window("main") {
            // Set the bridge port before injecting the bridge script
            let port_js = format!("window.__TEST_BRIDGE_PORT = {};", port);
            if let Err(e) = window.eval(&port_js) {
                log::error!("[webdriver] Failed to set bridge port: {}", e);
                return;
            }

            if let Err(e) = window.eval(BRIDGE_JS) {
                log::error!("[webdriver] Failed to inject bridge JS: {}", e);
            } else {
                log::info!("[webdriver] Bridge JS injected successfully");
            }
        } else {
            log::error!("[webdriver] No main window found for bridge injection");
        }
    });

    // Start the HTTP server
    tauri::async_runtime::spawn(async move {
        let router = build_router(state_for_server);
        let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
        log::info!("[webdriver] Starting WebDriver server on http://{}", addr);

        let listener = tokio::net::TcpListener::bind(addr)
            .await
            .expect("failed to bind WebDriver server port");

        axum::serve(listener, router)
            .await
            .expect("WebDriver server failed");
    });
}
