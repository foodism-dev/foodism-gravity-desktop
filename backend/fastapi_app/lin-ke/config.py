from dataclasses import dataclass
import os
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[2]


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_env_file(BACKEND_DIR / ".env")
load_env_file(BACKEND_DIR / ".env.server")


def int_env(name: str, default: int) -> int:
    value = os.getenv(name, "").strip()
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def float_env(name: str, default: float) -> float:
    value = os.getenv(name, "").strip()
    if not value:
        return default
    try:
        return float(value)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/proma")
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    openai_base_url: str = os.getenv("OPENAI_BASE_URL", "")
    optimize_model: str = os.getenv("OPTIMIZE_MODEL", "gpt-4o-mini")
    optimize_concurrency: int = int_env("OPTIMIZE_CONCURRENCY", 5)
    optimize_max_batch_size: int = int_env("OPTIMIZE_MAX_BATCH_SIZE", 20)
    optimize_retries: int = int_env("OPTIMIZE_RETRIES", 3)
    life_partner_base_url: str = os.getenv("LIN_KE_BASE_URL", "https://www.life-partner.cn")
    life_partner_timeout: float = float_env("LIN_KE_TIMEOUT", 60.0)
    rb_image_base_url: str = os.getenv("RB_IMAGE_BASE_URL", "")


def get_settings() -> Settings:
    return Settings()
