// scripts/profile.js
// Profile page: shows any user's profile (?uid=...) and lets the owner edit their own.
//
// Data: users/<uid> -> { nickname, minecraftName, bio, photoURL, profileColor, verified }
// Pictures: Storage at profiles/<uid>/avatar_<timestamp>.png

import * as skinview3d from 'https://cdn.jsdelivr.net/npm/skinview3d@3.4.2/+esm';

/* ==========================================================================
   1. CONFIGURATION
   ========================================================================== */
const BIO_MAX_LENGTH = 300;                       // keep in sync with the Firestore rules
const NICKNAME_MIN_LENGTH = 2;
const NICKNAME_MAX_LENGTH = 30;
const MC_NAME_PATTERN = /^[A-Za-z0-9_-]{3,16}$/;  // valid Minecraft usernames
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;        // profile colors are stored as #rrggbb
const AVATAR_SIZE = 256;                          // pictures are cropped to AVATAR_SIZE x AVATAR_SIZE px

const ANECDOTE_PREVIEW_COUNT = 6;  // thumbnails in the profile window; more -> "show all" button
const ARTICLE_PREVIEW_COUNT = 5;   // article rows shown while packed; more -> expandable
const MAX_PROFILE_COMMENTS = 20;   // only the newest N comments are shown

// Texts you may want to rewrite
const TEXT_NO_BIO = 'Zatím žádné bio.';
const TEXT_NO_COMMENTS = 'Tento uživatel zatím nenapsal žádné komentáře.';
const TEXT_COMMENTS_LOADING = 'Načítám komentáře...';
const TEXT_COMMENTS_ERROR = 'Komentáře se nepodařilo načíst.';

// Colors offered in the editor (the "default" swatch is added automatically)
const PROFILE_COLORS = [
    { name: 'Červená',   value: '#d94040' },
    { name: 'Oranžová',  value: '#e08a1e' },
    { name: 'Zelená',    value: '#2e9e55' },
    { name: 'Tyrkysová', value: '#1f9d9d' },
    { name: 'Fialová',   value: '#8a4fd6' },
    { name: 'Růžová',    value: '#d6489a' },
    { name: 'Hnědá',     value: '#8b5a2b' },
    { name: 'Šedá',      value: '#6b7280' }
];
const DEFAULT_CUSTOM_COLOR = '#0066cc';

const POST_PLACEHOLDER_IMAGE = 'https://picsum.photos/100/100';

const AVATAR_PLACEHOLDER_SVG = `
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5z"/>
    </svg>
`;

/* ==========================================================================
   2. STATE & SMALL HELPERS
   ========================================================================== */
let profileState = {
    uid: null,            // whose profile is shown
    isOwner: false,
    profile: {},          // { nickname, minecraftName, bio, photoURL, profileColor, verified }
    pendingAvatar: null,  // { blob, previewUrl } chosen in the form but not saved yet
    removeAvatar: false,
    editColor: ''         // color currently picked in the editor ('' = default)
};

let loadedArticles = [];
let loadedAnecdotes = [];
let articlesExpanded = false;

const byId = (id) => document.getElementById(id);

// Which of the three main blocks is visible
function showOnly(section) {
    byId('profileLoading').style.display = section === 'loading' ? 'flex' : 'none';
    byId('profileMessage').style.display = section === 'message' ? 'block' : 'none';
    byId('profilePage').style.display = section === 'page' ? 'block' : 'none';
}

function showMessage(text) {
    const box = byId('profileMessage');
    box.innerHTML = '';

    const link = document.createElement('a');
    link.href = 'index.html';
    link.textContent = 'Zpět na hlavní stranu';

    box.append(document.createTextNode(text), document.createElement('br'), link);
    showOnly('message');
}

let statusTimer = null;
function showStatus(text) {
    const box = byId('profileStatus');
    box.textContent = text;
    box.style.display = 'block';
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { box.style.display = 'none'; }, 3500);
}

function formatPostDate(timestamp) {
    return timestamp ? timestamp.toDate().toLocaleDateString('cs-CZ') : '';
}

function formatPostDateTime(timestamp) {
    return timestamp
        ? timestamp.toDate().toLocaleString('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' })
        : '';
}

const postMillis = (timestamp) => timestamp ? timestamp.toMillis() : 0;

function sortPostsNewestFirst(docs) {
    return [...docs].sort((a, b) => postMillis(b.data().date) - postMillis(a.data().date));
}

// Profile picture, or the placeholder silhouette when there is none (or it fails to load)
function renderAvatar(container, url) {
    container.innerHTML = '';

    if (!url) {
        container.innerHTML = AVATAR_PLACEHOLDER_SVG;
        return;
    }

    const img = document.createElement('img');
    img.src = url;
    img.alt = 'Profilový obrázek';
    img.addEventListener('error', () => { container.innerHTML = AVATAR_PLACEHOLDER_SVG; });
    container.appendChild(img);
}

// Image, or a muted first-frame preview for videos
function createThumbElement(media, className) {
    let el;
    if (media.type === 'video') {
        el = document.createElement('video');
        el.src = media.url + '#t=0.1';
        el.muted = true;
        el.preload = 'metadata';
        el.playsInline = true;
    } else {
        el = document.createElement('img');
        el.src = media.url;
        el.alt = '';
        el.loading = 'lazy';
    }
    el.className = className;
    return el;
}

// Best-effort delete of an old picture in Storage (never throws)
async function deleteOldAvatar(url) {
    if (!url || !url.includes('firebasestorage')) return;
    try {
        await storage.refFromURL(url).delete();
    } catch (err) {
        console.warn("Could not delete the old profile picture:", err.code || err);
    }
}

// Center-crops the image to a square and scales it to size x size px (PNG).
// Small images (e.g. 16x16 Minecraft textures) are scaled up without smoothing so they stay sharp.
function cropToSquareBlob(file, size) {
    return new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const img = new Image();

        img.onload = () => {
            const side = Math.min(img.naturalWidth, img.naturalHeight);
            const sx = (img.naturalWidth - side) / 2;
            const sy = (img.naturalHeight - side) / 2;

            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;

            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = side >= size;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

            URL.revokeObjectURL(objectUrl);
            canvas.toBlob(
                (blob) => blob ? resolve(blob) : reject(new Error("Canvas export failed")),
                'image/png'
            );
        };

        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("Image could not be loaded"));
        };

        img.src = objectUrl;
    });
}

// The profile color is the CSS variable --profile-accent ('' = back to the site blue)
function applyProfileColor(color) {
    const root = document.documentElement;
    if (COLOR_PATTERN.test(color || '')) {
        root.style.setProperty('--profile-accent', color);
    } else {
        root.style.removeProperty('--profile-accent');
    }
}

/* ==========================================================================
   3. DIALOGS & FULLSCREEN MEDIA
   ========================================================================== */
function updateScrollLock() {
    const anyOpen = document.querySelector('.profile-modal-overlay.active, .lightbox-overlay.active');
    document.body.classList.toggle('modal-open', !!anyOpen);
}

function openModal(id) {
    byId(id).classList.add('active');
    updateScrollLock();
}

function closeModal(id) {
    byId(id).classList.remove('active');
    updateScrollLock();
}

function ensureLightbox() {
    let lightbox = byId('globalLightbox');
    if (lightbox) return lightbox;

    lightbox = document.createElement('div');
    lightbox.className = 'lightbox-overlay';
    lightbox.id = 'globalLightbox';
    lightbox.innerHTML = `
        <button class="lightbox-close" id="closeLightboxBtn" aria-label="Zavřít">&times;</button>
        <div class="lightbox-content" id="lightboxContentTarget"></div>
    `;
    document.body.appendChild(lightbox);

    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox || e.target.id === 'closeLightboxBtn') closeMediaFullscreen();
    });

    return lightbox;
}

function openMediaFullscreen(mediaUrl, mediaType) {
    const lightbox = ensureLightbox();
    const container = byId('lightboxContentTarget');
    container.innerHTML = '';

    const media = document.createElement(mediaType === 'video' ? 'video' : 'img');
    media.src = mediaUrl;
    if (mediaType === 'video') {
        media.controls = true;
        media.autoplay = true;
    } else {
        media.alt = 'Zvětšený náhled';
    }
    container.appendChild(media);

    lightbox.classList.add('active');
    updateScrollLock();
}

function closeMediaFullscreen() {
    const lightbox = byId('globalLightbox');
    if (!lightbox) return;

    lightbox.classList.remove('active');
    updateScrollLock();

    // Wait for the fade-out, then drop the media (this also stops a playing video)
    setTimeout(() => {
        if (!lightbox.classList.contains('active')) {
            byId('lightboxContentTarget').innerHTML = '';
        }
    }, 300);
}

// Escape closes the top-most layer first
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;

    const lightbox = byId('globalLightbox');
    if (lightbox && lightbox.classList.contains('active')) {
        closeMediaFullscreen();
    } else if (byId('anecdotesModal').classList.contains('active')) {
        closeModal('anecdotesModal');
    } else if (byId('editModal').classList.contains('active')) {
        closeEditor();
    }
});

/* ==========================================================================
   4. LOADING A PROFILE
   ========================================================================== */
// Re-runs whenever the login state is known or changes (e.g. login through the modal)
firebase.auth().onAuthStateChanged((user) => {
    const params = new URLSearchParams(window.location.search);
    const requestedUid = params.get('uid');
    const targetUid = requestedUid || (user ? user.uid : null);

    if (!targetUid) {
        window.location.href = "index.html";
    } else {
        loadProfile(targetUid, user);
    }
});

async function loadProfile(uid, user) {
    showOnly('loading');

    try {
        const snap = await db.collection('users').doc(uid).get();
        const isOwner = !!user && user.uid === uid;

        // A missing document is only fine for the owner (it gets created on the first save)
        if (!snap.exists && !isOwner) {
            showMessage('Profil nebyl nalezen.');
            return;
        }

        const data = snap.exists ? snap.data() : {};
        const fallbackName = isOwner
            ? (user.displayName || (user.email ? user.email.split('@')[0] : 'Uživatel'))
            : 'Uživatel';

        profileState = {
            uid: uid,
            isOwner: isOwner,
            profile: {
                nickname: data.nickname || fallbackName,
                minecraftName: data.minecraftName || '',
                bio: data.bio || '',
                photoURL: data.photoURL || '',
                profileColor: COLOR_PATTERN.test(data.profileColor || '') ? data.profileColor : '',
                verified: data.verified === true
            },
            pendingAvatar: null,
            removeAvatar: false,
            editColor: ''
        };

        renderProfile();
        loadPostsSection(uid);
        loadCommentsSection(uid);

    } catch (err) {
        console.error("Failed to load the profile:", err);
        showMessage('Profil se nepodařilo načíst.');
    }
}

/* ==========================================================================
   5. VIEW MODE
   ========================================================================== */
// Draws the player's 3D Minecraft skin into the container (verified players only).
let skinViewer = null;

function renderSkin(container, profile) {
    // Dispose the previous viewer (renderProfile runs again after every save)
    if (skinViewer) {
        skinViewer.dispose();
        skinViewer = null;
    }

    const username = (profile.minecraftName || '').trim();
    if (!MC_NAME_PATTERN.test(username)) {
        container.textContent = '';
        return;
    }

    container.innerHTML = '<canvas id="skin_container"></canvas>';

    skinViewer = new skinview3d.SkinViewer({
        canvas: byId('skin_container'),
        width: 300,
        height: 400
    });
    skinViewer.animation = new skinview3d.WalkingAnimation();
    skinViewer.autoRotate = true;

    // Note: a template literal needs backticks and ${...}; plain quotes with {username}
    // are sent to the server as the literal text "{username}".
    const skinUrl = `https://minotar.net/skin/${encodeURIComponent(username)}`;

    // loadSkin returns a promise; without .catch a failed image load becomes an
    // "Uncaught (in promise)" error and the viewer stays empty.
    skinViewer.loadSkin(skinUrl).catch((err) => {
        console.warn('Could not load the skin of', username, err);
        container.textContent = 'Skin se nepodařilo načíst.';
    });
}

function renderProfile() {
    const { profile, isOwner } = profileState;

    document.title = `${profile.nickname} | Deník.GR`;
    applyProfileColor(profile.profileColor);

    renderAvatar(byId('profileAvatar'), profile.photoURL);
    byId('profileName').textContent = profile.nickname;

    // Minecraft nick
    const mcRow = byId('profileMc');
    mcRow.innerHTML = '';
    if (profile.minecraftName) {
        const strong = document.createElement('strong');
        strong.textContent = profile.minecraftName;
        mcRow.append('Minecraft nick: ', strong);
    }

    // Bio
    const bioEl = byId('profileBio');
    if (profile.bio) {
        bioEl.textContent = profile.bio;
        bioEl.classList.remove('profile-muted');
    } else {
        bioEl.textContent = TEXT_NO_BIO;
        bioEl.classList.add('profile-muted');
    }

    byId('profileEditBtn').style.display = isOwner ? 'inline-flex' : 'none';

    // Skin window: verified players only. Without it the other two columns move to the middle.
    byId('skinColumn').style.display = profile.verified ? '' : 'none';
    byId('profilePage').classList.toggle('no-skin', !profile.verified);
    if (profile.verified) renderSkin(byId('profileSkin'), profile);

    showOnly('page');
}

/* ==========================================================================
   6. EDIT DIALOG
   ========================================================================== */
function discardPendingAvatar() {
    if (profileState.pendingAvatar) {
        URL.revokeObjectURL(profileState.pendingAvatar.previewUrl);
    }
    profileState.pendingAvatar = null;
}

function renderColorPicker() {
    const box = byId('colorSwatches');
    box.innerHTML = '';

    [{ name: 'Výchozí', value: '' }, ...PROFILE_COLORS].forEach((option) => {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'color-swatch' + (option.value === '' ? ' default' : '');
        swatch.title = option.name;
        swatch.setAttribute('aria-label', option.name);
        swatch.dataset.value = option.value;
        if (option.value) swatch.style.background = option.value;
        swatch.addEventListener('click', () => selectColor(option.value));
        box.appendChild(swatch);
    });

    byId('profileColorInput').value = profileState.editColor || DEFAULT_CUSTOM_COLOR;
    updateColorSelection();
}

function updateColorSelection() {
    const current = profileState.editColor.toLowerCase();
    byId('colorSwatches').querySelectorAll('.color-swatch').forEach((swatch) => {
        swatch.classList.toggle('selected', swatch.dataset.value.toLowerCase() === current);
    });
}

// Picking a color previews it on the whole page right away
function selectColor(value) {
    profileState.editColor = value;
    applyProfileColor(value);
    byId('profileColorInput').value = value || DEFAULT_CUSTOM_COLOR;
    updateColorSelection();
}

function openEditor() {
    const { profile } = profileState;

    discardPendingAvatar();
    profileState.removeAvatar = false;
    profileState.editColor = profile.profileColor;

    byId('nicknameInput').value = profile.nickname;

    // Verified players can't change their Minecraft nick
    const mcInput = byId('mcNameInput');
    mcInput.value = profile.minecraftName;
    mcInput.disabled = profile.verified;
    byId('mcNameHint').textContent = profile.verified
        ? 'Ověřeným hráčům nelze Minecraft nick měnit.'
        : '3-16 znaků: A-Z, 0-9, "_", "-"';

    byId('bioInput').value = profile.bio;
    byId('bioCounter').textContent = profile.bio.length;
    byId('profileFormError').textContent = '';
    renderAvatar(byId('avatarEditPreview'), profile.photoURL);
    renderColorPicker();

    openModal('editModal');
}

function closeEditor() {
    discardPendingAvatar();
    profileState.removeAvatar = false;
    applyProfileColor(profileState.profile.profileColor); // drop an unsaved color preview
    closeModal('editModal');
}

byId('profileEditBtn').addEventListener('click', openEditor);
byId('profileCancelBtn').addEventListener('click', closeEditor);
byId('editModalClose').addEventListener('click', closeEditor);

byId('bioInput').addEventListener('input', (e) => {
    byId('bioCounter').textContent = e.target.value.length;
});

byId('profileColorInput').addEventListener('input', (e) => selectColor(e.target.value));

// Choosing a picture: crop it locally and show a preview (uploaded only on save)
byId('avatarFileInput').addEventListener('change', async (e) => {
    const input = e.target;
    const file = input.files[0];
    if (!file) return;

    byId('profileFormError').textContent = '';

    try {
        const blob = await cropToSquareBlob(file, AVATAR_SIZE);
        discardPendingAvatar();
        profileState.pendingAvatar = { blob: blob, previewUrl: URL.createObjectURL(blob) };
        profileState.removeAvatar = false;
        renderAvatar(byId('avatarEditPreview'), profileState.pendingAvatar.previewUrl);
    } catch (err) {
        console.error("Profile picture processing failed:", err);
        byId('profileFormError').textContent = 'Obrázek se nepodařilo načíst. Zkuste jiný soubor.';
    }

    input.value = ''; // lets the same file be chosen again
});

byId('avatarRemoveBtn').addEventListener('click', () => {
    discardPendingAvatar();
    profileState.removeAvatar = true;
    renderAvatar(byId('avatarEditPreview'), '');
});

byId('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const { profile } = profileState;
    const errorBox = byId('profileFormError');
    const saveBtn = byId('profileSaveBtn');

    const nickname = byId('nicknameInput').value.trim();
    const minecraftName = profile.verified ? profile.minecraftName : byId('mcNameInput').value.trim();
    const bio = byId('bioInput').value.trim();
    const color = profileState.editColor;

    errorBox.textContent = '';

    if (nickname.length < NICKNAME_MIN_LENGTH || nickname.length > NICKNAME_MAX_LENGTH) {
        errorBox.textContent = `Uživatelské jméno musí mít ${NICKNAME_MIN_LENGTH}-${NICKNAME_MAX_LENGTH} znaků.`;
        return;
    }
    if (!profile.verified && minecraftName && !MC_NAME_PATTERN.test(minecraftName)) {
        errorBox.textContent = 'Neplatný nick (3-16 znaků, A-Z, 0-9, "_", "-")';
        return;
    }
    if (bio.length > BIO_MAX_LENGTH) {
        errorBox.textContent = `Bio může mít nejvýše ${BIO_MAX_LENGTH} znaků.`;
        return;
    }
    if (color && !COLOR_PATTERN.test(color)) {
        errorBox.textContent = 'Neplatná barva profilu.';
        return;
    }

    const user = firebase.auth().currentUser;
    if (!user || user.uid !== profileState.uid) {
        errorBox.textContent = 'Pro uložení profilu se musíte přihlásit.';
        return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Ukládám...';

    try {
        const oldUrl = profile.photoURL;
        let newUrl = oldUrl;

        if (profileState.pendingAvatar) {
            const fileRef = storage.ref(`profiles/${user.uid}/avatar_${Date.now()}.png`);
            const snapshot = await fileRef.put(profileState.pendingAvatar.blob, { contentType: 'image/png' });
            newUrl = await snapshot.ref.getDownloadURL();
        } else if (profileState.removeAvatar) {
            newUrl = '';
        }

        // merge: only touches these fields (verified etc. stay as they are)
        const changes = {
            nickname: nickname,
            bio: bio,
            photoURL: newUrl ? newUrl : firebase.firestore.FieldValue.delete(),
            profileColor: color ? color : firebase.firestore.FieldValue.delete()
        };
        if (!profile.verified) changes.minecraftName = minecraftName;

        await db.collection('users').doc(user.uid).set(changes, { merge: true });

        if (oldUrl && oldUrl !== newUrl) deleteOldAvatar(oldUrl);

        discardPendingAvatar();
        profileState.removeAvatar = false;
        profileState.profile = { ...profile, nickname, minecraftName, bio, photoURL: newUrl, profileColor: color };

        closeModal('editModal');
        renderProfile();

        // Keep the name in the navbar in sync without a reload
        const menuBtn = byId('userMenuBtn');
        if (menuBtn) menuBtn.textContent = `${nickname} ▾`;

        showStatus('Profil byl uložen.');

    } catch (err) {
        console.error("Saving the profile failed:", err);
        errorBox.textContent = err.code === 'permission-denied'
            ? 'Nemáte oprávnění uložit tento profil.'
            : 'Uložení se nezdařilo. Zkuste to prosím znovu.';
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Uložit změny';
    }
});

/* ==========================================================================
   7. ARTICLES & ANECDOTES OF THIS USER
   ========================================================================== */
// Fetches the posts of one user and renders them (the profile itself is already visible)
async function loadPostsSection(uid) {
    loadedArticles = [];
    loadedAnecdotes = [];
    articlesExpanded = false;
    renderArticles();
    renderAnecdotes();

    try {
        // Equality-only queries need no composite index; sorting happens below
        const [articleSnap, anecdoteSnap] = await Promise.all([
            db.collection('articles').where('authorUid', '==', uid).get(),
            db.collection('anecdotes').where('authorUid', '==', uid).get()
        ]);

        if (profileState.uid !== uid) return; // another profile was opened in the meantime

        loadedArticles = sortPostsNewestFirst(articleSnap.docs).map((doc) => {
            const data = doc.data();
            return {
                title: data.title || 'Bez názvu',
                sub: [data.category, formatPostDate(data.date)].filter(Boolean).join(' • '),
                thumb: { type: 'image', url: data.coverImage || POST_PLACEHOLDER_IMAGE },
                href: `article.html?id=${encodeURIComponent(doc.id)}`
            };
        });

        loadedAnecdotes = sortPostsNewestFirst(anecdoteSnap.docs)
            .map((doc) => {
                const data = doc.data();
                return {
                    thumb: { type: data.type || 'image', url: data.url },
                    dateText: formatPostDateTime(data.date) || 'Neznámé datum'
                };
            })
            .filter(a => a.thumb.url);

        renderArticles();
        renderAnecdotes();

    } catch (err) {
        // The profile itself still works, so these sections simply stay hidden
        console.error("Failed to load the posts of this user:", err);
    }
}

/* ---- Articles: packed to ARTICLE_PREVIEW_COUNT rows, expandable in place ---- */
function renderArticles() {
    const section = byId('articlesSection');
    const total = loadedArticles.length;

    if (total === 0) {
        section.style.display = 'none';
        return;
    }

    const list = byId('profileArticlesList');
    list.innerHTML = '';

    const visible = articlesExpanded ? loadedArticles : loadedArticles.slice(0, ARTICLE_PREVIEW_COUNT);
    visible.forEach(article => list.appendChild(buildPostRow(article)));

    byId('profileArticlesCount').textContent = `(${total})`;

    const btn = byId('articlesExpandBtn');
    if (total > ARTICLE_PREVIEW_COUNT) {
        btn.textContent = articlesExpanded ? 'Sbalit' : `Zobrazit všechny (${total})`;
        btn.style.display = 'inline-flex';
    } else {
        btn.style.display = 'none';
    }

    section.style.display = 'block';
}

byId('articlesExpandBtn').addEventListener('click', () => {
    articlesExpanded = !articlesExpanded;
    renderArticles();
});

// One row: thumbnail + title + small subtitle (a link to the article)
function buildPostRow({ thumb, title, sub, href }) {
    const row = document.createElement(href ? 'a' : 'div');
    row.className = 'profile-post-row' + (href ? ' clickable' : '');
    if (href) row.href = href;

    const info = document.createElement('div');
    info.className = 'profile-post-info';

    const titleEl = document.createElement('div');
    titleEl.className = 'profile-post-title';
    titleEl.textContent = title;

    const subEl = document.createElement('div');
    subEl.className = 'profile-post-sub';
    subEl.textContent = sub;

    info.append(titleEl, subEl);
    row.append(createThumbElement(thumb, 'profile-post-thumb'), info);
    return row;
}

/* ---- Anecdotes: thumbnails in the window, all of them in a dialog ---- */
function renderAnecdotes() {
    const card = byId('anecdotesCard');
    const total = loadedAnecdotes.length;

    if (total === 0) {
        card.style.display = 'none'; // the ad below moves up into its place
        return;
    }

    const grid = byId('anecdotePreviewGrid');
    grid.innerHTML = '';
    loadedAnecdotes.slice(0, ANECDOTE_PREVIEW_COUNT)
        .forEach(anecdote => grid.appendChild(buildAnecdoteTile(anecdote, false)));

    byId('profileAnecdotesCount').textContent = `(${total})`;

    const btn = byId('anecdotesExpandBtn');
    btn.textContent = `Zobrazit všechny (${total})`;
    btn.style.display = total > ANECDOTE_PREVIEW_COUNT ? 'inline-flex' : 'none';

    card.style.display = 'block';
}

// Square thumbnail; click = fullscreen. withCaption adds the date underneath (dialog).
function buildAnecdoteTile(anecdote, withCaption) {
    const tile = document.createElement('div');
    tile.className = 'anecdote-tile';
    tile.tabIndex = 0;
    tile.setAttribute('role', 'button');
    tile.title = anecdote.dateText;

    const media = document.createElement('div');
    media.className = 'anecdote-tile-media';
    media.appendChild(createThumbElement(anecdote.thumb, 'anecdote-tile-thumb'));

    if (anecdote.thumb.type === 'video') {
        const badge = document.createElement('span');
        badge.className = 'anecdote-tile-play';
        badge.textContent = '▶';
        media.appendChild(badge);
    }
    tile.appendChild(media);

    if (withCaption) {
        const caption = document.createElement('div');
        caption.className = 'anecdote-tile-caption';
        caption.textContent = anecdote.dateText;
        tile.appendChild(caption);
    }

    const open = () => openMediaFullscreen(anecdote.thumb.url, anecdote.thumb.type);
    tile.addEventListener('click', open);
    tile.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
        }
    });

    return tile;
}

function openAnecdotesModal() {
    byId('anecdotesModalTitle').textContent =
        `Anekdoty uživatele ${profileState.profile.nickname} (${loadedAnecdotes.length})`;

    const grid = byId('anecdotesModalGrid');
    grid.innerHTML = '';
    loadedAnecdotes.forEach(anecdote => grid.appendChild(buildAnecdoteTile(anecdote, true)));

    openModal('anecdotesModal');
}

byId('anecdotesExpandBtn').addEventListener('click', openAnecdotesModal);
byId('anecdotesModalClose').addEventListener('click', () => closeModal('anecdotesModal'));
byId('anecdotesModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal('anecdotesModal'); // click on the backdrop
});

/* ==========================================================================
   8. COMMENTS WRITTEN BY THIS USER
   ========================================================================== */
// Shows a single message instead of the list (loading, empty, error)
function setCommentsMessage(text) {
    const list = byId('profileCommentsList');
    list.innerHTML = '';

    const message = document.createElement('div');
    message.className = 'profile-empty';
    message.textContent = text;
    list.appendChild(message);

    byId('profileCommentsCount').textContent = '';
    byId('profileCommentsNote').style.display = 'none';
}

async function loadCommentsSection(uid) {
    setCommentsMessage(TEXT_COMMENTS_LOADING);

    try {
        // Collection group query over every article's "comments" subcollection.
        // Needs the extra Firestore rule and the single-field index from the earlier setup notes.
        const snap = await db.collectionGroup('comments').where('uid', '==', uid).get();
        if (profileState.uid !== uid) return; // another profile was opened in the meantime

        // Keep only comments that belong to an article
        const comments = snap.docs
            .map(doc => ({ data: doc.data(), articleRef: doc.ref.parent.parent }))
            .filter(c => c.articleRef && c.articleRef.parent.id === 'articles');

        // Look up each article once
        const articleIds = [...new Set(comments.map(c => c.articleRef.id))];
        const articleDocs = await Promise.all(
            articleIds.map(id => db.collection('articles').doc(id).get())
        );
        const articlesById = {};
        articleDocs.forEach(doc => { if (doc.exists) articlesById[doc.id] = doc.data(); });

        if (profileState.uid !== uid) return;

        const rows = comments
            .filter(c => articlesById[c.articleRef.id]) // skip comments of deleted articles
            .sort((a, b) => postMillis(b.data.createdAt) - postMillis(a.data.createdAt))
            .map(c => {
                const article = articlesById[c.articleRef.id];
                return {
                    title: article.title || 'Bez názvu',
                    thumbUrl: article.coverImage || POST_PLACEHOLDER_IMAGE,
                    text: c.data.text || '',
                    date: formatPostDateTime(c.data.createdAt),
                    href: `article.html?id=${encodeURIComponent(c.articleRef.id)}`
                };
            });

        renderProfileComments(rows.slice(0, MAX_PROFILE_COMMENTS), rows.length);

    } catch (err) {
        // Most likely the index is still missing; the rest of the profile works fine
        console.error("Failed to load the comments of this user:", err);
        setCommentsMessage(TEXT_COMMENTS_ERROR);
    }
}

function renderProfileComments(rows, total) {
    if (rows.length === 0) {
        setCommentsMessage(TEXT_NO_COMMENTS);
        return;
    }

    byId('profileCommentsCount').textContent = `(${total})`;

    const list = byId('profileCommentsList');
    list.innerHTML = '';
    rows.forEach(row => list.appendChild(buildProfileCommentRow(row)));

    const note = byId('profileCommentsNote');
    if (total > rows.length) {
        note.textContent = `Zobrazeno posledních ${rows.length} komentářů.`;
        note.style.display = 'block';
    } else {
        note.style.display = 'none';
    }
}

// One row: article cover + article title + the comment text + date
function buildProfileCommentRow(row) {
    const el = document.createElement(row.href ? 'a' : 'div');
    el.className = 'profile-post-row profile-comment-row' + (row.href ? ' clickable' : '');
    if (row.href) el.href = row.href;

    const thumb = document.createElement('img');
    thumb.className = 'profile-post-thumb';
    thumb.src = row.thumbUrl;
    thumb.alt = '';
    thumb.loading = 'lazy';

    const info = document.createElement('div');
    info.className = 'profile-post-info';

    const title = document.createElement('div');
    title.className = 'profile-post-title';
    title.textContent = row.title;

    const text = document.createElement('div');
    text.className = 'profile-comment-text';
    text.textContent = row.text;

    const date = document.createElement('div');
    date.className = 'profile-post-sub';
    date.textContent = row.date;

    info.append(title, text, date);
    el.append(thumb, info);
    return el;
}