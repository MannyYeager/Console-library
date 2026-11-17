import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from library import LibrarySystem, hash_password, verify_password


class LibraryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "library.json"
        self.lib = LibrarySystem(self.path)

    def readers(self):
        for username in ("ama", "kojo", "esi"):
            self.lib.register_user(username, "test-password")

    def test_hashes_are_salted_and_verified(self):
        first = hash_password("test-password")
        self.assertNotEqual(first, hash_password("test-password"))
        self.assertTrue(verify_password("test-password", first))
        self.assertFalse(verify_password("wrong", first))
        self.assertFalse(verify_password("test-password", "broken"))

    def test_no_default_admin_and_registration_is_student_only(self):
        self.assertEqual(self.lib.users, {})
        with patch("builtins.input", side_effect=["ama", ""]), patch("getpass.getpass", return_value="test-password"), redirect_stdout(io.StringIO()):
            self.lib.register()
        self.assertEqual(self.lib.users['ama']['role'], "Student")
        self.assertNotIn('password', self.lib.users['ama'])
        self.assertTrue(self.lib.authenticate("ama", "test-password"))

    def test_bootstrap_and_admin_operations_are_guarded(self):
        self.lib.register_user("ama", "test-password")
        with self.assertRaises(ValueError):
            self.lib.add_book("ama", "New Book", "Author")
        with self.assertRaises(ValueError):
            self.lib.report_text("ama")
        self.lib.create_admin("librarian", "admin-test-password")
        with self.assertRaises(ValueError):
            self.lib.create_admin("second-admin", "test-password")
        self.lib.add_book("librarian", "New Book", "Author")
        self.assertIn("Total books: 3", self.lib.report_text("librarian"))

    def test_legacy_passwords_migrate_and_untrusted_admin_role_is_removed(self):
        legacy = json.loads(self.path.read_text())
        legacy['users'] = {"admin": {"password": "123", "role": "Admin"}}
        self.path.write_text(json.dumps(legacy))
        with redirect_stdout(io.StringIO()):
            migrated = LibrarySystem(self.path)
        self.assertTrue(migrated.authenticate("admin", "123"))
        self.assertEqual(migrated.users['admin']['role'], "Student")
        self.assertNotIn('"password"', self.path.read_text())
        migrated.create_admin("librarian", "test-password")

    def test_registration_rejects_blank_duplicate_and_short_password(self):
        for username, password in [(" ", "test-password"), ("ama", "short")]:
            with self.assertRaises(ValueError):
                self.lib.register_user(username, password)
        self.lib.register_user("ama", "test-password")
        with self.assertRaises(ValueError):
            self.lib.register_user("ama", "test-password")

    def test_borrow_return_history_and_fifo_reservations_persist(self):
        self.readers()
        self.lib.borrow_title("ama", " changes ")
        with self.assertRaises(ValueError):
            self.lib.borrow_title("ama", "Changes")
        self.lib.borrow_title("kojo", "Changes")
        self.lib.borrow_title("esi", "Changes")
        with self.assertRaises(ValueError):
            self.lib.borrow_title("kojo", "Changes")
        self.lib.return_title("ama", "Changes")
        with self.assertRaises(ValueError):
            self.lib.borrow_title("esi", "Changes")
        self.lib.borrow_title("kojo", "Changes")
        restored = LibrarySystem(self.path)
        self.assertEqual(restored.borrowed_records['kojo'][0]['title'], "Changes")
        self.assertEqual(restored.reservations['Changes'], ['esi'])
        self.assertEqual(restored.history['ama'][0]['fine_paid'], 0)

    def test_return_ownership_and_late_fine(self):
        self.readers()
        self.lib.borrow_title("ama", "Changes")
        with self.assertRaises(ValueError):
            self.lib.return_title("kojo", "Changes")
        self.lib.borrowed_records['ama'][0]['date'] = (datetime.now() - timedelta(days=10)).strftime("%Y-%m-%d")
        self.lib.return_title("ama", "Changes")
        self.assertEqual(self.lib.history['ama'][0]['fine_paid'], 6)

    def test_corrupt_json_is_not_overwritten(self):
        self.path.write_text("broken-json")
        with self.assertRaises(ValueError):
            LibrarySystem(self.path)
        self.assertEqual(self.path.read_text(), "broken-json")


if __name__ == "__main__":
    unittest.main()
