"""Local preview server: static files with caching off, plus an endpoint the record page
posts frames to.

    python tools/serve.py [port]      then open http://localhost:8898/

POST /__frame?dir=NAME&i=N with a PNG data URL as the body saves frames/NAME/fNNNN.png.
"""
import base64, functools, http.server, os, sys, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "frames")


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        d = os.path.join(OUT, os.path.basename(q["dir"][0]))
        os.makedirs(d, exist_ok=True)
        body = self.rfile.read(int(self.headers["Content-Length"])).decode()
        with open(os.path.join(d, "f%04d.png" % int(q["i"][0])), "wb") as f:
            f.write(base64.b64decode(body.split(",", 1)[1]))
        self.send_response(204)
        self.end_headers()

    def log_message(self, *a):
        pass


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8898
http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Handler, directory=ROOT)).serve_forever()
