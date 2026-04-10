"""server/app.py — OpenEnv multi-mode deployment entry point."""
import uvicorn
from main import app  # noqa: F401

__all__ = ["app", "main"]


def main():
    """Entry point for `server` console script."""
    uvicorn.run("main:app", host="0.0.0.0", port=7860, workers=1, log_level="info")


if __name__ == "__main__":
    main()
