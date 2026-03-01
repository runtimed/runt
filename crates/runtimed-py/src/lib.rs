//! Python bindings for runtimed daemon client.
//!
//! Provides Python classes for:
//! - `DaemonClient`: Low-level daemon operations (status, ping, list rooms)
//! - `Session`: High-level code execution with kernel management
//!
//! Both sync and async APIs are provided.

use pyo3::prelude::*;

mod client;
mod error;
mod output;
mod session;

use client::DaemonClient;
use error::RuntimedError;
use output::{Cell, ExecutionResult, Output};
use session::Session;

/// Python module for runtimed daemon client.
#[pymodule]
fn runtimed(m: &Bound<'_, PyModule>) -> PyResult<()> {
    // Core classes
    m.add_class::<DaemonClient>()?;
    m.add_class::<Session>()?;

    // Output types
    m.add_class::<Cell>()?;
    m.add_class::<ExecutionResult>()?;
    m.add_class::<Output>()?;

    // Error type
    m.add("RuntimedError", m.py().get_type::<RuntimedError>())?;

    Ok(())
}
