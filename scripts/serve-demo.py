"""Development HTTPS assets + own-client IP hint; no inference/signaling relay."""
import argparse
import functools
import http.server
import ipaddress
import json
from pathlib import Path
import ssl
from urllib.parse import urlsplit

LAN_NETWORKS = tuple(ipaddress.ip_network(cidr) for cidr in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"))

def lan_ipv4(address):
    try:
        ip = ipaddress.ip_address(address)
        return str(ip) if any(ip in network for network in LAN_NETWORKS) else None
    except ValueError:
        return None

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if urlsplit(self.path).path == "/network-info":
            # Return only the caller's socket address, never a peer list, SDP,
            # forwarded header or tensor. Optional: static hosts need no endpoint.
            body = json.dumps({"clientIPv4": lan_ipv4(self.client_address[0])}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def handle(self):
        try:
            super().handle()
        except (ssl.SSLEOFError, BrokenPipeError, ConnectionResetError):
            self.log_message("Client disconnected before transfer completed; check the phone's app status")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cert", required=True)
    parser.add_argument("--key", required=True)
    parser.add_argument("--port", type=int, default=8443)
    parser.add_argument("--directory", choices=("demo-dist", "release/demo"), default="demo-dist")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1] / args.directory
    if not (root / "index.html").is_file():
        parser.error("Run npm run build:demo first")
    server = http.server.ThreadingHTTPServer(("0.0.0.0", args.port), functools.partial(Handler, directory=str(root)))
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.load_cert_chain(args.cert, args.key)
    server.socket = tls.wrap_socket(server.socket, server_side=True)
    print(f"Serving {root} and /network-info (own IP only) over HTTPS on port {args.port}. Open your Mac's LAN IP on both phones.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == "__main__":
    main()
