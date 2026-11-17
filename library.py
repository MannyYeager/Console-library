import json
import os
import getpass
import argparse
import hashlib
import hmac
import secrets
import tempfile
from pathlib import Path
from datetime import datetime

PASSWORD_ITERATIONS = 600_000


def hash_password(password):
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), PASSWORD_ITERATIONS
    ).hex()
    return f"pbkdf2_sha256${PASSWORD_ITERATIONS}${salt}${digest}"


def verify_password(password, encoded):
    try:
        algorithm, iterations, salt, expected = encoded.split("$")
        if algorithm != "pbkdf2_sha256" or int(iterations) != PASSWORD_ITERATIONS:
            return False
        actual = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt), int(iterations)
        ).hex()
        return hmac.compare_digest(actual, expected)
    except (ValueError, AttributeError, TypeError):
        return False


class LibrarySystem:
    def __init__(self, data_file=None):
        self.data_file = Path(data_file) if data_file else Path(__file__).with_name("ghana_library_data.json")
        self.books = []            
        self.users = {}            
        self.borrowed_records = {} 
        self.history = {} 
        self.reservations = {} # {book_title: [list_of_usernames]}
        self.current_user = None
        self.user_role = None
        
        self.load_data()

    def clear_screen(self):
        if os.isatty(1):
            os.system('cls' if os.name == 'nt' else 'clear')

    def save_data(self):
        all_data = {
            "books": self.books,
            "users": self.users,
            "borrowed_records": self.borrowed_records,
            "history": self.history,
            "reservations": self.reservations,
            "favorites": getattr(self, 'favorites', {})
        }
        # Replace the complete file only after writing it successfully.
        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.data_file.parent,
                                             delete=False) as f:
                temp_path = f.name
                json.dump(all_data, f, indent=4)
            os.replace(temp_path, self.data_file)
        finally:
            if temp_path and os.path.exists(temp_path):
                os.unlink(temp_path)

    def load_data(self):
        if os.path.exists(self.data_file):
            with open(self.data_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                self.books = data.get("books", [])
                self.users = data.get("users", {})
                self.borrowed_records = data.get("borrowed_records", {})
                self.history = data.get("history", {})
                self.reservations = data.get("reservations", {})
                self.favorites = data.get('favorites', {})
            # Older versions allowed anyone to select Admin. Those roles cannot
            # be trusted; a local operator must explicitly bootstrap an admin.
            migrated = False
            for user in self.users.values():
                if "password" in user:
                    user["password_hash"] = hash_password(user.pop("password"))
                    user["role"] = "Student"
                    migrated = True
            if migrated:
                self.save_data()
                print("Legacy accounts migrated to hashed passwords and Student roles.")
        else:
            # No default credentials. Admin setup is an explicit local command.
            self.books.append({"title": "The Beautyful Ones Are Not Yet Born", "author": "Ayi Kwei Armah", "status": "Available"})
            self.books.append({"title": "Changes", "author": "Ama Ata Aidoo", "status": "Available"})
            self.save_data()

    def create_admin(self, username, password):
        """Bootstrap one admin from the local command line, never registration."""
        if any(user.get("role") == "Admin" for user in self.users.values()):
            raise ValueError("An admin already exists; bootstrap is disabled.")
        username = username.strip()
        if not username or len(username) > 40 or not 8 <= len(password) <= 128:
            raise ValueError("Use a username of 1 to 40 characters and a password of 8 to 128 characters.")
        self.users[username] = {"password_hash": hash_password(password), "role": "Admin"}
        self.save_data()

    # --- Authentication Logic ---
    def register_user(self, username, password):
        username = username.strip()
        if not username or len(username) > 40 or username in self.users:
            raise ValueError("Choose an unused username of 1 to 40 characters.")
        if not 8 <= len(password) <= 128:
            raise ValueError("Password must contain 8 to 128 characters.")
        self.users[username] = {"password_hash": hash_password(password), "role": "Student"}
        self.save_data()
        return username

    def authenticate(self, username, password):
        user = self.users.get(username.strip())
        return bool(user and verify_password(password, user.get("password_hash")))

    def borrow_title(self, username, title, loan_days=7):
        if isinstance(loan_days, bool) or not isinstance(loan_days, int) or loan_days not in {7, 14, 21, 28}:
            raise ValueError('Choose a loan duration of 7, 14, 21 or 28 days.')
        if username not in self.users:
            raise ValueError("Please log in first.")
        book = next((b for b in self.books if b['title'].casefold() == title.strip().casefold()), None)
        if not book:
            raise ValueError("Book not found.")
        records = self.borrowed_records.setdefault(username, [])
        if any(r['title'] == book['title'] for r in records):
            raise ValueError("You already have this book on loan.")
        queue = self.reservations.setdefault(book['title'], [])
        if book['status'] != "Available":
            if username in queue:
                raise ValueError("You are already in the reservation queue.")
            queue.append(username)
            self.save_data()
            return "Added to the reservation queue."
        if queue and queue[0] != username:
            raise ValueError("This book is reserved for the next reader in the queue.")
        if len(records) >= 5:
            raise ValueError('You can borrow up to five books at a time. Return one before borrowing another.')
        if queue:
            queue.pop(0)
        book['status'] = f"Out ({username})"
        records.append({"title": book['title'], "date": datetime.now().strftime("%Y-%m-%d"), 'loan_days': loan_days, 'renewals': 0})
        self.save_data()
        return "Book borrowed. Enjoy your next chapter!"

    def return_title(self, username, title):
        records = self.borrowed_records.get(username, [])
        record = next((r for r in records if r['title'].casefold() == title.strip().casefold()), None)
        if not record:
            raise ValueError("No matching borrowing record.")
        days = (datetime.now() - datetime.strptime(record['date'], "%Y-%m-%d")).days
        fine = max(0, days - record.get('loan_days', 7)) * 2
        for book in self.books:
            if book['title'] == record['title']:
                book['status'] = "Available"
        self.history.setdefault(username, []).append({
            "title": record['title'], "returned": datetime.now().strftime("%Y-%m-%d"), "fine_paid": fine
        })
        records.remove(record)
        self.save_data()
        return f"Book returned. Recorded fine: GHS {fine}.00 (simulation)."

    def renew_title(self, username, title):
        record = next((r for r in self.borrowed_records.get(username, []) if r['title'] == title), None)
        if not record:
            raise ValueError('This book is not on your bookshelf.')
        days = (datetime.now() - datetime.strptime(record['date'], '%Y-%m-%d')).days
        if record.get('renewals', 0) or days > record.get('loan_days', 7):
            raise ValueError('Only an on-time loan that has not been renewed can be extended.')
        if self.reservations.get(title):
            raise ValueError('Another reader is waiting. Return this book by its current due date.')
        record['loan_days'] = record.get('loan_days', 7) + 7
        record['renewals'] = 1
        self.save_data()
        return 'Your loan has been extended by seven days.'

    def cancel_reservation(self, username, title):
        queue = self.reservations.get(title, [])
        if username not in queue:
            raise ValueError('You do not have a reservation for this book.')
        queue.remove(username)
        self.save_data()
        return 'Reservation cancelled. The queue has been updated.'

    def save_title(self, username, title, saved=True):
        if username not in self.users or not any(b['title'] == title for b in self.books):
            raise ValueError('Choose a book from the catalog.')
        if not hasattr(self, 'favorites'):
            self.favorites = {}
        titles = self.favorites.setdefault(username, [])
        if saved and title not in titles:
            titles.append(title)
        elif not saved and title in titles:
            titles.remove(title)
        self.save_data()
        return 'Reading list updated.'

    def add_book(self, username, title, author, genre='Literature', pages='', description=''):
        if self.users.get(username, {}).get("role") != "Admin":
            raise ValueError("Only an admin can add books.")
        title, author = title.strip(), author.strip()
        if not title or not author or len(title) > 160 or len(author) > 100:
            raise ValueError("Enter a title (up to 160 characters) and author (up to 100).")
        if any(b['title'].casefold() == title.casefold() for b in self.books):
            raise ValueError("This title is already in the catalog.")
        if not isinstance(genre, str) or not genre.strip() or len(genre.strip()) > 40 or not isinstance(description, str) or len(description) > 1200:
            raise ValueError('Use a category up to 40 characters and a description up to 1200.')
        if pages and (not str(pages).isascii() or not str(pages).isdigit() or not 1 <= int(pages) <= 20000):
            raise ValueError('Page count must be a whole number from 1 to 20000.')
        self.books.append({"title": title, "author": author, "status": "Available", 'genre': genre.strip(),
                           'pages': int(pages) if pages else None, 'description': description.strip()})
        self.save_data()

    def report_text(self, username):
        if self.users.get(username, {}).get("role") != "Admin":
            raise ValueError("Only an admin can export reports.")
        fines = sum(h['fine_paid'] for records in self.history.values() for h in records)
        lines = ["GHANA COMMUNITY LIBRARY - STATUS REPORT", "=" * 45,
                 f"Users: {len(self.users)} | Total books: {len(self.books)}",
                 f"Recorded fines: GHS {fines}.00 (simulation)", "Active reservations:"]
        lines.extend(f"- {title}: {', '.join(names)}" for title, names in self.reservations.items() if names)
        return "\n".join(lines) + "\n"

    def register(self):
        self.clear_screen()
        print("--- Register New Account ---")
        username = input("Username: ").strip()
        password = getpass.getpass("Password (8 to 128 characters): ")
        try:
            self.register_user(username, password)
            print(f"Account for {username} created as Student.")
        except ValueError as error:
            print(error)
        input("Press Enter to continue...")

    def login(self):
        self.clear_screen()
        print("--- System Login ---")
        username = input("Username: ").strip()
        password = getpass.getpass("Password: ")
        
        if self.authenticate(username, password):
            self.current_user = username
            self.user_role = self.users[username]["role"]
            return True
        print("Invalid credentials.")
        input("Press Enter...")
        return False

    # --- Core Library Functions ---
    def view_catalog(self):
        self.clear_screen()
        print(f"--- Library Catalog ({len(self.books)} books) ---")
        print(f"{'No.':<4} {'Title':<35} {'Author':<20} {'Status'}")
        print("-" * 75)
        for i, b in enumerate(self.books, 1):
            res_count = len(self.reservations.get(b['title'], []))
            res_text = f" ({res_count} waiting)" if res_count > 0 else ""
            print(f"{i:<4} {b['title'][:33]:<35} {b['author'][:18]:<20} {b['status']}{res_text}")
        input("\nPress Enter to return...")

    def borrow_book(self):
        self.clear_screen()
        title = input("Enter title to borrow or reserve: ")
        try:
            print(self.borrow_title(self.current_user, title))
        except ValueError as error:
            print(error)
        input("Press Enter...")

    def return_book(self):
        self.clear_screen()
        title = input("Enter title to return: ")
        try:
            print(self.return_title(self.current_user, title))
        except ValueError as error:
            print(error)
        input("Press Enter...")

    def export_report(self):
        filename = self.data_file.with_name(f"Library_Report_{datetime.now():%Y_%m_%d}.txt")
        filename.write_text(self.report_text(self.current_user), encoding="utf-8")
        print(f"Report saved to {filename}")
        input("Press Enter...")

# --- Application Loop ---
def main():
    parser = argparse.ArgumentParser(description="Ghana Community Library terminal manager")
    parser.add_argument("--data-file", type=Path, help="Path to the local JSON store")
    parser.add_argument("--create-admin", metavar="USERNAME", help="Bootstrap the first admin locally")
    args = parser.parse_args()
    lib = LibrarySystem(args.data_file)
    if args.create_admin:
        password = getpass.getpass("New admin password (at least 8 characters): ")
        if password != getpass.getpass("Confirm password: "):
            raise ValueError("Passwords do not match.")
        lib.create_admin(args.create_admin, password)
        print(f"Admin {args.create_admin} is ready. Run library.py to log in.")
        return
    while True:
        if not lib.current_user:
            lib.clear_screen()
            print("--- GHANA COMMUNITY LIBRARY ---")
            print("1. Login\n2. Register\n3. Exit")
            cmd = input("Choice: ")
            if cmd == '1': lib.login()
            elif cmd == '2': lib.register()
            elif cmd == '3': break
            else:
                print("Choose 1, 2, or 3.")
                input("Press Enter...")
        else:
            lib.clear_screen()
            print(f"USER: {lib.current_user} | ROLE: {lib.user_role}")
            print("1. View Catalog\n2. Borrow / Reserve\n3. Return\n4. My History")
            if lib.user_role == "Admin": print("5. Export Report\n6. Add Book")
            print("0. Logout")
            
            cmd = input("Select: ")
            if cmd == '1': lib.view_catalog()
            elif cmd == '2': lib.borrow_book()
            elif cmd == '3': lib.return_book()
            elif cmd == '4':
                lib.clear_screen()
                if not lib.history.get(lib.current_user):
                    print("No returned books yet.")
                for h in lib.history.get(lib.current_user, []):
                    print(f"{h['title']} | Returned: {h['returned']} | Fine: GHS {h['fine_paid']}")
                input("\nPress Enter...")
            elif cmd == '5' and lib.user_role == "Admin": lib.export_report()
            elif cmd == '6' and lib.user_role == "Admin":
                t = input("Title: "); a = input("Author: ")
                try:
                    lib.add_book(lib.current_user, t, a)
                    print("Book added.")
                except ValueError as error:
                    print(error)
                input("Press Enter...")
            elif cmd == '0':
                lib.current_user = None
                lib.user_role = None
            else:
                print("Choose one of the listed options.")
                input("Press Enter...")

if __name__ == "__main__":
    try:
        main()
    except (EOFError, KeyboardInterrupt):
        print("\nGoodbye.")
    except (ValueError, OSError) as error:
        print(f"Unable to continue: {error}")
        raise SystemExit(1)
