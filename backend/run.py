import uvicorn
from app.config import get_settings

if __name__ == "__main__":
    cfg = get_settings()
    uvicorn.run(
        "app.main:app",
        host=cfg.API_HOST,
        port=cfg.API_PORT,
        reload=True,
        log_level=cfg.LOG_LEVEL.lower(),
    )
