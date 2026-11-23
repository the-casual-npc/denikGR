// scripts/figures.js
// "Osobnosti": directory of players. Verified profiles first, then all other accounts.
//
// Data: users/<uid> -> { nickname, minecraftName, bio, photoURL, verified }
// "verified: true" (a boolean, not the text "true") is set by hand in the Firebase console.

/* ==========================================================================
   1. CONFIGURATION
   ========================================================================== */
const BIO_PREVIEW_LENGTH = 140; // characters of the bio shown on a card

const AVATAR_PLACEHOLDER_SVG = `
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5z"/>
    </svg>
`;

/* ==========================================================================
   2. STATE & SMALL HELPERS
   ========================================================================== */
// All loaded figures. A future search can filter these two lists and re-render.
let figuresState = { verified: [], others: [] };

const byId = (id) => document.getElementById(id);

function showFiguresMessage(text) {
    byId('figuresLoading').style.display = 'none';
    byId('verifiedSection').style.display = 'none';
    byId('othersSection').style.display = 'none';

    const box = byId('figuresMessage');
    box.textContent = text;
    box.style.display = 'block';
}

// First BIO_PREVIEW_LENGTH characters on one line, with an ellipsis when cut
function makeBioPreview(bio) {
    const flat = bio.replace(/\s+/g, ' ').trim();
    if (flat.length <= BIO_PREVIEW_LENGTH) return flat;
    return flat.slice(0, BIO_PREVIEW_LENGTH).trimEnd() + '…';
}

function createFigureAvatar(photoURL) {
    const avatar = document.createElement('div');
    avatar.className = 'figure-avatar';

    const showPlaceholder = () => { avatar.innerHTML = AVATAR_PLACEHOLDER_SVG; };

    if (photoURL) {
        const img = document.createElement('img');
        img.src = photoURL;
        img.alt = '';
        img.loading = 'lazy';
        img.addEventListener('error', showPlaceholder);
        avatar.appendChild(img);
    } else {
        showPlaceholder();
    }
    return avatar;
}

/* ==========================================================================
   3. LOADING
   ========================================================================== */
// Newest article of every author: { <authorUid>: { id, title, date, millis } }
async function loadLatestArticles() {
    const latest = {};

    try {
        const snap = await db.collection('articles').get();
        snap.forEach((doc) => {
            const data = doc.data();
            if (!data.authorUid) return; // old articles without an owner can't be matched

            const millis = data.date ? data.date.toMillis() : 0;
            const current = latest[data.authorUid];

            if (!current || millis > current.millis) {
                latest[data.authorUid] = {
                    id: doc.id,
                    title: data.title || 'Bez názvu',
                    date: data.date ? data.date.toDate().toLocaleDateString('cs-CZ') : '',
                    millis: millis
                };
            }
        });
    } catch (err) {
        // The cards still work without this information
        console.warn("Could not load the latest articles (cards are shown without them):", err);
    }

    return latest;
}

async function loadFigures() {
    try {
        const [usersSnap, latestByAuthor] = await Promise.all([
            db.collection('users').get(),
            loadLatestArticles()
        ]);

        const figures = usersSnap.docs.map((doc) => {
            const data = doc.data();
            return {
                uid: doc.id,
                nickname: data.nickname || 'Uživatel',
                minecraftName: data.minecraftName || '',
                bio: data.bio || '',
                photoURL: data.photoURL || '',
                verified: data.verified === true,
                latestArticle: latestByAuthor[doc.id] || null
            };
        });

        const byName = (a, b) => a.nickname.localeCompare(b.nickname, 'cs', { sensitivity: 'base' });
        figuresState.verified = figures.filter(f => f.verified).sort(byName);
        figuresState.others = figures.filter(f => !f.verified).sort(byName);

        renderFigures();

    } catch (err) {
        console.error("Failed to load the figures:", err);
        showFiguresMessage('Osobnosti se nepodařilo načíst.');
    }
}

/* ==========================================================================
   4. RENDERING
   ========================================================================== */
// Takes the lists as parameters so a search can pass filtered lists later
function renderFigures(verified = figuresState.verified, others = figuresState.others) {
    byId('figuresLoading').style.display = 'none';

    if (verified.length === 0 && others.length === 0) {
        showFiguresMessage('Zatím tu nejsou žádní hráči.');
        return;
    }

    byId('figuresMessage').style.display = 'none';
    fillSection('verifiedSection', 'verifiedGrid', 'verifiedCount', verified);
    fillSection('othersSection', 'othersGrid', 'othersCount', others);
}

// A section is hidden while it has no profiles
function fillSection(sectionId, gridId, countId, figures) {
    const section = byId(sectionId);

    if (figures.length === 0) {
        section.style.display = 'none';
        return;
    }

    const grid = byId(gridId);
    grid.innerHTML = '';
    figures.forEach(figure => grid.appendChild(buildFigureCard(figure)));

    byId(countId).textContent = `(${figures.length})`;
    section.style.display = 'block';
}

// The whole card is one link to the profile page
function buildFigureCard(figure) {
    const card = document.createElement('a');
    card.className = 'figure-card' + (figure.verified ? ' verified' : '');
    card.href = `profile.html?uid=${encodeURIComponent(figure.uid)}`;

    // Avatar + name (+ verified badge) + "aka <Minecraft name>"
    const head = document.createElement('div');
    head.className = 'figure-head';

    const names = document.createElement('div');
    names.className = 'figure-names';

    const name = document.createElement('div');
    name.className = 'figure-name';

    const nameText = document.createElement('span');
    nameText.className = 'figure-name-text';
    nameText.textContent = figure.nickname;
    name.appendChild(nameText);

    if (figure.verified) {
        const badge = document.createElement('span');
        badge.className = 'verified-badge';
        badge.title = 'Ověřený hráč';
        badge.textContent = '✓';
        name.appendChild(badge);
    }
    names.appendChild(name);

    // Skipped when it is the same as the display name
    if (figure.minecraftName
        && figure.minecraftName.toLowerCase() !== figure.nickname.toLowerCase()) {
        const aka = document.createElement('div');
        aka.className = 'figure-aka';
        aka.textContent = `aka ${figure.minecraftName}`;
        names.appendChild(aka);
    }

    head.append(createFigureAvatar(figure.photoURL), names);
    card.appendChild(head);

    // Part of the bio
    const bio = document.createElement('p');
    bio.className = 'figure-bio';
    if (figure.bio.trim()) {
        bio.textContent = makeBioPreview(figure.bio);
    } else {
        bio.classList.add('empty');
        bio.textContent = 'Zatím bez popisu.';
    }
    card.appendChild(bio);

    // Latest article (information only, the card itself links to the profile)
    if (figure.latestArticle) {
        const latest = document.createElement('div');
        latest.className = 'figure-latest';

        const label = document.createElement('span');
        label.className = 'figure-latest-label';
        label.textContent = 'Nejnovější článek';

        const title = document.createElement('span');
        title.className = 'figure-latest-title';
        title.textContent = figure.latestArticle.title;

        const date = document.createElement('span');
        date.textContent = figure.latestArticle.date;

        latest.append(label, title, date);
        card.appendChild(latest);
    }

    return card;
}

/* ==========================================================================
   5. SEARCH (not implemented yet)
   ========================================================================== */
// TODO: filter figuresState.verified / figuresState.others by the typed text
// (nickname, Minecraft name) and call renderFigures(filteredVerified, filteredOthers).
byId('figuresSearchForm').addEventListener('submit', (e) => {
    e.preventDefault();
});

loadFigures();