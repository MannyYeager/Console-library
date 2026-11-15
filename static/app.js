const $ = (selector) => document.querySelector(selector);
let state, view = 'catalog', filter = 'all', authMode = 'login', toastTimer;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').className = error ? 'error' : '';
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5500);
}

async function api(path, data) {
  const response = await fetch(path, data === undefined ? {} : {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Something went wrong. Please try again.');
  return result;
}

async function refresh() {
  state = await api('/api/state');
  render();
}

function showAuth(mode = 'login') {
  authMode = mode;
  $('#auth-title').textContent = mode === 'login' ? 'Welcome back.' : 'Make yourself at home.';
  $('#auth-description').textContent = mode === 'login' ? 'Sign in to borrow, reserve, and keep reading.' : 'Your free reader account opens a world of stories.';
  $('#auth-submit').textContent = mode === 'login' ? 'Sign in ↗' : 'Create reader account ↗';
  $('#auth-toggle').textContent = mode === 'login' ? 'New here? Create a reader account' : 'Already a reader? Sign in';
  const password = $('#auth-form [name=password]');
  password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  password.minLength = mode === 'login' ? 1 : 8;
  $('#auth-error').textContent = '';
  if (!$('#auth-dialog').open) { $('#auth-form').reset(); $('#auth-dialog').showModal(); }
}

function cover(book) {
  return `<div class="book-cover-area"><span class="availability ${book.available ? '' : 'unavailable'}">${book.available ? (book.reserved_for_other ? 'Reserved' : 'Available') : 'On loan'}</span><div class="book-cover ${book.title.length > 25 ? 'long-title' : ''}"><small>${escapeHtml(book.author)}</small><strong>${escapeHtml(book.title)}</strong><span class="motif"></span><span class="edition">THE COMMUNITY COLLECTION</span></div></div>`;
}

function empty(title, description) {
  return `<div class="empty"><h3>${title}</h3><p>${description}</p></div>`;
}

function render() {
  const user = state.user;
  $('#mode-label').textContent = state.demo ? 'Local demo · resets on restart' : 'Local library';
  $('#catalog-count').textContent = state.books.length;
  $('#loan-count').textContent = state.loans.length;
  $('#account').innerHTML = user ? `<span class="account-name"><span class="avatar">${escapeHtml(user.username[0].toUpperCase())}</span>${escapeHtml(user.username)}</span><button class="text-button" id="sign-out">Sign out ↗</button>` : '<button class="text-button" id="sign-in">Sign in ↗</button>';
  if (user) $('#sign-out').onclick = () => action('/api/logout', {});
  else $('#sign-in').onclick = () => showAuth();
  $('#explore').textContent = user ? 'Find your next read ↗' : state.demo ? 'Explore the demo ↗' : 'Join the reading room ↗';
  $('#demo-caption').textContent = user ? 'Seven days, a good book, and a little you-time.' : state.demo ? 'No signup needed. Just a little curiosity.' : 'Create a reader account to borrow and reserve.';
  $('#hero').hidden = view !== 'catalog';
  $('#catalog-tools').hidden = view !== 'catalog';
  $('#admin').hidden = !user || user.role !== 'Admin';
  const headings = {catalog:['THE SHELVES ARE OPEN','A story for every reader','The collection'],loans:['A LITTLE ROOM FOR READING','Your personal bookshelf','My bookshelf'],history:['THE STORIES THAT STAY','Chapters you’ve finished','Reading history']};
  $('#section-kicker').textContent = headings[view][0];
  $('#section-title').innerHTML = `${headings[view][1]}<span>.</span>`;
  $('#crumb').textContent = headings[view][2];
  document.querySelectorAll('[data-view]').forEach(button => {
    button.classList.toggle('active', button.dataset.view === view);
    if (button.dataset.view === view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  const query = $('#search').value.trim().toLocaleLowerCase();
  let books = view === 'catalog' ? state.books.filter(book =>
    (filter === 'all' || (book.available && !book.reserved_for_other)) &&
    `${book.title} ${book.author}`.toLocaleLowerCase().includes(query)) :
    (view === 'loans' ? state.loans : state.history).map(record => ({...state.books.find(book => book.title === record.title), ...record}));
  $('#result-count').textContent = `${books.length} ${books.length === 1 ? 'book' : 'books'}`;
  if (view !== 'catalog' && !user) {
    $('#content').innerHTML = empty('A shelf of your own.', 'Sign in or explore the demo to start your reading journey.');
  } else if (!books.length) {
    $('#content').innerHTML = view === 'catalog' ? empty('No stories found.', 'Try a different title, author, or filter.') : view === 'loans' ? empty('Your next story is waiting.', 'Browse the collection and borrow a book to see it here.') : empty('Every reader starts somewhere.', 'Your returned books will appear here.');
  } else {
    $('#content').innerHTML = books.map((book,index) => {
      const ownLoan = state.loans.some(loan => loan.title === book.title);
      const queued = state.reservations.find(item => item.title === book.title);
      const disabled = view === 'history' || (view === 'catalog' && (ownLoan || (queued && !book.reserved_for_me) || (book.available && book.reserved_for_other)));
      const label = view === 'history' ? 'Finished ✓' : view === 'loans' ? 'Return book ↗' : ownLoan ? 'On your shelf ✓' : queued && !book.reserved_for_me ? `In queue · #${queued.position}` : book.available ? 'Borrow book ↗' : 'Reserve book ↗';
      const details = view === 'loans' ? `<div class="loan-details">Borrowed ${escapeHtml(book.date)}<br>Due ${escapeHtml(book.due)} · Fine GHS ${book.fine}.00</div>` : view === 'history' ? `<div class="loan-details">Returned ${escapeHtml(book.returned)}<br>Recorded fine GHS ${book.fine_paid}.00 · simulated</div>` : '';
      return `<article class="book-card">${cover(book,index)}<h3>${escapeHtml(book.title)}</h3><p class="book-author">${escapeHtml(book.author)}</p>${details}<div class="book-bottom"><span class="book-category">${view === 'catalog' ? 'GHANA · LITERATURE' : '7-DAY LOAN'}</span><button class="borrow-button" data-book="${index}" ${disabled ? 'disabled' : ''}>${label}</button></div></article>`;
    }).join('');
    document.querySelectorAll('[data-book]').forEach(button => button.onclick = () => {
      if (!state.user) return showAuth();
      action(view === 'loans' ? '/api/return' : '/api/borrow', {title:books[Number(button.dataset.book)].title}, button);
    });
  }
  $('#reservations').hidden = view !== 'loans' || !state.reservations.length;
  $('#reservations').className = 'reservation-panel';
  $('#reservations').innerHTML = '<h3>Your place in the queue.</h3>' + state.reservations.map(item => `<div class="reservation-row"><span>${escapeHtml(item.title)}</span><span>Position ${item.position}</span></div>`).join('');
}

async function action(path, data, button) {
  if (button) button.disabled = true;
  try {
    const result = await api(path, data);
    await refresh();
    toast(result.message);
    return true;
  } catch (error) { toast(error.message, true); return false; }
  finally { if (button?.isConnected) button.disabled = false; }
}

document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => { view = button.dataset.view; render(); });
document.querySelectorAll('[data-filter]').forEach(button => button.onclick = () => {
  filter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(item => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); });
  render();
});
$('#search').oninput = render;
$('#explore').onclick = async () => {
  if (!state) return;
  if (state.user) { $('#search').focus(); $('.collection').scrollIntoView({behavior:'smooth'}); }
  else if (state.demo) await action('/api/demo', {}, $('#explore'));
  else showAuth('register');
};
$('#auth-toggle').onclick = () => showAuth(authMode === 'login' ? 'register' : 'login');
$('.close').onclick = () => $('#auth-dialog').close();
$('#auth-form').onsubmit = async event => {
  event.preventDefault();
  const button = $('#auth-submit'); button.disabled = true;
  try {
    const result = await api(`/api/${authMode}`, Object.fromEntries(new FormData(event.target)));
    $('#auth-dialog').close(); event.target.reset(); await refresh(); toast(result.message);
  } catch (error) { $('#auth-error').textContent = error.message; }
  finally { button.disabled = false; }
};
$('#add-book-form').onsubmit = async event => {
  event.preventDefault();
  if (await action('/api/add-book', Object.fromEntries(new FormData(event.target)), event.target.querySelector('button'))) event.target.reset();
};
document.addEventListener('keydown', event => {
  if (event.key === '/' && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName) && !$('#auth-dialog').open && view === 'catalog') { event.preventDefault(); $('#search').focus(); }
});
refresh().catch(error => { $('#content').innerHTML = empty('The shelves are taking a moment.', 'Refresh the page after starting the local library server.'); toast(error.message, true); });
