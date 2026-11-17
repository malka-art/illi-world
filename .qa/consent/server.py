"""Local static server for the illi.world page test (2026-11-11). Serves a site folder, supports byte ranges (so the
film can play and seek), and stands in for the site-event Edge Function at POST /collect: it keeps every beacon body in
memory, applies nothing, and returns them at GET /__log (DELETE /__log clears). Bound to 127.0.0.1 only.

  python server.py <site folder> <port>
"""
import json, os, sys, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT, PORT = os.path.abspath(sys.argv[1]), int(sys.argv[2])
LOG, LOCK = [], threading.Lock()


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(b)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'content-type')
        self.end_headers()

    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(n).decode('utf-8', 'replace')
        if self.path.startswith('/collect'):
            with LOCK:
                try:
                    LOG.append(json.loads(body))
                except ValueError:
                    LOG.append({'bad': body[:200]})
            self.send_response(204)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            return
        self._json(404, {})

    def do_DELETE(self):
        with LOCK:
            LOG.clear()
        self._json(200, {'ok': True})

    def do_GET(self):
        if self.path.startswith('/__log'):
            with LOCK:
                return self._json(200, LOG)
        rng = self.headers.get('Range')
        path = self.translate_path(self.path.split('?')[0])
        if rng and os.path.isfile(path):
            size = os.path.getsize(path)
            start, _, end = rng.replace('bytes=', '').partition('-')
            start = int(start or 0)
            end = min(int(end) if end else size - 1, size - 1)
            self.send_response(206)
            self.send_header('Content-Type', self.guess_type(path))
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
            self.send_header('Content-Length', str(end - start + 1))
            self.end_headers()
            with open(path, 'rb') as f:
                f.seek(start)
                left = end - start + 1
                while left > 0:
                    chunk = f.read(min(65536, left))
                    if not chunk:
                        break
                    try:
                        self.wfile.write(chunk)
                    except (ConnectionError, OSError):
                        return
                    left -= len(chunk)
            return
        return super().do_GET()

    def end_headers(self):
        if not self.headers.get('Range'):
            self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
