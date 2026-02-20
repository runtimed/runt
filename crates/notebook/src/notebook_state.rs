use crate::runtime::Runtime;
use crate::settings::{self, PythonEnvType};
use nbformat::v4::{Cell, CellId, CellMetadata, Notebook, Output};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use uuid::Uuid;

/// Flattened cell representation for the frontend.
/// Converts nbformat's tagged enum into something JS-friendly.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "cell_type")]
pub enum FrontendCell {
    #[serde(rename = "code")]
    Code {
        id: String,
        source: String,
        execution_count: Option<i32>,
        outputs: Vec<serde_json::Value>,
    },
    #[serde(rename = "markdown")]
    Markdown { id: String, source: String },
    #[serde(rename = "raw")]
    Raw { id: String, source: String },
}

impl FrontendCell {
    pub fn id(&self) -> &str {
        match self {
            FrontendCell::Code { id, .. } => id,
            FrontendCell::Markdown { id, .. } => id,
            FrontendCell::Raw { id, .. } => id,
        }
    }
}

/// Convert nbformat Cell -> FrontendCell
pub fn cell_to_frontend(cell: &Cell) -> FrontendCell {
    match cell {
        Cell::Code {
            id,
            source,
            execution_count,
            outputs,
            ..
        } => FrontendCell::Code {
            id: id.to_string(),
            source: source.join(""),
            execution_count: *execution_count,
            outputs: outputs
                .iter()
                .filter_map(|o| serde_json::to_value(o).ok())
                .collect(),
        },
        Cell::Markdown { id, source, .. } => FrontendCell::Markdown {
            id: id.to_string(),
            source: source.join(""),
        },
        Cell::Raw { id, source, .. } => FrontendCell::Raw {
            id: id.to_string(),
            source: source.join(""),
        },
    }
}

/// Convert source string back to nbformat's Vec<String> (lines with newlines).
fn source_to_lines(source: &str) -> Vec<String> {
    if source.is_empty() {
        return Vec::new();
    }
    source.split_inclusive('\n').map(|s| s.to_string()).collect()
}

pub struct NotebookState {
    pub notebook: Notebook,
    pub path: Option<PathBuf>,
    pub dirty: bool,
}

impl NotebookState {
    pub fn new_empty() -> Self {
        // Generate unique environment ID for this notebook
        let env_id = Uuid::new_v4().to_string();

        // Load user's preferred Python environment type from settings
        let app_settings = settings::load_settings();
        let mut additional = HashMap::new();

        // Set up environment metadata based on user's preference
        match app_settings.default_python_env {
            PythonEnvType::Uv => {
                additional.insert(
                    "uv".to_string(),
                    serde_json::json!({
                        "dependencies": Vec::<String>::new(),
                    }),
                );
            }
            PythonEnvType::Conda => {
                additional.insert(
                    "conda".to_string(),
                    serde_json::json!({
                        "dependencies": Vec::<String>::new(),
                        "channels": vec!["conda-forge"],
                    }),
                );
            }
        }

        additional.insert(
            "runt".to_string(),
            serde_json::json!({
                "env_id": env_id,
            }),
        );

        NotebookState {
            notebook: Notebook {
                metadata: nbformat::v4::Metadata {
                    kernelspec: None,
                    language_info: None,
                    authors: None,
                    additional,
                },
                nbformat: 4,
                nbformat_minor: 5,
                cells: vec![Cell::Code {
                    id: CellId::from(Uuid::new_v4()),
                    metadata: empty_cell_metadata(),
                    execution_count: None,
                    source: Vec::new(),
                    outputs: Vec::new(),
                }],
            },
            path: None,
            dirty: false,
        }
    }

    /// Create a new empty notebook with a specific runtime
    pub fn new_empty_with_runtime(runtime: Runtime) -> Self {
        let env_id = Uuid::new_v4().to_string();
        let mut additional = HashMap::new();

        // Set runtime-specific metadata
        match runtime {
            Runtime::Python => {
                // Load user's preferred Python environment type from settings
                let app_settings = settings::load_settings();
                match app_settings.default_python_env {
                    PythonEnvType::Uv => {
                        additional.insert(
                            "uv".to_string(),
                            serde_json::json!({
                                "dependencies": Vec::<String>::new(),
                            }),
                        );
                    }
                    PythonEnvType::Conda => {
                        additional.insert(
                            "conda".to_string(),
                            serde_json::json!({
                                "dependencies": Vec::<String>::new(),
                                "channels": vec!["conda-forge"],
                            }),
                        );
                    }
                }
                additional.insert(
                    "runt".to_string(),
                    serde_json::json!({
                        "env_id": env_id,
                        "runtime": "python",
                    }),
                );
            }
            Runtime::Deno => {
                // Deno setup with default permissions
                additional.insert(
                    "deno".to_string(),
                    serde_json::json!({
                        "permissions": Vec::<String>::new(),
                    }),
                );
                additional.insert(
                    "runt".to_string(),
                    serde_json::json!({
                        "env_id": env_id,
                        "runtime": "deno",
                    }),
                );
            }
        }

        NotebookState {
            notebook: Notebook {
                metadata: nbformat::v4::Metadata {
                    kernelspec: None,
                    language_info: None,
                    authors: None,
                    additional,
                },
                nbformat: 4,
                nbformat_minor: 5,
                cells: vec![Cell::Code {
                    id: CellId::from(Uuid::new_v4()),
                    metadata: empty_cell_metadata(),
                    execution_count: None,
                    source: Vec::new(),
                    outputs: Vec::new(),
                }],
            },
            path: None,
            dirty: false,
        }
    }

    /// Create a new empty Python notebook with conda metadata from an environment.yml config.
    /// Used when creating a new notebook in a directory with environment.yml.
    /// Unlike pyproject.toml, deps are NOT copied into the notebook — they live in the project file.
    /// We just set conda mode with the environment.yml's channels so the UI shows correctly.
    pub fn new_empty_with_conda_from_environment_yml(
        config: &crate::environment_yml::EnvironmentYmlConfig,
    ) -> Self {
        let env_id = Uuid::new_v4().to_string();
        let mut additional = HashMap::new();

        let channels = if config.channels.is_empty() {
            vec!["conda-forge".to_string()]
        } else {
            config.channels.clone()
        };

        additional.insert(
            "conda".to_string(),
            serde_json::json!({
                "dependencies": Vec::<String>::new(),
                "channels": channels,
                "env_id": env_id.clone(),
            }),
        );

        additional.insert(
            "runt".to_string(),
            serde_json::json!({
                "env_id": env_id,
                "runtime": "python",
            }),
        );

        NotebookState {
            notebook: Notebook {
                metadata: nbformat::v4::Metadata {
                    kernelspec: None,
                    language_info: None,
                    authors: None,
                    additional,
                },
                nbformat: 4,
                nbformat_minor: 5,
                cells: vec![Cell::Code {
                    id: CellId::from(Uuid::new_v4()),
                    metadata: empty_cell_metadata(),
                    execution_count: None,
                    source: Vec::new(),
                    outputs: Vec::new(),
                }],
            },
            path: None,
            dirty: false,
        }
    }

    /// Create a new empty Python notebook with UV metadata from a pyproject.toml config.
    /// Used when creating a new notebook in a directory with pyproject.toml.
    pub fn new_empty_with_uv_from_pyproject(config: &crate::pyproject::PyProjectConfig) -> Self {
        let env_id = Uuid::new_v4().to_string();
        let mut additional = HashMap::new();

        let all_deps = crate::pyproject::get_all_dependencies(config);

        additional.insert(
            "uv".to_string(),
            serde_json::json!({
                "dependencies": all_deps,
                "requires-python": config.requires_python,
            }),
        );

        additional.insert(
            "runt".to_string(),
            serde_json::json!({
                "env_id": env_id,
                "runtime": "python",
            }),
        );

        NotebookState {
            notebook: Notebook {
                metadata: nbformat::v4::Metadata {
                    kernelspec: None,
                    language_info: None,
                    authors: None,
                    additional,
                },
                nbformat: 4,
                nbformat_minor: 5,
                cells: vec![Cell::Code {
                    id: CellId::from(Uuid::new_v4()),
                    metadata: empty_cell_metadata(),
                    execution_count: None,
                    source: Vec::new(),
                    outputs: Vec::new(),
                }],
            },
            path: None,
            dirty: false,
        }
    }

    pub fn from_notebook(notebook: Notebook, path: PathBuf) -> Self {
        NotebookState {
            notebook,
            path: Some(path),
            dirty: false,
        }
    }

    /// Get the runtime type from notebook metadata
    pub fn get_runtime(&self) -> Runtime {
        self.notebook
            .metadata
            .additional
            .get("runt")
            .and_then(|v| v.get("runtime"))
            .and_then(|r| r.as_str())
            .and_then(|s| s.parse().ok())
            .unwrap_or(Runtime::Python)
    }

    pub fn cells_for_frontend(&self) -> Vec<FrontendCell> {
        self.notebook.cells.iter().map(cell_to_frontend).collect()
    }

    pub fn find_cell_index(&self, cell_id: &str) -> Option<usize> {
        self.notebook
            .cells
            .iter()
            .position(|c| c.id().as_str() == cell_id)
    }

    pub fn update_cell_source(&mut self, cell_id: &str, source: &str) {
        if let Some(idx) = self.find_cell_index(cell_id) {
            let lines = source_to_lines(source);
            match &mut self.notebook.cells[idx] {
                Cell::Code {
                    source: ref mut s, ..
                } => *s = lines,
                Cell::Markdown {
                    source: ref mut s, ..
                } => *s = lines,
                Cell::Raw {
                    source: ref mut s, ..
                } => *s = lines,
            }
            self.dirty = true;
        }
    }

    pub fn get_cell_source(&self, cell_id: &str) -> Option<String> {
        self.find_cell_index(cell_id).map(|idx| {
            self.notebook.cells[idx].source().join("")
        })
    }

    pub fn add_cell(
        &mut self,
        cell_type: &str,
        after_cell_id: Option<&str>,
    ) -> Option<FrontendCell> {
        let new_id = CellId::from(Uuid::new_v4());
        let cell = match cell_type {
            "code" => Cell::Code {
                id: new_id,
                metadata: empty_cell_metadata(),
                execution_count: None,
                source: Vec::new(),
                outputs: Vec::new(),
            },
            "markdown" => Cell::Markdown {
                id: new_id,
                metadata: empty_cell_metadata(),
                source: Vec::new(),
                attachments: None,
            },
            "raw" => Cell::Raw {
                id: new_id,
                metadata: empty_cell_metadata(),
                source: Vec::new(),
            },
            _ => return None,
        };

        let frontend_cell = cell_to_frontend(&cell);

        let insert_idx = match after_cell_id {
            Some(id) => self.find_cell_index(id).map(|i| i + 1),
            None => Some(0),
        };

        if let Some(idx) = insert_idx {
            self.notebook.cells.insert(idx, cell);
        } else {
            self.notebook.cells.push(cell);
        }
        self.dirty = true;

        Some(frontend_cell)
    }

    pub fn delete_cell(&mut self, cell_id: &str) -> bool {
        // Don't delete the last cell
        if self.notebook.cells.len() <= 1 {
            return false;
        }
        if let Some(idx) = self.find_cell_index(cell_id) {
            self.notebook.cells.remove(idx);
            self.dirty = true;
            true
        } else {
            false
        }
    }

    pub fn clear_cell_outputs(&mut self, cell_id: &str) {
        if let Some(idx) = self.find_cell_index(cell_id) {
            if let Cell::Code {
                outputs,
                execution_count,
                ..
            } = &mut self.notebook.cells[idx]
            {
                outputs.clear();
                *execution_count = None;
            }
        }
    }

    pub fn set_cell_execution_count(&mut self, cell_id: &str, count: i32) {
        if let Some(idx) = self.find_cell_index(cell_id) {
            if let Cell::Code {
                execution_count, ..
            } = &mut self.notebook.cells[idx]
            {
                *execution_count = Some(count);
            }
        }
    }

    pub fn append_cell_output(&mut self, cell_id: &str, output: Output) {
        if let Some(idx) = self.find_cell_index(cell_id) {
            if let Cell::Code { outputs, .. } = &mut self.notebook.cells[idx] {
                outputs.push(output);
            }
        }
    }

    pub fn serialize(&self) -> Result<String, String> {
        let nb = nbformat::Notebook::V4(self.notebook.clone());
        nbformat::serialize_notebook(&nb).map_err(|e| e.to_string())
    }
}

fn empty_cell_metadata() -> CellMetadata {
    CellMetadata {
        id: None,
        collapsed: None,
        scrolled: None,
        deletable: None,
        editable: None,
        format: None,
        name: None,
        tags: None,
        jupyter: None,
        execution: None,
        additional: HashMap::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_empty_creates_single_code_cell() {
        let state = NotebookState::new_empty();

        assert_eq!(state.notebook.cells.len(), 1);
        assert!(matches!(state.notebook.cells[0], Cell::Code { .. }));
        assert!(state.path.is_none());
        assert!(!state.dirty);
    }

    #[test]
    fn test_new_empty_sets_env_metadata() {
        let state = NotebookState::new_empty();

        // Should have either uv or conda metadata based on default settings (Conda is default)
        let has_env = state.notebook.metadata.additional.contains_key("uv")
            || state.notebook.metadata.additional.contains_key("conda");
        assert!(has_env);
        assert!(state.notebook.metadata.additional.contains_key("runt"));
    }

    #[test]
    fn test_new_empty_with_runtime_python() {
        let state = NotebookState::new_empty_with_runtime(Runtime::Python);

        // Should have either uv or conda metadata based on default settings
        let has_env = state.notebook.metadata.additional.contains_key("uv")
            || state.notebook.metadata.additional.contains_key("conda");
        assert!(has_env);
        let runt = state.notebook.metadata.additional.get("runt").unwrap();
        assert_eq!(runt.get("runtime").unwrap(), "python");
    }

    #[test]
    fn test_new_empty_with_runtime_deno() {
        let state = NotebookState::new_empty_with_runtime(Runtime::Deno);

        assert!(state.notebook.metadata.additional.contains_key("deno"));
        let runt = state.notebook.metadata.additional.get("runt").unwrap();
        assert_eq!(runt.get("runtime").unwrap(), "deno");
    }

    #[test]
    fn test_get_runtime_returns_python_by_default() {
        let state = NotebookState::new_empty();
        assert_eq!(state.get_runtime(), Runtime::Python);
    }

    #[test]
    fn test_get_runtime_returns_correct_runtime() {
        let state = NotebookState::new_empty_with_runtime(Runtime::Deno);
        assert_eq!(state.get_runtime(), Runtime::Deno);
    }

    #[test]
    fn test_find_cell_index_returns_correct_position() {
        let state = NotebookState::new_empty();
        let cell_id = state.notebook.cells[0].id().to_string();

        assert_eq!(state.find_cell_index(&cell_id), Some(0));
    }

    #[test]
    fn test_find_cell_index_returns_none_for_missing() {
        let state = NotebookState::new_empty();
        assert_eq!(state.find_cell_index("nonexistent"), None);
    }

    #[test]
    fn test_update_cell_source_modifies_cell() {
        let mut state = NotebookState::new_empty();
        let cell_id = state.notebook.cells[0].id().to_string();

        state.update_cell_source(&cell_id, "print('hello')");

        let source = state.get_cell_source(&cell_id).unwrap();
        assert_eq!(source, "print('hello')");
    }

    #[test]
    fn test_update_cell_source_sets_dirty_flag() {
        let mut state = NotebookState::new_empty();
        let cell_id = state.notebook.cells[0].id().to_string();

        assert!(!state.dirty);
        state.update_cell_source(&cell_id, "x = 1");
        assert!(state.dirty);
    }

    #[test]
    fn test_get_cell_source_returns_joined_lines() {
        let mut state = NotebookState::new_empty();
        let cell_id = state.notebook.cells[0].id().to_string();

        state.update_cell_source(&cell_id, "line1\nline2\nline3");

        let source = state.get_cell_source(&cell_id).unwrap();
        assert_eq!(source, "line1\nline2\nline3");
    }

    #[test]
    fn test_get_cell_source_returns_none_for_missing() {
        let state = NotebookState::new_empty();
        assert!(state.get_cell_source("nonexistent").is_none());
    }

    #[test]
    fn test_add_cell_code() {
        let mut state = NotebookState::new_empty();

        let result = state.add_cell("code", None);

        assert!(result.is_some());
        assert!(matches!(result.unwrap(), FrontendCell::Code { .. }));
        assert_eq!(state.notebook.cells.len(), 2);
    }

    #[test]
    fn test_add_cell_markdown() {
        let mut state = NotebookState::new_empty();

        let result = state.add_cell("markdown", None);

        assert!(result.is_some());
        assert!(matches!(result.unwrap(), FrontendCell::Markdown { .. }));
    }

    #[test]
    fn test_add_cell_raw() {
        let mut state = NotebookState::new_empty();

        let result = state.add_cell("raw", None);

        assert!(result.is_some());
        assert!(matches!(result.unwrap(), FrontendCell::Raw { .. }));
    }

    #[test]
    fn test_add_cell_invalid_type_returns_none() {
        let mut state = NotebookState::new_empty();

        let result = state.add_cell("invalid", None);

        assert!(result.is_none());
        assert_eq!(state.notebook.cells.len(), 1);
    }

    #[test]
    fn test_add_cell_after_existing_cell() {
        let mut state = NotebookState::new_empty();
        let first_cell_id = state.notebook.cells[0].id().to_string();

        state.add_cell("code", Some(&first_cell_id));

        assert_eq!(state.notebook.cells.len(), 2);
        // New cell should be at index 1 (after first cell)
        assert_ne!(state.notebook.cells[1].id().to_string(), first_cell_id);
    }

    #[test]
    fn test_add_cell_at_beginning_when_no_after() {
        let mut state = NotebookState::new_empty();
        let first_cell_id = state.notebook.cells[0].id().to_string();

        let new_cell = state.add_cell("code", None).unwrap();

        // New cell should be at index 0
        assert_eq!(state.notebook.cells[0].id().to_string(), new_cell.id());
        // Original cell should now be at index 1
        assert_eq!(state.notebook.cells[1].id().to_string(), first_cell_id);
    }

    #[test]
    fn test_add_cell_sets_dirty_flag() {
        let mut state = NotebookState::new_empty();

        assert!(!state.dirty);
        state.add_cell("code", None);
        assert!(state.dirty);
    }

    #[test]
    fn test_delete_cell_removes_cell() {
        let mut state = NotebookState::new_empty();
        state.add_cell("code", None);
        let cell_to_delete = state.notebook.cells[0].id().to_string();

        let result = state.delete_cell(&cell_to_delete);

        assert!(result);
        assert_eq!(state.notebook.cells.len(), 1);
    }

    #[test]
    fn test_delete_cell_prevents_removing_last() {
        let mut state = NotebookState::new_empty();
        let only_cell = state.notebook.cells[0].id().to_string();

        let result = state.delete_cell(&only_cell);

        assert!(!result);
        assert_eq!(state.notebook.cells.len(), 1);
    }

    #[test]
    fn test_delete_cell_returns_false_for_missing() {
        let mut state = NotebookState::new_empty();
        state.add_cell("code", None);

        let result = state.delete_cell("nonexistent");

        assert!(!result);
        assert_eq!(state.notebook.cells.len(), 2);
    }

    #[test]
    fn test_delete_cell_sets_dirty_flag() {
        let mut state = NotebookState::new_empty();
        state.add_cell("code", None);
        state.dirty = false;
        let cell_to_delete = state.notebook.cells[0].id().to_string();

        state.delete_cell(&cell_to_delete);

        assert!(state.dirty);
    }

    #[test]
    fn test_clear_cell_outputs_clears_outputs_and_count() {
        let mut state = NotebookState::new_empty();
        let cell_id = state.notebook.cells[0].id().to_string();

        // Set some execution state
        state.set_cell_execution_count(&cell_id, 5);

        // Clear outputs
        state.clear_cell_outputs(&cell_id);

        // Check execution count is cleared
        if let Cell::Code {
            execution_count, ..
        } = &state.notebook.cells[0]
        {
            assert!(execution_count.is_none());
        }
    }

    #[test]
    fn test_set_cell_execution_count() {
        let mut state = NotebookState::new_empty();
        let cell_id = state.notebook.cells[0].id().to_string();

        state.set_cell_execution_count(&cell_id, 42);

        if let Cell::Code {
            execution_count, ..
        } = &state.notebook.cells[0]
        {
            assert_eq!(*execution_count, Some(42));
        } else {
            panic!("Expected code cell");
        }
    }

    #[test]
    fn test_cells_for_frontend_converts_correctly() {
        let mut state = NotebookState::new_empty();
        let cell_id = state.notebook.cells[0].id().to_string();
        state.update_cell_source(&cell_id, "x = 1");

        let frontend_cells = state.cells_for_frontend();

        assert_eq!(frontend_cells.len(), 1);
        if let FrontendCell::Code { source, .. } = &frontend_cells[0] {
            assert_eq!(source, "x = 1");
        } else {
            panic!("Expected code cell");
        }
    }

    #[test]
    fn test_serialize_produces_valid_json() {
        let state = NotebookState::new_empty();

        let result = state.serialize();

        assert!(result.is_ok());
        let json_str = result.unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        assert_eq!(parsed["nbformat"], 4);
        assert!(parsed["cells"].is_array());
    }

    #[test]
    fn test_source_to_lines_handles_empty_string() {
        let lines = source_to_lines("");
        assert!(lines.is_empty());
    }

    #[test]
    fn test_source_to_lines_multiline() {
        let lines = source_to_lines("line1\nline2");
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0], "line1\n");
        assert_eq!(lines[1], "line2");
    }

    #[test]
    fn test_source_to_lines_single_line() {
        let lines = source_to_lines("single");
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0], "single");
    }

    #[test]
    fn test_source_to_lines_preserves_trailing_newline() {
        let lines = source_to_lines("line1\nline2\n");
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0], "line1\n");
        assert_eq!(lines[1], "line2\n");
    }

    #[test]
    fn test_source_to_lines_roundtrip() {
        for original in &["line1\nline2", "line1\nline2\n", "single", "single\n", ""] {
            let lines = source_to_lines(original);
            let rejoined: String = lines.join("");
            assert_eq!(&rejoined, original, "roundtrip failed for {:?}", original);
        }
    }

    #[test]
    fn test_frontend_cell_id_method() {
        let code_cell = FrontendCell::Code {
            id: "code-123".to_string(),
            source: String::new(),
            execution_count: None,
            outputs: vec![],
        };
        let md_cell = FrontendCell::Markdown {
            id: "md-456".to_string(),
            source: String::new(),
        };
        let raw_cell = FrontendCell::Raw {
            id: "raw-789".to_string(),
            source: String::new(),
        };

        assert_eq!(code_cell.id(), "code-123");
        assert_eq!(md_cell.id(), "md-456");
        assert_eq!(raw_cell.id(), "raw-789");
    }

    #[test]
    fn test_frontend_cell_serialization() {
        let cell = FrontendCell::Code {
            id: "test-id".to_string(),
            source: "print('hi')".to_string(),
            execution_count: Some(1),
            outputs: vec![],
        };

        let json = serde_json::to_value(&cell).unwrap();

        assert_eq!(json["cell_type"], "code");
        assert_eq!(json["id"], "test-id");
        assert_eq!(json["source"], "print('hi')");
        assert_eq!(json["execution_count"], 1);
    }
}
