-- Telemetry events table
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    install_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_data TEXT, -- JSON blob for flexible event payloads
    created_at TEXT DEFAULT (datetime('now')),

    -- Indexes for common queries
    -- Query by install to see a user's history
    -- Query by event_type for aggregate analysis
    -- Query by time for recent events
    UNIQUE(install_id, event_type, created_at) -- Prevent exact duplicates
);

CREATE INDEX IF NOT EXISTS idx_events_install_id ON events(install_id);
CREATE INDEX IF NOT EXISTS idx_events_event_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);

-- Example event_type values:
-- "auto_launch" - kernel auto-launch attempt
-- "kernel_start" - manual kernel start
-- "cell_execute" - cell execution
-- "app_open" - app opened
-- "app_close" - app closed
