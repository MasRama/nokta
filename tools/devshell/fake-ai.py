#!/usr/bin/env python3
"""A stand-in for Anthropic's Messages API, for Creator Mode in the smoke
test: every request is answered with the plugin in FOLDER, as the model
would write it (plugin.toml, and each file's text and executable bit).

    tools/devshell/fake-ai.py PORT FOLDER
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT, FOLDER = int(sys.argv[1]), sys.argv[2]


def draft():
    files = []
    for name in sorted(os.listdir(FOLDER)):
        path = os.path.join(FOLDER, name)
        with open(path, encoding="utf-8") as f:
            files.append({"path": name, "content": f.read(), "executable": os.access(path, os.X_OK)})
    return {"id": os.path.basename(FOLDER.rstrip("/")), "files": files}


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers.get("content-length", 0)))
        ok = self.path == "/v1/messages" and self.headers.get("x-api-key") == "smoke-key"
        body = json.dumps(
            {"type": "message", "role": "assistant", "stop_reason": "end_turn",
             "content": [{"type": "text", "text": json.dumps(draft())}]}
            if ok else {"type": "error", "error": {"type": "authentication_error", "message": "bad key"}}
        ).encode()
        self.send_response(200 if ok else 401)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
