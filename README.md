# Ghana Community Library

A quiet reading room for Ghanaian stories, with a working Python library manager behind it. Browse the collection, borrow a book, join a reservation queue, and see your reading history through either the web interface or the original terminal app.

## Try the web demo

Requires **Python 3.11 or newer**. No packages, API keys, build tools, or database server are needed.

```sh
git clone https://github.com/MannyYeager/Console-library.git
cd Console-library
python web.py --demo
```

Open **http://127.0.0.1:8765/** and choose **Explore the demo**, then **Reader** or **Librarian**. You can also use **Try demo roles** in the header to switch between them. On Windows, `py` can replace `python`; on macOS/Linux, use `python3` if needed. If the port is occupied, use `python web.py --demo --port 8766` and open that port instead.

The demo starts with six sample books and creates temporary role accounts without asking for credentials. All demo users share the temporary catalog and one demo librarian; it resets when the server stops. It never changes your normal library store. Demo role access is available only with `--demo`, which always uses a temporary file. It cannot grant admin access to a persistent library.

### A two-minute walkthrough

1. Enter as **Reader**, then search for **Changes** or **Ama Ata Aidoo**.
2. Choose **Borrow book**. The app opens **My bookshelf**, shows a success message, and displays the seven-day due date. If you click Borrow as a visitor, the sign-in dialog explains what to do and offers **Continue as demo reader**; the original borrowing action then completes automatically.
3. Use **Try demo roles → Librarian**. The overview shows the active loan. Open **Loans & returns** and choose **Process return**, or add a title through **The collection**. Reports show real values from the shared local data.
4. Switch back to **Reader** in the same session. Your reader identity and bookshelf are preserved; **Reading history** now includes the librarian-processed return.
5. To try reservations, keep a reader signed in after borrowing. Open a separate browser/private window, start another demo reader, and reserve the same title. Return it in the original window; only the first reader in the queue can borrow it next.

Signing out ends access to generated demo identities. Restarting the server expires sessions; an attempted borrow from a stale page opens the sign-in/demo recovery flow instead of silently failing. Refreshing also synchronizes the page with the server.

### Two working roles

| Reader | Librarian |
| --- | --- |
| Search, borrow, and reserve | Collection and circulation overview |
| Personal bookshelf and due dates | Add catalog entries |
| Return own books | Process returns on behalf of readers |
| Personal reading history | Reservation queues and live text reports |

Both roles use the same Python rules and data. The server checks librarian privileges on every management endpoint; hiding reader navigation is not the authorization boundary. In persistent mode, both roles sign in with their own username/password and only the local setup command can create the first admin.

## Use a persistent library

```sh
python library.py --create-admin librarian
python web.py
```

The setup command prompts for a new password and confirmation. Sign in with that account to add books and open a text status report. Reader registration always creates a **Student** account. There are no default credentials, and admin bootstrap refuses to run when an admin already exists.

To use the terminal interface instead:

```sh
python library.py
```

Both interfaces use `ghana_library_data.json` beside `library.py`. A custom path is supported by both:

```sh
python library.py --data-file ./my-library.json --create-admin librarian
python web.py --data-file ./my-library.json
```

Run one application process per data file; simultaneous terminal and web processes are not supported. The web server serializes operations within its process. Data is written to a temporary file and then replaced atomically. Back up your data before upgrades.

## Features

- Searchable catalog, availability filter, and responsive web layout.
- Reader registration, sign-in, sign-out, personal loans, and return history.
- Case-insensitive title matching and first-in, first-out reservations.
- Seven-day loans; simulated late fines of **GHS 2 per day** after day seven.
- A separate librarian desk for inventory additions, active loans, reader returns, reservation queues, and text reports.
- Salted PBKDF2-HMAC-SHA256 password hashes with 600,000 iterations.
- Local web sessions with HttpOnly/SameSite cookies, origin checks, and basic authentication throttling.
- Larger readable text, clear action buttons, and a book-cover opening effect on hover or keyboard focus. Touch actions do not depend on hover; reduced-motion mode disables the effect. No external fonts or animation packages.

Book-cover compositions are original CSS illustrations, not reproductions of published covers.

## Existing data migration

Older versions stored plaintext passwords and allowed self-selected admin roles. On first load, plaintext passwords are replaced with salted hashes and **all legacy accounts are reset to Student**, including the former default admin. Their passwords still work. Run the local `--create-admin` command to establish a trusted administrator; if that username already exists, bootstrap replaces its credentials and role while keeping its borrowing records.

The old default `admin/123` is never created in a new store. If migrating a store containing that account, bootstrap it with a strong new password or keep it unused as a Student account. Old backups may still contain plaintext passwords; protect them accordingly.

## Verify

```sh
python -m unittest -v
```

Tests use temporary stores and local ephemeral HTTP ports. They cover password migration, authorization, registration, reservation order, return ownership, late fines, persistence, sessions, demo role switching, librarian-managed returns, expired sessions, and the HTTP interface.

## Project structure

| File | Purpose |
| --- | --- |
| `library.py` | Shared library rules, JSON persistence, and terminal interface |
| `web.py` | Local Python HTTP server, sessions, and JSON API |
| `static/` | Buildless HTML, CSS, and JavaScript interface |
| `test_library.py`, `test_web.py` | Domain and HTTP regression tests |

This is a **local educational portfolio application**, bound to loopback only. It is not a production library service: there is no HTTPS deployment, email verification, password recovery, real payment processing, multi-copy inventory, or reservation expiry. Recorded fines are a simulation, not evidence that money was collected. Stop the server with Ctrl+C.
