use anyhow::Result;
use base64::prelude::*;
use bytes::Bytes;
use env_logger;
use futures::future::{select, Either};
use futures::StreamExt;
use log::{debug, error, info};
use rust_embed::Embed;
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

use jupyter_protocol::{
    media::MediaType, Channel, ConnectionInfo, ExecuteRequest, ExpressionResult, Header,
    JupyterMessage, JupyterMessageContent, KernelInfoRequest,
};

use serde::{Deserialize, Serialize, Serializer};
use serde_json::Value;
use tokio::fs;
use std::path::PathBuf;
use tao::{
    dpi::Size,
    event::{ElementState, Event, WindowEvent},
    event_loop::{ControlFlow, EventLoop, EventLoopBuilder},
    keyboard::{Key, ModifiersState},
    window::{Window, WindowBuilder},
};
use wry::{
    http::{Method, Request, Response},
    WebViewBuilder,
};

#[derive(Embed)]
#[folder = "../../packages/sidecar-ui/dist"]
struct Asset;

#[derive(Serialize)]
struct WryJupyterMessage {
    // Note: I skipped zmq_identities, thinking we don't need them for this
    header: Header,
    parent_header: Option<Header>,
    metadata: Value,
    content: JupyterMessageContent,
    #[serde(serialize_with = "serialize_base64")]
    buffers: Vec<Bytes>,
    channel: Option<Channel>,
}

#[derive(Debug, Clone)]
enum SidecarEvent {
    JupyterMessage(JupyterMessage),
    KernelCwd { cwd: String },
}

impl<'de> Deserialize<'de> for WryJupyterMessage {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        struct WryJupyterMessageHelper {
            header: Header,
            #[serde(default)]
            parent_header: Option<Header>,
            #[serde(default)]
            metadata: Value,
            content: Value,
            #[serde(default, deserialize_with = "deserialize_base64_opt")]
            buffers: Vec<Bytes>,
            #[serde(default)]
            channel: Option<Channel>,
        }

        let helper = WryJupyterMessageHelper::deserialize(deserializer)?;
        let content: JupyterMessageContent =
            JupyterMessageContent::from_type_and_content(&helper.header.msg_type, helper.content)
                .map_err(serde::de::Error::custom)?;

        Ok(WryJupyterMessage {
            header: helper.header,
            parent_header: helper.parent_header,
            metadata: helper.metadata,
            content: content,
            buffers: helper.buffers,
            channel: helper.channel,
        })
    }
}

impl From<JupyterMessage> for WryJupyterMessage {
    fn from(msg: JupyterMessage) -> Self {
        WryJupyterMessage {
            header: msg.header,
            parent_header: msg.parent_header,
            metadata: msg.metadata,
            content: msg.content,
            buffers: msg.buffers,
            channel: msg.channel,
        }
    }
}

impl From<WryJupyterMessage> for JupyterMessage {
    fn from(msg: WryJupyterMessage) -> Self {
        JupyterMessage {
            // todo!(): figure out if we need to set this
            zmq_identities: Vec::new(),
            header: msg.header,
            parent_header: msg.parent_header,
            metadata: msg.metadata,
            content: msg.content,
            buffers: msg.buffers,
            channel: msg.channel,
        }
    }
}

// Custom serializer for Base64 encoding for buffers
fn serialize_base64<S>(data: &[Bytes], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    data.iter()
        .map(|bytes| BASE64_STANDARD.encode(bytes))
        .collect::<Vec<_>>()
        .serialize(serializer)
}

fn deserialize_base64_opt<'de, D>(deserializer: D) -> Result<Vec<Bytes>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let encoded: Option<Vec<String>> = Option::deserialize(deserializer)?;
    match encoded {
        Some(vec) => vec
            .iter()
            .map(|s| {
                BASE64_STANDARD
                    .decode(s)
                    .map(Bytes::from)
                    .map_err(serde::de::Error::custom)
            })
            .collect(),
        None => Ok(Vec::new()),
    }
}

async fn run(
    connection_file_path: &PathBuf,
    event_loop: EventLoop<SidecarEvent>,
    window: Window,
    dump_file: Option<Arc<Mutex<std::fs::File>>>,
) -> anyhow::Result<()> {
    let content = fs::read_to_string(&connection_file_path).await?;
    let connection_info = serde_json::from_str::<ConnectionInfo>(&content)?;

    let mut iopub = runtimelib::create_client_iopub_connection(
        &connection_info,
        "",
        &format!("sidecar-{}", uuid::Uuid::new_v4()),
    )
    .await?;

    let shell =
        runtimelib::create_client_shell_connection(&connection_info, &iopub.session_id).await?;
    let (mut shell_writer, mut shell_reader) = shell.split();

    let event_loop_proxy = event_loop.create_proxy();

    // Send half: forward messages from UI to kernel
    let (tx, mut rx) = futures::channel::mpsc::channel::<JupyterMessage>(100);
    tokio::spawn(async move {
        while let Some(message) = rx.next().await {
            if let Err(e) = shell_writer.send(message).await {
                error!("Failed to send message: {}", e);
            }
        }
    });

    // Recv half: read shell replies and forward to UI
    let shell_event_proxy = event_loop_proxy.clone();
    tokio::spawn(async move {
        while let Ok(message) = shell_reader.read().await {
            if let Err(e) = shell_event_proxy.send_event(SidecarEvent::JupyterMessage(message)) {
                error!("Failed to forward shell reply: {:?}", e);
                break;
            }
        }
    });

    let ui_ready = Arc::new(AtomicBool::new(false));
    let pending_kernel_info: Arc<Mutex<Option<JupyterMessage>>> = Arc::new(Mutex::new(None));
    let pending_kernel_cwd: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

    let ui_ready_handler = ui_ready.clone();
    let pending_kernel_info_handler = pending_kernel_info.clone();
    let pending_kernel_cwd_handler = pending_kernel_cwd.clone();
    let kernel_info_proxy = event_loop_proxy.clone();

    let webview = WebViewBuilder::new()
        .with_devtools(true)
        .with_asynchronous_custom_protocol("sidecar".into(), move |_webview_id, req, responder| {
            if let (&Method::POST, "/message") = (req.method(), req.uri().path()) {
                match serde_json::from_slice::<WryJupyterMessage>(req.body()) {
                    Ok(wry_message) => {
                        let message: JupyterMessage = wry_message.into();

                        info!(
                            "Sending message to shell: type={}, comm_id={:?}",
                            message.header.msg_type,
                            match &message.content {
                                JupyterMessageContent::CommMsg(c) => Some(c.comm_id.clone()),
                                _ => None,
                            }
                        );

                        let mut tx = tx.clone();

                        if let Err(e) = tx.try_send(message) {
                            error!("Failed to send message to shell channel: {}", e);
                        } else {
                            info!("Message sent to shell channel successfully");
                        }
                        responder.respond(Response::builder().status(200).body(&[]).unwrap());
                        return;
                    }
                    Err(e) => {
                        error!("Failed to deserialize message: {}", e);
                        responder.respond(
                            Response::builder()
                                .status(400)
                                .body("Bad Request".as_bytes().to_vec())
                                .unwrap(),
                        );
                        return;
                    }
                }
            };

            if let (&Method::POST, "/ready") = (req.method(), req.uri().path()) {
                ui_ready_handler.store(true, Ordering::SeqCst);
                if let Ok(mut pending) = pending_kernel_info_handler.lock() {
                    if let Some(message) = pending.take() {
                        let _ = kernel_info_proxy.send_event(SidecarEvent::JupyterMessage(message));
                    }
                }
                if let Ok(mut pending) = pending_kernel_cwd_handler.lock() {
                    if let Some(cwd) = pending.take() {
                        let _ = kernel_info_proxy.send_event(SidecarEvent::KernelCwd { cwd });
                    }
                }
                responder
                    .respond(Response::builder().status(204).body(Vec::new()).unwrap());
                return;
            }
            let response = get_response(req).map_err(|e| {
                error!("{:?}", e);
                e
            });
            match response {
                Ok(response) => responder.respond(response),
                Err(e) => {
                    error!("{:?}", e);
                    responder.respond(
                        Response::builder()
                            .status(500)
                            .body("Internal Server Error".as_bytes().to_vec())
                            .unwrap(),
                    )
                }
            }
        });

    let kernel_label = connection_file_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("kernel");
    let kernel_query = querystring::stringify(vec![("kernel", kernel_label)]);
    let ui_url = format!("sidecar://localhost/?{}", kernel_query);

    let webview = webview
        .with_url(&ui_url)
        .build(&window)?;

    let kernel_info_connection = connection_info.clone();
    let kernel_info_session_id = iopub.session_id.clone();
    let kernel_info_proxy = event_loop_proxy.clone();
    let kernel_info_ready = ui_ready.clone();
    let kernel_info_pending = pending_kernel_info.clone();
    let kernel_cwd_pending = pending_kernel_cwd.clone();
    tokio::spawn(async move {
        for attempt in 0..3 {
            if let Some(message) = request_kernel_info(
                &kernel_info_connection,
                &kernel_info_session_id,
                Duration::from_secs(2),
            )
            .await
            {
                let kernel_language = match &message.content {
                    JupyterMessageContent::KernelInfoReply(reply) => {
                        Some(reply.language_info.name.clone())
                    }
                    _ => None,
                };
                if kernel_info_ready.load(Ordering::SeqCst) {
                    let _ =
                        kernel_info_proxy.send_event(SidecarEvent::JupyterMessage(message.clone()));
                } else if let Ok(mut pending) = kernel_info_pending.lock() {
                    *pending = Some(message.clone());
                }

                if kernel_language.as_deref() == Some("python") {
                    if let Some(cwd) = request_python_cwd(
                        &kernel_info_connection,
                        &kernel_info_session_id,
                        Duration::from_secs(2),
                    )
                    .await
                    {
                        if kernel_info_ready.load(Ordering::SeqCst) {
                            let _ = kernel_info_proxy.send_event(SidecarEvent::KernelCwd { cwd });
                        } else if let Ok(mut pending) = kernel_cwd_pending.lock() {
                            *pending = Some(cwd);
                        }
                    }
                }
                return;
            }
            if attempt < 2 {
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
        }
        debug!("kernel_info_reply not received after retries");
    });

    tokio::spawn(async move {
        while let Ok(message) = iopub.read().await {
            // Log ALL messages from iopub for debugging
            info!(
                "iopub message: type={}, comm_id={:?}",
                message.header.msg_type,
                match &message.content {
                    JupyterMessageContent::CommOpen(c) => Some(c.comm_id.clone()),
                    JupyterMessageContent::CommMsg(c) => Some(c.comm_id.clone()),
                    JupyterMessageContent::CommClose(c) => Some(c.comm_id.clone()),
                    _ => None,
                }
            );

            // Dump message to file if enabled
            if let Some(ref file) = dump_file {
                let serialized: WryJupyterMessage = message.clone().into();
                if let Ok(json) = serde_json::to_string(&serialized) {
                    if let Ok(mut f) = file.lock() {
                        let _ = writeln!(f, "{}", json);
                        let _ = f.flush();
                    }
                }
            }

            match event_loop_proxy.send_event(SidecarEvent::JupyterMessage(message)) {
                Ok(_) => {
                    debug!("Sent message to event loop");
                }
                Err(e) => {
                    error!("Failed to send message to event loop: {:?}", e);
                    break;
                }
            };
        }
    });

    // Track modifier keys for keyboard shortcuts
    let mut modifiers = ModifiersState::default();

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        match event {
            Event::WindowEvent {
                event: WindowEvent::ModifiersChanged(new_modifiers),
                ..
            } => {
                modifiers = new_modifiers;
            }
            Event::WindowEvent {
                event:
                    WindowEvent::KeyboardInput {
                        event: key_event, ..
                    },
                ..
            } => {
                // Cmd+Option+I to open devtools (macOS)
                // Ctrl+Shift+I on other platforms
                if key_event.state == ElementState::Pressed {
                    let is_devtools_shortcut = if cfg!(target_os = "macos") {
                        modifiers.super_key()
                            && modifiers.alt_key()
                            && key_event.logical_key == Key::Character("i".into())
                    } else {
                        modifiers.control_key()
                            && modifiers.shift_key()
                            && key_event.logical_key == Key::Character("I".into())
                    };

                    #[cfg(debug_assertions)]
                    if is_devtools_shortcut {
                        info!("Opening devtools");
                        webview.open_devtools();
                    }
                    #[cfg(not(debug_assertions))]
                    let _ = is_devtools_shortcut; // Silence unused variable warning
                }
            }
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                *control_flow = ControlFlow::Exit;
            }
            Event::UserEvent(data) => match data {
                SidecarEvent::JupyterMessage(message) => {
                    debug!("Received UserEvent message: {}", message.header.msg_type);
                    let serialized: WryJupyterMessage = message.into();
                    match serde_json::to_string(&serialized) {
                        Ok(serialized_message) => {
                            webview
                                .evaluate_script(&format!(
                                    r#"globalThis.onMessage({})"#,
                                    serialized_message
                                ))
                                .unwrap_or_else(|e| error!("Failed to evaluate script: {:?}", e));
                        }
                        Err(e) => error!("Failed to serialize message: {}", e),
                    }
                }
                SidecarEvent::KernelCwd { cwd } => {
                    let payload = serde_json::json!({
                        "type": "kernel_cwd",
                        "cwd": cwd,
                    });
                    if let Ok(serialized_payload) = serde_json::to_string(&payload) {
                        webview
                            .evaluate_script(&format!(
                                r#"globalThis.onSidecarInfo({})"#,
                                serialized_payload
                            ))
                            .unwrap_or_else(|e| error!("Failed to evaluate script: {:?}", e));
                    }
                }
            },
            _ => {}
        }
    });
}

async fn request_kernel_info(
    connection_info: &ConnectionInfo,
    session_id: &str,
    timeout: Duration,
) -> Option<JupyterMessage> {
    let mut shell = match runtimelib::create_client_shell_connection(connection_info, session_id)
        .await
    {
        Ok(shell) => shell,
        Err(e) => {
            error!("Failed to create kernel info shell connection: {}", e);
            return None;
        }
    };

    let request: JupyterMessage = KernelInfoRequest::default().into();
    if let Err(e) = shell.send(request).await {
        error!("Failed to send kernel_info_request: {}", e);
        return None;
    }

    let result = select(
        Box::pin(shell.read()),
        Box::pin(tokio::time::sleep(timeout)),
    )
    .await;

    match result {
        Either::Left((Ok(message), _)) => {
            if message.header.msg_type == "kernel_info_reply" {
                Some(message)
            } else {
                None
            }
        }
        Either::Left((Err(e), _)) => {
            error!("Failed to read kernel_info_reply: {}", e);
            None
        }
        Either::Right((_timeout, _)) => None,
    }
}

async fn request_python_cwd(
    connection_info: &ConnectionInfo,
    session_id: &str,
    timeout: Duration,
) -> Option<String> {
    let mut shell = match runtimelib::create_client_shell_connection(connection_info, session_id)
        .await
    {
        Ok(shell) => shell,
        Err(e) => {
            error!("Failed to create cwd shell connection: {}", e);
            return None;
        }
    };

    let mut user_expressions = HashMap::new();
    user_expressions.insert("cwd".to_string(), "__import__('os').getcwd()".to_string());
    let request = ExecuteRequest {
        code: String::new(),
        silent: true,
        store_history: false,
        user_expressions: Some(user_expressions),
        allow_stdin: false,
        stop_on_error: false,
    };

    if let Err(e) = shell.send(request.into()).await {
        error!("Failed to send cwd execute_request: {}", e);
        return None;
    }

    let result = select(
        Box::pin(shell.read()),
        Box::pin(tokio::time::sleep(timeout)),
    )
    .await;

    match result {
        Either::Left((Ok(message), _)) => {
            if message.header.msg_type != "execute_reply" {
                return None;
            }
            let JupyterMessageContent::ExecuteReply(reply) = message.content else {
                return None;
            };
            let user_expressions = reply.user_expressions?;
            let expression = user_expressions.get("cwd")?;
            match expression {
                ExpressionResult::Ok { data, .. } => data.content.iter().find_map(|media| {
                    if let MediaType::Plain(text) = media {
                        Some(text.clone())
                    } else {
                        None
                    }
                }),
                ExpressionResult::Error { .. } => None,
            }
        }
        Either::Left((Err(e), _)) => {
            error!("Failed to read cwd execute_reply: {}", e);
            None
        }
        Either::Right((_timeout, _)) => None,
    }
}

/// Launch the sidecar viewer for a Jupyter kernel.
///
/// This takes over the current thread to run the GUI event loop.
///
/// # Arguments
/// * `file` - Path to a Jupyter kernel connection file (JSON)
/// * `quiet` - If true, suppress log output
/// * `dump` - Optional path to dump all Jupyter messages as JSON
pub fn launch(file: &Path, quiet: bool, dump: Option<&Path>) -> Result<()> {
    if !quiet {
        env_logger::init();
    }
    info!("Starting sidecar application");
    let (width, height) = (960.0, 550.0);

    if !file.exists() {
        anyhow::bail!("Invalid file provided");
    }
    let connection_file = file.to_path_buf();

    let event_loop: EventLoop<SidecarEvent> = EventLoopBuilder::with_user_event().build();

    let window = WindowBuilder::new()
        .with_title("kernel sidecar")
        .with_inner_size(Size::Logical((width, height).into()))
        .build(&event_loop)
        .unwrap();

    let dump_file = dump.map(|path| {
        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(path)
            .expect("Failed to open dump file");
        info!("Dumping messages to {:?}", path);
        Arc::new(Mutex::new(file))
    });

    let rt = tokio::runtime::Runtime::new()?;
    rt.block_on(run(&connection_file, event_loop, window, dump_file))
}

fn get_response(request: Request<Vec<u8>>) -> Result<Response<Vec<u8>>> {
    if request.method() != &Method::GET {
        return Ok(Response::builder()
            .status(405)
            .body("Method Not Allowed".as_bytes().to_vec())
            .unwrap());
    }

    let path = request.uri().path();

    // Normalize path: "/" -> "index.html", strip leading "/"
    let file_path = if path == "/" {
        "index.html"
    } else {
        path.trim_start_matches('/')
    };

    debug!("Serving asset: {}", file_path);

    match Asset::get(file_path) {
        Some(content) => {
            // Guess MIME type from file extension
            let mime_type = mime_guess::from_path(file_path)
                .first_or_octet_stream()
                .to_string();

            debug!("Found asset {} with mime type {}", file_path, mime_type);

            Ok(Response::builder()
                .header("Content-Type", mime_type)
                .status(200)
                .body(content.data.into_owned())
                .unwrap())
        }
        None => {
            debug!("Asset not found: {}", file_path);
            Ok(Response::builder()
                .header("Content-Type", "text/plain")
                .status(404)
                .body("Not Found".as_bytes().to_vec())
                .unwrap())
        }
    }
}
