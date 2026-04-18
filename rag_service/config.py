"""Resolves the SQLite DB path using the same logic as the Rust runtime."""
import os
import sys
from pathlib import Path

try:
    import tomllib
except ImportError:
    import tomli as tomllib  # type: ignore  (Python < 3.11 fallback)


def _config_dir() -> Path:
    if sys.platform == "win32":
        return Path(os.environ.get("APPDATA", Path.home())) / "plshelp"
    xdg = os.environ.get("XDG_CONFIG_HOME")
    if xdg:
        return Path(xdg) / "plshelp"
    return Path.home() / ".config" / "plshelp"


def _data_dir() -> Path:
    if sys.platform == "win32":
        return Path(os.environ.get("APPDATA", Path.home())) / "plshelp"
    xdg = os.environ.get("XDG_DATA_HOME")
    if xdg:
        return Path(xdg) / "plshelp"
    return Path.home() / ".local" / "share" / "plshelp"


def get_db_path() -> Path:
    if override := os.environ.get("BADGER_DB_PATH"):
        return Path(override)
    config_file = _config_dir() / "config.toml"
    if config_file.exists():
        with open(config_file, "rb") as f:
            cfg = tomllib.load(f)
        if db := cfg.get("paths", {}).get("db_path"):
            p = Path(db)
            # Expand ~ if present
            return p.expanduser()
    return _data_dir() / "plshelp.db"


def get_service_settings() -> dict:
    """Read rag_service section from config.toml if present."""
    config_file = _config_dir() / "config.toml"
    if config_file.exists():
        with open(config_file, "rb") as f:
            cfg = tomllib.load(f)
        return cfg.get("rag_service", {})
    return {}
