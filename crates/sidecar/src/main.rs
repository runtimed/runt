use anyhow::Result;
use base64::prelude::*;
use bytes::Bytes;
use clap::Parser;
use futures::StreamExt;
use runtimelib::{Channel, ConnectionInfo, Header, JupyterMessage, JupyterMessageContent};
use serde::{Deserialize, Serialize, Serializer};
use serde_json::Value;
use std::path::PathBuf;
use tao::{
    dpi::Size,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoop, EventLoopBuilder},
    window::{Window, WindowBuilder},
};
use wry::{
    http::{Method, Request, Response},
    WebViewBuilder,
};

#[derive(Parser)]
#[clap(name = "sidecar", version = "0.1.0", author = "Kyle Kelley")]
struct Cli {
    /// connection file to a jupyter kernel
    file: PathBuf,
}

#[derive(Serialize, Deserialize)]
struct WryJupyterMessage {
    // Note: I skipped zmq_identities, thinking we don't need them for this
    header: Header,
    parent_header: Option<Header>,
    metadata: Value,
    content: JupyterMessageContent,
    #[serde(
        serialize_with = "serialize_base64",
        deserialize_with = "deserialize_base64"
    )]
    buffers: Vec<Bytes>,
    channel: Option<Channel>,
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

fn deserialize_base64<'de, D>(deserializer: D) -> Result<Vec<Bytes>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let encoded: Vec<String> = Vec::deserialize(deserializer)?;
    encoded
        .iter()
        .map(|s| {
            BASE64_STANDARD
                .decode(s)
                .map(Bytes::from)
                .map_err(serde::de::Error::custom)
        })
        .collect()
}

async fn run(
    connection_file_path: &PathBuf,
    event_loop: EventLoop<JupyterMessage>,
    window: Window,
) -> anyhow::Result<()> {
    let connection_info = ConnectionInfo::from_path(connection_file_path).await?;

    let mut iopub = connection_info
        .create_client_iopub_connection("", &format!("sidecar-{}", uuid::Uuid::new_v4()))
        .await?;

    let mut shell = connection_info
        .create_client_shell_connection(&iopub.session_id)
        .await?;

    let (tx, mut rx) = futures::channel::mpsc::channel::<JupyterMessage>(100);

    smol::spawn(async move {
        while let Some(message) = rx.next().await {
            if let Err(e) = shell.send(message).await {
                eprintln!("Failed to send message: {}", e);
                break;
            }
            let resp = shell.read().await;
            dbg!(&resp);
        }
    })
    .detach();

    let webview = WebViewBuilder::new(&window)
        .with_devtools(true)
        .with_asynchronous_custom_protocol("sidecar".into(), move |req, responder| {
            if let (&Method::POST, "/message") = (req.method(), req.uri().path()) {
                match serde_json::from_slice::<WryJupyterMessage>(req.body()) {
                    Ok(wry_message) => {
                        let message: JupyterMessage = wry_message.into();

                        dbg!(&message);

                        let mut tx = tx.clone();

                        if let Err(e) = tx.try_send(message) {
                            eprintln!("Failed to send message: {}", e);
                        }
                        responder.respond(Response::builder().status(200).body(&[]).unwrap());
                        return;
                    }
                    Err(e) => {
                        eprintln!("Failed to deserialize message: {}", e);
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
            let response = get_response(req).map_err(|e| {
                eprintln!("{:?}", e);
                e
            });
            match response {
                Ok(response) => responder.respond(response),
                Err(e) => {
                    eprintln!("{:?}", e);
                    responder.respond(
                        Response::builder()
                            .status(500)
                            .body("Internal Server Error".as_bytes().to_vec())
                            .unwrap(),
                    )
                }
            }
        })
        .with_url("sidecar://localhost")
        .build()?;

    let event_loop_proxy = event_loop.create_proxy();

    smol::spawn(async move {
        while let Ok(message) = iopub.read().await {
            match event_loop_proxy.send_event(message) {
                Ok(_) => {}
                Err(e) => {
                    eprintln!("{:?}", e);
                    break;
                }
            };
        }
    })
    .detach();

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        match event {
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                *control_flow = ControlFlow::Exit;
            }
            Event::UserEvent(data) => {
                let serialized: WryJupyterMessage = data.into();
                match serde_json::to_string(&serialized) {
                    Ok(serialized_message) => {
                        webview
                            .evaluate_script(&format!(
                                r#"globalThis.onMessage({})"#,
                                serialized_message
                            ))
                            .expect("Failed to evaluate script");
                    }
                    Err(e) => eprintln!("Failed to serialize message: {}", e),
                }
            }
            _ => {}
        }
    });
}

fn main() -> Result<()> {
    let args = Cli::parse();
    let (width, height) = (960.0, 550.0);

    if !args.file.exists() {
        anyhow::bail!("Invalid file provided");
    }
    let connection_file = args.file;

    let event_loop: EventLoop<JupyterMessage> = EventLoopBuilder::with_user_event().build();

    let window = WindowBuilder::new()
        .with_title("kernel sidecar")
        .with_inner_size(Size::Logical((width, height).into()))
        .build(&event_loop)
        .unwrap();

    smol::block_on(run(&connection_file, event_loop, window))
}

fn get_response(request: Request<Vec<u8>>) -> Result<Response<Vec<u8>>> {
    match (request.method(), request.uri().path()) {
        (&Method::GET, "/") => Ok(Response::builder()
            .header("Content-Type", "text/html")
            .status(200)
            .body(include_bytes!("./static/index.html").into())
            .unwrap()),
        (&Method::GET, "/main.js") => Ok(Response::builder()
            .header("Content-Type", "application/javascript")
            .status(200)
            .body(include_bytes!("./static/main.js").into())
            .unwrap()),
        _ => Ok(Response::builder()
            .header("Content-Type", "text/plain")
            .status(404)
            .body("Not Found".as_bytes().to_vec())
            .unwrap()),
    }
}
