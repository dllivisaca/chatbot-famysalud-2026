#!/usr/bin/env python3

import json
import os
import socket
import time
from urllib.parse import urlparse

try:
    import requests
except ImportError as exc:
    raise SystemExit("Este diagnostico requiere requests instalado en el entorno Python.") from exc


TIMEOUT_SECONDS = float(os.getenv("DIAG_TIMEOUT_SECONDS", "35"))
HOST_HEADER = os.getenv("DIAG_HOST_HEADER", "ia.famysaludec.com")
CHAT_PAYLOAD = {"texto": "hola"}
DEFAULT_TARGETS = [
    {"method": "GET", "url": "https://ia.famysaludec.com/"},
    {"method": "POST", "url": "https://ia.famysaludec.com/chat", "json": CHAT_PAYLOAD},
    {"method": "GET", "url": "http://localhost"},
    {"method": "GET", "url": "http://127.0.0.1"},
    {"method": "GET", "url": "http://localhost/", "headers": {"Host": HOST_HEADER}},
    {"method": "POST", "url": "http://localhost/chat", "json": CHAT_PAYLOAD, "headers": {"Host": HOST_HEADER}},
    {"method": "GET", "url": "http://127.0.0.1/", "headers": {"Host": HOST_HEADER}},
    {"method": "POST", "url": "http://127.0.0.1/chat", "json": CHAT_PAYLOAD, "headers": {"Host": HOST_HEADER}},
]


def extra_targets():
    urls = [item.strip() for item in os.getenv("DIAG_EXTRA_URLS", "").split(",") if item.strip()]
    targets = []
    for url in urls:
        is_chat = url.rstrip("/").endswith("/chat")
        targets.append({
            "method": "POST" if is_chat else "GET",
            "url": url,
            "json": CHAT_PAYLOAD if is_chat else None,
        })
    return targets


def redact(value):
    return value or None


def resolve_host(hostname):
    try:
        return sorted({
            item[4][0]
            for item in socket.getaddrinfo(hostname, None)
        })
    except Exception as exc:
        return {"error": str(exc)}


def request_target(target):
    started = time.time()
    try:
        response = requests.request(
            target["method"],
            target["url"],
            json=target.get("json"),
            headers=target.get("headers"),
            timeout=TIMEOUT_SECONDS,
        )
        return {
            "target": {"method": target["method"], "url": target["url"]},
            "ok": 200 <= response.status_code < 400,
            "status_code": response.status_code,
            "duration_ms": int((time.time() - started) * 1000),
            "headers": {
                "server": response.headers.get("server"),
                "location": response.headers.get("location"),
                "content_type": response.headers.get("content-type"),
            },
            "body_preview": response.text[:500],
        }
    except Exception as exc:
        return {
            "target": {"method": target["method"], "url": target["url"]},
            "ok": False,
            "duration_ms": int((time.time() - started) * 1000),
            "error": {
                "type": exc.__class__.__name__,
                "message": str(exc),
            },
        }


def main():
    targets = DEFAULT_TARGETS + extra_targets()
    hostnames = sorted({urlparse(target["url"]).hostname for target in targets if urlparse(target["url"]).hostname})

    print(json.dumps({
        "diagnostic": "famybot_ia_connectivity_python",
        "timeout_seconds": TIMEOUT_SECONDS,
        "env": {
            "PORT": redact(os.getenv("PORT")),
            "PASSENGER_BASE_URI": redact(os.getenv("PASSENGER_BASE_URI")),
            "PASSENGER_APP_ENV": redact(os.getenv("PASSENGER_APP_ENV")),
            "FAMYBOT_IA_API_URL": redact(os.getenv("FAMYBOT_IA_API_URL")),
            "DIAG_EXTRA_URLS": redact(os.getenv("DIAG_EXTRA_URLS")),
            "DIAG_HOST_HEADER": redact(HOST_HEADER),
        },
    }, indent=2, ensure_ascii=False))

    for hostname in hostnames:
        print(json.dumps({
            "type": "dns",
            "hostname": hostname,
            "result": resolve_host(hostname),
        }, indent=2, ensure_ascii=False))

    for target in targets:
        print(json.dumps(request_target(target), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
