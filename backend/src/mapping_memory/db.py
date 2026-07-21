# ruff: noqa: E501
import sqlite3
from contextlib import closing
from pathlib import Path

from mapping_memory.fts import backfill_notes_fts_if_empty, init_notes_fts


def connect_db(sqlite_path: Path) -> sqlite3.Connection:
    sqlite_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(sqlite_path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db(sqlite_path: Path) -> None:
    with closing(connect_db(sqlite_path)) as connection:
        _create_non_chat_tables(connection)
        _migrate_notes_category_id(connection)
        _migrate_notes_markdown_path(connection)
        _migrate_notes_ai_organization(connection)
        init_notes_fts(connection)
        backfill_notes_fts_if_empty(connection)
        _create_memory_settings(connection)
        if _legacy_chat_schema_exists(connection):
            connection.commit()
            connection.execute("BEGIN IMMEDIATE")
            _reset_chat_tables(connection)
        else:
            _create_chat_tables(connection)
        connection.commit()


def reset_development_chat_data(sqlite_path: Path, *, allowed: bool) -> None:
    if not allowed:
        raise ValueError("reset_development_chat_data requires allowed=True")
    with closing(connect_db(sqlite_path)) as connection:
        connection.execute("BEGIN IMMEDIATE")
        _reset_chat_tables(connection)
        connection.commit()


def _create_non_chat_tables(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            slug TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            original_text TEXT NOT NULL,
            ai_title TEXT NOT NULL,
            short_summary TEXT NOT NULL,
            tags_json TEXT NOT NULL,
            date_added TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            category_id INTEGER REFERENCES categories(id),
            markdown_path TEXT,
            needs_ai_organization INTEGER NOT NULL DEFAULT 0
        )
        """
    )


def _create_memory_settings(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS memory_settings (
            user_id TEXT PRIMARY KEY,
            learning_enabled INTEGER NOT NULL DEFAULT 1
        )
        """
    )


def _legacy_chat_schema_exists(connection: sqlite3.Connection) -> bool:
    tables = {
        row["name"]
        for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    }
    if "chat_messages" not in tables:
        return False
    required_tables = {
        "chat_threads",
        "chat_messages",
        "generation_jobs",
        "chat_turn_scopes",
        "chat_turn_scope_note_ids",
        "chat_thread_summaries",
        "automatic_memory_change_provenance",
    }
    if not required_tables.issubset(tables):
        return True
    thread_columns = {
        row["name"] for row in connection.execute("PRAGMA table_info(chat_threads)").fetchall()
    }
    if "title_origin" not in thread_columns:
        return True
    message_sql = connection.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'chat_messages'"
    ).fetchone()["sql"]
    return "'completed'" not in message_sql or "sources_json" in message_sql


def _reset_chat_tables(connection: sqlite3.Connection) -> None:
    connection.execute("DROP TABLE IF EXISTS automatic_memory_change_provenance")
    connection.execute("DROP TABLE IF EXISTS chat_thread_summaries")
    connection.execute("DROP TABLE IF EXISTS assistant_claim_sources")
    connection.execute("DROP TABLE IF EXISTS assistant_claims")
    connection.execute("DROP TABLE IF EXISTS assistant_validation_results")
    connection.execute("DROP TABLE IF EXISTS assistant_source_snapshots")
    connection.execute("DROP TABLE IF EXISTS chat_turn_scope_note_ids")
    connection.execute("DROP TABLE IF EXISTS chat_turn_scopes")
    connection.execute("DROP TABLE IF EXISTS generation_jobs")
    connection.execute("DROP TABLE IF EXISTS chat_messages")
    connection.execute("DROP TABLE IF EXISTS chat_threads")
    _create_chat_tables(connection)


def _create_chat_tables(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS chat_threads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            title TEXT NOT NULL,
            title_origin TEXT NOT NULL CHECK (title_origin IN ('automatic', 'manual')),
            scope_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
            content TEXT NOT NULL,
            thread_id INTEGER NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
            status TEXT NOT NULL CHECK (
                (role = 'user' AND status = 'completed')
                OR (role = 'assistant' AND status IN (
                    'pending', 'completed', 'failed', 'timed_out', 'interrupted', 'cancelled'
                ))
            ),
            evidence_summary_json TEXT,
            created_at TEXT NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS generation_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            thread_id INTEGER NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
            user_message_id INTEGER NOT NULL UNIQUE REFERENCES chat_messages(id) ON DELETE CASCADE,
            assistant_message_id INTEGER NOT NULL UNIQUE REFERENCES chat_messages(id) ON DELETE CASCADE,
            status TEXT NOT NULL CHECK (status IN (
                'queued', 'running', 'completed', 'failed', 'timed_out', 'interrupted', 'cancelled'
            )),
            progress_stage TEXT NOT NULL CHECK (progress_stage IN (
                'queued', 'retrieving', 'generating', 'finalizing'
            )),
            cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
            error_category TEXT CHECK (error_category IN (
                'retrieval', 'provider', 'rate_limited', 'validation', 'internal', 'timeout',
                'interrupted', 'cancelled'
            )),
            user_facing_error TEXT,
            created_at TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            updated_at TEXT NOT NULL,
            cancel_requested_at TEXT,
            CHECK (
                (status = 'completed' AND finished_at IS NOT NULL AND error_category IS NULL
                    AND user_facing_error IS NULL)
                OR (status IN ('failed', 'timed_out', 'interrupted', 'cancelled')
                    AND finished_at IS NOT NULL AND error_category IS NOT NULL
                    AND length(trim(user_facing_error)) > 0)
                OR (status IN ('queued', 'running') AND finished_at IS NULL
                    AND error_category IS NULL AND user_facing_error IS NULL)
            ),
            CHECK (status != 'cancelled' OR cancel_requested = 1)
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS chat_turn_scopes (
            user_message_id INTEGER PRIMARY KEY REFERENCES chat_messages(id) ON DELETE CASCADE,
            mode TEXT NOT NULL CHECK (mode IN ('all', 'custom'))
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS chat_turn_scope_note_ids (
            user_message_id INTEGER NOT NULL REFERENCES chat_turn_scopes(user_message_id)
                ON DELETE CASCADE,
            position INTEGER NOT NULL CHECK (position >= 0),
            note_id INTEGER NOT NULL CHECK (note_id > 0),
            PRIMARY KEY (user_message_id, position)
        )
        """
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_id ON chat_messages(thread_id, id)"
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_chat_threads_user_updated ON chat_threads(user_id, updated_at DESC, id DESC)"
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_generation_jobs_status_created "
        "ON generation_jobs(status, created_at, id)"
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_generation_jobs_thread_created "
        "ON generation_jobs(thread_id, created_at, id)"
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS chat_thread_summaries (
            thread_id INTEGER PRIMARY KEY REFERENCES chat_threads(id) ON DELETE CASCADE,
            summary TEXT NOT NULL,
            last_summarized_message_id INTEGER NOT NULL
                REFERENCES chat_messages(id) ON DELETE CASCADE,
            updated_at TEXT NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS automatic_memory_change_provenance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            thread_id INTEGER NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
            user_message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
            generation_job_id INTEGER NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
            operation TEXT NOT NULL CHECK (operation IN ('ADD', 'UPDATE')),
            provider_memory_id TEXT NOT NULL CHECK (length(trim(provider_memory_id)) > 0),
            prior_content TEXT,
            resulting_content TEXT NOT NULL CHECK (length(trim(resulting_content)) > 0),
            prior_content_fingerprint TEXT,
            resulting_content_fingerprint TEXT NOT NULL
                CHECK (length(trim(resulting_content_fingerprint)) > 0),
            created_at TEXT NOT NULL,
            CHECK (
                (operation = 'ADD' AND prior_content IS NULL AND prior_content_fingerprint IS NULL)
                OR (operation = 'UPDATE' AND prior_content IS NOT NULL
                    AND prior_content_fingerprint IS NOT NULL)
            )
        )
        """
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_automatic_memory_change_provenance_turn "
        "ON automatic_memory_change_provenance(thread_id, user_message_id, generation_job_id, id)"
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_automatic_memory_change_provenance_user_memory "
        "ON automatic_memory_change_provenance(user_id, provider_memory_id, id)"
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS assistant_source_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            assistant_message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
            generation_job_id INTEGER NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
            source_id TEXT NOT NULL CHECK (length(trim(source_id)) > 0),
            source_type TEXT NOT NULL CHECK (source_type IN ('note', 'web')),
            title TEXT NOT NULL CHECK (length(trim(title)) > 0),
            source_date TEXT CHECK (source_date IS NULL OR length(trim(source_date)) > 0),
            cited_snippet TEXT NOT NULL CHECK (
                length(trim(cited_snippet)) > 0 AND length(cited_snippet) <= 360
            ),
            citation_order INTEGER NOT NULL CHECK (citation_order >= 1),
            note_id INTEGER,
            source_start INTEGER,
            source_end INTEGER,
            note_version_updated_at TEXT,
            url TEXT,
            CHECK (
                (source_type = 'note' AND note_id IS NOT NULL AND note_id > 0
                    AND source_start IS NOT NULL AND source_start >= 0
                    AND source_end IS NOT NULL AND source_end >= source_start
                    AND length(trim(note_version_updated_at)) > 0 AND url IS NULL)
                OR (source_type = 'web' AND length(trim(url)) > 0
                    AND note_id IS NULL AND source_start IS NULL AND source_end IS NULL
                    AND note_version_updated_at IS NULL)
            ),
            UNIQUE (assistant_message_id, source_id),
            UNIQUE (assistant_message_id, citation_order)
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS assistant_claims (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            assistant_message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
            generation_job_id INTEGER NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
            claim_id TEXT NOT NULL CHECK (length(trim(claim_id)) > 0),
            claim_text TEXT NOT NULL CHECK (length(trim(claim_text)) > 0),
            claim_order INTEGER NOT NULL CHECK (claim_order >= 1),
            UNIQUE (assistant_message_id, claim_id),
            UNIQUE (assistant_message_id, claim_order)
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS assistant_claim_sources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            assistant_message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
            generation_job_id INTEGER NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
            assistant_claim_id INTEGER NOT NULL REFERENCES assistant_claims(id) ON DELETE CASCADE,
            assistant_source_snapshot_id INTEGER NOT NULL
                REFERENCES assistant_source_snapshots(id) ON DELETE CASCADE,
            position INTEGER NOT NULL CHECK (position >= 1),
            UNIQUE (assistant_claim_id, position),
            UNIQUE (assistant_claim_id, assistant_source_snapshot_id)
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS assistant_validation_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            assistant_message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
            generation_job_id INTEGER NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
            result_id TEXT NOT NULL CHECK (length(trim(result_id)) > 0),
            kind TEXT NOT NULL CHECK (kind IN ('code', 'semantic')),
            outcome TEXT NOT NULL CHECK (outcome IN ('passed', 'failed')),
            details_json TEXT NOT NULL CHECK (
                length(details_json) <= 4096 AND json_valid(details_json)
            ),
            result_order INTEGER NOT NULL CHECK (result_order >= 1),
            UNIQUE (assistant_message_id, result_id),
            UNIQUE (assistant_message_id, result_order)
        )
        """
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_assistant_sources_message_order "
        "ON assistant_source_snapshots(assistant_message_id, citation_order)"
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_assistant_claims_message_order "
        "ON assistant_claims(assistant_message_id, claim_order)"
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_assistant_claim_sources_claim_order "
        "ON assistant_claim_sources(assistant_claim_id, position)"
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_assistant_validations_message_order "
        "ON assistant_validation_results(assistant_message_id, result_order)"
    )


def _migrate_notes_category_id(connection: sqlite3.Connection) -> None:
    columns = {row["name"] for row in connection.execute("PRAGMA table_info(notes)").fetchall()}
    if "category_id" not in columns:
        connection.execute(
            "ALTER TABLE notes ADD COLUMN category_id INTEGER REFERENCES categories(id)"
        )


def _migrate_notes_markdown_path(connection: sqlite3.Connection) -> None:
    columns = {row["name"] for row in connection.execute("PRAGMA table_info(notes)").fetchall()}
    if "markdown_path" not in columns:
        connection.execute("ALTER TABLE notes ADD COLUMN markdown_path TEXT")


def _migrate_notes_ai_organization(connection: sqlite3.Connection) -> None:
    columns = {row["name"] for row in connection.execute("PRAGMA table_info(notes)").fetchall()}
    if "needs_ai_organization" not in columns:
        connection.execute(
            "ALTER TABLE notes ADD COLUMN needs_ai_organization INTEGER NOT NULL DEFAULT 0"
        )
