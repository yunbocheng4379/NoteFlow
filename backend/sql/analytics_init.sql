-- NoteFlow analytics events schema.
-- Safe to run repeatedly on MySQL; existing tables are preserved.
CREATE TABLE IF NOT EXISTS analytics_events (
    id BIGINT NOT NULL AUTO_INCREMENT,
    event_name VARCHAR(64) NOT NULL,
    page_path VARCHAR(255) NOT NULL,
    target VARCHAR(128) NULL,
    user_id INT NULL,
    visitor_key VARCHAR(64) NULL,
    identity_key VARCHAR(96) NULL,
    session_id VARCHAR(64) NULL,
    properties JSON NULL,
    occurred_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY ix_analytics_events_occurred_at (occurred_at),
    KEY ix_analytics_events_user_id (user_id),
    KEY ix_analytics_events_time_event (occurred_at, event_name),
    KEY ix_analytics_events_time_identity (occurred_at, identity_key),
    KEY ix_analytics_events_time_page (occurred_at, page_path)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
