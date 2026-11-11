#!/usr/bin/env python3
"""
Servidor local del UPR Research Capacity Map.

Úsalo solo si el navegador bloquea las APIs de NIH RePORTER o NSF Awards (CORS).
  1. Abre una terminal en esta carpeta.
  2. Ejecuta:  python3 servidor.py        (en Windows: py servidor.py)
  3. Se abre http://localhost:8000 automáticamente.

- Sirve los archivos de la aplicación.
- Reenvía SOLO a estos dos servicios (no es un proxy abierto):
    /proxy/nih/...  -> https://api.reporter.nih.gov/...
    /proxy/nsf/...  -> https://api.nsf.gov/...
    /proxy/grants/... -> https://api.grants.gov/...
- Escucha solo en 127.0.0.1 (no es accesible desde otras computadoras).
Requiere solo Python 3.8+ (biblioteca estándar).
"""
import http.server, socketserver, urllib.request, urllib.error, os, sys, webbrowser, threading

PORT = int(os.environ.get("PORT", "8000"))
ROOT = os.path.dirname(os.path.abspath(__file__))
UPSTREAM = {"nih": "https://api.reporter.nih.gov", "nsf": "https://api.nsf.gov", "grants": "https://api.grants.gov", "usa": "https://api.usaspending.gov"}
MAX_BODY = 1_000_000


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept, X-Session")

    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    def _proxy(self, method):
        parts = self.path.split("/", 3)  # ['', 'proxy', 'nih', 'v2/...']
        if len(parts) < 3 or parts[2] not in UPSTREAM:
            self.send_error(404, "Servicio no permitido"); return
        url = UPSTREAM[parts[2]] + "/" + (parts[3] if len(parts) > 3 else "")
        body = None
        if method == "POST":
            n = int(self.headers.get("Content-Length") or 0)
            if n > MAX_BODY:
                self.send_error(413); return
            body = self.rfile.read(n)
        req = urllib.request.Request(url, data=body, method=method, headers={
            "Accept": "application/json", "Content-Type": "application/json",
            "User-Agent": "UPR-Research-Capacity-Map/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                status, data, ctype = r.status, r.read(), r.headers.get("Content-Type", "application/json")
        except urllib.error.HTTPError as e:
            status, data, ctype = e.code, e.read(), e.headers.get("Content-Type", "application/json")
        except Exception as e:  # red caída, DNS, etc.
            status, data, ctype = 502, ('{"error": "%s"}' % str(e).replace('"', "'")).encode(), "application/json"
        self.send_response(status); self._cors()
        self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(data)))
        self.end_headers(); self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith("/proxy/"): return self._proxy("GET")
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/proxy/"): return self._proxy("POST")
        self.send_error(405)

    def log_message(self, fmt, *args):
        if args and "/proxy/" in str(args[0]): sys.stderr.write("  " + (fmt % args) + "\n")


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    with Server(("127.0.0.1", PORT), Handler) as srv:
        url = f"http://localhost:{PORT}/index.html"
        print(f"UPR Research Capacity Map en {url}  (Ctrl+C para salir)")
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            print("\nServidor detenido.")
