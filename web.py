"""Local-only web interface. Run: python web.py --demo"""
import argparse
import json
import secrets
import tempfile
import time
import threading
from datetime import datetime, timedelta
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from library import LibrarySystem

STATIC = Path(__file__).with_name("static")
DEMO_BOOKS = [
    ("The Beautyful Ones Are Not Yet Born", "Ayi Kwei Armah"),
    ("Changes", "Ama Ata Aidoo"),
    ("The Housemaid", "Amma Darko"),
    ("The Dilemma of a Ghost", "Ama Ata Aidoo"),
    ("Faceless", "Amma Darko"),
    ("This Earth, My Brother…", "Kofi Awoonor"),
]
DEMO_ACCOUNTS = {
    "reader": {"username": "reader.demo", "password": "ReadWithUs26!"},
    "librarian": {"username": "librarian.demo", "password": "Shelves26!"},
}


def prepare_demo(library):
    """Seed credentials only in the temporary --demo store, never normal data."""
    library.books = [{"title": title, "author": author, "status": "Available"} for title, author in DEMO_BOOKS]
    library.register_user(**DEMO_ACCOUNTS['reader'])
    library.create_admin(**DEMO_ACCOUNTS['librarian'])
    library.save_data()


class LibraryServer(ThreadingHTTPServer):
    def __init__(self, address, library, demo=False):
        super().__init__(address, Handler)
        self.library = library
        self.demo = demo
        self.sessions = {}
        self.auth_attempts = []
        self.data_lock = threading.RLock()
        self.demo_librarian = None
        self.demo_accounts = {}


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def reply(self, status, body, content_type="application/json; charset=utf-8", cookie=None):
        if isinstance(body, dict):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def valid_host(self):
        return self.headers.get("Host") in {
            f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"
        }

    def session(self):
        now = time.time()
        self.server.sessions = {k: v for k, v in self.server.sessions.items() if v[1] > now}
        cookies = SimpleCookie()
        try:
            cookies.load(self.headers.get("Cookie", ""))
        except Exception:
            return None, None
        token = cookies.get("library_session")
        token = token.value if token else None
        session = self.server.sessions.get(token)
        return (session[0] if session else None), token

    def new_session(self, username, demo_roles=None):
        _, old_token = self.session()
        self.server.sessions.pop(old_token, None)
        token = secrets.token_urlsafe(32)
        self.server.sessions[token] = (username, time.time() + 8 * 60 * 60, demo_roles or {})
        return f"library_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800"

    def state(self):
        lib = self.server.library
        username, _ = self.session()
        books = []
        for book in lib.books:
            queue = lib.reservations.get(book['title'], [])
            books.append({"title": book['title'], "author": book['author'],
                          "available": book['status'] == "Available",
                          "waiting": len(queue), "reserved_for_me": bool(queue and queue[0] == username),
                          "reserved_for_other": bool(queue and queue[0] != username)})
        loans = []
        for record in lib.borrowed_records.get(username, []):
            borrowed = datetime.strptime(record['date'], "%Y-%m-%d")
            loans.append({**record, "due": (borrowed + timedelta(days=7)).strftime("%Y-%m-%d"),
                          "fine": max(0, (datetime.now() - borrowed).days - 7) * 2})
        return {"demo": self.server.demo, "demo_accounts": self.server.demo_accounts if self.server.demo else {},
                "user": {"username": username, "role": lib.users[username]['role']} if username else None,
                "books": books if username else [], "loans": loans, "history": lib.history.get(username, []),
                "reservations": [{"title": title, "position": names.index(username) + 1}
                                 for title, names in lib.reservations.items() if username in names]}

    def admin_state(self, username):
        lib = self.server.library
        if lib.users.get(username, {}).get("role") != "Admin":
            raise ValueError("Sign in as a librarian to open the management desk.")
        loans = []
        for reader, records in lib.borrowed_records.items():
            for record in records:
                borrowed = datetime.strptime(record['date'], "%Y-%m-%d")
                due = borrowed + timedelta(days=7)
                loans.append({**record, "reader": reader, "due": due.strftime("%Y-%m-%d"),
                              "overdue": (datetime.now() - borrowed).days > 7,
                              "fine": max(0, (datetime.now() - borrowed).days - 7) * 2})
        return {"loans": loans, "readers": sum(u.get('role') == 'Student' for u in lib.users.values()),
                "reservations": [{"title": title, "readers": readers}
                                 for title, readers in lib.reservations.items() if readers],
                "returns": [{**record, "reader": reader} for reader, records in lib.history.items() for record in records],
                "report": lib.report_text(username)}

    def do_GET(self):
        with self.server.data_lock:
            self.get_request()

    def get_request(self):
        if not self.valid_host():
            self.reply(403, {"error": "Use the local preview address."})
            return
        path = urlsplit(self.path).path
        if path == "/api/state":
            self.reply(200, self.state())
        elif path == "/api/admin/state":
            username, _ = self.session()
            try:
                self.reply(200, self.admin_state(username))
            except ValueError as error:
                self.reply(403, {"error": str(error)})
        elif path == "/api/report":
            username, _ = self.session()
            try:
                report = self.server.library.report_text(username)
                self.reply(200, report, "text/plain; charset=utf-8")
            except ValueError as error:
                self.reply(403, {"error": str(error)})
        elif path in {"/", "/app.js", "/style.css"}:
            filename, mime = {"/": ("index.html", "text/html"), "/app.js": ("app.js", "text/javascript"),
                              "/style.css": ("style.css", "text/css")}[path]
            self.reply(200, (STATIC / filename).read_bytes(), mime + "; charset=utf-8")
        else:
            self.reply(404, {"error": "Page not found."})

    def do_POST(self):
        with self.server.data_lock:
            self.post_request()

    def post_request(self):
        if not self.valid_host() or self.headers.get("Origin") not in {
            f"http://127.0.0.1:{self.server.server_port}", f"http://localhost:{self.server.server_port}"
        }:
            self.reply(403, {"error": "Request origin rejected."})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 16384 or self.headers.get_content_type() != "application/json":
                raise ValueError("Send a JSON request under 16 KB.")
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict) or any(not isinstance(v, str) for v in data.values()):
                raise ValueError("Form values must be text.")
            lib = self.server.library
            username, token = self.session()
            path = urlsplit(self.path).path
            cookie = None
            message = "Done."
            if path in {"/api/login", "/api/register", "/api/demo"}:
                now = time.time()
                self.server.auth_attempts = [t for t in self.server.auth_attempts if now - t < 60]
                if len(self.server.auth_attempts) >= 20:
                    self.reply(429, {"error": "Please wait a minute before trying again."})
                    return
                self.server.auth_attempts.append(now)
                demo_roles = {}
                if path == "/api/demo":
                    if not self.server.demo:
                        raise ValueError("Demo access is disabled for this catalog.")
                    role = data.get("role", "reader")
                    if role not in {"reader", "librarian"}:
                        raise ValueError("Choose the reader or librarian demo.")
                    old_session = self.server.sessions.get(token)
                    demo_roles = dict(old_session[2]) if old_session else {}
                    username = demo_roles.get(role)
                    if not username:
                        if role == "librarian":
                            if not self.server.demo_librarian:
                                self.server.demo_librarian = "librarian-" + secrets.token_hex(3)
                                lib.create_admin(self.server.demo_librarian, secrets.token_urlsafe(24))
                            username = self.server.demo_librarian
                        elif role in self.server.demo_accounts:
                            username = self.server.demo_accounts[role]['username']
                        else:
                            username = lib.register_user("reader-" + secrets.token_hex(3), secrets.token_urlsafe(24))
                        demo_roles[role] = username
                else:
                    username = data.get("username", "").strip()
                    password = data.get("password", "")
                    if len(password) > 128:
                        raise ValueError("Password is too long.")
                    if path == "/api/register":
                        lib.register_user(username, password)
                    elif not lib.authenticate(username, password):
                        self.reply(401, {"error": "Username or password is incorrect."})
                        return
                    if self.server.demo:
                        demo_roles = {role: username for role, account in self.server.demo_accounts.items()
                                      if account['username'] == username}
                cookie = self.new_session(username, demo_roles)
                message = "Librarian desk opened." if lib.users[username]['role'] == 'Admin' else "Reader session opened. Your next chapter is waiting."
            elif path == "/api/logout":
                self.server.sessions.pop(token, None)
                cookie = "library_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
                message = "You have signed out."
            elif not username:
                self.reply(401, {"error": "Please sign in to continue."})
                return
            elif path.startswith("/api/admin/"):
                if lib.users[username].get('role') != 'Admin':
                    self.reply(403, {"error": "Only a librarian can manage circulation."})
                    return
                if path == "/api/admin/return":
                    message = lib.return_title(data.get('reader', ''), data.get('title', ''))
                else:
                    self.reply(404, {"error": "Action not found."})
                    return
            elif path == "/api/borrow":
                message = lib.borrow_title(username, data.get("title", ""))
            elif path == "/api/return":
                message = lib.return_title(username, data.get("title", ""))
            elif path == "/api/add-book":
                lib.add_book(username, data.get("title", ""), data.get("author", ""))
                message = "A new story has joined the shelves."
            else:
                self.reply(404, {"error": "Action not found."})
                return
            self.reply(200, {"message": message}, cookie=cookie)
        except (ValueError, UnicodeError) as error:
            self.reply(400, {"error": str(error)})
        except OSError:
            self.reply(500, {"error": "Unable to save library data. Check the local data file."})


def main():
    parser = argparse.ArgumentParser(description="Ghana Community Library local web interface")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--demo", action="store_true", help="Use an isolated temporary demo catalog")
    parser.add_argument("--data-file", type=Path, help="Local JSON store (shared with terminal app)")
    args = parser.parse_args()
    if args.demo and args.data_file:
        parser.error("Choose --demo or --data-file, not both.")
    with tempfile.TemporaryDirectory(prefix="library-demo-") as temp:
        lib = LibrarySystem(Path(temp) / "demo.json" if args.demo else args.data_file)
        if args.demo:
            prepare_demo(lib)
        with LibraryServer(("127.0.0.1", args.port), lib, args.demo) as server:
            if args.demo:
                server.demo_accounts = DEMO_ACCOUNTS
                server.demo_librarian = DEMO_ACCOUNTS['librarian']['username']
            print(f"Library preview: http://127.0.0.1:{server.server_port}", flush=True)
            print("Demo data resets on restart." if args.demo else f"Data: {lib.data_file}", flush=True)
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                print("\nLibrary closed.")


if __name__ == "__main__":
    main()
