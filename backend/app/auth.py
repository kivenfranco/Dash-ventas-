"""
JWT authentication + middleware for BI Ventas API.
Users stored in backend/app/data/users.json.
Roles: admin (sees all), vendedor (filtered to own CODIGO_VENDEDOR).
"""
import json
import logging
import time
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import Request
from fastapi.responses import JSONResponse
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel

logger = logging.getLogger(__name__)

ALGORITHM = "HS256"
USERS_FILE = Path(__file__).parent / "data" / "users.json"

# Routes that don't require a token
_PUBLIC = {
    "/api/auth/login",
    "/api/auth/setup",
    "/api/health",
    "/docs",
    "/redoc",
    "/openapi.json",
}

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

_DEFAULT_SECRET = "bi-ventas-secret-change-in-production-2024"

# ── Simple in-memory rate limiter for login ───────────────────────────────────
# Tracks failed attempts per IP: {ip: [timestamp, ...]}
_login_attempts: dict = defaultdict(list)
_MAX_ATTEMPTS  = 10   # max failed attempts in window
_WINDOW_SECS   = 300  # 5-minute window


def check_login_rate_limit(ip: str) -> bool:
    """Returns True if the IP is allowed to attempt login, False if blocked."""
    now = time.time()
    # Evict old entries outside the window
    _login_attempts[ip] = [t for t in _login_attempts[ip] if now - t < _WINDOW_SECS]
    return len(_login_attempts[ip]) < _MAX_ATTEMPTS


def record_failed_login(ip: str):
    _login_attempts[ip].append(time.time())


class UserInToken(BaseModel):
    id: int
    email: str
    nombre: str
    rol: str           # "admin" | "vendedor"
    codigo_vendedor: Optional[str] = None


# ── User store ────────────────────────────────────────────────────────────────

def load_users() -> list:
    if USERS_FILE.exists():
        try:
            return json.loads(USERS_FILE.read_text("utf-8")).get("users", [])
        except Exception:
            return []
    return []


def save_users(users: list):
    USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    USERS_FILE.write_text(
        json.dumps({"users": users}, ensure_ascii=False, indent=2), "utf-8"
    )


def check_security_config():
    """Warn at startup if using insecure defaults."""
    from .config import get_settings
    cfg = get_settings()
    if cfg.AUTH_SECRET_KEY == _DEFAULT_SECRET:
        logger.warning(
            "SEGURIDAD: AUTH_SECRET_KEY usa el valor por defecto. "
            "Define AUTH_SECRET_KEY en backend/.env con una clave aleatoria fuerte."
        )


def setup_default_admin(default_password: str = "Alico2024!"):
    """Called at startup — creates admin if no users exist."""
    if load_users():
        return
    admin = {
        "id": 1,
        "nombre": "Administrador",
        "email": "admin@alico.com",
        "password_hash": pwd_context.hash(default_password),
        "rol": "admin",
        "codigo_vendedor": None,
    }
    save_users([admin])
    logger.info("Usuario admin por defecto creado: admin@alico.com / %s", default_password)


# ── Token helpers ─────────────────────────────────────────────────────────────

def _secret() -> str:
    from .config import get_settings
    return get_settings().AUTH_SECRET_KEY


def _token_hours() -> int:
    from .config import get_settings
    return get_settings().AUTH_TOKEN_HOURS


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def authenticate_user(email: str, password: str) -> Optional[dict]:
    for u in load_users():
        if u["email"].lower() == email.lower() and verify_password(password, u["password_hash"]):
            return u
    return None


def create_token(user: dict) -> str:
    payload = {
        "id":               user["id"],
        "email":            user["email"],
        "nombre":           user["nombre"],
        "rol":              user["rol"],
        "codigo_vendedor":  user.get("codigo_vendedor"),
        "exp":              datetime.utcnow() + timedelta(hours=_token_hours()),
    }
    return jwt.encode(payload, _secret(), algorithm=ALGORITHM)


def decode_token(token: str) -> UserInToken:
    payload = jwt.decode(token, _secret(), algorithms=[ALGORITHM])
    return UserInToken(**payload)


# ── Middleware ────────────────────────────────────────────────────────────────

async def auth_middleware(request: Request, call_next):
    # Always allow OPTIONS (CORS preflight)
    if request.method == "OPTIONS":
        return await call_next(request)

    path = request.url.path
    # Allow public routes
    if any(path == p or path.startswith(p + "/") for p in _PUBLIC):
        return await call_next(request)
    
    logger.info(f"Middleware verificando ruta: {path}")


    # Extract Bearer token
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return JSONResponse(status_code=401, content={"detail": "No autenticado. Inicia sesión."})

    try:
        user = decode_token(auth_header[7:])
        request.state.user = user
    except JWTError:
        return JSONResponse(status_code=401, content={"detail": "Token inválido o expirado."})

    return await call_next(request)


# ── FastAPI helpers ───────────────────────────────────────────────────────────

def get_user(request: Request) -> Optional[UserInToken]:
    return getattr(request.state, "user", None)


def vendedor_filter(request: Request) -> Optional[str]:
    """If the logged-in user has 'vendedor' role, returns their CODIGO_VENDEDOR
    so that SQL queries can add a WHERE clause to filter their own data only."""
    user = get_user(request)
    if user and user.rol == "vendedor" and user.codigo_vendedor:
        return user.codigo_vendedor
    return None
