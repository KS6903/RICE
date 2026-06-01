from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    DATABASE_URL: str
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    ALLOWED_ORIGINS: str = "http://localhost:5173,http://localhost:3000"
    APP_NAME: str = "Rice Mill System"
    DEBUG: bool = False
    # Optional — when present, /api/weather hits Google's Weather API. Otherwise
    # the endpoint falls back to Open-Meteo (no key required), so the widget
    # works out of the box.
    GOOGLE_WEATHER_API_KEY: str | None = None

    @property
    def origins_list(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",")]

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
