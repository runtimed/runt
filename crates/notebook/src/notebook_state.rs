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
    source.lines().map(|l| format!("{}\n", l)).collect()
}

pub struct NotebookState {
    pub notebook: Notebook,
    pub path: Option<PathBuf>,
    pub dirty: bool,
}

impl NotebookState {
    pub fn new_empty() -> Self {
        NotebookState {
            notebook: Notebook {
                metadata: nbformat::v4::Metadata {
                    kernelspec: None,
                    language_info: None,
                    authors: None,
                    additional: HashMap::new(),
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
