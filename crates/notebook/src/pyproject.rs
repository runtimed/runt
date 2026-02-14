//! pyproject.toml discovery and parsing for notebook environments.
//!
//! This module handles finding and parsing pyproject.toml files to extract
//! dependencies for notebook environments. Uses the `pyproject-toml` crate
//! from PyO3 for PEP 517/518/621 compliant parsing.

use anyhow::{anyhow, Result};
use pyproject_toml::PyProjectToml;
use serde::Deserialize;
use std::path::{Path, PathBuf};

/// Configuration extracted from a pyproject.toml file.
#[derive(Debug, Clone)]
pub struct PyProjectConfig {
    /// Path to the pyproject.toml file.
    pub path: PathBuf,
    /// Project name from [project.name].
    pub project_name: Option<String>,
    /// Dependencies from [project.dependencies].
    pub dependencies: Vec<String>,
    /// Python version constraint from [project.requires-python].
    pub requires_python: Option<String>,
    /// Dev dependencies from [tool.uv.dev-dependencies].
    pub dev_dependencies: Vec<String>,
    /// Custom index URL from [tool.uv.index-url].
    pub index_url: Option<String>,
    /// Extra index URLs from [tool.uv.extra-index-url].
    pub extra_index_urls: Vec<String>,
}

/// Serializable info about a detected pyproject.toml for the frontend.
#[derive(Debug, Clone, serde::Serialize)]
pub struct PyProjectInfo {
    /// Absolute path to the pyproject.toml file.
    pub path: String,
    /// Path relative to the notebook.
    pub relative_path: String,
    /// Project name if available.
    pub project_name: Option<String>,
    /// Whether [project.dependencies] has entries.
    pub has_dependencies: bool,
    /// Number of dependencies.
    pub dependency_count: usize,
    /// Whether [tool.uv.dev-dependencies] has entries.
    pub has_dev_dependencies: bool,
    /// Python version constraint if specified.
    pub requires_python: Option<String>,
}

// [tool.uv] section - not covered by pyproject-toml crate
#[derive(Debug, Deserialize, Default)]
struct ToolUv {
    #[serde(rename = "dev-dependencies")]
    dev_dependencies: Option<Vec<String>>,
    #[serde(rename = "index-url")]
    index_url: Option<String>,
    #[serde(rename = "extra-index-url")]
    extra_index_url: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, Default)]
struct ToolSection {
    uv: Option<ToolUv>,
}

#[derive(Debug, Deserialize, Default)]
struct RawPyProject {
    tool: Option<ToolSection>,
}

/// Find a pyproject.toml file by walking up from the given path.
///
/// Starts from the given path (or its parent if it's a file) and walks up
/// the directory tree until a pyproject.toml is found or a stopping condition
/// is met (home directory or filesystem root).
pub fn find_pyproject(start_path: &Path) -> Option<PathBuf> {
    // Start from the directory containing the file, or the directory itself
    let start_dir = if start_path.is_file() {
        start_path.parent()?
    } else {
        start_path
    };

    let home_dir = dirs::home_dir();

    let mut current = start_dir.to_path_buf();
    loop {
        let candidate = current.join("pyproject.toml");
        if candidate.exists() {
            return Some(candidate);
        }

        // Stop at home directory
        if let Some(ref home) = home_dir {
            if current == *home {
                return None;
            }
        }

        // Move to parent directory
        match current.parent() {
            Some(parent) if parent != current => {
                current = parent.to_path_buf();
            }
            _ => return None, // Reached root
        }
    }
}

/// Parse a pyproject.toml file and extract relevant configuration.
///
/// Uses pyproject-toml crate for PEP 517/518/621 compliant parsing of
/// [project] section, and manual parsing for [tool.uv] section.
pub fn parse_pyproject(path: &Path) -> Result<PyProjectConfig> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| anyhow!("Failed to read pyproject.toml: {}", e))?;

    // Parse using pyproject-toml for PEP-compliant [project] section
    let parsed = PyProjectToml::new(&content)
        .map_err(|e| anyhow!("Failed to parse pyproject.toml: {}", e))?;

    // Extract [project] fields using the proper PEP 621 types
    let (project_name, dependencies, requires_python) = if let Some(project) = &parsed.project {
        let name = Some(project.name.clone());

        // Convert pep508 Requirements to strings
        let deps: Vec<String> = project
            .dependencies
            .as_ref()
            .map(|deps| deps.iter().map(|r| r.to_string()).collect())
            .unwrap_or_default();

        // Convert pep440 VersionSpecifiers to string
        let python = project
            .requires_python
            .as_ref()
            .map(|v| v.to_string());

        (name, deps, python)
    } else {
        (None, vec![], None)
    };

    // Parse [tool.uv] section manually (not covered by pyproject-toml)
    let raw: RawPyProject = toml::from_str(&content).unwrap_or_default();
    let uv = raw.tool.and_then(|t| t.uv).unwrap_or_default();

    Ok(PyProjectConfig {
        path: path.to_path_buf(),
        project_name,
        dependencies,
        requires_python,
        dev_dependencies: uv.dev_dependencies.unwrap_or_default(),
        index_url: uv.index_url,
        extra_index_urls: uv.extra_index_url.unwrap_or_default(),
    })
}

/// Create PyProjectInfo from a config for sending to the frontend.
pub fn create_pyproject_info(config: &PyProjectConfig, notebook_path: &Path) -> PyProjectInfo {
    let relative_path =
        pathdiff::diff_paths(&config.path, notebook_path.parent().unwrap_or(notebook_path))
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| config.path.display().to_string());

    PyProjectInfo {
        path: config.path.display().to_string(),
        relative_path,
        project_name: config.project_name.clone(),
        has_dependencies: !config.dependencies.is_empty(),
        dependency_count: config.dependencies.len(),
        has_dev_dependencies: !config.dev_dependencies.is_empty(),
        requires_python: config.requires_python.clone(),
    }
}

/// Get all dependencies from a pyproject config (main + dev).
pub fn get_all_dependencies(config: &PyProjectConfig) -> Vec<String> {
    let mut deps = config.dependencies.clone();
    deps.extend(config.dev_dependencies.clone());
    deps
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    fn create_pyproject(dir: &Path, content: &str) {
        let path = dir.join("pyproject.toml");
        let mut file = std::fs::File::create(path).unwrap();
        file.write_all(content.as_bytes()).unwrap();
    }

    #[test]
    fn test_find_pyproject_same_dir() {
        let temp = TempDir::new().unwrap();
        create_pyproject(temp.path(), "[project]\nname = \"test\"");

        let found = find_pyproject(temp.path());
        assert!(found.is_some());
        assert_eq!(found.unwrap(), temp.path().join("pyproject.toml"));
    }

    #[test]
    fn test_find_pyproject_parent_dir() {
        let temp = TempDir::new().unwrap();
        let subdir = temp.path().join("notebooks");
        std::fs::create_dir(&subdir).unwrap();
        create_pyproject(temp.path(), "[project]\nname = \"test\"");

        let found = find_pyproject(&subdir);
        assert!(found.is_some());
        assert_eq!(found.unwrap(), temp.path().join("pyproject.toml"));
    }

    #[test]
    fn test_find_pyproject_not_found() {
        let temp = TempDir::new().unwrap();
        // No pyproject.toml created
        let found = find_pyproject(temp.path());
        assert!(found.is_none());
    }

    #[test]
    fn test_parse_pyproject_minimal() {
        let temp = TempDir::new().unwrap();
        create_pyproject(temp.path(), "[project]\nname = \"myproject\"");

        let config = parse_pyproject(&temp.path().join("pyproject.toml")).unwrap();
        assert_eq!(config.project_name, Some("myproject".to_string()));
        assert!(config.dependencies.is_empty());
    }

    #[test]
    fn test_parse_pyproject_with_deps() {
        let temp = TempDir::new().unwrap();
        create_pyproject(
            temp.path(),
            r#"
[project]
name = "myproject"
dependencies = ["pandas>=2.0", "numpy"]
requires-python = ">=3.10"

[tool.uv]
dev-dependencies = ["pytest", "ruff"]
index-url = "https://pypi.org/simple"
"#,
        );

        let config = parse_pyproject(&temp.path().join("pyproject.toml")).unwrap();
        assert_eq!(config.project_name, Some("myproject".to_string()));
        assert_eq!(config.dependencies.len(), 2);
        // PEP 508 normalized form may differ slightly
        assert!(config.dependencies.iter().any(|d| d.contains("pandas")));
        assert!(config.dependencies.iter().any(|d| d.contains("numpy")));
        assert_eq!(config.requires_python, Some(">=3.10".to_string()));
        assert_eq!(config.dev_dependencies, vec!["pytest", "ruff"]);
        assert_eq!(
            config.index_url,
            Some("https://pypi.org/simple".to_string())
        );
    }

    #[test]
    fn test_parse_pyproject_empty_sections() {
        let temp = TempDir::new().unwrap();
        // pyproject-toml requires at least [project] or [build-system]
        create_pyproject(temp.path(), "[build-system]\nrequires = []");

        let config = parse_pyproject(&temp.path().join("pyproject.toml")).unwrap();
        assert!(config.project_name.is_none());
        assert!(config.dependencies.is_empty());
    }
}
