import secrets
from typing import Literal
from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str = "sqlite:///./boring.db"
    jwt_secret: str = secrets.token_urlsafe(48)
    demo_mode: bool = True
    cors_origin: str = "http://localhost:5173"
    s3_bucket: str = ""
    aws_region: str = "ap-south-1"
    payoneer_environment: Literal["sandbox", "live"] = "sandbox"
    # Reserved for the approved partner adapter; credentials alone never enable live mode.
    payoneer_client_id: str = ""
    payoneer_client_secret: SecretStr = SecretStr("")
    payoneer_program_id: str = ""


settings = Settings()
engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False}
    if settings.database_url.startswith("sqlite")
    else {},
    pool_pre_ping=True,
)
if settings.database_url.startswith("sqlite"):

    @event.listens_for(engine, "connect")
    def enable_sqlite_foreign_keys(connection, record):
        connection.execute("PRAGMA foreign_keys=ON")


SessionLocal = sessionmaker(engine, expire_on_commit=False)


def db_session():
    with SessionLocal() as db:
        yield db
