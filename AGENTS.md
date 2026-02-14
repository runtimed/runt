# Agent Instructions

This document provides guidance for AI agents working in this repository.

## Workspace Description

When working in a worktree, set a human-readable description of what you're working on by writing to `.context/workspace-description`:

```bash
mkdir -p .context
echo "Your description here" > .context/workspace-description
```

This description appears in the notebook app's debug banner (visible in debug builds only), helping identify what each worktree is testing when multiple are running in parallel.

Keep descriptions short and descriptive, e.g.:
- "Testing conda environment creation"
- "Fixing kernel interrupt handling"
- "Adding ipywidgets support"

The `.context/` directory is gitignored and used for per-worktree state that shouldn't be committed.

## Contributing Guidelines

See the `contributing/` directory for detailed guides:
- `contributing/ui.md` - UI components and shadcn setup
- `contributing/nteract-elements.md` - Working with nteract/elements registry
