#!/bin/bash

# ================================================
# BI Ventas - Docker Control Script (Linux/Mac)
# ================================================

set -e

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Función para imprimir mensajes
print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# Función para mostrar ayuda
show_help() {
    cat << EOF
${BLUE}BI Ventas - Docker Control${NC}

Uso: ./docker-control.sh [COMANDO]

Comandos disponibles:
  ${GREEN}start${NC}          - Inicia los contenedores (build + up)
  ${GREEN}stop${NC}           - Detiene los contenedores
  ${GREEN}restart${NC}        - Reinicia los contenedores
  ${GREEN}rebuild${NC}        - Reconstruye las imágenes y levanta contenedores
  ${GREEN}logs${NC}           - Muestra los logs en tiempo real
  ${GREEN}logs-backend${NC}   - Logs solo del backend
  ${GREEN}logs-frontend${NC}  - Logs solo del frontend
  ${GREEN}status${NC}         - Muestra el estado de los contenedores
  ${GREEN}shell-backend${NC}  - Abre una shell en el contenedor del backend
  ${GREEN}shell-frontend${NC} - Abre una shell en el contenedor del frontend
  ${GREEN}clean${NC}          - Limpia contenedores e imágenes no usadas
  ${GREEN}clean-all${NC}      - Elimina todo (contenedores, imágenes, volúmenes)
  ${GREEN}health${NC}         - Verifica el health check de los servicios
  ${GREEN}ip${NC}             - Muestra IPs de acceso
  ${GREEN}help${NC}           - Muestra esta ayuda

Puertos:
  Backend:  8000
  Frontend: 5173

URLs:
  Localhost: http://localhost:5173
  Por IP:    ./docker-control.sh ip
EOF
}

# Comandos
start_containers() {
    print_info "Iniciando contenedores..."
    docker-compose build
    docker-compose up -d
    print_success "Contenedores iniciados"
    print_info "Esperando a que los servicios estén listos..."
    sleep 5
    show_urls
}

stop_containers() {
    print_info "Deteniendo contenedores..."
    docker-compose down
    print_success "Contenedores detenidos"
}

restart_containers() {
    print_info "Reiniciando contenedores..."
    docker-compose restart
    print_success "Contenedores reiniciados"
    sleep 3
    show_urls
}

rebuild_containers() {
    print_info "Reconstruyendo contenedores..."
    docker-compose down
    docker-compose build --no-cache
    docker-compose up -d
    print_success "Contenedores reconstruidos"
    sleep 5
    show_urls
}

show_logs() {
    docker-compose logs -f
}

show_logs_backend() {
    docker-compose logs -f backend
}

show_logs_frontend() {
    docker-compose logs -f frontend
}

show_status() {
    print_info "Estado de contenedores:"
    docker-compose ps
}

shell_backend() {
    print_info "Abriendo shell en backend..."
    docker-compose exec backend /bin/bash
}

shell_frontend() {
    print_info "Abriendo shell en frontend..."
    docker-compose exec frontend /bin/sh
}

clean_containers() {
    print_warning "Limpiando contenedores e imágenes no usadas..."
    docker-compose down
    docker system prune -f
    print_success "Limpieza completada"
}

clean_all() {
    print_warning "ADVERTENCIA: Esto eliminará TODO (contenedores, imágenes, volúmenes)"
    read -p "¿Estás seguro? (s/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Ss]$ ]]; then
        print_info "Eliminando todo..."
        docker-compose down -v
        docker system prune -af
        print_success "Eliminación completada"
    else
        print_info "Operación cancelada"
    fi
}

check_health() {
    print_info "Verificando health checks..."
    echo ""
    docker-compose ps
    echo ""
    print_info "Health check del backend:"
    docker-compose exec backend curl -s http://localhost:8000/docs > /dev/null && print_success "Backend - OK" || print_error "Backend - FALLO"

    print_info "Health check del frontend:"
    docker-compose exec frontend wget -q --spider http://localhost:5173/ && print_success "Frontend - OK" || print_error "Frontend - FALLO"
}

show_ip_info() {
    clear
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}BI Ventas - IPs de Acceso${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
    print_info "Detectando IP del host..."
    echo ""

    local ip=""
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        ip=$(hostname -I | awk '{print $1}')
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        ip=$(ipconfig getifaddr en0)
    fi

    if [ -z "$ip" ]; then
        print_warning "No se pudo detectar la IP automáticamente"
        echo ""
        echo "Usa tu IP local manualmente. Ejemplos:"
        echo "  - 192.168.x.x (privada)"
        echo "  - 172.x.x.x (privada)"
        echo ""
        return
    fi

    print_success "IP Detectada: $ip"
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo "URLs de Acceso:"
    echo -e "${BLUE}========================================${NC}"
    echo ""
    echo -e "  ${GREEN}Frontend:${NC}   http://$ip:5173"
    echo -e "  ${GREEN}API:${NC}        http://$ip:8000"
    echo -e "  ${GREEN}Docs:${NC}       http://$ip:8000/docs"
    echo -e "  ${GREEN}ReDoc:${NC}      http://$ip:8000/redoc"
    echo ""
    echo "  Localhost:"
    echo -e "  ${GREEN}Frontend:${NC}   http://localhost:5173"
    echo -e "  ${GREEN}API:${NC}        http://localhost:8000"
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo ""
}

show_urls() {
    echo ""
    print_success "Servicios disponibles:"

    # Detectar IP del host
    local ip=""
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        ip=$(hostname -I | awk '{print $1}')
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        ip=$(ipconfig getifaddr en0)
    fi

    if [ -n "$ip" ]; then
        echo -e "  ${BLUE}Frontend (IP):${NC}     http://$ip:5173"
        echo -e "  ${BLUE}API (IP):${NC}          http://$ip:8000"
    fi

    echo -e "  ${BLUE}Frontend:${NC}         http://localhost:5173"
    echo -e "  ${BLUE}API:${NC}              http://localhost:8000"
    echo -e "  ${BLUE}Docs:${NC}             http://localhost:8000/docs"
    echo ""
}

# Main
case "${1:-help}" in
    start)
        start_containers
        ;;
    stop)
        stop_containers
        ;;
    restart)
        restart_containers
        ;;
    rebuild)
        rebuild_containers
        ;;
    logs)
        show_logs
        ;;
    logs-backend)
        show_logs_backend
        ;;
    logs-frontend)
        show_logs_frontend
        ;;
    status)
        show_status
        ;;
    shell-backend)
        shell_backend
        ;;
    shell-frontend)
        shell_frontend
        ;;
    clean)
        clean_containers
        ;;
    clean-all)
        clean_all
        ;;
    health)
        check_health
        ;;
    ip)
        show_ip_info
        ;;
    help)
        show_help
        ;;
    *)
        print_error "Comando desconocido: $1"
        show_help
        exit 1
        ;;
esac
