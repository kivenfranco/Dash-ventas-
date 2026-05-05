from functools import lru_cache
from pathlib import Path
from pydantic_settings import BaseSettings

# Ruta absoluta al .env — funciona sin importar el CWD al iniciar el servidor
_ENV_FILE = str(Path(__file__).parent.parent / ".env")


class Settings(BaseSettings):
    SNOWFLAKE_USER: str
    SNOWFLAKE_PASSWORD: str
    SNOWFLAKE_ACCOUNT: str
    SNOWFLAKE_WAREHOUSE: str = "SNOWFLAKE_LEARNING_WH"

    # GOLD.VENTAS:    FACT_VENTAS, DIM_ESTADO_CLIENTE, PP_*
    # GOLD.MAESTROS:  DIM_CLIENTE, DIM_DOMICILIO, DIM_TIEMPO, DIM_VENDEDOR,
    #                 DIM_TERRITORIO, DIM_REGION, DIM_GRUPO_PRODUCTO,
    #                 DIM_GRUPO_COMERCIAL, DIM_PARTE, DIM_MERCADO
    SNOWFLAKE_DATABASE: str = "GOLD"
    SNOWFLAKE_SCHEMA: str = "VENTAS"
    SNOWFLAKE_SCHEMA_MAESTROS: str = "MAESTROS"

    GOOGLE_AI_KEY: str = ""
    ANTHROPIC_API_KEY: str = ""

    CACHE_TTL_HOURS: int = 6
    REFRESH_HOUR: int = 3
    REFRESH_MINUTE: int = 0

    # SMTP — Office 365
    SMTP_HOST: str = "smtp.office365.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM_NAME: str = "BI Ventas ALICO"
    ALERTAS_ENABLED: bool = True

    LOG_LEVEL: str = "INFO"
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8000
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",")]

    def T(self, table: str) -> str:
        return f"{self.SNOWFLAKE_DATABASE}.{self.SNOWFLAKE_SCHEMA}.{table}"

    def TM(self, table: str) -> str:
        return f"{self.SNOWFLAKE_DATABASE}.{self.SNOWFLAKE_SCHEMA_MAESTROS}.{table}"

    model_config = {"env_file": _ENV_FILE, "extra": "ignore"}


@lru_cache()
def get_settings() -> Settings:
    return Settings()
