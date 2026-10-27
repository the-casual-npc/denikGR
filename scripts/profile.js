// scripts/profile.js
// Profile page: shows any user's profile (?uid=...), lets the owner edit their own,
// and shows placeholder values when nobody is logged in (or with ?demo).
//
// Data: users/<uid> -> { nickname, minecraftName, bio, photoURL }
// Pictures: Storage at profiles/<uid>/avatar_<timestamp>.png

/* ==========================================================================
   1. CONFIGURATION
   ========================================================================== */
const BIO_MAX_LENGTH = 300;                      // keep in sync with the Firestore rules
const MC_NAME_PATTERN = /^[A-Za-z0-9_-]{3,16}$/;  // valid Minecraft Java usernames
const AVATAR_SIZE = 256;                         // pictures are cropped to AVATAR_SIZE x AVATAR_SIZE px

// Shown when nobody is logged in and no ?uid= is given (or with ?demo in the address)

const AVATAR_PLACEHOLDER_SVG = `
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5z"/>
    </svg>
`;

/* ==========================================================================
   2. STATE & SMALL HELPERS
   ========================================================================== */
let profileState = {
    uid: null,            // whose profile is shown (null = placeholder profile)
    isDemo: false,
    isOwner: false,
    profile: {},          // { nickname, minecraftName, bio, photoURL }
    pendingAvatar: null,  // { blob, previewUrl } chosen in the form but not saved yet
    removeAvatar: false
};

const byId = (id) => document.getElementById(id);

// Which of the three main blocks is visible
function showOnly(section) {
    byId('profileLoading').style.display = section === 'loading' ? 'flex' : 'none';
    byId('profileMessage').style.display = section === 'message' ? 'block' : 'none';
    byId('profileCard').style.display = section === 'card' ? 'block' : 'none';

    if (section !== 'card') {
        byId('profileDemoBanner').style.display = 'none';
        byId('profilePostsSection').style.display = 'none';
        byId('profileCommentsSection').style.display = 'none';
    }
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

/* ==========================================================================
   7. COMMENTS WRITTEN BY THIS USER
   ========================================================================== */
const MAX_PROFILE_COMMENTS = 20; // only the newest N comments are shown

// Placeholder rows for the demo profile
const DEMO_COMMENTS = [
    {
        title: 'Obchodní dům v plamenech kvůli creeperovi',
        text: 'Tohle jsem viděl na vlastní oči, creeper to měl namířeno přímo na vchod!',
        date: '12. 10. 2026 19:20',
        thumbUrl: 'https://picsum.photos/seed/denik-a1/100/100'
    },
    {
        title: 'Nová zastávka na lince do Netheru',
        text: 'Konečně! Doufám, že budou jezdit i v noci, protože ráno je tam pořád plno.',
        date: '8. 10. 2026 8:15',
        thumbUrl: 'https://picsum.photos/seed/denik-a2/100/100'
    }
];

const postMillis = (timestamp) => timestamp ? timestamp.toMillis() : 0;

async function loadCommentsSection(uid) {
    byId('profileCommentsSection').style.display = 'none';

    try {
        // Collection group query over every article's "comments" subcollection.
        // Needs the extra Firestore rule and the single-field index from the setup notes.
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
    }
}

function renderProfileComments(rows, total) {
    const section = byId('profileCommentsSection');

    if (rows.length === 0) {
        section.style.display = 'none';
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

    section.style.display = 'block';
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

/* ==========================================================================
   3. LOADING A PROFILE
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
            isDemo: false,
            isOwner: isOwner,
            profile: {
                nickname: data.nickname || fallbackName,
                minecraftName: data.minecraftName || '',
                bio: data.bio || '',
                photoURL: data.photoURL || ''
            },
            pendingAvatar: null,
            removeAvatar: false
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
   4. VIEW MODE
   ========================================================================== */
function renderProfile() {
    const { profile, isOwner, isDemo } = profileState;
    const canEdit = isOwner || isDemo;

    document.title = `${profile.nickname} | Deník.GR`;
    byId('profileDemoBanner').style.display = isDemo ? 'block' : 'none';

    renderAvatar(byId('profileAvatar'), profile.photoURL);
    byId('profileName').textContent = profile.nickname;

    // Minecraft name
    const mcRow = byId('profileMc');
    mcRow.innerHTML = '';
    if (profile.minecraftName) {
        const strong = document.createElement('strong');
        strong.textContent = profile.minecraftName;
        mcRow.append('Minecraft nick: ', strong);
    } else if (canEdit) {
        const hint = document.createElement('span');
        hint.className = 'profile-muted';
        hint.textContent = '';
        mcRow.appendChild(hint);
    }

    // Bio
    const bioEl = byId('profileBio');
    if (profile.bio) {
        bioEl.textContent = profile.bio;
        bioEl.classList.remove('profile-muted');
    } else {
        bioEl.textContent = 'Zatím žádné bio.'
        bioEl.classList.add('profile-muted');
    }

    byId('profileEditBtn').style.display = canEdit ? 'inline-flex' : 'none';

    byId('profileForm').style.display = 'none';
    byId('profileView').style.display = 'flex';
    showOnly('card');
}

/* ==========================================================================
   5. EDIT MODE
   ========================================================================== */
function discardPendingAvatar() {
    if (profileState.pendingAvatar) {
        URL.revokeObjectURL(profileState.pendingAvatar.previewUrl);
    }
    profileState.pendingAvatar = null;
}

function openEditor() {
    const { profile } = profileState;

    discardPendingAvatar();
    profileState.removeAvatar = false;

    byId('mcNameInput').value = profile.minecraftName;
    byId('bioInput').value = profile.bio;
    byId('bioCounter').textContent = profile.bio.length;
    byId('profileFormError').textContent = '';
    renderAvatar(byId('avatarEditPreview'), profile.photoURL);

    byId('profileView').style.display = 'none';
    byId('profileForm').style.display = 'block';
}

function closeEditor() {
    discardPendingAvatar();
    profileState.removeAvatar = false;
    byId('profileForm').style.display = 'none';
    byId('profileView').style.display = 'flex';
}

byId('profileEditBtn').addEventListener('click', openEditor);
byId('profileCancelBtn').addEventListener('click', closeEditor);

byId('bioInput').addEventListener('input', (e) => {
    byId('bioCounter').textContent = e.target.value.length;
});

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

    const errorBox = byId('profileFormError');
    const saveBtn = byId('profileSaveBtn');
    const minecraftName = byId('mcNameInput').value.trim();
    const bio = byId('bioInput').value.trim();

    errorBox.textContent = '';

    if (minecraftName && !MC_NAME_PATTERN.test(minecraftName)) {
        errorBox.textContent = 'Minecraft jméno musí mít 3–16 znaků (písmena, čísla a podtržítko).';
        return;
    }
    if (bio.length > BIO_MAX_LENGTH) {
        errorBox.textContent = `Text o vás může mít nejvýše ${BIO_MAX_LENGTH} znaků.`;
        return;
    }

    // Placeholder profile: apply the changes to the preview only, nothing is saved
    if (profileState.isDemo) {
        let photoURL = profileState.profile.photoURL;
        if (profileState.pendingAvatar) {
            photoURL = profileState.pendingAvatar.previewUrl;
            profileState.pendingAvatar = null; // keep the preview URL alive for the page
        } else if (profileState.removeAvatar) {
            photoURL = '';
        }

        profileState.profile = { ...profileState.profile, minecraftName, bio, photoURL };
        renderProfile();
        showStatus('Změny byly použity pouze pro náhled (nic se neukládá).');
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
        const oldUrl = profileState.profile.photoURL;
        let newUrl = oldUrl;

        if (profileState.pendingAvatar) {
            const fileRef = storage.ref(`profiles/${user.uid}/avatar_${Date.now()}.png`);
            const snapshot = await fileRef.put(profileState.pendingAvatar.blob, { contentType: 'image/png' });
            newUrl = await snapshot.ref.getDownloadURL();
        } else if (profileState.removeAvatar) {
            newUrl = '';
        }

        // merge: only touches these fields (nickname etc. stay as they are)
        await db.collection('users').doc(user.uid).set({
            minecraftName: minecraftName,
            bio: bio,
            photoURL: newUrl ? newUrl : firebase.firestore.FieldValue.delete()
        }, { merge: true });

        if (oldUrl && oldUrl !== newUrl) deleteOldAvatar(oldUrl);

        discardPendingAvatar();
        profileState.profile = { ...profileState.profile, minecraftName, bio, photoURL: newUrl };
        profileState.removeAvatar = false;
        renderProfile();
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
   6. ARTICLES & ANECDOTES OF THIS USER
   ========================================================================== */
const POST_PLACEHOLDER_IMAGE = 'https://picsum.photos/100/100';

// Placeholder rows for the demo profile (no database access)
const DEMO_POSTS = {
    articles: [
        { title: 'Obchodní dům v plamenech kvůli creeperovi', sub: 'Aktuality • 12. 10. 2026', thumb: { type: 'image', url: 'https://picsum.photos/seed/denik-a1/100/100' } },
        { title: 'Nová zastávka na lince do Netheru', sub: 'Doprava • 8. 10. 2026', thumb: { type: 'image', url: 'https://picsum.photos/seed/denik-a2/100/100' } },
        { title: 'Otevření obchodu s diamantovým nářadím', sub: 'Obchody • 1. 10. 2026', thumb: { type: 'image', url: 'https://picsum.photos/seed/denik-a3/100/100' } }
    ],
    anecdotes: [
        {
            title: '10. 10. 2026 18:42', sub: 'Obrázek',
            thumb: { type: 'image', url: 'https://picsum.photos/seed/denik-b1/100/100' },
            onOpen: () => openMediaFullscreen('https://picsum.photos/seed/denik-b1/1200/800', 'image')
        },
        {
            title: '3. 10. 2026 21:05', sub: 'Obrázek',
            thumb: { type: 'image', url: 'https://picsum.photos/seed/denik-b2/100/100' },
            onOpen: () => openMediaFullscreen('https://picsum.photos/seed/denik-b2/1200/800', 'image')
        }
    ]
};

function formatPostDate(timestamp) {
    return timestamp ? timestamp.toDate().toLocaleDateString('cs-CZ') : '';
}

function formatPostDateTime(timestamp) {
    return timestamp
        ? timestamp.toDate().toLocaleString('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' })
        : '';
}

function sortPostsNewestFirst(docs) {
    const millis = (doc) => doc.data().date ? doc.data().date.toMillis() : 0;
    return [...docs].sort((a, b) => millis(b) - millis(a));
}

// Fetches the posts of one user and renders them (the profile itself is already visible)
async function loadPostsSection(uid) {
    byId('profilePostsSection').style.display = 'none';

    try {
        // Equality-only queries need no composite index; sorting happens below
        const [articleSnap, anecdoteSnap] = await Promise.all([
            db.collection('articles').where('authorUid', '==', uid).get(),
            db.collection('anecdotes').where('authorUid', '==', uid).get()
        ]);

        if (profileState.uid !== uid) return; // another profile was opened in the meantime

        const articles = sortPostsNewestFirst(articleSnap.docs).map((doc) => {
            const data = doc.data();
            return {
                title: data.title || 'Bez názvu',
                sub: [data.category, formatPostDate(data.date)].filter(Boolean).join(' • '),
                thumb: { type: 'image', url: data.coverImage || POST_PLACEHOLDER_IMAGE },
                href: `article.html?id=${encodeURIComponent(doc.id)}`
            };
        });

        const anecdotes = sortPostsNewestFirst(anecdoteSnap.docs).map((doc) => {
            const data = doc.data();
            return {
                title: formatPostDateTime(data.date) || 'Neznámé datum',
                sub: data.type === 'video' ? 'Video' : 'Obrázek',
                thumb: { type: data.type, url: data.url },
                onOpen: () => openMediaFullscreen(data.url, data.type)
            };
        });

        renderPostsSection(articles, anecdotes);

    } catch (err) {
        // The profile itself still works, so the section simply stays hidden
        console.error("Failed to load the posts of this user:", err);
    }
}

function renderPostsSection(articles, anecdotes) {
    const section = byId('profilePostsSection');

    if (articles.length === 0 && anecdotes.length === 0) {
        section.style.display = 'none';
        return;
    }

    fillPostList('profileArticlesList', 'profileArticlesCount', articles, 'Zatím žádné články.');
    fillPostList('profileAnecdotesList', 'profileAnecdotesCount', anecdotes, 'Zatím žádné anekdoty.');
    section.style.display = 'block';
}

function fillPostList(listId, countId, posts, emptyText) {
    const list = byId(listId);
    list.innerHTML = '';
    byId(countId).textContent = posts.length ? `(${posts.length})` : '';

    if (posts.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'profile-posts-empty';
        empty.textContent = emptyText;
        list.appendChild(empty);
        return;
    }

    posts.forEach((post) => list.appendChild(buildPostRow(post)));
}

// One row: thumbnail + title + small subtitle.
// href = opens a page, onOpen = runs a function (lightbox), neither = not clickable
function buildPostRow({ thumb, title, sub, href, onOpen }) {
    const row = document.createElement(href ? 'a' : 'div');
    row.className = 'profile-post-row';

    if (href) {
        row.href = href;
    } else if (onOpen) {
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.addEventListener('click', onOpen);
        row.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen();
            }
        });
    }
    if (href || onOpen) row.classList.add('clickable');

    // Thumbnail: image, or a muted first-frame preview for videos
    let thumbEl;
    if (thumb.type === 'video') {
        thumbEl = document.createElement('video');
        thumbEl.src = thumb.url + '#t=0.1';
        thumbEl.muted = true;
        thumbEl.preload = 'metadata';
        thumbEl.playsInline = true;
    } else {
        thumbEl = document.createElement('img');
        thumbEl.src = thumb.url;
        thumbEl.alt = '';
        thumbEl.loading = 'lazy';
    }
    thumbEl.className = 'profile-post-thumb';

    const info = document.createElement('div');
    info.className = 'profile-post-info';

    const titleEl = document.createElement('div');
    titleEl.className = 'profile-post-title';
    titleEl.textContent = title;

    const subEl = document.createElement('div');
    subEl.className = 'profile-post-sub';
    subEl.textContent = sub;

    info.append(titleEl, subEl);
    row.append(thumbEl, info);
    return row;
}

/* ---- Lightbox (created on first use) ---- */
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

    const close = () => {
        lightbox.classList.remove('active');
        setTimeout(() => {
            if (!lightbox.classList.contains('active')) {
                byId('lightboxContentTarget').innerHTML = '';
            }
        }, 300);
    };

    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox || e.target.id === 'closeLightboxBtn') close();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close();
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
}