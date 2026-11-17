# Ghana Community Library

A reading room for Ghanaian stories, with an illustrated welcome screen and a working Python library manager behind it. Sign in to browse the collection, borrow books, join reservation queues, or manage the shelves. The original terminal app remains available.

## Try the web demo

Requires **Python 3.11 or newer**. No packages, API keys, build tools, or database server are needed.

```sh
git clone https://github.com/MannyYeager/Console-library.git
cd Console-library
python web.py --demo
```

Open **http://127.0.0.1:8765/**. The site starts with a full-page login form. Choose **Reader demo** or **Librarian demo** to fill the form, then click **Open my reading room**. The server authenticates those credentials and opens the account's stored role; the login form cannot assign privileges. On Windows, `py` can replace `python`; on macOS/Linux, use `python3` if needed. If the port is occupied, use `python web.py --demo --port 8770` and open that port instead.

The demo starts with six sample books and these deliberately public, local-only teaching credentials:

| Role | Username | Demo password |
| --- | --- | --- |
| Reader | `reader.demo` | `ReadWithUs26!` |
| Librarian | `librarian.demo` | `Shelves26!` |

These accounts are created **only in the temporary `--demo` store** and are never installed in a persistent library. All demo users share that catalog and the named demo accounts. Data resets when the server stops. Passwords are hashed even in the demo. The credential hints and optional in-app **Try demo roles** shortcut are disabled outside demo mode.

### A fuller reading workflow

Reader sections are **Discover**, **My bookshelf**, **Reservations**, **Reading list** and **Reading history**. Find a title by name, author or category, open its details and choose a **7, 14, 21 or 28 day** loan. The confirmation shows your return date, current borrowing capacity and the simulated GHS 2-per-day late policy. Readers can borrow up to five books.

An on-time loan may be extended once by seven days if no reader is waiting. Renewal is blocked for overdue or already-renewed loans. Returns show the recorded simulated fine before confirmation. Legacy borrowing records without duration metadata retain their original seven-day policy.

Unavailable titles have a FIFO reservation queue. Readers can view their position, leave the queue, and choose a loan duration when their reserved title is ready. Heart buttons maintain a persistent per-reader next-read list. Book details also include an optional librarian description/page count and a clearly labelled community reading prompt.

Librarian sections separate **Overview**, **The collection**, **Loans & returns** and **Reports**. Add titles with category, optional page count and description; process reader returns; review due dates and queues; and export a live text report. Loan dates, availability and fines use the same domain rules across both roles and the terminal application.

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
- Selectable-duration loans; simulated late fines of **GHS 2 per day** after day seven.
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

### Visual design and animation

The browser app includes a distinct colour palette, custom stroke SVG icons, richer dashboards, and Anime.js entrances and action feedback. Animation respects `prefers-reduced-motion`, including changes while the page is open. Forms and data updates do not depend on animation completing.

Anime.js **4.5.0** is vendored at `static/vendor/anime.umd.min.js` from the official npm distribution, with its MIT license in `static/vendor/ANIME-LICENSE.md`. No CDN, build step, or internet connection is needed at runtime. `static/ui.js` and `static/ui.css` provide the shared icon and motion layer; `static/theme.css` contains this app’s visual theme. See [Anime.js installation](https://animejs.com/documentation/getting-started/installation/).
`node test_motion.cjs` checks the motion preference and missing-runtime fallbacks (Node.js is needed only for this optional check).

### Expanded workspace implementation

`static/workspace.css` contains the illustrated hero, loan dialog, duration selector, reading-list and reservation layouts. The backend stores `loan_days`, renewal count and per-reader saved titles alongside the existing atomic JSON store. New domain/HTTP tests cover selected durations, fine calculations, renewals, waiting readers, persistence and the five-book limit. Existing authentication and migration safeguards remain in place.
