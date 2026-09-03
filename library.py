import json
import os
import getpass
from datetime import datetime

class LibrarySystem:
    def __init__(self):
        self.data_file = "ghana_library_data.json"
        self.books = []            
        self.users = {}            
        self.borrowed_records = {} 
        self.history = {} 
        self.reservations = {} # {book_title: [list_of_usernames]}
        self.current_user = None
        self.user_role = None
        
        self.load_data()

    def clear_screen(self):
        os.system('cls' if os.name == 'nt' else 'clear')

    def save_data(self):
        all_data = {
            "books": self.books,
            "users": self.users,
            "borrowed_records": self.borrowed_records,
            "history": self.history,
            "reservations": self.reservations
        }
        with open(self.data_file, "w") as f:
            json.dump(all_data, f, indent=4)

    def load_data(self):
        if os.path.exists(self.data_file):
            with open(self.data_file, "r") as f:
                data = json.load(f)
                self.books = data.get("books", [])
                self.users = data.get("users", {})
                self.borrowed_records = data.get("borrowed_records", {})
                self.history = data.get("history", {})
                self.reservations = data.get("reservations", {})
        else:
            # Setup default admin and inventory
            self.users["admin"] = {"password": "123", "role": "Admin"}
            self.books.append({"title": "The Beautyful Ones Are Not Yet Born", "author": "Ayi Kwei Armah", "status": "Available"})
            self.books.append({"title": "Changes", "author": "Ama Ata Aidoo", "status": "Available"})
            self.save_data()

    # --- Authentication Logic ---
    def register(self):
        self.clear_screen()
        print("--- Register New Account ---")
        username = input("Username: ").strip()
        if username in self.users:
            print("Username already exists.")
            input("Press Enter...")
            return
        
        password = getpass.getpass("Password: ")
        role_choice = input("Register as (1) Student or (2) Admin: ")
        role = "Admin" if role_choice == '2' else "Student"
        
        self.users[username] = {"password": password, "role": role}
        self.save_data()
        print(f"Account for {username} created as {role}.")
        input("Press Enter to login...")

    def login(self):
        self.clear_screen()
        print("--- System Login ---")
        username = input("Username: ")
        password = getpass.getpass("Password: ")
        
        if username in self.users and self.users[username]["password"] == password:
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
        title = input("Enter title to borrow: ").lower()
        for b in self.books:
            if b['title'].lower() == title:
                if b['status'] == "Available":
                    # Check if someone else reserved it first
                    res_list = self.reservations.get(b['title'], [])
                    if res_list and res_list[0] != self.current_user:
                        print(f"Sorry, this book is reserved for {res_list[0]}.")
                        input("Press Enter...")
                        return

                    # Process borrowing
                    if res_list and res_list[0] == self.current_user:
                        res_list.pop(0) # Remove from reservation queue
                    
                    b['status'] = f"Out ({self.current_user})"
                    date_str = datetime.now().strftime("%Y-%m-%d")
                    if self.current_user not in self.borrowed_records:
                        self.borrowed_records[self.current_user] = []
                    self.borrowed_records[self.current_user].append({"title": b['title'], "date": date_str})
                    self.save_data()
                    print("Book successfully borrowed.")
                    input("Press Enter...")
                    return
                else:
                    # If book is busy, offer reservation
                    print("This book is currently out.")
                    choice = input("Would you like to reserve it? (y/n): ")
                    if choice.lower() == 'y':
                        if b['title'] not in self.reservations:
                            self.reservations[b['title']] = []
                        if self.current_user not in self.reservations[b['title']]:
                            self.reservations[b['title']].append(self.current_user)
                            self.save_data()
                            print("You have been added to the reservation queue.")
                        else:
                            print("You are already in the queue for this book.")
                        input("Press Enter...")
                        return
        print("Book not found.")
        input("Press Enter...")

    def return_book(self):
        self.clear_screen()
        title = input("Enter title to return: ").lower()
        records = self.borrowed_records.get(self.current_user, [])
        target = next((r for r in records if r['title'].lower() == title), None)
        
        if target:
            # Fine Calculation
            b_date = datetime.strptime(target['date'], "%Y-%m-%d")
            days = (datetime.now() - b_date).days
            fine = (days - 7) * 2 if days > 7 else 0
            
            # Update Catalog
            for b in self.books:
                if b['title'].lower() == title:
                    b['status'] = "Available"
                    # Notify about reservations
                    res_list = self.reservations.get(b['title'], [])
                    if res_list:
                        print(f"NOTICE: This book is now reserved for {res_list[0]}.")
            
            # Save History
            if self.current_user not in self.history: self.history[self.current_user] = []
            self.history[self.current_user].append({
                "title": target['title'], 
                "returned": datetime.now().strftime("%Y-%m-%d"), 
                "fine_paid": fine
            })
            
            records.remove(target)
            self.save_data()
            print(f"Return processed. Fine: GHS {fine}.00")
        else:
            print("No matching borrowing record.")
        input("Press Enter...")

    # --- Reporting ---
    def export_report(self):
        if self.user_role != "Admin": return
        total_fines = sum(h['fine_paid'] for user in self.history.values() for h in user)
        filename = f"Library_Report_{datetime.now().strftime('%Y_%m_%d')}.txt"
        with open(filename, "w") as r:
            r.write("GHANA COMMUNITY LIBRARY - OFFICIAL STATUS REPORT\n" + "="*45 + "\n")
            r.write(f"Users: {len(self.users)} | Total Books: {len(self.books)}\n")
            r.write(f"Revenue: GHS {total_fines}.00\n\nActive Reservations:\n")
            for bk, names in self.reservations.items():
                if names: r.write(f"- {bk}: {', '.join(names)}\n")
        print(f"Report saved to {filename}")
        input("Press Enter...")

# --- Application Loop ---
def main():
    lib = LibrarySystem()
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
                for h in lib.history.get(lib.current_user, []):
                    print(f"{h['title']} | Returned: {h['returned']} | Fine: GHS {h['fine_paid']}")
                input("\nPress Enter...")
            elif cmd == '5' and lib.user_role == "Admin": lib.export_report()
            elif cmd == '6' and lib.user_role == "Admin":
                t = input("Title: "); a = input("Author: ")
                lib.books.append({"title": t, "author": a, "status": "Available"})
                lib.save_data(); print("Book added."); input("Enter...")
            elif cmd == '0': lib.current_user = None

if __name__ == "__main__":
    main()