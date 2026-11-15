import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path

from library import LibrarySystem
from web import LibraryServer


class WebTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.lib = LibrarySystem(Path(self.temp.name) / "data.json")
        self.server = LibraryServer(("127.0.0.1", 0), self.lib, demo=True)
        self.origin = f"http://127.0.0.1:{self.server.server_port}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.cleanup)

    def cleanup(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, path, data=None, cookie=None, origin=True, host=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        headers = {"Content-Type": "application/json"}
        if origin:
            headers['Origin'] = self.origin
        if cookie:
            headers['Cookie'] = cookie
        if host:
            headers['Host'] = host
        connection.request("POST" if data is not None else "GET", path,
                           json.dumps(data) if data is not None else None, headers)
        response = connection.getresponse()
        body = response.read().decode()
        result = response.status, dict(response.getheaders()), json.loads(body) if 'application/json' in response.getheader('Content-Type') else body
        connection.close()
        return result

    def test_static_page_and_assets(self):
        for path, text in [("/", "Your next chapter"), ("/app.js", "/api/state"), ("/style.css", "prefers-reduced-motion")]:
            status, headers, body = self.request(path)
            self.assertEqual(status, 200)
            self.assertIn(text, body)
            self.assertIn("frame-ancestors 'none'", headers['Content-Security-Policy'])
        self.assertEqual(self.request("/../library.py")[0], 404)

    def test_registration_login_logout_and_session(self):
        status, headers, _ = self.request('/api/register', {"username": "ama", "password": "test-password", "role": "Admin"})
        self.assertEqual(status, 200)
        cookie = headers['Set-Cookie'].split(';')[0]
        self.assertIn("HttpOnly", headers['Set-Cookie'])
        state = self.request('/api/state', cookie=cookie)[2]
        self.assertEqual(state['user']['role'], 'Student')
        self.assertNotIn('users', state)
        self.assertEqual(self.request('/api/login', {"username": "ama", "password": "wrong"})[0], 401)
        status, headers, _ = self.request('/api/login', {"username": "ama", "password": "test-password"})
        self.assertEqual(status, 200)
        cookie = headers['Set-Cookie'].split(';')[0]
        self.request('/api/logout', {}, cookie=cookie)
        self.assertIsNone(self.request('/api/state', cookie=cookie)[2]['user'])

    def test_demo_borrow_return_and_authorization(self):
        self.assertEqual(self.request('/api/borrow', {"title": "Changes"})[0], 401)
        _, headers, _ = self.request('/api/demo', {})
        cookie = headers['Set-Cookie'].split(';')[0]
        self.assertEqual(self.request('/api/borrow', {"title": "Changes"}, cookie)[0], 200)
        self.assertEqual(len(self.request('/api/state', cookie=cookie)[2]['loans']), 1)
        self.assertEqual(self.request('/api/add-book', {"title": "Book", "author": "Author"}, cookie)[0], 400)
        self.assertEqual(self.request('/api/report', cookie=cookie)[0], 403)
        self.assertEqual(self.request('/api/admin/state', cookie=cookie)[0], 403)
        self.assertEqual(self.request('/api/admin/return', {"reader": "anyone", "title": "Changes"}, cookie)[0], 403)
        self.assertEqual(self.request('/api/return', {"title": "Changes"}, cookie)[0], 200)
        self.assertEqual(len(self.request('/api/state', cookie=cookie)[2]['history']), 1)

    def test_origin_host_and_invalid_payload_rejected(self):
        self.assertEqual(self.request('/api/demo', {}, origin=False)[0], 403)
        self.assertEqual(self.request('/api/state', host="untrusted.example")[0], 403)
        self.assertEqual(self.request('/api/register', {"username": []})[0], 400)
        self.server.demo = False
        self.assertEqual(self.request('/api/demo', {"role": "librarian"})[0], 400)

    def test_admin_add_book_and_report(self):
        self.lib.create_admin("librarian", "test-password")
        _, headers, _ = self.request('/api/login', {"username": "librarian", "password": "test-password"})
        cookie = headers['Set-Cookie'].split(';')[0]
        self.assertEqual(self.request('/api/add-book', {"title": "Test Book", "author": "Author"}, cookie)[0], 200)
        self.assertIn("Total books: 3", self.request('/api/report', cookie=cookie)[2])

    def test_demo_role_switch_preserves_reader_and_librarian_can_process_return(self):
        _, headers, _ = self.request('/api/demo', {"role": "reader"})
        reader_cookie = headers['Set-Cookie'].split(';')[0]
        reader_name = self.request('/api/state', cookie=reader_cookie)[2]['user']['username']
        self.request('/api/borrow', {"title": "Changes"}, reader_cookie)
        _, headers, _ = self.request('/api/demo', {"role": "librarian"}, reader_cookie)
        librarian_cookie = headers['Set-Cookie'].split(';')[0]
        self.assertEqual(self.request('/api/state', cookie=librarian_cookie)[2]['user']['role'], 'Admin')
        status, _, overview = self.request('/api/admin/state', cookie=librarian_cookie)
        self.assertEqual(status, 200)
        self.assertEqual(overview['loans'][0]['reader'], reader_name)
        self.assertEqual(self.request('/api/add-book', {"title": "New Story", "author": "Test Author"}, librarian_cookie)[0], 200)
        self.assertEqual(self.request('/api/admin/return', {"reader": reader_name, "title": "Changes"}, librarian_cookie)[0], 200)
        _, headers, _ = self.request('/api/demo', {"role": "reader"}, librarian_cookie)
        restored_cookie = headers['Set-Cookie'].split(';')[0]
        restored = self.request('/api/state', cookie=restored_cookie)[2]
        self.assertEqual(restored['user']['username'], reader_name)
        self.assertEqual(len(restored['loans']), 0)
        self.assertEqual(restored['history'][0]['title'], 'Changes')
        self.assertEqual(len(restored['books']), 3)

    def test_invalid_demo_role_and_expired_session_are_rejected(self):
        self.assertEqual(self.request('/api/demo', {"role": "superadmin"})[0], 400)
        _, headers, _ = self.request('/api/demo', {})
        cookie = headers['Set-Cookie'].split(';')[0]
        self.server.sessions.clear()
        self.assertEqual(self.request('/api/borrow', {"title": "Changes"}, cookie)[0], 401)
        self.assertEqual(self.request('/api/admin/state')[0], 403)


if __name__ == "__main__":
    unittest.main()
