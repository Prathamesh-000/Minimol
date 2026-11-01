"""Exercise the actual HTTP handler without opening a listening socket."""
import importlib.util
import io
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("serve_demo", Path(__file__).resolve().parents[2] / "scripts/serve-demo.py")
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)

class Socket:
    def __init__(self, request):
        self.request = request
        self.output = bytearray()

    def makefile(self, *_):
        return io.BytesIO(self.request)

    def sendall(self, data):
        self.output.extend(data)

def test_ip_hint_uses_only_own_socket_address_not_forwarded_headers(tmp_path):
    sock = Socket(b"GET /network-info HTTP/1.0\r\nX-Forwarded-For: 10.0.0.99\r\n\r\n")
    server.Handler(sock, ("10.10.222.230", 1234), None, directory=str(tmp_path))
    headers, body = bytes(sock.output).split(b"\r\n\r\n", 1)
    assert b"200 OK" in headers
    assert b"Cache-Control: no-store" in headers
    assert json.loads(body) == {"clientIPv4": "10.10.222.230"}

def test_ip_hint_does_not_suggest_public_or_loopback_addresses():
    for value in ("127.0.0.1", "::1", "8.8.8.8", "169.254.1.1", "192.0.2.1", "invalid"):
        assert server.lan_ipv4(value) is None
    for value in ("10.0.0.1", "172.16.0.1", "172.31.255.254", "192.168.1.1"):
        assert server.lan_ipv4(value) == value

def test_static_assets_still_served_and_no_signaling_endpoint(tmp_path):
    (tmp_path / "index.html").write_text("miniMol test asset")
    sock = Socket(b"GET /index.html HTTP/1.0\r\n\r\n")
    server.Handler(sock, ("10.0.0.1", 1234), None, directory=str(tmp_path))
    assert bytes(sock.output).endswith(b"miniMol test asset")
    sock = Socket(b"POST /network-info HTTP/1.0\r\nContent-Length: 0\r\n\r\n")
    server.Handler(sock, ("10.0.0.1", 1234), None, directory=str(tmp_path))
    assert b"501 Unsupported method" in sock.output
