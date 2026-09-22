#!/usr/bin/env python3
"""Loopback JeV-compatible SemIf provider, backed by MLX on Apple Silicon.

Start with the SemIf environment described in README.  The process loads the
pinned Qwen3.5 checkpoint once, then reads option-letter logits directly for
each question.  It intentionally listens only on loopback.
"""

from __future__ import annotations

import json
import os
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from semif_phase1 import mlx_backend

MODEL = os.environ.get("SEMIF_MODEL", "Qwen/Qwen3.5-4B")
REVISION = os.environ.get("SEMIF_REVISION", "851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a")
BITS = int(os.environ.get("SEMIF_MLX_BITS", "4"))
CACHE_LIMIT_MIB = int(os.environ.get("SEMIF_MLX_CACHE_LIMIT_MIB", "256"))
MAX_INPUT_TOKENS = int(os.environ.get("SEMIF_MAX_INPUT_TOKENS", "4096"))


def text(value: Any) -> str:
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


class Provider:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._loaded: tuple[Any, Any, dict[str, Any]] | None = None

    @property
    def loaded(self) -> bool:
        return self._loaded is not None

    def load(self) -> tuple[Any, Any, dict[str, Any]]:
        if self._loaded is None:
            self._loaded = mlx_backend.load_model(
                MODEL, REVISION, bits=BITS, cache_limit_mib=CACHE_LIMIT_MIB
            )
        return self._loaded

    @staticmethod
    def options(question: dict[str, Any]) -> tuple[list[str], list[dict[str, str]]]:
        kind = question.get("type")
        criteria = question.get("criteria")
        if kind == "choice":
            if not isinstance(criteria, dict) or not 1 <= len(criteria) <= 26:
                raise ValueError("choice criteria must contain 1 to 26 options")
            keys = list(criteria)
            return keys, [{"id": key, "description": f"{key}: {text(criteria[key])}"} for key in keys]
        if kind == "noul":
            if criteria is not None and not isinstance(criteria, dict):
                raise ValueError("noul criteria must be an object when supplied")
            criteria = criteria or {}
            return ["false", "true"], [
                {"id": "false", "description": f"false: {text(criteria.get('false', 'The proposition is false.'))}"},
                {"id": "true", "description": f"true: {text(criteria.get('true', 'The proposition is true.'))}"},
            ]
        if kind == "score":
            if not isinstance(criteria, list) or not 2 <= len(criteria) <= 10:
                raise ValueError("score criteria must contain 2 to 10 ordered levels")
            keys = [str(index) for index in range(len(criteria))]
            return keys, [
                {"id": key, "description": f"{key}: {text(criterion)}"}
                for key, criterion in zip(keys, criteria)
            ]
        raise ValueError("question type must be choice, noul, or score")

    def decide(self, state: Any, question: dict[str, Any], request_id: str) -> dict[str, Any]:
        keys, options = self.options(question)
        if len(keys) == 1:
            return {"key": keys[0], "probabilities": {keys[0]: 1.0}, "input_tokens": 0, "inference_ms": 0.0}
        instructions = question.get("instructions", "")
        if not isinstance(instructions, str):
            instructions = json.dumps(instructions, ensure_ascii=False)
        row = {"id": request_id, "state": state, "question": instructions, "options": options}
        with self._lock:
            model, tokenizer, metadata = self.load()
            started = time.perf_counter()
            output = mlx_backend.score(model, tokenizer, row, metadata, MAX_INPUT_TOKENS)
            inference_ms = (time.perf_counter() - started) * 1_000
        probabilities = dict(zip(keys, output["probabilities"], strict=True))
        key = max(probabilities, key=probabilities.get)
        return {
            "key": key,
            "probabilities": probabilities,
            "input_tokens": output["input_tokens"],
            "inference_ms": round(inference_ms, 3),
        }


PROVIDER = Provider()


def response(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict) or "state" not in payload or not isinstance(payload.get("questions"), dict):
        raise ValueError("state and a non-empty questions object are required")
    if not payload["questions"]:
        raise ValueError("questions must not be empty")
    answers: dict[str, Any] = {}
    timings: list[float] = []
    input_tokens = 0
    for name, question in payload["questions"].items():
        if not isinstance(name, str) or not isinstance(question, dict):
            raise ValueError("questions must map names to objects")
        decision = PROVIDER.decide(payload["state"], question, name)
        kind = question["type"]
        timings.append(decision["inference_ms"])
        input_tokens += decision["input_tokens"]
        probabilities = decision["probabilities"]
        if kind == "choice":
            answers[name] = {"type": kind, "choice": decision["key"], "probabilities": probabilities,
                             "confidence": probabilities[decision["key"]]}
        elif kind == "noul":
            answers[name] = {"type": kind, "noul": probabilities["true"]}
        else:
            answers[name] = {"type": kind, "score": int(decision["key"]), "probabilities": probabilities,
                             "confidence": probabilities[decision["key"]],
                             "legend": {str(index): value for index, value in enumerate(question["criteria"])}}
    return {
        "model": "jevlocal-semif-qwen3.5-4b-mlx-q4",
        "answers": answers,
        "usage": {"input_tokens": input_tokens, "output_tokens": 0},
        "metadata": {
            "provider": "semif/mlx-qwen3.5-4b-q4",
            "probabilities": "Conditional native option-logit softmax; uncalibrated for this workload.",
            "performance": {"inference_ms": round(sum(timings), 3), "per_question_ms": timings},
        },
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_: Any) -> None:
        pass

    def write_json(self, status: int, body: dict[str, Any]) -> None:
        encoded = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:
        if self.path == "/health":
            self.write_json(200, {"status": "ok", "provider": "semif/mlx", "loaded": PROVIDER.loaded,
                                  "model": MODEL, "revision": REVISION, "bits": BITS})
            return
        self.write_json(404, {"error": {"message": "not found"}})

    def do_POST(self) -> None:
        if self.path not in {"/v1/systemone", "/v1/decide"}:
            self.write_json(404, {"error": {"message": "not found"}})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length))
            self.write_json(200, response(body))
        except (ValueError, json.JSONDecodeError) as exc:
            self.write_json(422, {"error": {"message": str(exc), "type": "invalid_request_error"}})
        except Exception as exc:  # provider availability is distinct from bad input
            self.write_json(503, {"error": {"message": f"SemIf decision failed: {exc}", "type": "provider_error"}})


if __name__ == "__main__":
    host = os.environ.get("JEVLOCAL_HOST", "127.0.0.1")
    port = int(os.environ.get("JEVLOCAL_PORT", "9013"))
    ThreadingHTTPServer((host, port), Handler).serve_forever()
