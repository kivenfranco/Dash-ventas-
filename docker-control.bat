@echo off
REM ================================================
REM BI Ventas - Docker Control Script (Windows)
REM ================================================

setlocal enabledelayedexpansion

if "%1%"=="" (
    goto show_help
)

if /I "%1%"=="start" (
    goto start_containers
) else if /I "%1%"=="stop" (
    goto stop_containers
) else if /I "%1%"=="restart" (
    goto restart_containers
) else if /I "%1%"=="rebuild" (
    goto rebuild_containers
) else if /I "%1%"=="logs" (
    goto show_logs
) else if /I "%1%"=="logs-backend" (
    goto show_logs_backend
) else if /I "%1%"=="logs-frontend" (
    goto show_logs_frontend
) else if /I "%1%"=="status" (
    goto show_status
) else if /I "%1%"=="shell-backend" (
    goto shell_backend
) else if /I "%1%"=="shell-frontend" (
    goto shell_frontend
) else if /I "%1%"=="clean" (
    goto clean_containers
) else if /I "%1%"=="clean-all" (
    goto clean_all
) else if /I "%1%"=="health" (
    goto check_health
) else if /I "%1%"=="ip" (
    goto show_ip_info
) else if /I "%1%"=="help" (
    goto show_help
) else (
    echo ERROR: Comando desconocido: %1%
    echo.
    goto show_help
)

:show_help
echo.
echo =====================================================
echo BI Ventas - Docker Control
echo =====================================================
echo.
echo Uso: docker-control.bat [COMANDO]
echo.
echo Comandos disponibles:
echo   start         - Inicia los contenedores (build + up)
echo   stop          - Detiene los contenedores
echo   restart       - Reinicia los contenedores
echo   rebuild       - Reconstruye las imagenes y levanta
echo   logs          - Muestra logs en tiempo real
echo   logs-backend  - Logs solo del backend
echo   logs-frontend - Logs solo del frontend
echo   status        - Estado de contenedores
echo   shell-backend - Abre shell en el backend
echo   shell-frontend- Abre shell en el frontend
echo   clean         - Limpia contenedores e imagenes
echo   clean-all     - Elimina todo (CUIDADO!)
echo   health        - Verifica health checks
echo   ip            - Muestra IPs de acceso
echo   help          - Muestra esta ayuda
echo.
echo Puertos:
echo   Backend:  8000
echo   Frontend: 5173
echo.
echo Acceso:
echo   Localhost: http://localhost:5173
echo   Por IP:    .\docker-control.bat ip
echo.
goto end

:show_ip_info
cls
echo.
echo =====================================================
echo BI Ventas - IPs de Acceso
echo =====================================================
echo.
echo [*] Detectando IP del host...
echo.

REM Obtener IP (Windows)
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /I "IPv4"') do (
    set "IP=%%A"
    set "IP=!IP: =!"
)

if not defined IP (
    echo [!] No se pudo detectar la IP automáticamente
    echo.
    echo Usa tu IP local manualmente. Ejemplos:
    echo   - 192.168.x.x (privada)
    echo   - 172.x.x.x (privada)
    echo.
    goto end
)

echo [+] IP Detectada: !IP!
echo.
echo =====================================================
echo URLs de Acceso:
echo =====================================================
echo.
echo   Frontend:   http://!IP!:5173
echo   API:        http://!IP!:8000
echo   Docs:       http://!IP!:8000/docs
echo   ReDoc:      http://!IP!:8000/redoc
echo.
echo   Localhost:
echo   Frontend:   http://localhost:5173
echo   API:        http://localhost:8000
echo.
echo =====================================================
echo.
goto end

:start_containers
echo.
echo [*] Iniciando contenedores...
docker-compose build
docker-compose up -d
echo [+] Contenedores iniciados
echo [*] Esperando a que los servicios esten listos...
timeout /t 5 /nobreak
call :show_urls
goto end

:stop_containers
echo.
echo [*] Deteniendo contenedores...
docker-compose down
echo [+] Contenedores detenidos
goto end

:restart_containers
echo.
echo [*] Reiniciando contenedores...
docker-compose restart
echo [+] Contenedores reiniciados
timeout /t 3 /nobreak
call :show_urls
goto end

:rebuild_containers
echo.
echo [*] Reconstruyendo contenedores...
docker-compose down
docker-compose build --no-cache
docker-compose up -d
echo [+] Contenedores reconstruidos
timeout /t 5 /nobreak
call :show_urls
goto end

:show_logs
docker-compose logs -f
goto end

:show_logs_backend
docker-compose logs -f backend
goto end

:show_logs_frontend
docker-compose logs -f frontend
goto end

:show_status
echo.
echo [*] Estado de contenedores:
echo.
docker-compose ps
goto end

:shell_backend
echo.
echo [*] Abriendo shell en backend...
docker-compose exec backend cmd
goto end

:shell_frontend
echo.
echo [*] Abriendo shell en frontend...
docker-compose exec frontend cmd
goto end

:clean_containers
echo.
echo [!] Limpiando contenedores e imagenes no usadas...
docker-compose down
docker system prune -f
echo [+] Limpieza completada
goto end

:clean_all
echo.
echo [!] ADVERTENCIA: Esto eliminara TODO (contenedores, imagenes, volumenes)
set /p confirm="Escriba 's' para confirmar: "
if /I "%confirm%"=="s" (
    echo [*] Eliminando todo...
    docker-compose down -v
    docker system prune -af
    echo [+] Eliminacion completada
) else (
    echo [*] Operacion cancelada
)
goto end

:check_health
echo.
echo [*] Verificando health checks...
echo.
docker-compose ps
echo.
echo [*] Health check del backend:
docker-compose exec backend curl -s http://localhost:8000/docs >nul && (
    echo [+] Backend - OK
) || (
    echo [-] Backend - FALLO
)
echo.
echo [*] Health check del frontend:
docker-compose exec frontend wget -q --spider http://localhost:5173/ && (
    echo [+] Frontend - OK
) || (
    echo [-] Frontend - FALLO
)
goto end

:show_urls
REM Detectar IP
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /I "IPv4" ^| findstr /v "127.0"') do (
    set "IP=%%A"
    set "IP=!IP: =!"
    goto show_urls_print
)

:show_urls_print
echo.
echo [+] Servicios disponibles:
echo.
if defined IP (
    echo   Frontend (IP):  http://!IP!:5173
    echo   API (IP):       http://!IP!:8000
)
echo   Frontend:      http://localhost:5173
echo   API:           http://localhost:8000
echo   Docs:          http://localhost:8000/docs
echo.
echo [*] Para ver IPs en cualquier momento: docker-control.bat ip
echo.
exit /b 0

:end
endlocal
