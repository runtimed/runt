use clap::Parser;
use clap::Subcommand;
use futures::stream::StreamExt;
use reqwest_eventsource::{Event, EventSource};
use runtimed::execution::CodeExecutionOutput;
use runtimelib::jupyter::client::JupyterRuntime;
use runtimelib::jupyter::client::RuntimeId;
use runtimelib::jupyter::KernelspecDir;
use std::collections::HashMap;

use anyhow::Error;

use tabled::{
    builder::Builder,
    settings::{object::Rows, themes::Colorization, Color, Style},
    Table, Tabled,
};

/** Runtime 🔄  */
#[derive(Parser, Debug)]
#[clap(author, version, about, long_about = None)]
struct Cli {
    /// Commands to interact with runtimes
    #[clap(subcommand)]
    command: Commands,
}

#[derive(Debug, Subcommand)]
enum Commands {
    /// Start a new runtime
    Run { kernel_name: String },
    /// List running runtimes
    Ps,
    /// Attach and stream messages from runtime
    Attach { id: String },
    /// Run code on a specific runtime
    Exec { id: String, code: String },
    /// Evaluate code on a specific runtime and return output
    Eval { id: String, code: String },
    /// Get results from a previous execution
    GetResults { id: String },
    /// List available environments (Jupyter kernelspecs)
    Environments,
    /// Shutdown a runtime
    Stop { id: String },
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Ps => {
            list_instances().await?;
        }
        Commands::Attach { id } => {
            attach(id).await?;
        }
        Commands::Exec { id, code } => {
            run_code(id, code).await?;
        }
        Commands::Eval { id, code } => {
            eval_code(id, code).await?;
        }
        Commands::GetResults { id } => {
            execution(id).await?;
        }
        Commands::Environments => {
            list_environments().await?;
        }
        Commands::Run { kernel_name } => {
            start_runtime(&kernel_name).await?;
        }
        Commands::Stop { id } => {
            stop_runtime(&id).await?;
        }
    }

    Ok(())
}

#[derive(Tabled)]
struct RuntimeDisplay {
    #[tabled(rename = "Kernel Name")]
    kernel_name: String,
    #[tabled(rename = "Language")]
    language: String,
    #[tabled(rename = "ID")]
    id: RuntimeId,
    #[tabled(rename = "IP")]
    ip: String,
    #[tabled(rename = "Transport")]
    transport: String,
    #[tabled(rename = "Connection File", skip)]
    #[allow(dead_code)] // Reserved for later use
    connection_file: String,
    #[tabled(rename = "State")]
    state: String,
}

async fn list_instances() -> Result<(), Error> {
    let runtimes = reqwest::get("http://127.0.0.1:12397/v0/runtime_instances")
        .await?
        .json::<Vec<JupyterRuntime>>()
        .await?;

    let displays: Vec<RuntimeDisplay> = runtimes
        .into_iter()
        .map(|runtime| RuntimeDisplay {
            kernel_name: runtime
                .connection_info
                .kernel_name
                .unwrap_or("unknown".to_string())
                .chars()
                .take(15)
                .collect(),
            id: runtime.id,
            ip: runtime.connection_info.ip,
            transport: runtime.connection_info.transport,
            connection_file: runtime.connection_file.display().to_string(),
            state: runtime.state,
            language: runtime
                .kernel_info
                .map_or("unknown".to_string(), |info| info.language_info.name),
        })
        .collect();

    if !displays.is_empty() {
        let table = Table::new(displays)
            .with(Style::rounded())
            .with(Colorization::exact([Color::BOLD], Rows::first()))
            .to_string();
        println!("{}", table);
    } else {
        println!("No Jupyter runtimes running.");
    }

    Ok(())
}

async fn run_code(id: String, code: String) -> Result<(), Error> {
    let client = reqwest::Client::new();
    let response = client
        .post(format!(
            "http://127.0.0.1:12397/v0/runtime_instances/{}/run_code",
            id,
        ))
        .json(&HashMap::from([("code", code)]))
        .send()
        .await?
        .text()
        .await?;

    // Deserialize the response
    let response: serde_json::Value = serde_json::from_str(&response)?;

    println!("Execution {} submitted, run\n", response["msg_id"]);
    println!("runt get-results {}", response["msg_id"]);
    println!("\nto get the results of the execution.");

    Ok(())
}

async fn eval_code(id: String, code: String) -> Result<(), Error> {
    let client = reqwest::Client::new();
    let response = client
        .post(format!(
            "http://127.0.0.1:12397/v0/runtime_instances/{}/eval_code",
            id,
        ))
        .json(&HashMap::from([("code", code)]))
        .send()
        .await?
        .text()
        .await?;

    let response: CodeExecutionOutput = serde_json::from_str(&response)?;

    println!("Execution: {response}\n");
    Ok(())
}

async fn execution(id: String) -> Result<(), Error> {
    let response = reqwest::get(format!("http://127.0.0.1:12397/v0/executions/{}", id))
        .await?
        .json::<Vec<serde_json::Value>>()
        .await?;

    // Collect all the status: idle -> busy -> idle messages to determine when this started and stopped
    let status_changes = response
        .iter()
        .filter(|msg| msg["msg_type"] == "status")
        .map(|msg| {
            (
                msg["content"]["execution_state"].as_str().unwrap_or(""),
                msg["created_at"].as_str().unwrap_or(""),
            )
        })
        .collect::<Vec<_>>();

    let (start_time, end_time) = if let Some((first, rest)) = status_changes.split_first() {
        // Destructure the tuple (execution_state, created_at) for both first and last
        let (_, first_time) = first;
        let (_, last_time) = rest.last().unwrap_or(&("", ""));

        // Dereference both first_time and last_time to get &str from &&str
        (*first_time, *last_time)
    } else {
        ("", "")
    };

    let status = response
        .last()
        .map(|msg| {
            msg["content"]["execution_state"]
                .as_str()
                .unwrap_or("unknown")
        })
        .unwrap_or("unknown");

    let code = response
        .iter()
        .find(|msg| msg["msg_type"] == "execute_input")
        .map(|msg| msg["content"]["code"].as_str().unwrap_or(""));

    let results = response
        .iter()
        .filter_map(|msg| match msg["msg_type"].as_str() {
            Some("execute_result") | Some("display_data") => msg["content"]["data"]["text/plain"]
                .as_str()
                .map(ToString::to_string),
            Some("stream") => msg["content"]["text"].as_str().map(ToString::to_string),
            Some("error") => Some(format!(
                "Error: {}",
                msg["content"]["evalue"]
                    .as_str()
                    .unwrap_or("<unknown error>")
            )),
            _ => None,
        })
        .collect::<Vec<_>>();

    let mut builder = Builder::default();

    builder.push_record(vec!["Execution Results"]);
    builder.push_record(vec![format!("Execution ID: {}", id)]);
    builder.push_record(vec![format!("Status: {}", status)]);
    builder.push_record(vec![format!("Started: {}", start_time)]);
    builder.push_record(vec![format!("Finished: {}", end_time)]);
    builder.push_record(vec![""]);

    // Code "block"
    builder.push_record(vec!["-- Code --"]);
    builder.push_record(vec![code.unwrap_or("").to_string()]);
    builder.push_record(vec![""]);
    builder.push_record(vec!["-- Output --"]);
    for result in results {
        builder.push_record(vec![result.to_string()]);
    }
    builder.push_record(vec![""]);

    let table = builder.build().with(Style::rounded()).to_string();

    println!("{}", table);

    Ok(())
}

#[derive(Tabled)]
struct EnvironmentDisplay {
    #[tabled(rename = "Kernel Name")]
    kernel_name: String,
    #[tabled(rename = "Language")]
    language: String,
    #[tabled(rename = "Path")]
    path: String,
}

async fn list_environments() -> Result<(), Error> {
    // For now we're just transparently passing through the jupyter kernelspecs without regard for the python environments
    // and possible divergence
    let kernelspecs = reqwest::get("http://127.0.0.1:12397/v0/environments")
        .await?
        .json::<Vec<KernelspecDir>>()
        .await?;

    let displays: Vec<EnvironmentDisplay> = kernelspecs
        .iter()
        .map(|kernelspecdir| EnvironmentDisplay {
            kernel_name: kernelspecdir.kernel_name.clone(),
            language: kernelspecdir.kernelspec.language.clone(),
            path: kernelspecdir.path.display().to_string(),
        })
        .collect();

    if !displays.is_empty() {
        let table = Table::new(displays)
            .with(Style::rounded())
            .with(Colorization::exact([Color::BOLD], Rows::first()))
            .to_string();
        println!("{}", table);
    } else {
        println!("No Jupyter environments found.");
    }

    Ok(())
}

async fn attach(id: String) -> Result<(), Error> {
    let mut es = EventSource::get(format!(
        "http://127.0.0.1:12397/v0/runtime_instances/{}/attach",
        id,
    ));
    while let Some(event) = es.next().await {
        match event {
            Ok(Event::Open) => eprintln!("Connection Open!"),
            Ok(Event::Message(message)) => println!("{}", message.data),
            Err(err) => {
                eprintln!("Error: {}", err);
                es.close();
            }
        }
    }
    Ok(())
}

async fn start_runtime(kernel_name: &String) -> Result<(), Error> {
    let client = reqwest::Client::new();
    let response: JupyterRuntime = client
        .post("http://127.0.0.1:12397/v0/runtime_instances")
        .json(&HashMap::from([("environment", kernel_name)]))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    println!("New runtime instance: {}", response.id);
    Ok(())
}

async fn stop_runtime(id: &String) -> Result<(), Error> {
    let client = reqwest::Client::new();
    client
        .delete(format!("http://127.0.0.1:12397/v0/runtime_instances/{id}"))
        .send()
        .await?
        .error_for_status()?;

    Ok(())
}
