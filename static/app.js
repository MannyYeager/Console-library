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
  AppUI.feedback('#toast');
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
  const validViews = isLibrarian() ? ['overview','manage','circulation','reports'] : ['catalog','loans','reservations','saved','history'];
  if (!validViews.includes(view)) view = validViews[0];
  render();
}

function navigate(nextView) {
  view = nextView;
  window.scrollTo({top:0,behavior:"instant"});
  render();
  AppUI.reveal('#content>.book-card,#content>.stat-grid,#content>.desk-intro');
  $('#section-title').focus({preventScroll:true});
}

function showAuth(mode = 'login') {
  authMode = mode;
  if (mode === 'login' && !state?.user) {
    $('#auth-dialog').close();
    $('#entry-error').textContent = pendingBorrow ? `Sign in to finish borrowing “${pendingBorrow}”.` : '';
    $('#entry-username').focus();
    return;
  }
  $('#auth-title').textContent = mode === 'login' ? (pendingBorrow ? 'A reader account opens this book.' : 'Welcome back.') : 'Make yourself at home.';
  $('#auth-description').textContent = pendingBorrow
    ? `Sign in to borrow “${pendingBorrow}”. ${state.demo ? 'Or continue immediately as a demo reader below.' : 'New readers can create an account below.'}`
    : mode === 'login' ? 'Readers and librarians can sign in here. Librarian accounts are set up by the local operator.' : 'Create a reader account to borrow and reserve books.';
  $('#auth-submit').textContent = mode === 'login' ? 'Sign in ↗' : 'Create reader account ↗';
  $('#auth-toggle').textContent = mode === 'login' ? 'New reader? Create an account' : 'Already have an account? Sign in';
  $('#auth-demo').hidden = true;
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
    : [['catalog','▤','Discover',state.books.length],['loans','⌑','My bookshelf',state.loans.length],['reservations','<span data-icon="calendar"></span>','Reservations',state.reservations.length],['saved','<span data-icon="heart"></span>','Reading list',state.favorites.length],['history','◷','Reading history','']];
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
    (filter === 'all' || (book.available && !book.reserved_for_other)) && ($('#category-filter').value === 'all' || book.genre === $('#category-filter').value) && `${book.title} ${book.author}`.toLocaleLowerCase().includes(query)) :
    (view === 'saved' ? state.books.filter(book => state.favorites.includes(book.title)) : view === 'loans' ? state.loans : state.history).map(record => ({...state.books.find(book => book.title === record.title), ...record}));
  $('#result-count').textContent = `${books.length} ${books.length === 1 ? 'book' : 'books'}`;
  if (!catalogView && !state.user) {
    $('#content').innerHTML = empty('A shelf of your own.', 'Sign in or start a reader demo to borrow your first book.', '<button class="primary" id="empty-sign-in">Open a reader session ↗</button>');
    $('#empty-sign-in').onclick = () => { pendingBorrow = null; showAuth(); };
    return;
  }
  if (!books.length) {
    $('#content').innerHTML = catalogView ? empty('No stories found.', 'Try another title, author, or availability filter.') : view === 'saved' ? empty('A little something for another day.','Save titles with the heart button. Your next-read list will live here.','<button class="primary" id="browse-books">Discover the collection ↗</button>') : view === 'loans' ? empty('Your next story is waiting.', 'Choose a book from the collection and it will appear here.', '<button class="primary" id="browse-books">Browse the collection ↗</button>') : empty('Every reader starts somewhere.', 'Your returned books will appear here.');
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
    const details = view === 'loans' ? `<div class="loan-details">Borrowed ${escapeHtml(book.date)}<br><strong>Due ${escapeHtml(book.due)}</strong> · ${book.loan_days} days<br>Late fine: GHS ${book.fine}.00 · simulated</div>` : view === 'history' ? `<div class="loan-details">Returned ${escapeHtml(book.returned)}<br>Recorded fine: GHS ${book.fine_paid}.00 · simulated</div>` : '';
    return `<article class="book-card">${cover(book)}<div class="book-title-row"><h3>${escapeHtml(book.title)}</h3><button class="save-book" data-save="${index}" aria-label="${state.favorites.includes(book.title) ? 'Remove from reading list' : 'Save to reading list'}: ${escapeHtml(book.title)}" aria-pressed="${state.favorites.includes(book.title)}"><span data-icon="heart"></span></button></div><p class="book-author">${escapeHtml(book.author)}</p>${details}<div class="book-bottom"><span class="book-category">${escapeHtml(book.genre)}</span><button class="book-details-button" data-details="${index}">Book details <span data-icon="arrow"></span></button>${operation === 'status' ? `<span class="book-status">${label}</span>` : `<button class="borrow-button" data-book="${index}" data-operation="${operation}" aria-label="${escapeHtml(label.replace(/[↗+]/g,'').trim())}: ${escapeHtml(book.title)}">${label}</button>`}</div></article>`;
  }).join('');
  document.querySelectorAll('[data-save]').forEach(button => button.onclick = () => { const title = books[Number(button.dataset.save)].title; action(state.favorites.includes(title) ? '/api/unsave-book' : '/api/save-book',{title},button); });
  document.querySelectorAll('[data-details]').forEach(button => button.onclick = () => openBook(books[Number(button.dataset.details)].title,'details'));
  document.querySelectorAll('[data-book]').forEach(button => button.onclick = async () => {
    if (busy) return;
    const operation = button.dataset.operation;
    const title = books[Number(button.dataset.book)].title;
    if (operation === 'shelf') return navigate('loans');
    if (operation === 'circulation') return navigate('circulation');
    if (!state.user) { pendingBorrow = title; showAuth(); return; }
    openBook(title,operation);
  });
}

function circulationTable(loans, compact = false) {
  if (!loans.length) return empty('All stories are home.', 'Borrowed books will appear here with their reader and due date.');
  return `<div class="table-scroll"><table><thead><tr><th>Book / reader</th><th>Due date</th><th>Status</th>${compact ? '' : '<th>Action</th>'}</tr></thead><tbody>${loans.map((loan,index) => `<tr><td><strong>${escapeHtml(loan.title)}</strong><small>${escapeHtml(loan.reader)}</small></td><td>${escapeHtml(loan.due)}</td><td><span class="loan-badge ${loan.overdue ? 'late' : ''}">${loan.overdue ? 'Overdue' : 'On time'}</span><small>Fine GHS ${loan.fine}.00</small></td>${compact ? '' : `<td><button class="return-action" data-return="${index}">Process return ↗</button></td>`}</tr>`).join('')}</tbody></table></div>`;
}

function renderDesk() {
  $('#result-count').textContent = 'LIBRARIAN ACCESS';
  if (view === 'overview') {
    $('#content').innerHTML = `<div class="desk-intro librarian-hero"><div><span class="role-pill">YOUR COMMUNITY, CONNECTED</span><h3>Keep good stories moving.</h3><p>A thoughtful home for every title, every reader and every next chapter. Make room for a new voice, or bring a borrowed story back to the shelves.</p><div class="action-row"><button class="primary" data-jump="manage">Grow the collection <span data-icon="plus"></span></button><button class="secondary" data-jump="circulation">Open circulation <span data-icon="swap"></span></button></div></div><span class="librarian-motif" data-icon="books"></span></div><div class="stat-grid">${[[state.books.length,'Books in collection'],[desk.loans.length,'Books on loan'],[desk.readers,'Registered readers'],[desk.reservations.reduce((sum,item) => sum + item.readers.length,0),'Reservations']].map(([number,label]) => `<div class="stat-card"><span data-icon="${['book','swap','users','clock'][['Books in collection','Books on loan','Registered readers','Reservations'].indexOf(label)]}"></span><strong>${number}</strong><span>${label}</span></div>`).join('')}</div><div class="desk-heading"><h3>Out in the community</h3><button class="text-button" id="all-loans">Manage loans & returns ↗</button></div>${circulationTable(desk.loans,true)}<div class="desk-callout"><h3>Make room for another story.</h3><p>Add a title to the shared catalog. Readers will see it immediately.</p><button class="primary" id="manage-collection">Manage the collection +</button></div>`;
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
  const signedIn = Boolean(state.user);
  document.body.classList.toggle('entry-mode',!signedIn);
  document.body.classList.toggle('librarian-mode',isLibrarian());
  $('#entry').hidden = signedIn;
  $('#entry-demo').hidden = !state.demo || !Object.keys(state.demo_accounts || {}).length;
  if (!signedIn) return;
  $('#reading-strip').hidden = isLibrarian() || view !== 'catalog';
  $('#available-count').textContent = state.books.filter(book => book.available && !book.reserved_for_other).length;
  $('#shelf-count').textContent = state.loans.length;
  $('#queue-count').textContent = state.reservations.length;
  renderNavigation();
  $('#hero-greeting').textContent = 'GOOD TO SEE YOU, ' + state.user.username.toUpperCase() + '.';
  const chosenCategory = $('#category-filter').value;
  $('#category-filter').innerHTML = '<option value="all">Every category</option>' + [...new Set(state.books.map(book => book.genre))].map(genre => `<option value="${escapeHtml(genre)}">${escapeHtml(genre)}</option>`).join('');
  if ([...$('#category-filter').options].some(option => option.value === chosenCategory)) $('#category-filter').value = chosenCategory;
  const headings = {
    catalog:['THE SHELVES ARE OPEN','A story for every reader','The collection'],
    saved:['A LITTLE SOMETHING FOR LATER','Your next-read list','Reading list'],
    reservations:['A STORY WORTH WAITING FOR','Your place in the story','Reservations'],
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
  $('#content').className = ['catalog','manage','loans','saved','history'].includes(view) ? 'book-grid' : 'desk-content';
  $('#content').setAttribute('aria-busy','false');
  $('#explore').innerHTML = 'Find your next story <span data-icon="arrow"></span>';
  $('#demo-caption').textContent = state.user ? 'Your choice of loan duration. Your own reading space.' : state.demo ? 'Choose a reader or librarian. No signup needed.' : 'Create a reader account to borrow and reserve.';
  if (view === 'reservations') renderReservations(); else if (['overview','circulation','reports'].includes(view)) renderDesk(); else renderBooks();
  $('#reservations').hidden = true;
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
    AppUI.reveal('#content>.book-card,#content>.stat-grid');
    toast(result.message);
    return true;
  } catch (error) {
    if (error.status === 401 && !['/api/login','/api/register'].includes(path)) {
      pendingBorrow = path === '/api/borrow' ? data.title : null;
      await refresh();
      showAuth();
    }
    if ($('#book-dialog').open) $('#book-dialog-error').textContent = error.message;
    if ($('#auth-dialog').open) $('#auth-error').textContent = error.message;
    if (!state?.user) $('#entry-error').textContent = error.message;
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
  if (operation === 'borrow') { openBook(title,'borrow'); return; }
  const success = await action('/api/return',{title},button);
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
$('#category-filter').onchange = () => state && render();
$('#explore').onclick = () => {
  if (!state || busy) return;
  pendingBorrow = null;
  if (state.user) { $('#search').focus(); $('.collection').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'}); }
  else if (state.demo) $('#role-dialog').showModal();
  else showAuth('register');
};
$('#auth-toggle').onclick = () => showAuth(authMode === 'login' ? 'register' : 'login');
$('#entry-register').onclick = () => showAuth('register');
document.querySelectorAll('[data-fill-demo]').forEach(button => button.onclick = () => {
  const account = state?.demo_accounts?.[button.dataset.fillDemo];
  if (!account) return;
  $('#entry-username').value = account.username;
  $('#entry-password').value = account.password;
  $('#entry-error').textContent = '';
  $('#demo-credentials').textContent = `${button.dataset.fillDemo === 'reader' ? 'Reader' : 'Librarian'} demo selected. Click “Open my reading room” to sign in.`;
  $('#entry-submit').focus();
});
$('#entry-form').onsubmit = async event => {
  event.preventDefault(); $('#entry-error').textContent = '';
  if (await action('/api/login',Object.fromEntries(new FormData(event.target)),$('#entry-submit'))) {
    event.target.reset(); $('#demo-credentials').textContent = '';
    if (pendingBorrow && !isLibrarian()) await transactBook('borrow',pendingBorrow);
  }
};
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

function renderReservations() {
  $('#result-count').textContent = state.reservations.length + ' waiting lists';
  $('#content').innerHTML = state.reservations.length ? `<div class="reservation-intro"><span data-icon="calendar"></span><div><h3>Good stories are worth the wait.</h3><p>Your queue position updates as books return. When your turn arrives, choose your loan duration and borrow from the collection.</p></div></div><div class="reservation-grid">${state.reservations.map((item,index) => {const book=state.books.find(b=>b.title===item.title);return `<article class="reservation-card"><span class="pill ${book.available&&item.position===1?'good':''}">${book.available&&item.position===1?'Ready for you':'Queue position '+item.position}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(book.author)}</p><div class="progress-track"><div data-queue-width="${100/item.position}"></div></div><div class="action-row"><button class="primary" data-reservation-open="${index}">${book.available&&item.position===1?'Choose loan duration':'View book'} <span data-icon="arrow"></span></button><button class="text-action" data-cancel-reservation="${index}">Leave queue</button></div></article>`;}).join('')}</div>` : empty('Your next story might already be here.','Reserve an unavailable title from the collection. Your waiting list will appear in this section.','<button class="primary" id="reservation-browse">Discover the collection <span data-icon="arrow"></span></button>');
  document.querySelectorAll('[data-queue-width]').forEach(el=>el.style.width=el.dataset.queueWidth+'%');
  document.querySelectorAll('[data-reservation-open]').forEach(button=>button.onclick=()=>openBook(state.reservations[Number(button.dataset.reservationOpen)].title,'borrow'));
  document.querySelectorAll('[data-cancel-reservation]').forEach(button=>button.onclick=()=>action('/api/cancel-reservation',{title:state.reservations[Number(button.dataset.cancelReservation)].title},button));
  if($('#reservation-browse'))$('#reservation-browse').onclick=()=>navigate('catalog');
}

function openBook(title,intent='details') {
  const book=state.books.find(book=>book.title===title);
  if(!book)return;
  const loan=state.loans.find(loan=>loan.title===title),queued=state.reservations.find(item=>item.title===title);
  const prompt=['After a chapter, note one choice you would have made differently.','Choose a sentence that stays with you. What gives it its power?','Imagine discussing this story with a friend. What would you ask first?'][state.books.indexOf(book)%3];
  const details=book.description?`<p class="book-description">${escapeHtml(book.description)}</p>`:'';
  let controls;
  if(isLibrarian())controls='<div class="soft-note">You are viewing the librarian workspace. Manage active loans and returns in circulation.</div><button class="primary" id="dialog-circulation">Open circulation <span data-icon="arrow"></span></button>';
  else if(loan)controls=`<div class="loan-summary"><div><small>Your reading window</small><strong>${loan.loan_days} days</strong></div><div><small>Due back</small><strong>${loan.due}</strong></div><div><small>${loan.days_left<0?'Days overdue':'Days remaining'}</small><strong>${Math.abs(loan.days_left)}</strong></div></div><p class="panel-copy">${loan.can_renew?'Need another chapter? You can extend this on-time loan once by seven days.':loan.renewals?'This loan has already been renewed.':book.waiting?'Another reader is waiting for this title.':'Return overdue titles before renewing.'}</p><dl class="detail-list"><div><dt>Recorded late fine</dt><dd>GHS ${loan.fine}.00 · simulated</dd></div></dl><div class="action-row">${loan.can_renew?'<button class="secondary" id="dialog-renew"><span data-icon="calendar"></span>Extend by 7 days</button>':''}<button class="primary" id="dialog-return">${intent==='return'?'Confirm return':'Return this book'} <span data-icon="check"></span></button></div>`;
  else if(queued&&(!book.available||!book.reserved_for_me))controls=`<div class="soft-note">You are number <strong>${queued.position}</strong> in this title’s reservation queue. Choose your borrowing window once the book is ready for you.</div><button class="secondary" id="dialog-cancel-reservation">Leave this waiting list</button>`;
  else if(!book.available)controls=`<div class="soft-note">This title is out in the community. ${book.waiting} ${book.waiting===1?'reader is':'readers are'} already waiting. You’ll join in position ${book.waiting+1}.</div><button class="primary" id="dialog-reserve">Join the waiting list <span data-icon="calendar"></span></button>`;
  else if(book.reserved_for_other)controls='<div class="soft-note">This title is waiting for the next reader in its queue. Save it to your reading list and check back soon.</div>';
  else controls=`<form id="loan-form"><p class="eyebrow">MAKE A LITTLE TIME FOR THIS STORY</p><fieldset class="duration-options"><legend>How long would you like to borrow it?</legend>${[7,14,21,28].map(days=>`<label><input type="radio" name="loan_days" value="${days}" ${days===14?'checked':''}><span><strong>${days}</strong>days</span></label>`).join('')}</fieldset><div class="due-preview"><span data-icon="calendar"></span><div><small>Your return date</small><strong id="loan-due-preview"></strong></div><span id="loan-duration-preview" class="pill">14-day loan</span></div><p class="panel-copy">You have ${state.loans.length} of ${state.loan_limit} books on loan. Late returns accrue a simulated GHS 2 per day. One 7-day extension is available if no one is waiting.</p><button class="primary" type="submit" id="confirm-loan" ${state.loans.length>=state.loan_limit?'disabled':''}>Confirm borrowing <span data-icon="check"></span></button></form>`;
  $('#book-dialog-error').textContent='';
  $('#book-dialog-content').innerHTML=`<div class="book-detail-heading"><span class="book-detail-icon"><span data-icon="book"></span></span><div><span class="pill">${escapeHtml(book.genre)}</span><h2 id="book-dialog-title">${escapeHtml(book.title)}</h2><p>${escapeHtml(book.author)}${book.pages?' · '+book.pages+' pages':''}</p></div></div>${details}<div class="reading-prompt"><span data-icon="spark"></span><div><small>A COMMUNITY READING PROMPT</small><p>${prompt}</p></div></div>${controls}<div class="book-dialog-bottom"><span>One good story. A little time for yourself.</span><button class="text-action" id="dialog-save"><span data-icon="heart"></span>${state.favorites.includes(title)?'Remove from reading list':'Save for another day'}</button></div>`;
  $('#dialog-save').onclick=async()=>{if(await action(state.favorites.includes(title)?'/api/unsave-book':'/api/save-book',{title},$('#dialog-save')))openBook(title,intent);};
  if($('#loan-form')){
    const preview=()=>{const days=Number($('#loan-form input:checked').value),date=new Date();date.setDate(date.getDate()+days);$('#loan-due-preview').textContent=date.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'long',year:'numeric'});$('#loan-duration-preview').textContent=days+'-day loan';};
    $('#loan-form').onchange=preview;preview();
    $('#loan-form').onsubmit=async event=>{event.preventDefault();if(await action('/api/borrow',{title,loan_days:$('#loan-form input:checked').value},$('#confirm-loan'))){$('#book-dialog').close();pendingBorrow=null;navigate('loans');}};
  }
  if($('#dialog-reserve'))$('#dialog-reserve').onclick=async()=>{if(await action('/api/borrow',{title,loan_days:'7'},$('#dialog-reserve'))){$('#book-dialog').close();navigate('reservations');}};
  if($('#dialog-cancel-reservation'))$('#dialog-cancel-reservation').onclick=async()=>{if(await action('/api/cancel-reservation',{title},$('#dialog-cancel-reservation')))openBook(title);};
  if($('#dialog-renew'))$('#dialog-renew').onclick=async()=>{if(await action('/api/renew',{title},$('#dialog-renew')))openBook(title);};
  if($('#dialog-return'))$('#dialog-return').onclick=async()=>{if(await action('/api/return',{title},$('#dialog-return'))){$('#book-dialog').close();navigate('history');}};
  if($('#dialog-circulation'))$('#dialog-circulation').onclick=()=>{$('#book-dialog').close();navigate('circulation');};
  if(!$('#book-dialog').open)$('#book-dialog').showModal();
  AppUI.hydrate();
}
$('#close-book-dialog').onclick=()=>$('#book-dialog').close();

document.addEventListener('click',event=>{const button=event.target.closest('[data-jump]');if(button)navigate(button.dataset.jump);});
