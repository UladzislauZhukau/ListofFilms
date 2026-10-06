/* ListOfFilms — клиент. Без фреймворков: hash-роутер + fetch + шаблоны строк. */

const STATUS_LABELS = {
  watched: 'Просмотрено',
  watching: 'Смотрю',
  watchlist: 'Буду смотреть',
  dropped: 'Брошено',
};

const TYPE_LABELS = { movie: 'Фильм', tv: 'Сериал' };

const state = {
  user: null,
  authMode: 'login',
  library: { entries: [], counts: {} },
  filters: { status: 'all', type: 'all', genre: '', sort: 'added', q: '', favorite: false },
  searchResults: [],
};

/* ------------------------------- утилиты ----------------------------- */

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function show(element, visible) {
  element?.classList.toggle('hidden', !visible);
}

let toastTimer = null;
function toast(message, kind = 'ok') {
  const node = $('#toast');
  node.textContent = message;
  node.className = `toast toast--${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.add('hidden'), 3200);
}

function plural(count, one, few, many) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/* --------------------------------- API ------------------------------- */

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    method: options.method || 'GET',
    headers: options.body ? { 'content-type': 'application/json' } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error(payload?.error || `Ошибка ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

/* --------------------------------- вход ------------------------------ */

function setAuthMode(mode) {
  state.authMode = mode;
  $$('[data-auth-tab]').forEach((tab) =>
    tab.classList.toggle('is-active', tab.dataset.authTab === mode)
  );
  $('#auth-submit').textContent = mode === 'login' ? 'Войти' : 'Создать профиль';
  show($('#auth-confirm-field'), mode === 'register');
  $('#auth-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  show($('#auth-error'), false);
}

async function submitAuth(event) {
  event.preventDefault();
  const username = $('#auth-username').value.trim();
  const password = $('#auth-password').value;
  const confirm = $('#auth-confirm').value;
  const errorNode = $('#auth-error');

  const fail = (message) => {
    errorNode.textContent = message;
    show(errorNode, true);
  };

  if (state.authMode === 'register' && password !== confirm) {
    return fail('Пароли не совпадают');
  }

  const button = $('#auth-submit');
  button.disabled = true;
  try {
    const path = state.authMode === 'login' ? '/auth/login' : '/auth/register';
    const { user } = await api(path, { method: 'POST', body: { username, password } });
    state.user = user;
    $('#auth-form').reset();
    show(errorNode, false);
    await enterApp();
    toast(state.authMode === 'login' ? `С возвращением, ${user.username}!` : 'Профиль создан 🎬');
  } catch (error) {
    fail(error.message);
  } finally {
    button.disabled = false;
  }
}

async function logout() {
  await api('/auth/logout', { method: 'POST' });
  state.user = null;
  state.library = { entries: [], counts: {} };
  show($('#app-view'), false);
  show($('#auth-view'), true);
  location.hash = '#/library';
}

/* ------------------------------ библиотека --------------------------- */

function statusBadge(status) {
  return `<span class="badge badge--${status}">${STATUS_LABELS[status] || status}</span>`;
}

function posterMarkup(item) {
  if (item.posterUrl) {
    return `<img src="${escapeHtml(item.posterUrl)}" alt="${escapeHtml(item.title)}" loading="lazy" />`;
  }
  return `<div class="card__noposter">${escapeHtml(item.title)}</div>`;
}

// Оценка прямо на карточке, чтобы проставлять её подряд, не открывая
// каждый фильм. Для «Буду смотреть» оценивать ещё нечего.
function rateControl(entry) {
  return `<label class="card__rate">
    <span>Оценка</span>
    <select class="card__rate-select" data-rate-entry="${entry.id}" aria-label="Оценка «${escapeHtml(entry.title)}»">
      ${ratingOptions(entry.rating, '—')}
    </select>
  </label>`;
}

async function rateFromCard(select) {
  const id = Number(select.dataset.rateEntry);
  const entry = state.library.entries.find((item) => item.id === id);
  const rating = select.value ? Number(select.value) : null;
  const previous = entry?.rating ?? null;
  select.disabled = true;

  try {
    const { entry: saved } = await api(`/entries/${id}`, { method: 'PATCH', body: { rating } });
    if (entry) entry.rating = saved.rating;

    // Меняем только бейдж на постере: полная перерисовка сбила бы
    // прокрутку и порядок, пока человек идёт по списку.
    const poster = select.closest('.card').querySelector('.card__poster');
    poster.querySelector('.card__score')?.remove();
    if (saved.rating) poster.insertAdjacentHTML('beforeend', `<div class="card__score">${saved.rating}</div>`);
  } catch (error) {
    select.value = previous ?? '';
    toast(error.message, 'error');
  } finally {
    select.disabled = false;
  }
}

function entryCard(entry, { editable = false } = {}) {
  const meta = [entry.year, TYPE_LABELS[entry.mediaType]].filter(Boolean).join(' · ');
  return `
    <article class="card" data-entry-id="${entry.id}">
      <div class="card__poster">
        ${posterMarkup(entry)}
        <div class="card__badges">
          ${statusBadge(entry.status)}
          ${entry.favorite ? '<span class="badge badge--star">★</span>' : ''}
        </div>
        ${entry.rating ? `<div class="card__score">${entry.rating}</div>` : ''}
      </div>
      <div class="card__body">
        <div class="card__title">${escapeHtml(entry.title)}</div>
        <div class="card__meta">${escapeHtml(meta)}</div>
        ${editable && entry.status !== 'watchlist' ? rateControl(entry) : ''}
      </div>
    </article>`;
}

function renderStatusTabs() {
  const counts = state.library.counts || {};
  const tabs = [['all', 'Все'], ...Object.entries(STATUS_LABELS)];
  $('#status-tabs').innerHTML = tabs
    .map(([value, label]) => {
      const active = state.filters.status === value ? ' is-active' : '';
      const count = counts[value] ?? 0;
      return `<button class="tab${active}" data-status="${value}" type="button">
        ${label}<span class="tab__count">${count}</span>
      </button>`;
    })
    .join('');
}

// Перерисовывает список жанров, не теряя выбранный: даже если после смены
// других фильтров он перестал встречаться, пункт остаётся, иначе выбор
// молча сбросился бы и показал не то, что просили.
function renderGenreOptions(genres) {
  const select = $('#library-genre');
  const chosen = state.filters.genre;
  const options = ['<option value="">Все жанры</option>'];

  for (const genre of genres) {
    const selected = genre.value === chosen ? ' selected' : '';
    options.push(
      `<option value="${escapeHtml(genre.value)}"${selected}>${escapeHtml(genre.label)} (${genre.count})</option>`
    );
  }

  if (chosen && !genres.some((genre) => genre.value === chosen)) {
    options.push(`<option value="${escapeHtml(chosen)}" selected>${escapeHtml(chosen)} (0)</option>`);
  }

  select.innerHTML = options.join('');
}

async function loadLibrary() {
  const { status, type, genre, sort, q, favorite } = state.filters;
  const params = new URLSearchParams({ status, type, sort });
  if (q) params.set('q', q);
  if (genre) params.set('genre', genre);
  if (favorite) params.set('favorite', 'true');

  state.library = await api(`/entries?${params}`);
  renderStatusTabs();
  renderGenreOptions(state.library.genres || []);

  const grid = $('#library-grid');
  const empty = $('#library-empty');
  const list = state.library.entries;

  grid.innerHTML = list.map((entry) => entryCard(entry, { editable: true })).join('');
  show(grid, list.length > 0);
  show(empty, list.length === 0);

  if (!list.length) {
    empty.innerHTML = state.library.counts.all
      ? 'Под эти фильтры ничего не подошло.'
      : 'Список пуст. Откройте <a href="#/search">поиск</a> и добавьте первый фильм.';
  }
}

/* -------------------------------- поиск ------------------------------ */

function searchCard(item) {
  const meta = [item.year, TYPE_LABELS[item.mediaType], item.source === 'tmdb' ? 'TMDB' : 'OMDb']
    .filter(Boolean)
    .join(' · ');
  const label = item.inList ? `В списке: ${STATUS_LABELS[item.savedStatus] ?? ''}` : 'Добавить ▾';

  return `
    <article class="card" data-ref="${escapeHtml(item.ref)}">
      <div class="card__poster">
        ${posterMarkup(item)}
        ${item.inList ? '<div class="card__badges"><span class="badge badge--watched">✓ в списке</span></div>' : ''}
      </div>
      <div class="card__body">
        <div class="card__title">${escapeHtml(item.title)}</div>
        <div class="card__meta">${escapeHtml(meta)}</div>
      </div>
      <button class="btn btn--sm card__action ${item.inList ? '' : 'btn--primary'}" type="button"
        data-quick-add="${escapeHtml(item.ref)}"
        data-current-status="${escapeHtml(item.savedStatus ?? '')}"
        aria-haspopup="menu">
        ${escapeHtml(label)}
      </button>
    </article>`;
}

// Номер последнего запроса: ответы на устаревшие запросы (пользователь уже
// допечатал дальше) отбрасываются, чтобы не перетереть свежую выдачу.
let searchSeq = 0;

async function runSearch(event) {
  event?.preventDefault();
  closeAddMenu();
  const seq = ++searchSeq;
  const query = $('#search-input').value.trim();
  const type = $('#search-type').value;
  const grid = $('#search-grid');
  const empty = $('#search-empty');

  if (query.length < 2) {
    grid.innerHTML = '';
    show(grid, false);
    show(empty, true);
    empty.textContent = 'Введите хотя бы два символа.';
    return;
  }

  // Пока идёт запрос, прежняя выдача остаётся на экране — так при наборе
  // текста не мигает заглушка «Ищем…».
  if (grid.classList.contains('hidden') || !grid.children.length) {
    empty.textContent = 'Ищем…';
    show(empty, true);
  }

  try {
    const data = await api(`/search?q=${encodeURIComponent(query)}&type=${type}`);
    if (seq !== searchSeq) return;
    state.searchResults = data.results;

    const broken = Object.entries(data.providers || {})
      .filter(([, value]) => value === 'error')
      .map(([name]) => name.toUpperCase());
    $('#provider-status').textContent = broken.length
      ? `${broken.join(', ')} сейчас недоступен`
      : '';

    grid.innerHTML = data.results.map(searchCard).join('');
    show(grid, data.results.length > 0);
    show(empty, data.results.length === 0);
    if (!data.results.length) empty.textContent = `По запросу «${query}» ничего не нашлось.`;
  } catch (error) {
    if (seq !== searchSeq) return;
    show(grid, false);
    show(empty, true);
    empty.textContent = error.message;
  }
}

/* --------------------- меню выбора раздела ---------------------------- */

// Кнопка на карточке не добавляет сразу, а открывает меню: раздел выбирается
// для каждого фильма отдельно, в момент добавления.
let addMenuTarget = null;

function closeAddMenu() {
  show($('#add-menu'), false);
  addMenuTarget = null;
}

function addMenuMarkup(currentStatus) {
  const title = currentStatus ? 'Перенести в раздел' : 'Добавить в раздел';
  const items = Object.entries(STATUS_LABELS).map(([value, label]) => {
    const isCurrent = value === currentStatus;
    return `<button class="menu__item${isCurrent ? ' is-current' : ''}" type="button"
      role="menuitem" data-add-status="${value}">
      <span>${label}</span>${isCurrent ? '<span>✓</span>' : ''}
    </button>`;
  });
  return `<div class="menu__title">${title}</div>${items.join('')}`;
}

// Меню с position: fixed, поэтому считаем от координат вьюпорта и
// прижимаем к краям, чтобы на узком экране оно не уехало за границу.
function placeAddMenu(menu, button) {
  const anchor = button.getBoundingClientRect();
  menu.style.visibility = 'hidden';
  show(menu, true);

  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - menu.offsetWidth - 8));
  const below = anchor.bottom + 6;
  const fitsBelow = below + menu.offsetHeight <= window.innerHeight - 8;
  const top = fitsBelow ? below : Math.max(8, anchor.top - menu.offsetHeight - 6);

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.visibility = '';
}

function openAddMenu(button) {
  const menu = $('#add-menu');
  menu.innerHTML = addMenuMarkup(button.dataset.currentStatus || null);
  addMenuTarget = { ref: button.dataset.quickAdd, button };
  placeAddMenu(menu, button);
}

async function quickAdd(ref, button, status) {
  button.disabled = true;
  try {
    const { entry, updated } = await api('/entries', {
      method: 'POST',
      body: { ref, status },
    });
    button.dataset.currentStatus = entry.status;
    toast(
      updated
        ? `«${entry.title}» перенесён: ${STATUS_LABELS[entry.status].toLowerCase()}`
        : `«${entry.title}» добавлен: ${STATUS_LABELS[entry.status].toLowerCase()}`
    );
    button.classList.remove('btn--primary');
    button.textContent = `В списке: ${STATUS_LABELS[entry.status]}`;
    // Метку перерисовываем целиком: при переносе между разделами у неё
    // меняется цвет, а не только факт присутствия в списке.
    const card = button.closest('.card');
    const badge = `<div class="card__badges"><span class="badge badge--${entry.status}">✓ ${STATUS_LABELS[entry.status]}</span></div>`;
    const existing = card?.querySelector('.card__badges');
    if (existing) existing.outerHTML = badge;
    else card?.querySelector('.card__poster').insertAdjacentHTML('beforeend', badge);
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

/* -------------------------------- модалка ---------------------------- */

function closeModal() {
  show($('#modal'), false);
  $('#modal-content').innerHTML = '';
}

function openModal(html) {
  $('#modal-content').innerHTML = html;
  show($('#modal'), true);
}

function ratingOptions(selected, emptyLabel = 'без оценки') {
  const options = [`<option value="">${emptyLabel}</option>`];
  for (let value = 10; value >= 1; value -= 1) {
    options.push(`<option value="${value}"${selected === value ? ' selected' : ''}>${value}</option>`);
  }
  return options.join('');
}

function statusOptions(selected) {
  return Object.entries(STATUS_LABELS)
    .map(([value, label]) => `<option value="${value}"${selected === value ? ' selected' : ''}>${label}</option>`)
    .join('');
}

function detailMarkup(title, entry) {
  const facts = [];
  if (title.genres?.length) facts.push(['Жанры', title.genres.join(', ')]);
  if (title.runtime) facts.push(['Длительность', `${title.runtime} мин`]);
  if (title.seasons) facts.push(['Сезонов', title.seasons]);
  if (title.director) facts.push(['Режиссёр', title.director]);
  if (title.actors) facts.push(['В ролях', title.actors]);
  if (title.imdbRating) facts.push(['Рейтинг IMDb', title.imdbRating]);
  if (title.tmdbRating) facts.push(['Рейтинг TMDB', title.tmdbRating]);

  const sub = [title.year, TYPE_LABELS[title.mediaType], title.originalTitle]
    .filter(Boolean)
    .join(' · ');

  return `
    <div class="detail" data-ref="${escapeHtml(title.ref)}" data-entry-id="${entry?.id ?? ''}">
      <div>
        ${
          title.posterUrl
            ? `<img class="detail__poster" src="${escapeHtml(title.posterUrl)}" alt="" />`
            : '<div class="detail__poster card__noposter" style="aspect-ratio:2/3">нет постера</div>'
        }
      </div>
      <div>
        <h3 id="modal-title">${escapeHtml(title.title)}</h3>
        <p class="detail__sub">${escapeHtml(sub)}</p>
        ${title.overview ? `<p class="detail__overview">${escapeHtml(title.overview)}</p>` : ''}
        <div class="detail__facts">
          ${facts.map(([key, value]) => `<div>${escapeHtml(key)}: <b>${escapeHtml(value)}</b></div>`).join('')}
        </div>

        <div class="formrow">
          <label class="field">
            <span>Статус</span>
            <select class="input" id="detail-status">${statusOptions(entry?.status || 'watched')}</select>
          </label>
          <label class="field">
            <span>Оценка</span>
            <select class="input" id="detail-rating">${ratingOptions(entry?.rating ?? null)}</select>
          </label>
          <label class="field">
            <span>Дата просмотра</span>
            <input class="input" id="detail-date" type="date" value="${escapeHtml(entry?.watchedOn ?? '')}" />
          </label>
        </div>

        <label class="field">
          <span>Заметка</span>
          <textarea class="input" id="detail-review" rows="3" maxlength="2000"
            placeholder="Впечатления, с кем смотрели, стоит ли пересматривать…">${escapeHtml(entry?.review ?? '')}</textarea>
        </label>

        <div class="detail__actions">
          <button class="btn btn--primary" id="detail-save" type="button">
            ${entry ? 'Сохранить' : 'Добавить в список'}
          </button>
          <button class="chip" id="detail-fav" type="button" aria-pressed="${Boolean(entry?.favorite)}">
            ★ Избранное
          </button>
          ${entry ? '<button class="btn btn--danger" id="detail-delete" type="button">Удалить</button>' : ''}
          ${
            title.imdbId
              ? `<a class="btn btn--ghost" href="https://www.imdb.com/title/${escapeHtml(title.imdbId)}/" target="_blank" rel="noopener">IMDb ↗</a>`
              : ''
          }
        </div>
      </div>
    </div>`;
}

async function openDetail(ref) {
  openModal('<p style="padding:30px;text-align:center;color:var(--text-dim)">Загрузка…</p>');
  try {
    const { title, entry } = await api(`/search/title/${encodeURIComponent(ref)}`);
    openModal(detailMarkup(title, entry));
    wireDetail(title, entry);
  } catch (error) {
    openModal(`<p class="form-error">${escapeHtml(error.message)}</p>`);
  }
}

function wireDetail(title, entry) {
  const favButton = $('#detail-fav');
  let favorite = Boolean(entry?.favorite);

  favButton.addEventListener('click', () => {
    favorite = !favorite;
    favButton.setAttribute('aria-pressed', String(favorite));
  });

  $('#detail-save').addEventListener('click', async () => {
    const body = {
      ref: title.ref,
      status: $('#detail-status').value,
      rating: $('#detail-rating').value ? Number($('#detail-rating').value) : null,
      review: $('#detail-review').value,
      watchedOn: $('#detail-date').value || null,
      favorite,
    };

    try {
      if (entry) {
        await api(`/entries/${entry.id}`, { method: 'PATCH', body });
      } else {
        await api('/entries', { method: 'POST', body });
      }
      closeModal();
      toast(entry ? 'Изменения сохранены' : `«${title.title}» добавлен`);
      await refreshCurrentView();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  $('#detail-delete')?.addEventListener('click', async () => {
    if (!confirm(`Удалить «${title.title}» из списка?`)) return;
    try {
      await api(`/entries/${entry.id}`, { method: 'DELETE' });
      closeModal();
      toast('Запись удалена');
      await refreshCurrentView();
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

/* ------------------------------ статистика --------------------------- */

function tile(value, label) {
  return `<div class="tile"><div class="tile__value">${escapeHtml(value)}</div><div class="tile__label">${escapeHtml(label)}</div></div>`;
}

function barList(items, labelKey, valueKey) {
  if (!items.length) return '<p class="panel__hint">Пока нет данных.</p>';
  const max = Math.max(...items.map((item) => item[valueKey]));
  return `<div class="bars">${items
    .map((item) => {
      const width = max ? Math.round((item[valueKey] / max) * 100) : 0;
      return `<div class="bar">
        <div class="bar__label">${escapeHtml(item[labelKey])}</div>
        <div class="bar__track"><div class="bar__fill" style="width:${width}%"></div></div>
        <div class="bar__value">${item[valueKey]}</div>
      </div>`;
    })
    .join('')}</div>`;
}

function statsMarkup(stats) {
  const hoursLabel = plural(stats.hours, 'час', 'часа', 'часов');
  return `
    <div class="tiles">
      ${tile(stats.byStatus.watched, 'просмотрено')}
      ${tile(stats.movies, plural(stats.movies, 'фильм', 'фильма', 'фильмов'))}
      ${tile(stats.series, plural(stats.series, 'сериал', 'сериала', 'сериалов'))}
      ${tile(stats.averageRating ?? '—', 'средняя оценка')}
      ${tile(`${stats.hours} ${hoursLabel}`, `это ${stats.days} ${plural(Math.round(stats.days), 'день', 'дня', 'дней')}`)}
      ${tile(stats.byStatus.watchlist, 'в планах')}
    </div>

    <div class="panels">
      <section class="panel">
        <h3>Любимые жанры</h3>
        ${barList(stats.topGenres, 'genre', 'count')}
      </section>
      <section class="panel">
        <h3>Распределение оценок</h3>
        ${barList(
          stats.ratingSpread.filter((item) => item.count > 0).map((item) => ({ label: `${item.rating} из 10`, count: item.count })),
          'label',
          'count'
        )}
      </section>
      <section class="panel">
        <h3>По десятилетиям</h3>
        ${barList(stats.decades.map((item) => ({ label: `${item.decade}-е`, count: item.count })), 'label', 'count')}
      </section>
      <section class="panel">
        <h3>Лучшие оценки</h3>
        ${
          stats.bestRated.length
            ? `<div class="bars">${stats.bestRated
                .map(
                  (entry) =>
                    `<div class="bar"><div class="bar__label" style="grid-column:1/3">${escapeHtml(entry.title)}</div><div class="bar__value">${entry.rating}</div></div>`
                )
                .join('')}</div>`
            : '<p class="panel__hint">Поставьте оценки, чтобы увидеть топ.</p>'
        }
      </section>
    </div>`;
}

async function loadStats() {
  const { stats } = await api('/profile/stats');
  $('#stats-body').innerHTML = statsMarkup(stats);
}

/* -------------------------------- профиль ---------------------------- */

function fillProfileForm() {
  $('#profile-display').value = state.user.displayName ?? '';
  $('#profile-bio').value = state.user.bio ?? '';
  const link = $('#public-link');
  const url = `${location.origin}/u/${encodeURIComponent(state.user.username)}`;
  link.href = url;
  link.textContent = url;
}

async function loadPublicProfile(username) {
  const body = $('#public-body');
  body.innerHTML = '<div class="empty">Загрузка профиля…</div>';

  try {
    const data = await api(`/profile/public/${encodeURIComponent(username)}`);
    const title = data.user.displayName || data.user.username;
    body.innerHTML = `
      <div class="view__head">
        <div>
          <h2>${escapeHtml(title)}</h2>
          <p class="provider-status">@${escapeHtml(data.user.username)} · на сайте с ${new Date(data.user.createdAt).toLocaleDateString('ru-RU')}</p>
        </div>
        ${state.user ? '<a class="btn btn--sm" href="#/library">К своей библиотеке</a>' : ''}
      </div>
      ${data.user.bio ? `<p class="detail__overview">${escapeHtml(data.user.bio)}</p>` : ''}
      <div class="tiles">
        ${tile(data.stats.byStatus.watched, 'просмотрено')}
        ${tile(data.stats.averageRating ?? '—', 'средняя оценка')}
        ${tile(data.stats.hours, plural(data.stats.hours, 'час', 'часа', 'часов'))}
        ${tile(data.stats.favorites, 'в избранном')}
      </div>
      ${
        data.entries.length
          ? `<div class="grid">${data.entries.map(entryCard).join('')}</div>`
          : '<div class="empty">Пока ничего не отмечено.</div>'
      }`;
  } catch (error) {
    body.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

/* -------------------------------- роутер ----------------------------- */

const VIEWS = ['library', 'search', 'stats', 'profile', 'public'];

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, '') || 'library';
  const [first, second] = hash.split('/');
  if (first === 'u' && second) return { name: 'public', param: decodeURIComponent(second) };
  return { name: VIEWS.includes(first) ? first : 'library', param: null };
}

async function refreshCurrentView() {
  const route = currentRoute();
  if (route.name === 'library') await loadLibrary();
  if (route.name === 'stats') await loadStats();
}

async function renderRoute() {
  const route = currentRoute();

  if (!state.user && route.name !== 'public') {
    show($('#app-view'), false);
    show($('#auth-view'), true);
    return;
  }

  show($('#auth-view'), false);
  show($('#app-view'), true);

  VIEWS.forEach((name) => show($(`#view-${name}`), name === route.name));
  $$('#main-nav .navlink').forEach((link) =>
    link.classList.toggle('is-active', link.getAttribute('href') === `#/${route.name}`)
  );

  try {
    if (route.name === 'library') await loadLibrary();
    if (route.name === 'stats') await loadStats();
    if (route.name === 'profile') fillProfileForm();
    if (route.name === 'public') await loadPublicProfile(route.param);
    if (route.name === 'search') $('#search-input').focus();
  } catch (error) {
    if (error.status === 401) {
      state.user = null;
      await renderRoute();
    } else {
      toast(error.message, 'error');
    }
  }
}

async function enterApp() {
  $('#current-user').textContent = `@${state.user.username}`;
  await renderRoute();
}

/* ------------------------------ обработчики -------------------------- */

function wireEvents() {
  $$('[data-auth-tab]').forEach((tab) =>
    tab.addEventListener('click', () => setAuthMode(tab.dataset.authTab))
  );
  $('#auth-form').addEventListener('submit', submitAuth);
  $('#logout-btn').addEventListener('click', logout);

  // фильтры библиотеки
  $('#status-tabs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-status]');
    if (!button) return;
    state.filters.status = button.dataset.status;
    loadLibrary().catch((error) => toast(error.message, 'error'));
  });

  let searchDebounce = null;
  $('#library-search').addEventListener('input', (event) => {
    state.filters.q = event.target.value;
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => loadLibrary().catch(() => {}), 220);
  });

  $('#library-type').addEventListener('change', (event) => {
    state.filters.type = event.target.value;
    loadLibrary().catch((error) => toast(error.message, 'error'));
  });

  $('#library-genre').addEventListener('change', (event) => {
    state.filters.genre = event.target.value;
    loadLibrary().catch((error) => toast(error.message, 'error'));
  });

  $('#library-sort').addEventListener('change', (event) => {
    state.filters.sort = event.target.value;
    loadLibrary().catch((error) => toast(error.message, 'error'));
  });

  $('#library-fav').addEventListener('click', (event) => {
    state.filters.favorite = !state.filters.favorite;
    event.currentTarget.setAttribute('aria-pressed', String(state.filters.favorite));
    loadLibrary().catch((error) => toast(error.message, 'error'));
  });

  // карточки: клик по карточке открывает детали
  document.addEventListener('click', (event) => {
    const choice = event.target.closest('[data-add-status]');
    if (choice) {
      event.stopPropagation();
      const target = addMenuTarget;
      closeAddMenu();
      if (target) quickAdd(target.ref, target.button, choice.dataset.addStatus);
      return;
    }

    if (event.target.closest('#add-menu')) return;
    if (event.target.closest('.card__rate')) return;

    const quick = event.target.closest('[data-quick-add]');
    if (quick) {
      event.stopPropagation();
      // Повторный клик по той же кнопке закрывает меню.
      if (addMenuTarget?.button === quick) closeAddMenu();
      else openAddMenu(quick);
      return;
    }

    closeAddMenu();

    const card = event.target.closest('.card');
    if (!card) return;

    if (card.dataset.ref) return openDetail(card.dataset.ref);
    if (card.dataset.entryId) {
      const entry =
        state.library.entries.find((item) => String(item.id) === card.dataset.entryId) ||
        null;
      if (entry) openDetail(entry.ref);
    }
  });

  $('#library-grid').addEventListener('change', (event) => {
    const select = event.target.closest('[data-rate-entry]');
    if (select) rateFromCard(select);
  });

  // поиск
  let liveSearchDebounce = null;
  $('#search-form').addEventListener('submit', (event) => {
    clearTimeout(liveSearchDebounce);
    runSearch(event);
  });
  $('#search-input').addEventListener('input', () => {
    clearTimeout(liveSearchDebounce);
    liveSearchDebounce = setTimeout(() => runSearch(), 350);
  });
  $('#search-type').addEventListener('change', () => runSearch());

  // Меню привязано к координатам кнопки, поэтому при прокрутке и смене
  // размеров окна проще закрыть его, чем пересчитывать позицию.
  window.addEventListener('resize', closeAddMenu);
  window.addEventListener('scroll', closeAddMenu, true);

  // модалка
  $$('[data-close-modal]').forEach((node) => node.addEventListener('click', closeModal));
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (addMenuTarget) closeAddMenu();
    else closeModal();
  });

  // профиль
  $('#profile-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const { user } = await api('/profile/me', {
        method: 'PATCH',
        body: { displayName: $('#profile-display').value, bio: $('#profile-bio').value },
      });
      state.user = user;
      toast('Профиль сохранён');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  $('#password-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/profile/password', {
        method: 'POST',
        body: {
          currentPassword: $('#password-current').value,
          newPassword: $('#password-new').value,
        },
      });
      event.target.reset();
      toast('Пароль обновлён');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  $('#delete-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!confirm('Удалить аккаунт и весь список без возможности восстановления?')) return;
    try {
      await api('/auth/account', {
        method: 'DELETE',
        body: { password: $('#delete-password').value },
      });
      state.user = null;
      location.hash = '#/library';
      show($('#app-view'), false);
      show($('#auth-view'), true);
      toast('Аккаунт удалён');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  window.addEventListener('hashchange', () => renderRoute());
}

/* --------------------------------- старт ----------------------------- */

async function boot() {
  wireEvents();
  setAuthMode('login');


  // Красивые ссылки /u/<ник> переводим в hash-маршрут.
  const prettyProfile = location.pathname.match(/^\/u\/(.+)$/);
  if (prettyProfile) {
    history.replaceState(null, '', '/');
    location.hash = `#/u/${prettyProfile[1]}`;
  }

  try {
    const { user } = await api('/auth/me');
    state.user = user;
  } catch {
    state.user = null;
  }

  show($('#boot'), false);
  if (state.user) {
    await enterApp();
  } else {
    await renderRoute();
  }
}

boot();
