from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from typing import Any
import math

def sanitize_nans(obj: Any) -> Any:
    if isinstance(obj, float) and math.isnan(obj):
        return None
    elif isinstance(obj, dict):
        return {k: sanitize_nans(v) for k, v in obj.items()}
    elif isinstance(obj, list) or isinstance(obj, tuple):
        return [sanitize_nans(i) for i in obj]
    return obj

class SafeJSONResponse(JSONResponse):
    def render(self, content: Any) -> bytes:
        return super().render(sanitize_nans(content))

from .auth import auth_middleware, setup_default_admin, check_security_config, get_user
from .config import get_settings
from .logger import setup_logging
from .routers import (
    kpis, trends, segments, detail, schema_router, filters, vendedores,
    alertas, atributos, hallazgos, agente, ventas_diarias, presupuesto,
    clientes, oportunidades, notificaciones, pronosticos, comercializacion, clientes_pareto,
    score_salud, ranking, anomalias_auto, cohort, canasta, factores_com,
)
from .routers import (
    auth_router, rfm, abcxyz, clv, cross_selling, churn, search, desempeno, presupuesto_manual,
    pvm, rfm_migracion, estacionalidad, riesgo_cliente, pvta_presupuesto, elasticidad,
)
from .scheduler.jobs import start_scheduler, stop_scheduler, trigger_manual_refresh
from .database.cache import cache
from .database.snowflake_connector import connector

cfg = get_settings()
setup_logging(cfg.LOG_LEVEL)
logger = logging.getLogger(__name__)

_SECURITY_HEADERS = {
    "X-Content-Type-Options":  "nosniff",
    "X-Frame-Options":         "DENY",
    "X-XSS-Protection":        "1; mode=block",
    "Referrer-Policy":         "strict-origin-when-cross-origin",
    "Permissions-Policy":      "geolocation=(), microphone=(), camera=()",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("BI Ventas API starting up…")
    check_security_config()
    setup_default_admin()
    start_scheduler()
    cache.flush()
    yield
    stop_scheduler()
    logger.info("BI Ventas API shut down")


app = FastAPI(
    title="BI Ventas API",
    description="Business Intelligence — Snowflake star schema + FastAPI",
    version="3.0.0",
    lifespan=lifespan,
    # Disable interactive docs in production; enable with DEBUG=true in .env
    docs_url="/docs" if cfg.DEBUG else None,
    redoc_url="/redoc" if cfg.DEBUG else None,
    openapi_url="/openapi.json" if cfg.DEBUG else None,
    default_response_class=SafeJSONResponse,
)

# CORS must be registered before auth middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=cfg.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Auth middleware — validates Bearer token on all non-public routes
app.middleware("http")(auth_middleware)


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    response = await call_next(request)
    for header, value in _SECURITY_HEADERS.items():
        response.headers[header] = value
    return response


# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth_router.router)
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
app.include_router(oportunidades.router)
app.include_router(notificaciones.router)
app.include_router(pronosticos.router)
app.include_router(comercializacion.router)
app.include_router(score_salud.router)
app.include_router(ranking.router)
app.include_router(anomalias_auto.router)
app.include_router(cohort.router)
app.include_router(clientes_pareto.router)
app.include_router(canasta.router)
app.include_router(factores_com.router)
app.include_router(rfm.router)
app.include_router(abcxyz.router)
app.include_router(clv.router)
app.include_router(cross_selling.router)
app.include_router(churn.router)
app.include_router(search.router)
app.include_router(desempeno.router)
app.include_router(presupuesto_manual.router)
app.include_router(pvm.router)
app.include_router(rfm_migracion.router)
app.include_router(estacionalidad.router)
app.include_router(riesgo_cliente.router)
app.include_router(pvta_presupuesto.router)
app.include_router(elasticidad.router)
app.include_router(schema_router.router)


@app.get("/api/health", tags=["System"])
def health(request: Request):
    user = get_user(request)
    base = {"status": "ok"}
    if user and user.rol == "admin":
        base.update({
            "snowflake": connector.test(),
            "cache":     cache.stats(),
            "database":  cfg.SNOWFLAKE_DATABASE,
            "schema":    cfg.SNOWFLAKE_SCHEMA,
        })
    return base


@app.post("/api/refresh", tags=["System"])
def manual_refresh():
    return trigger_manual_refresh()
