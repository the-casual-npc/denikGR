// scripts/random-anecdote.js
// "Random anecdote" widget for the sidebar of the main page.
// Needs the global Firestore reference "db" and scripts/reactions.js (for the reaction bar).
(function () {
    const widget = document.getElementById('randomAnecdoteWidget');
    if (!widget) return;

    const body = document.getElementById('randomAnecdoteBody');
    const shuffleBtn = document.getElementById('anecdoteShuffleBtn');

    let anecdotes = [];
    let currentId = null;

    // Reaction controllers are reused when the same anecdote is shown again
    const reactionControllers = {};
    let stopReactionBar = null; // unregisters the bar of the previously shown anecdote

    async function init() {
        try {
            const snap = await db.collection('anecdotes').get();
            anecdotes = snap.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(a => a.url); // ignore documents without media

            if (anecdotes.length === 0) return; // the widget stays hidden

            shuffleBtn.style.display = anecdotes.length > 1 ? '' : 'none';
            showRandom();
            widget.hidden = false;
        } catch (err) {
            console.error("Failed to load the random anecdote:", err);
        }
    }

    // Any anecdote except the one currently shown (when there is more than one)
    function pickRandom() {
        const pool = anecdotes.length > 1
            ? anecdotes.filter(a => a.id !== currentId)
            : anecdotes;
        return pool[Math.floor(Math.random() * pool.length)];
    }

    function getReactionController(anecdoteId) {
        if (!reactionControllers[anecdoteId]) {
            reactionControllers[anecdoteId] = createReactionController('anecdotes', anecdoteId);
            reactionControllers[anecdoteId].load();
        }
        return reactionControllers[anecdoteId];
    }

    function showRandom() {
        const anecdote = pickRandom();
        currentId = anecdote.id;
        const type = anecdote.type || 'image';

        if (stopReactionBar) {
            stopReactionBar();
            stopReactionBar = null;
        }
        body.innerHTML = '';

        // Media preview (click = fullscreen)
        const media = document.createElement('div');
        media.className = 'random-anecdote-media';
        media.setAttribute('role', 'button');
        media.tabIndex = 0;
        media.title = 'Zvětšit';

        if (type === 'video') {
            const video = document.createElement('video');
            video.src = anecdote.url + '#t=0.1'; // shows a frame as the preview
            video.muted = true;
            video.preload = 'metadata';
            video.playsInline = true;

            const badge = document.createElement('span');
            badge.className = 'random-anecdote-play';
            badge.textContent = '▶';

            media.append(video, badge);
        } else {
            const img = document.createElement('img');
            img.src = anecdote.url;
            img.alt = 'Náhodná anekdota';
            media.appendChild(img);
        }

        const open = () => openLightbox(anecdote.url, type);
        media.addEventListener('click', open);
        media.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                open();
            }
        });

        // "Zveřejnil: <author> • <date>" (author links to the profile when known)
        const author = document.createElement(anecdote.authorUid ? 'a' : 'span');
        author.className = 'random-anecdote-author';
        author.textContent = anecdote.author || 'Neznámý autor';
        if (anecdote.authorUid) {
            author.href = `profile.html?uid=${encodeURIComponent(anecdote.authorUid)}`;
        }

        const date = anecdote.date ? anecdote.date.toDate().toLocaleDateString('cs-CZ') : '';

        const meta = document.createElement('div');
        meta.className = 'random-anecdote-meta';
        meta.append('Zveřejnil: ', author, date ? ` • ${date}` : '');

        body.append(media, meta);

        // Reaction bar (skipped quietly if reactions.js is not loaded)
        if (typeof createReactionController === 'function') {
            const reactionHost = document.createElement('div');
            reactionHost.className = 'random-anecdote-reactions';
            body.appendChild(reactionHost);

            stopReactionBar = renderReactionBar(
                reactionHost,
                getReactionController(anecdote.id),
                { alwaysShowAdd: true }
            );
        }
    }

    shuffleBtn.addEventListener('click', showRandom);

    /* ---- Lightbox (created on first use) ---- */
    function openLightbox(url, type) {
        let lightbox = document.getElementById('globalLightbox');

        if (!lightbox) {
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
                        document.getElementById('lightboxContentTarget').innerHTML = '';
                    }
                }, 300);
            };

            lightbox.addEventListener('click', (e) => {
                if (e.target === lightbox || e.target.id === 'closeLightboxBtn') close();
            });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') close();
            });
        }

        const container = document.getElementById('lightboxContentTarget');
        container.innerHTML = '';

        const element = document.createElement(type === 'video' ? 'video' : 'img');
        element.src = url;
        if (type === 'video') {
            element.controls = true;
            element.autoplay = true;
        } else {
            element.alt = 'Zvětšený náhled';
        }
        container.appendChild(element);

        lightbox.classList.add('active');
    }

    init();
})();