# 🐳 Docker - BI Ventas

Configuración completa de Docker para ejecutar BI Ventas en contenedores estables y listos para producción.

## 📋 Requisitos

- **Docker Desktop**: [Descargar](https://www.docker.com/products/docker-desktop)
- **Docker Compose**: Incluido en Docker Desktop
- **Puertos disponibles**: 
  - `8000` (Backend FastAPI)
  - `5173` (Frontend React + Nginx)

## 🚀 Inicio Rápido

### Windows
```bash
# Ejecutar desde la raíz del proyecto
.\docker-control.bat start
```

### Linux / macOS
```bash
# Dar permisos de ejecución (primera vez)
chmod +x docker-control.sh

# Ejecutar
./docker-control.sh start
```

## 📍 Acceso a Servicios

Una vez iniciados, puedes acceder a:

- **Frontend**: http://localhost:5173
- **API**: http://localhost:8000
- **Documentación API (Swagger)**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## 🛠️ Comandos Disponibles

| Comando | Descripción |
|---------|-------------|
| `start` | Inicia los contenedores (build + up) |
| `stop` | Detiene los contenedores |
| `restart` | Reinicia los contenedores |
| `rebuild` | Reconstruye las imágenes desde cero |
| `logs` | Muestra logs en tiempo real de ambos servicios |
| `logs-backend` | Logs solo del backend |
| `logs-frontend` | Logs solo del frontend |
| `status` | Muestra el estado actual de los contenedores |
| `shell-backend` | Abre una shell bash en el backend |
| `shell-frontend` | Abre una shell en el frontend |
| `health` | Verifica los health checks de ambos servicios |
| `clean` | Limpia contenedores e imágenes no usadas |
| `clean-all` | ⚠️ Elimina TODO (contenedores, imágenes, volúmenes) |

### Ejemplos de Uso

```bash
# Ver logs en tiempo real
./docker-control.bat logs

# Ver solo logs del backend
./docker-control.bat logs-backend

# Ver estado de los contenedores
./docker-control.bat status

# Entrar al backend para ejecutar comandos
./docker-control.bat shell-backend

# Verificar que todo esté saludable
./docker-control.bat health
```

## 🔐 Variables de Entorno

El archivo `.env` se carga automáticamente desde el backend. Asegúrate de tener configurado:

```env
SNOWFLAKE_USER=tu_usuario
SNOWFLAKE_PASSWORD=tu_contraseña
SNOWFLAKE_ACCOUNT=xxxxxxx.region.azure
SNOWFLAKE_WAREHOUSE=COMPUTE_WH
SNOWFLAKE_DATABASE=MI_BASE_DE_DATOS
SNOWFLAKE_SCHEMA=PUBLIC
SNOWFLAKE_TABLE=WH_POWERBI
```

## 📊 Arquitectura Docker

```
┌─────────────────────────────────────────┐
│         Docker Network Bridge           │
│          (172.28.0.0/16)                │
├─────────────────┬───────────────────────┤
│                 │                       │
│   Frontend      │      Backend          │
│  (Nginx)        │   (FastAPI)           │
│  Port 5173      │   Port 8000           │
│                 │                       │
│   ✓ SPA Route   │   ✓ API endpoints     │
│   ✓ Proxy /api  │   ✓ Snowflake conn   │
│   ✓ Cache busting│   ✓ Health check    │
└─────────────────┴───────────────────────┘
        ↑ Comunicación interna
        └─ http://backend:8000 (desde nginx)
```

## 💪 Health Checks

Ambos servicios incluyen health checks automáticos:

- **Backend**: Verifica `GET /docs` cada 30 segundos
- **Frontend**: Verifica conexión HTTP cada 30 segundos

Si un servicio falla, Docker lo reiniciará automáticamente con la política `restart: unless-stopped`.

## 📝 Logs y Debugging

Los logs se almacenan en formato JSON con rotación:
- Máximo 10MB por archivo
- Máximo 3 archivos de backup

```bash
# Ver logs completos
docker logs bi-ventas-backend
docker logs bi-ventas-frontend

# Ver logs en vivo
docker logs -f bi-ventas-backend

# Últimas 100 líneas
docker logs --tail 100 bi-ventas-backend
```

## 🔄 Ciclo de Desarrollo

### Cambios en Backend
```bash
# 1. Hacer cambios en backend/
# 2. Reconstruir y reiniciar
./docker-control.bat rebuild

# O solo reiniciar si es cambio en requirements.txt
./docker-control.bat restart
```

### Cambios en Frontend
```bash
# 1. Hacer cambios en frontend/
# 2. Reconstruir (Vite se reconstruirá)
./docker-control.bat rebuild

# O si es cambio en package.json
./docker-control.bat rebuild
```

## ⚙️ Configuración Avanzada

### Recursos (CPU/Memoria)
Descomenta en `docker-compose.yml`:

```yaml
deploy:
  resources:
    limits:
      cpus: '1'
      memory: 1G
    reservations:
      cpus: '0.5'
      memory: 512M
```

### Volúmenes Persistentes
Para desarrollo con hot-reload:

```yaml
volumes:
  - ./backend:/app/backend
  - ./frontend/src:/app/src
```

## 🚨 Troubleshooting

### "Port 8000/5173 already in use"
```bash
# Linux/Mac - Encontrar proceso usando puerto
lsof -i :8000
lsof -i :5173

# Windows - Ver procesos en puerto
netstat -ano | findstr :8000

# Liberar puertos
./docker-control.bat stop
docker system prune -f
```

### "Connection refused" entre servicios
- Los servicios usan nombres DNS internos: `backend:8000`, `frontend:5173`
- Nginx en `nginx.conf` ya está configurado para esto
- Verificar con: `./docker-control.bat health`

### Limpiar todo y empezar de cero
```bash
./docker-control.bat clean-all
./docker-control.bat start
```

### Ver qué contiene una imagen
```bash
docker-compose exec backend ls -la
docker-compose exec frontend ls -la /usr/share/nginx/html
```

## 📦 Estructura de Archivos

```
BI-Ventas/
├── docker-compose.yml      # Orquestación de servicios
├── Dockerfile.backend      # Imagen del backend (FastAPI)
├── Dockerfile.frontend     # Imagen del frontend (React)
├── nginx.conf             # Configuración de Nginx
├── .dockerignore          # Archivos a ignorar en build
├── docker-control.sh      # Script de control (Linux/Mac)
├── docker-control.bat     # Script de control (Windows)
├── backend/               # Código FastAPI
├── frontend/              # Código React
└── .env                   # Variables de entorno
```

## 🔗 Links Útiles

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose](https://docs.docker.com/compose/)
- [Nginx Docker](https://hub.docker.com/_/nginx)
- [Python Docker](https://hub.docker.com/_/python)
- [Node.js Docker](https://hub.docker.com/_/node)

## 📞 Soporte

Para issues de Docker:
1. Verifica logs: `./docker-control.bat logs`
2. Verifica health: `./docker-control.bat health`
3. Limpia y reconstruye: `./docker-control.bat rebuild`
4. Revisa el archivo de compose para configuraciones

---

**Última actualización**: 2026-05-12
