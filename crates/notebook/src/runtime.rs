//! Runtime type for notebooks - Python or Deno

use serde::{Deserialize, Serialize};

/// Supported notebook runtime environments
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Runtime {
    #[default]
    Python,
    Deno,
}

impl std::fmt::Display for Runtime {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Runtime::Python => write!(f, "python"),
            Runtime::Deno => write!(f, "deno"),
        }
    }
}

impl std::str::FromStr for Runtime {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "python" | "py" => Ok(Runtime::Python),
            "deno" | "typescript" | "ts" => Ok(Runtime::Deno),
            _ => Err(format!("Unknown runtime: {}", s)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_runtime_display() {
        assert_eq!(Runtime::Python.to_string(), "python");
        assert_eq!(Runtime::Deno.to_string(), "deno");
    }

    #[test]
    fn test_runtime_from_str() {
        assert_eq!("python".parse::<Runtime>().unwrap(), Runtime::Python);
        assert_eq!("py".parse::<Runtime>().unwrap(), Runtime::Python);
        assert_eq!("deno".parse::<Runtime>().unwrap(), Runtime::Deno);
        assert_eq!("typescript".parse::<Runtime>().unwrap(), Runtime::Deno);
        assert_eq!("ts".parse::<Runtime>().unwrap(), Runtime::Deno);
        assert!("unknown".parse::<Runtime>().is_err());
    }

    #[test]
    fn test_runtime_default() {
        assert_eq!(Runtime::default(), Runtime::Python);
    }

    #[test]
    fn test_runtime_serde() {
        assert_eq!(
            serde_json::to_string(&Runtime::Python).unwrap(),
            "\"python\""
        );
        assert_eq!(serde_json::to_string(&Runtime::Deno).unwrap(), "\"deno\"");
        assert_eq!(
            serde_json::from_str::<Runtime>("\"python\"").unwrap(),
            Runtime::Python
        );
        assert_eq!(
            serde_json::from_str::<Runtime>("\"deno\"").unwrap(),
            Runtime::Deno
        );
    }
}
