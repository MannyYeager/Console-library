# Ghana Community Library

A quiet reading room for Ghanaian stories, with a working Python library manager behind it. Browse the collection, borrow a book, join a reservation queue, and see your reading history through either the web interface or the original terminal app.

## Try the web demo

Requires **Python 3.11 or newer**. No packages, API keys, build tools, or database server are needed.

```sh
git clone https://github.com/MannyYeager/Console-library.git
cd Console-library
python web.py --demo
```

Open **http://127.0.0.1:8765/** and choose **Explore the demo**. On Windows, `py` can replace `python`; on macOS/Linux, use `python3` if needed. If the port is occupied, use `python web.py --demo --port 8766` and open that port instead.

The demo creates a temporary reader account and six sample books. All demo users share that temporary catalog; it resets when the server stops. It never changes your normal library store. Demo access is available only with `--demo`.

### A two-minute walkthrough

1. Explore the demo, then search for **Changes** or **Ama Ata Aidoo**.
2. Choose **Borrow book**, then open **My bookshelf** to see the seven-day due date.
3. Choose **Return book**, then open **Reading history** to see the return.
4. To try reservations, keep the original reader signed in after borrowing. Open a separate browser or private window, start another demo reader, and reserve the same title. Return it in the original window; only the first reader in the queue can borrow it next. Demo reader credentials are generated internally, so signing out ends access to that reader.

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
- Admin-only inventory additions and text reports.
- Salted PBKDF2-HMAC-SHA256 password hashes with 600,000 iterations.
- Local web sessions with HttpOnly/SameSite cookies, origin checks, and basic authentication throttling.
- Subtle CSS transitions with reduced-motion support; no external fonts or animation packages.

Book-cover compositions are original CSS illustrations, not reproductions of published covers.

## Existing data migration

Older versions stored plaintext passwords and allowed self-selected admin roles. On first load, plaintext passwords are replaced with salted hashes and **all legacy accounts are reset to Student**, including the former default admin. Their passwords still work. Run the local `--create-admin` command to establish a trusted administrator; if that username already exists, bootstrap replaces its credentials and role while keeping its borrowing records.

The old default `admin/123` is never created in a new store. If migrating a store containing that account, bootstrap it with a strong new password or keep it unused as a Student account. Old backups may still contain plaintext passwords; protect them accordingly.

## Verify

```sh
python -m unittest -v
```

Tests use temporary stores and local ephemeral HTTP ports. They cover password migration, authorization, registration, reservation order, return ownership, late fines, persistence, sessions, and the HTTP interface.

## Project structure

| File | Purpose |
| --- | --- |
| `library.py` | Shared library rules, JSON persistence, and terminal interface |
| `web.py` | Local Python HTTP server, sessions, and JSON API |
| `static/` | Buildless HTML, CSS, and JavaScript interface |
| `test_library.py`, `test_web.py` | Domain and HTTP regression tests |

This is a **local educational portfolio application**, bound to loopback only. It is not a production library service: there is no HTTPS deployment, email verification, password recovery, real payment processing, multi-copy inventory, or reservation expiry. Recorded fines are a simulation, not evidence that money was collected. Stop the server with Ctrl+C.
