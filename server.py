import http.server
import socketserver
import webbrowser

PORT = 8000

Handler = http.server.SimpleHTTPRequestHandler
with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Servidor rodando em http://localhost:{PORT}")
    webbrowser.open(f"http://localhost:{PORT}")
=======
import http.server
import socketserver
import webbrowser

PORT = 8000

Handler = http.server.SimpleHTTPRequestHandler
with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Servidor rodando em http://localhost:{PORT}")
    webbrowser.open(f"http://localhost:{PORT}")
>>>>>>> d2ba42b (Primeiro commit do projeto ViewPro 3D)
    httpd.serve_forever()