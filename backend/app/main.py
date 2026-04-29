from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .logger import setup_logging
from .routers import kpis, trends, segments, detail, schema_router, filters, vendedores, alertas, atributos, hallazgos, agente, ventas_diarias, presupuesto, clientes
from .scheduler.jobs import start_scheduler, stop_scheduler, trigger_manual_refresh
from .database.cache import cache
from .database.snowflake_connector import connector

cfg = get_settings()
setup_logging(cfg.LOG_LEVEL)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("BI Ventas API starting up…")
    start_scheduler()
    yield
    stop_scheduler()
    logger.info("BI Ventas API shut down")


app = FastAPI(
    title="BI Ventas API",
    description="Business Intelligence — Snowflake star schema + FastAPI",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cfg.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(kpis.router)
app.include_router(trends.router)
app.include_router(segments.router)
app.include_router(detail.router)
app.include_router(filters.router)
app.include_router(vendedores.router)
app.include_router(alertas.router)
app.include_router(atributos.router)
app.include_router(hallazgos.router)
app.include_router(agente.router)
app.include_router(ventas_diarias.router)
app.include_router(presupuesto.router)
app.include_router(clientes.router)
app.include_router(schema_router.router)


@app.get("/api/health", tags=["System"])
def health():
    return {
        "status": "ok",
        "snowflake": connector.test(),
        "cache": cache.stats(),
        "database": cfg.SNOWFLAKE_DATABASE,
        "schema": cfg.SNOWFLAKE_SCHEMA,
    }


@app.post("/api/refresh", tags=["System"])
def manual_refresh():
    return trigger_manual_refresh()
