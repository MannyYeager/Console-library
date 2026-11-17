import tempfile
import unittest
from pathlib import Path
from datetime import datetime, timedelta
from library import LibrarySystem


class LoanFeaturesTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path=Path(self.temp.name)/'library.json'
        self.lib=LibrarySystem(self.path)
        self.lib.register_user('reader','test-reader-pass')
        self.lib.register_user('second','test-second-pass')
        self.title=self.lib.books[0]['title']

    def test_selected_duration_controls_fines_and_persists(self):
        self.lib.borrow_title('reader',self.title,28)
        record=self.lib.borrowed_records['reader'][0]
        record['date']=(datetime.now()-timedelta(days=29)).strftime('%Y-%m-%d')
        self.lib.save_data()
        loaded=LibrarySystem(self.path)
        self.assertEqual(loaded.borrowed_records['reader'][0]['loan_days'],28)
        self.assertIn('GHS 2.00',loaded.return_title('reader',self.title))

    def test_renewal_is_once_and_blocked_by_waiting_reader(self):
        self.lib.borrow_title('reader',self.title,14)
        self.lib.borrow_title('second',self.title)
        with self.assertRaises(ValueError):self.lib.renew_title('reader',self.title)
        self.lib.cancel_reservation('second',self.title)
        self.lib.renew_title('reader',self.title)
        self.assertEqual(self.lib.borrowed_records['reader'][0]['loan_days'],21)
        with self.assertRaises(ValueError):self.lib.renew_title('reader',self.title)

    def test_bad_durations_and_overdue_renewals_rejected(self):
        for duration in [0,8,99,'14',True]:
            with self.assertRaises(ValueError):self.lib.borrow_title('reader',self.title,duration)
        self.lib.borrow_title('reader',self.title)
        self.lib.borrowed_records['reader'][0]['date']=(datetime.now()-timedelta(days=8)).strftime('%Y-%m-%d')
        with self.assertRaises(ValueError):self.lib.renew_title('reader',self.title)

    def test_saved_reading_list_is_per_reader_and_persistent(self):
        self.lib.save_title('reader',self.title)
        self.lib.save_title('reader',self.title)
        self.assertEqual(LibrarySystem(self.path).favorites['reader'],[self.title])
        self.assertNotIn('second',self.lib.favorites)
        self.lib.save_title('reader',self.title,False)
        self.assertEqual(self.lib.favorites['reader'],[])

    def test_five_book_limit_leaves_sixth_title_available(self):
        self.lib.books.extend([dict(title=f'Extra {i}',author='Demo',status='Available') for i in range(4)])
        for book in self.lib.books[:5]:self.lib.borrow_title('reader',book['title'])
        with self.assertRaises(ValueError):self.lib.borrow_title('reader',self.lib.books[5]['title'])
        self.assertEqual(len(self.lib.borrowed_records['reader']),5)
        self.assertEqual(self.lib.books[5]['status'],'Available')
