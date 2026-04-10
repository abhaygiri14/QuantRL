"""app.py — Hugging Face Spaces entry point."""
import uvicorn
from main import app  # noqa: F401


def main():
    uvicorn.run("main:app", host="0.0.0.0", port=7860, workers=1, log_level="info")


if __name__ == "__main__":
    main()
