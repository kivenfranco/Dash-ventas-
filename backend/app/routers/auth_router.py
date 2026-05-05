"""
POST /api/auth/login           — authenticate, get JWT
GET  /api/auth/me              — current user info
POST /api/auth/cambiar-password — change own password
GET  /api/auth/users           — list all users (admin)
POST /api/auth/users           — create user (admin)
PUT  /api/auth/users/{id}      — update user (admin)
DELETE /api/auth/users/{id}    — delete user (admin)
"""
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ..auth import (
    authenticate_user, create_token, hash_password,
    load_users, save_users, get_user,
)

router = APIRouter(prefix="/api/auth", tags=["Auth"])


class LoginBody(BaseModel):
    email: str
    password: str


class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str


class UserBody(BaseModel):
    email: str
    password: str
    nombre: str
    rol: str
    codigo_vendedor: Optional[str] = None


class UserUpdate(BaseModel):
    nombre: Optional[str] = None
    password: Optional[str] = None
    rol: Optional[str] = None
    codigo_vendedor: Optional[str] = None


def _require_admin(request: Request):
    user = get_user(request)
    if not user or user.rol != "admin":
        raise HTTPException(status_code=403, detail="Se requiere rol administrador.")
    return user


@router.post("/login")
def login(body: LoginBody):
    user = authenticate_user(body.email, body.password)
    if not user:
        raise HTTPException(status_code=401, detail="Credenciales incorrectas.")
    token = create_token(user)
    return {
        "access_token": token,
        "token_type":   "bearer",
        "user": {
            "id":               user["id"],
            "email":            user["email"],
            "nombre":           user["nombre"],
            "rol":              user["rol"],
            "codigo_vendedor":  user.get("codigo_vendedor"),
        },
    }


@router.get("/me")
def me(request: Request):
    user = get_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="No autenticado.")
    return user


@router.post("/cambiar-password")
def cambiar_password(body: ChangePasswordBody, request: Request):
    current = get_user(request)
    if not current:
        raise HTTPException(status_code=401, detail="No autenticado.")
    user = authenticate_user(current.email, body.current_password)
    if not user:
        raise HTTPException(status_code=401, detail="Contraseña actual incorrecta.")
    users = load_users()
    for u in users:
        if u["id"] == user["id"]:
            u["password_hash"] = hash_password(body.new_password)
    save_users(users)
    return {"status": "ok"}


@router.get("/users")
def list_users(request: Request):
    _require_admin(request)
    users = load_users()
    return {"users": [{k: v for k, v in u.items() if k != "password_hash"} for u in users]}


@router.post("/users", status_code=201)
def create_user(body: UserBody, request: Request):
    _require_admin(request)
    users = load_users()
    if any(u["email"].lower() == body.email.lower() for u in users):
        raise HTTPException(status_code=409, detail="Email ya registrado.")
    new_id = max((u["id"] for u in users), default=0) + 1
    new_user = {
        "id":               new_id,
        "nombre":           body.nombre,
        "email":            body.email,
        "password_hash":    hash_password(body.password),
        "rol":              body.rol,
        "codigo_vendedor":  body.codigo_vendedor,
    }
    users.append(new_user)
    save_users(users)
    return {k: v for k, v in new_user.items() if k != "password_hash"}


@router.put("/users/{user_id}")
def update_user(user_id: int, body: UserUpdate, request: Request):
    _require_admin(request)
    users = load_users()
    for u in users:
        if u["id"] == user_id:
            if body.nombre is not None:
                u["nombre"] = body.nombre
            if body.password is not None:
                u["password_hash"] = hash_password(body.password)
            if body.rol is not None:
                u["rol"] = body.rol
            if body.codigo_vendedor is not None:
                u["codigo_vendedor"] = body.codigo_vendedor
            save_users(users)
            return {k: v for k, v in u.items() if k != "password_hash"}
    raise HTTPException(status_code=404, detail="Usuario no encontrado.")


@router.delete("/users/{user_id}")
def delete_user(user_id: int, request: Request):
    current = _require_admin(request)
    if current.id == user_id:
        raise HTTPException(status_code=400, detail="No puedes eliminar tu propio usuario.")
    users = load_users()
    new_users = [u for u in users if u["id"] != user_id]
    if len(new_users) == len(users):
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    save_users(new_users)
    return {"status": "ok"}
