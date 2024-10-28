use anyhow::Result;
use clap::Parser;
use std::{
    borrow::Cow,
    sync::{Arc, Mutex},
};
use tao::{
    dpi::Size,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoop},
    window::WindowBuilder,
};
use wry::{
    http::{Method, Request, Response},
    WebViewBuilder,
};

#[derive(Parser)]
#[clap(name = "sidecar", version = "0.1.0", author = "Kyle Kelley")]
struct Cli {
    /// connection file to a jupyter kernel
    file: std::path::PathBuf,
}

fn main() -> Result<()> {
    let args = Cli::parse();
    let (width, height) = (960.0, 550.0);
    let current_query = Arc::new(Mutex::new(String::new()));

    if !args.file.exists() {
        anyhow::bail!("Invalid file provided");
    }

    let event_loop = EventLoop::new();
    let window = WindowBuilder::new()
        .with_title("kernel sidecar")
        .with_inner_size(Size::Logical((width, height).into()))
        .build(&event_loop)
        .unwrap();

    let _webview = WebViewBuilder::new(&window)
        .with_devtools(true)
        .with_asynchronous_custom_protocol("sidecar".into(), move |request, responder| {
            let response = get_response(request).map_err(|e| {
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

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        if let Event::WindowEvent {
            event: WindowEvent::CloseRequested,
            ..
        } = event
        {
            // let sql = current_query.lock().unwrap();
            // println!("{}", sql.replace("\"df\"", from.as_ref()));
            *control_flow = ControlFlow::Exit
        }
    });
}

enum Action {
    Arrow,
    Json,
    Exec,
}

impl<T> TryFrom<&Request<T>> for Action {
    type Error = anyhow::Error;
    fn try_from(value: &Request<T>) -> Result<Self> {
        let Some(query) = value.uri().query() else {
            anyhow::bail!("no query string found");
        };
        for (k, v) in querystring::querify(query) {
            if !k.eq("type") {
                continue;
            }
            match v {
                "arrow" => return Ok(Self::Arrow),
                "json" => return Ok(Self::Json),
                "exec" => return Ok(Self::Exec),
                _ => anyhow::bail!("Invalid action"),
            };
        }
        anyhow::bail!("Invalid action")
    }
}

fn get_response(request: Request<Vec<u8>>) -> Result<Response<Cow<'static, [u8]>>> {
    match (request.method(), request.uri().path()) {
        (&Method::GET, "/") => Ok(Response::builder()
            .header("Content-Type", "text/html")
            .status(200)
            .body(include_bytes!("./static/index.html").into())
            .unwrap()),
        (&Method::GET, "/widget.js") => Ok(Response::builder()
            .header("Content-Type", "application/javascript")
            .status(200)
            .body(include_bytes!("./static/widget.js").into())
            .unwrap()),
        _ => Ok(Response::builder()
            .header("Content-Type", "text/plain")
            .status(404)
            .body("Not Found".as_bytes().to_vec().into())
            .unwrap()),
    }
}
