import http.server, socketserver, sys, os
PORT = 8000

for a in sys.argv[1:]:
    try:
        PORT = int(a); break
    except ValueError:
        pass
os.chdir(os.path.dirname(os.path.abspath(__file__)) or '.')
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
with socketserver.TCPServer(('', PORT), H) as httpd:
    print(f'http://localhost:{PORT}')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nbye.')