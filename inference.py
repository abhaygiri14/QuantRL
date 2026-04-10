"""
inference.py — Baseline inference for the Stock Trading Agent environment.

Prints [START] / [STEP] / [END] structured blocks required by the validator.

Environment variables
---------------------
  API_BASE_URL  LLM endpoint  (default: https://router.huggingface.co/v1)
  MODEL_NAME    Model name    (default: meta-llama/Llama-3.3-70B-Instruct)
  HF_TOKEN      API key
  ENV_URL       Env server    (default: http://localhost:7860)
"""
from __future__ import annotations

import json
import os
import sys
import textwrap
import time
import urllib.error
import urllib.request

from openai import OpenAI

API_BASE_URL = os.getenv("API_BASE_URL", "https://router.huggingface.co/v1")
API_KEY      = os.getenv("HF_TOKEN") or os.getenv("API_KEY", "")
MODEL_NAME   = os.getenv("MODEL_NAME", "meta-llama/Llama-3.3-70B-Instruct")
ENV_URL      = os.getenv("ENV_URL", "http://localhost:7860").rstrip("/")

MAX_STEPS   = 50
TEMPERATURE = 0.1
MAX_TOKENS  = 256

TASK_IDS = ["trending_up", "mean_reverting", "volatile_recovery"]

# ── HTTP helpers ──────────────────────────────────────────────────────────────

def http_post(path: str, body: dict, retries: int = 3) -> dict:
    url = f"{ENV_URL}{path}"
    data = json.dumps(body).encode()
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(
                url, data=data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as exc:
            print(f"  [HTTP {exc.code}] {url}", file=sys.stderr, flush=True)
            if attempt == retries:
                raise
        except Exception as exc:
            print(f"  [Attempt {attempt}] {url} failed: {exc}", file=sys.stderr, flush=True)
            if attempt == retries:
                raise
            time.sleep(2 * attempt)
    return {}


def wait_for_server(timeout: int = 60) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{ENV_URL}/health", timeout=5) as r:
                if r.status == 200:
                    print(f"Server ready at {ENV_URL}", flush=True)
                    return
        except Exception:
            pass
        time.sleep(3)
    raise RuntimeError(f"Server at {ENV_URL} not ready after {timeout}s")


# ── Prompts ───────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = textwrap.dedent("""
You are an expert stock trader. Analyse the market data and decide one action.

Reply with ONLY a JSON object, nothing else:
{"action": "buy" | "sell" | "hold", "quantity": <integer 1-20>, "reasoning": "<one sentence>"}

Rules:
- "buy"  when technical indicators suggest upward momentum
- "sell" when indicators suggest downward momentum or take profit
- "hold" when signals are unclear or no position exists to sell
- quantity must be between 1 and 20
""").strip()


def build_prompt(obs: dict, step: int) -> str:
    ind = obs.get("indicators", {})
    lines = [
        f"Day {obs.get('current_day')}/{obs.get('total_days')} | Step {step}",
        f"Task: {obs.get('task_name')} ({obs.get('difficulty')})",
        f"Objective: {obs.get('task_description', '')[:200]}",
        "",
        f"PRICE:  ${obs.get('current_price'):.2f}",
        f"SMA5:   {ind.get('SMA5', 0):.2f}  SMA20: {ind.get('SMA20', 0):.2f}",
        f"RSI:    {ind.get('RSI', 50):.1f}",
        f"MACD:   {ind.get('MACD', 0):.4f}",
        f"BB_upper: {ind.get('BB_upper', 0):.2f}  BB_lower: {ind.get('BB_lower', 0):.2f}",
        "",
        f"PORTFOLIO: cash=${obs.get('cash', 0):.2f}  shares={obs.get('shares_held', 0)}",
        f"Portfolio value: ${obs.get('portfolio_value', 0):.2f}  "
        f"Return: {obs.get('total_return_pct', 0):.2f}%",
        "",
        f"Last actions: {obs.get('previous_actions', [])[-3:]}",
    ]
    if obs.get("hint"):
        lines += ["", f"HINT: {obs['hint']}"]
    lines += ["", "Reply with ONLY the JSON action object."]
    return "\n".join(lines)


# ── Agent loop ────────────────────────────────────────────────────────────────

def call_llm(client: OpenAI, obs: dict, step: int) -> dict:
    try:
        resp = client.chat.completions.create(
            model=MODEL_NAME,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",   "content": build_prompt(obs, step)},
            ],
            temperature=TEMPERATURE,
            max_tokens=MAX_TOKENS,
        )
        raw = (resp.choices[0].message.content or "{}").strip()
        # strip markdown fences if present
        if raw.startswith("```"):
            raw = "\n".join(raw.splitlines()[1:])
            raw = raw.replace("```", "").strip()
        return json.loads(raw)
    except Exception as exc:
        print(f"  [LLM error] {exc}", file=sys.stderr, flush=True)
        return {"action": "hold", "quantity": 10}


def run_task(client: OpenAI, task_id: str) -> float:
    print(f"[START] task={task_id}", flush=True)

    try:
        obs = http_post("/reset", {"task_id": task_id})
    except Exception as exc:
        print(f"[END] task={task_id} score=0.01 steps=0", flush=True)
        print(f"  [ERROR] reset failed: {exc}", file=sys.stderr, flush=True)
        return 0.01

    best_score = 0.01
    step_num   = 0

    for step in range(1, MAX_STEPS + 1):
        if obs.get("done"):
            break

        action_json = call_llm(client, obs, step)
        action = action_json.get("action", "hold")
        quantity = int(action_json.get("quantity", 10))
        quantity = max(1, min(quantity, 20))

        try:
            result = http_post("/step", {"action": action, "quantity": quantity})
        except Exception as exc:
            print(f"  [ERROR] step failed: {exc}", file=sys.stderr, flush=True)
            continue

        reward     = result.get("reward", {})
        score      = round(max(0.01, min(float(reward.get("value", 0.01)), 0.99)), 4)
        done       = result.get("done", False)
        obs        = result.get("observation", obs)
        best_score = max(best_score, score)
        step_num   = step

        print(f"[STEP] step={step} reward={score:.4f} done={done}", flush=True)

        if done:
            break

    best_score = round(max(0.01, min(best_score, 0.99)), 4)
    print(f"[END] task={task_id} score={best_score:.4f} steps={step_num}", flush=True)
    return best_score


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print("Stock Trading Agent — Baseline Inference", flush=True)
    print(f"Model: {MODEL_NAME} | Env: {ENV_URL}", flush=True)

    if not API_KEY:
        print("[ERROR] HF_TOKEN not set.", flush=True)
        sys.exit(1)

    try:
        wait_for_server(timeout=60)
    except RuntimeError as exc:
        print(f"[ERROR] {exc}", flush=True)
        sys.exit(1)

    client = OpenAI(base_url=API_BASE_URL, api_key=API_KEY)
    scores: dict[str, float] = {}
    t0 = time.time()

    for task_id in TASK_IDS:
        try:
            scores[task_id] = run_task(client, task_id)
        except Exception as exc:
            print(f"[END] task={task_id} score=0.01 steps=0", flush=True)
            print(f"  [ERROR] {exc}", file=sys.stderr, flush=True)
            scores[task_id] = 0.01

    avg = sum(scores.values()) / len(scores)
    print(f"\nAverage score: {avg:.4f} | Runtime: {time.time()-t0:.1f}s", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        import traceback
        print(f"[FATAL] {exc}", flush=True)
        traceback.print_exc()
        sys.exit(1)
