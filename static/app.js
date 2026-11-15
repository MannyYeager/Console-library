const $ = selector => document.querySelector(selector);
let state, desk, view = 'catalog', filter = 'all', authMode = 'login';
let pendingBorrow = null, toastTimer, busy = false;
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const isLibrarian = () => state?.user?.role === 'Admin';

function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').className = error ? 'error' : '';
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, error ? 10000 : 7000);
}

async function api(path, data) {
  let response;
  try {
    response = await fetch(path, data === undefined ? {} : {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)
    });
  } catch {
    throw new Error('The local library is offline. Restart the server, then refresh this page.');
  }
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || 'Please try again.'), {status:response.status});
  return result;
}

async function refresh() {
  state = await api('/api/state');
  desk = isLibrarian() ? await api('/api/admin/state') : null;
  const validViews = isLibrarian() ? ['overview','manage','circulation','reports'] : ['catalog','loans','history'];
  if (!validViews.includes(view)) view = validViews[0];
  render();
}

function navigate(nextView) {
  view = nextView;
  render();
  $('#section-title').focus({preventScroll:true});
}

function showAuth(mode = 'login') {
  authMode = mode;
  $('#auth-title').textContent = mode === 'login' ? (pendingBorrow ? 'A reader account opens this book.' : 'Welcome back.') : 'Make yourself at home.';
  $('#auth-description').textContent = pendingBorrow
    ? `Sign in to borrow “${pendingBorrow}”. ${state.demo ? 'Or continue immediately as a demo reader below.' : 'New readers can create an account below.'}`
    : mode === 'login' ? 'Readers and librarians can sign in here. Librarian accounts are set up by the local operator.' : 'Create a reader account to borrow and reserve books.';
  $('#auth-submit').textContent = mode === 'login' ? 'Sign in ↗' : 'Create reader account ↗';
  $('#auth-toggle').textContent = mode === 'login' ? 'New reader? Create an account' : 'Already have an account? Sign in';
  $('#auth-demo').hidden = !state.demo;
  const password = $('#auth-form [name=password]');
  password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  password.minLength = mode === 'login' ? 1 : 8;
  $('#auth-error').textContent = '';
  if (!$('#auth-dialog').open) { $('#auth-form').reset(); $('#auth-dialog').showModal(); }
}

function cover(book) {
  return `<div class="book-cover-area" aria-hidden="true"><span class="availability ${book.available ? '' : 'unavailable'}">${book.available ? (book.reserved_for_other ? 'Reserved' : 'Available') : 'On loan'}</span><div class="book-object"><div class="book-pages"><span>A good story<br>is an open door.</span></div><div class="book-cover ${book.title.length > 25 ? 'long-title' : ''}"><small>${escapeHtml(book.author)}</small><strong>${escapeHtml(book.title)}</strong><span class="motif"></span><span class="edition">COMMUNITY COLLECTION</span></div></div></div>`;
}

function empty(title, description, button = '') {
  return `<div class="empty"><h3>${title}</h3><p>${description}</p>${button}</div>`;
}

function renderNavigation() {
  const items = isLibrarian()
    ? [['overview','◫','Overview',''],['manage','▤','The collection',state.books.length],['circulation','⇄','Loans & returns',desk.loans.length],['reports','▥','Reports','']]
    : [['catalog','▤','The collection',state.books.length],['loans','⌑','My bookshelf',state.loans.length],['history','◷','Reading history','']];
  $('#navigation').innerHTML = items.map(([key,icon,label,count]) => `<button class="nav-item ${view === key ? 'active' : ''}" data-view="${key}" ${view === key ? 'aria-current="page"' : ''}><span aria-hidden="true">${icon}</span>${label}${count !== '' ? `<span class="count">${count}</span>` : ''}</button>`).join('');
  document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => navigate(button.dataset.view));
  $('#nav-label').textContent = isLibrarian() ? "THE LIBRARIAN'S DESK" : 'YOUR READING ROOM';
  $('#workspace-name').textContent = isLibrarian() ? 'Librarian desk' : 'The reading room';
  $('#mode-label').textContent = state.demo ? 'Local demo · sample data' : 'Local library';
  const user = state.user;
  $('#account').innerHTML = `${state.demo ? '<button class="role-switch" id="choose-role">Try demo roles ⇄</button>' : ''}${user ? `<span class="account-name"><span class="avatar">${isLibrarian() ? 'L' : 'R'}</span><span>${isLibrarian() ? 'Librarian' : 'Reader'}<small>${escapeHtml(user.username)}</small></span></span><button class="text-button" id="sign-out">Sign out</button>` : '<button class="text-button" id="sign-in">Sign in ↗</button>'}`;
  if (state.demo) $('#choose-role').onclick = () => { pendingBorrow = null; $('#role-dialog').showModal(); };
  if (user) $('#sign-out').onclick = async () => { pendingBorrow = null; await action('/api/logout', {}); };
  else $('#sign-in').onclick = () => { pendingBorrow = null; showAuth(); };
}

function renderBooks() {
  const query = $('#search').value.trim().toLocaleLowerCase();
  const catalogView = ['catalog','manage'].includes(view);
  const books = catalogView ? state.books.filter(book =>
    (filter === 'all' || (book.available && !book.reserved_for_other)) && `${book.title} ${book.author}`.toLocaleLowerCase().includes(query)) :
    (view === 'loans' ? state.loans : state.history).map(record => ({...state.books.find(book => book.title === record.title), ...record}));
  $('#result-count').textContent = `${books.length} ${books.length === 1 ? 'book' : 'books'}`;
  if (!catalogView && !state.user) {
    $('#content').innerHTML = empty('A shelf of your own.', 'Sign in or start a reader demo to borrow your first book.', '<button class="primary" id="empty-sign-in">Open a reader session ↗</button>');
    $('#empty-sign-in').onclick = () => { pendingBorrow = null; showAuth(); };
    return;
  }
  if (!books.length) {
    $('#content').innerHTML = catalogView ? empty('No stories found.', 'Try another title, author, or availability filter.') : view === 'loans' ? empty('Your next story is waiting.', 'Choose a book from the collection and it will appear here.', '<button class="primary" id="browse-books">Browse the collection ↗</button>') : empty('Every reader starts somewhere.', 'Your returned books will appear here.');
    if ($('#browse-books')) $('#browse-books').onclick = () => navigate('catalog');
    return;
  }
  $('#content').innerHTML = books.map((book,index) => {
    const ownLoan = state.loans.some(loan => loan.title === book.title);
    const queued = state.reservations.find(item => item.title === book.title);
    let label = 'Borrow book ↗', operation = 'borrow';
    if (view === 'history') { label = 'Finished ✓'; operation = 'status'; }
    else if (view === 'loans') { label = 'Return book ↗'; operation = 'return'; }
    else if (view === 'manage') { label = book.available ? 'On the shelf' : 'View circulation ↗'; operation = book.available ? 'status' : 'circulation'; }
    else if (ownLoan) { label = 'View on bookshelf ↗'; operation = 'shelf'; }
    else if (queued && !book.reserved_for_me) { label = `Your queue position: ${queued.position}`; operation = 'shelf'; }
    else if (book.available && book.reserved_for_other) { label = 'Reserved for next reader'; operation = 'status'; }
    else if (!book.available) label = 'Reserve this book +';
    const details = view === 'loans' ? `<div class="loan-details">Borrowed ${escapeHtml(book.date)}<br><strong>Due ${escapeHtml(book.due)}</strong><br>Late fine: GHS ${book.fine}.00 · simulated</div>` : view === 'history' ? `<div class="loan-details">Returned ${escapeHtml(book.returned)}<br>Recorded fine: GHS ${book.fine_paid}.00 · simulated</div>` : '';
    return `<article class="book-card">${cover(book)}<h3>${escapeHtml(book.title)}</h3><p class="book-author">${escapeHtml(book.author)}</p>${details}<div class="book-bottom"><span class="book-category">COMMUNITY COLLECTION</span>${operation === 'status' ? `<span class="book-status">${label}</span>` : `<button class="borrow-button" data-book="${index}" data-operation="${operation}" aria-label="${escapeHtml(label.replace(/[↗+]/g,'').trim())}: ${escapeHtml(book.title)}">${label}</button>`}</div></article>`;
  }).join('');
  document.querySelectorAll('[data-book]').forEach(button => button.onclick = async () => {
    if (busy) return;
    const operation = button.dataset.operation;
    const title = books[Number(button.dataset.book)].title;
    if (operation === 'shelf') return navigate('loans');
    if (operation === 'circulation') return navigate('circulation');
    if (!state.user) { pendingBorrow = title; showAuth(); return; }
    await transactBook(operation, title, button);
  });
}

function circulationTable(loans, compact = false) {
  if (!loans.length) return empty('All stories are home.', 'Borrowed books will appear here with their reader and due date.');
  return `<div class="table-scroll"><table><thead><tr><th>Book / reader</th><th>Due date</th><th>Status</th>${compact ? '' : '<th>Action</th>'}</tr></thead><tbody>${loans.map((loan,index) => `<tr><td><strong>${escapeHtml(loan.title)}</strong><small>${escapeHtml(loan.reader)}</small></td><td>${escapeHtml(loan.due)}</td><td><span class="loan-badge ${loan.overdue ? 'late' : ''}">${loan.overdue ? 'Overdue' : 'On time'}</span><small>Fine GHS ${loan.fine}.00</small></td>${compact ? '' : `<td><button class="return-action" data-return="${index}">Process return ↗</button></td>`}</tr>`).join('')}</tbody></table></div>`;
}

function renderDesk() {
  $('#result-count').textContent = 'LIBRARIAN ACCESS';
  if (view === 'overview') {
    $('#content').innerHTML = `<div class="desk-intro"><span class="role-pill">Librarian session</span><p>A clear view of your collection and the stories out in the community.</p></div><div class="stat-grid">${[[state.books.length,'Books in collection'],[desk.loans.length,'Books on loan'],[desk.readers,'Registered readers'],[desk.reservations.reduce((sum,item) => sum + item.readers.length,0),'Reservations']].map(([number,label]) => `<div class="stat-card"><strong>${number}</strong><span>${label}</span></div>`).join('')}</div><div class="desk-heading"><h3>Out in the community</h3><button class="text-button" id="all-loans">Manage loans & returns ↗</button></div>${circulationTable(desk.loans,true)}<div class="desk-callout"><h3>Make room for another story.</h3><p>Add a title to the shared catalog. Readers will see it immediately.</p><button class="primary" id="manage-collection">Manage the collection +</button></div>`;
    $('#all-loans').onclick = () => navigate('circulation');
    $('#manage-collection').onclick = () => navigate('manage');
  } else if (view === 'circulation') {
    $('#content').innerHTML = `<p class="section-description">Review active loans and process returns on behalf of readers. Fines are simulated, not payments.</p>${circulationTable(desk.loans)}<div class="desk-heading"><h3>Reservation queues</h3></div>${desk.reservations.length ? desk.reservations.map(item => `<div class="reservation-row"><strong>${escapeHtml(item.title)}</strong><span>${item.readers.map((reader,index) => `${index+1}. ${escapeHtml(reader)}`).join(' → ')}</span></div>`).join('') : '<p class="muted">No readers are waiting for a book.</p>'}`;
    document.querySelectorAll('[data-return]').forEach(button => button.onclick = () => {
      const loan = desk.loans[Number(button.dataset.return)];
      action('/api/admin/return', {title:loan.title,reader:loan.reader},button);
    });
  } else {
    $('#content').innerHTML = `<div class="report-header"><div><span class="role-pill">Live library summary</span><p>Generated from the current catalog, return history, and reservation queues.</p></div><a class="primary" href="/api/report" target="_blank" rel="noopener">Open text report ↗</a></div><pre class="report-body">${escapeHtml(desk.report)}</pre><p class="muted">${desk.returns.length} completed returns · Recorded fines are simulated. No money is collected.</p>`;
  }
}

function render() {
  renderNavigation();
  const headings = {
    catalog:['THE SHELVES ARE OPEN','A story for every reader','The collection'],
    loans:['A LITTLE ROOM FOR READING','Your personal bookshelf','My bookshelf'],
    history:['THE STORIES THAT STAY','Chapters you’ve finished','Reading history'],
    overview:["THE LIBRARIAN'S DESK",'A little order. A lot of stories','Overview'],
    manage:['GROW YOUR SHARED SHELVES','The collection, in good hands','Collection management'],
    circulation:['KEEP THE STORIES MOVING','Loans & returns','Loans & returns'],
    reports:['FROM THE LIBRARY RECORDS','The story in numbers','Reports']
  };
  $('#section-kicker').textContent = headings[view][0];
  $('#section-title').innerHTML = `${headings[view][1]}<span>.</span>`;
  $('#section-title').tabIndex = -1;
  $('#crumb').textContent = headings[view][2];
  $('#hero').hidden = view !== 'catalog';
  $('#catalog-tools').hidden = !['catalog','manage'].includes(view);
  $('#admin').hidden = view !== 'manage';
  $('#content').className = ['catalog','manage','loans','history'].includes(view) ? 'book-grid' : 'desk-content';
  $('#content').setAttribute('aria-busy','false');
  $('#explore').textContent = state.user ? 'Find your next read ↗' : state.demo ? 'Explore the demo ↗' : 'Join the reading room ↗';
  $('#demo-caption').textContent = state.user ? 'Seven-day loans. Your own reading space.' : state.demo ? 'Choose a reader or librarian. No signup needed.' : 'Create a reader account to borrow and reserve.';
  if (['overview','circulation','reports'].includes(view)) renderDesk(); else renderBooks();
  $('#reservations').hidden = view !== 'loans' || !state.reservations.length;
  $('#reservations').className = 'reservation-panel';
  $('#reservations').innerHTML = '<h3>Your place in the queue.</h3>' + state.reservations.map(item => `<div class="reservation-row"><span>${escapeHtml(item.title)}</span><span>Position ${item.position}</span></div>`).join('');
}

async function action(path, data, button) {
  if (busy) return false;
  busy = true;
  const oldContent = button ? Array.from(button.childNodes) : [];
  if (button) { button.disabled = true; button.textContent = 'Working…'; }
  try {
    const result = await api(path,data);
    await refresh();
    toast(result.message);
    return true;
  } catch (error) {
    if (error.status === 401 && !['/api/login','/api/register'].includes(path)) {
      pendingBorrow = path === '/api/borrow' ? data.title : null;
      await refresh();
      showAuth();
    }
    if ($('#auth-dialog').open) $('#auth-error').textContent = error.message;
    if ($('#role-dialog').open) $('#role-error').textContent = error.message;
    toast(error.message,true);
    return false;
  }
  finally {
    busy = false;
    if (button?.isConnected) { button.disabled = false; button.replaceChildren(...oldContent); }
  }
}

async function transactBook(operation,title,button) {
  const success = await action(operation === 'return' ? '/api/return' : '/api/borrow',{title},button);
  if (success) {
    pendingBorrow = null;
    navigate(operation === 'return' ? 'history' : 'loans');
  }
}

async function enterDemo(role,button) {
  if (await action('/api/demo',{role},button)) {
    $('#role-dialog').close(); $('#auth-dialog').close();
    if (role === 'reader' && pendingBorrow) await transactBook('borrow',pendingBorrow);
  }
}

document.querySelectorAll('[data-filter]').forEach(button => button.onclick = () => {
  filter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(item => { item.classList.toggle('active',item === button); item.setAttribute('aria-pressed',String(item === button)); });
  render();
});
$('#search').oninput = () => state && render();
$('#explore').onclick = () => {
  if (!state || busy) return;
  pendingBorrow = null;
  if (state.user) { $('#search').focus(); $('.collection').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'}); }
  else if (state.demo) $('#role-dialog').showModal();
  else showAuth('register');
};
$('#auth-toggle').onclick = () => showAuth(authMode === 'login' ? 'register' : 'login');
$('#auth-dialog .close').onclick = () => { pendingBorrow = null; $('#auth-dialog').close(); };
$('#role-close').onclick = () => $('#role-dialog').close();
$('#auth-demo').onclick = () => enterDemo('reader',$('#auth-demo'));
$('#role-dialog').addEventListener('click', event => {
  const button = event.target.closest('[data-role]');
  if (button) enterDemo(button.dataset.role,button);
});
$('#auth-form').onsubmit = async event => {
  event.preventDefault();
  const button = $('#auth-submit');
  if (await action(`/api/${authMode}`,Object.fromEntries(new FormData(event.target)),button)) {
    $('#auth-dialog').close(); event.target.reset();
    if (pendingBorrow && !isLibrarian()) await transactBook('borrow',pendingBorrow);
  }
};
$('#add-book-form').onsubmit = async event => {
  event.preventDefault();
  if (await action('/api/add-book',Object.fromEntries(new FormData(event.target)),event.target.querySelector('button'))) event.target.reset();
};
document.addEventListener('keydown',event => {
  if (event.key === '/' && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName) && !document.querySelector('dialog[open]') && ['catalog','manage'].includes(view)) { event.preventDefault(); $('#search').focus(); }
});
refresh().catch(error => { $('#content').setAttribute('aria-busy','false'); $('#content').innerHTML = empty('The shelves are taking a moment.','Start the local server, then refresh this page.'); toast(error.message,true); });
