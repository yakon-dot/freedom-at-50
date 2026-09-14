#!/usr/bin/env python3
"""Local Freedom preview server with browser caching disabled."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import argparse


class NoCachePreviewHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        path = self.path.split("?", 1)[0].lower()
        if path.endswith(("/", ".html", ".htm", ".js")):
            self.send_header(
                "Cache-Control", "no-store, no-cache, must-revalidate, max-age=0"
            )
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Serve the Freedom local preview")
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--bind", default="0.0.0.0")
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.bind, args.port), NoCachePreviewHandler)
    print(f"Freedom preview listening on http://{args.bind}:{args.port}/", flush=True)
    server.serve_forever()
