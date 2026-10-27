// scripts/reactions.js
// Shared reactions + comments engine.
//
// Data model:
//   <articles|anecdotes>/<postId>/reactions/<uid>_<reactionKey>
//        { uid, nickname, reaction, createdAt }          one document per user per reaction
//   articles/<postId>/comments/<autoId>
//        { uid, nickname, text, createdAt, updatedAt }   a user can write any number of comments

/* ==========================================================================
   1. CONFIGURATION - edit this list to add, remove or rename reactions
   ========================================================================== */
// "key" is what gets stored in the database, so never change a key once it has
// been used. The emoji and the label can be changed freely.
const REACTIONS = [
    { key: 'love',  emoji: '❤️', label: 'Famózní' },
    { key: 'break', emoji: '💔', label: 'Gangu...' },
    { key: 'fixed',   emoji: '❤️‍🩹', label: 'Vše je jak má být' },
    { key: 'reactity',   emoji: '😀', label: 'Reaktity' },
    { key: 'angry', emoji: '😡', label: 'Grrrr' },
    { key: 'true', image: 'img/reactions/true.png', label: 'True'}
];

const MAX_COMMENT_LENGTH = 1000; // keep in sync with the Firestore rules

/* ==========================================================================
   2. SMALL HELPERS
   ========================================================================== */
// Becomes true once Firebase has reported the login state at least once
let authKnown = false;
firebase.auth().onAuthStateChanged(() => { authKnown = true; });

const displayNameCache = {};

async function getDisplayName(user) {
    if (displayNameCache[user.uid]) return displayNameCache[user.uid];

    let name = user.displayName || (user.email ? user.email.split('@')[0] : 'Uživatel');
    try {
        const doc = await db.collection('users').doc(user.uid).get();
        if (doc.exists && doc.data().nickname) name = doc.data().nickname;
    } catch (err) {
        console.warn("Could not read the nickname, using fallback:", err);
    }

    displayNameCache[user.uid] = name;
    return name;
}

function openLoginModal() {
    const overlay = document.getElementById('authOverlay');
    if (overlay) overlay.classList.add('active');
}

function formatReactionDate(timestamp) {
    return timestamp
        ? timestamp.toDate().toLocaleString('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' })
        : '';
}

function createEl(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function reportReactionError(err) {
    console.error("Reaction/comment request failed:", err);
    alert(err.code === 'permission-denied'
        ? "Nemáte oprávnění provést tuto akci."
        : "Akci se nepodařilo dokončit. Zkuste to prosím znovu.");
}

const AVATAR_SVG = `
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
        <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5z"/>
    </svg>
`;

// Profile picture, or the silhouette when there is none (or it fails to load).
// With href the avatar becomes a link (to the user's profile).
function createAvatar(photoURL, href) {
    const avatar = createEl(href ? 'a' : 'div', 'comment-avatar');
    if (href) {
        avatar.href = href;
        avatar.title = 'Zobrazit profil';
    }

    const showPlaceholder = () => { avatar.innerHTML = AVATAR_SVG; };

    if (photoURL) {
        const img = document.createElement('img');
        img.src = photoURL;
        img.alt = '';
        img.addEventListener('error', showPlaceholder);
        avatar.appendChild(img);
    } else {
        showPlaceholder();
    }
    return avatar;
}

// Public profile data (users/<uid>) of comment authors, cached for the page
const userProfileCache = {}; // uid -> { nickname, minecraftName, photoURL } | null

async function loadUserProfiles(uids) {
    const missing = [...new Set(uids)].filter(uid => !(uid in userProfileCache));

    await Promise.all(missing.map(async (uid) => {
        try {
            const doc = await db.collection('users').doc(uid).get();
            userProfileCache[uid] = doc.exists ? doc.data() : null;
        } catch (err) {
            console.warn("Could not load the profile of", uid, err);
            userProfileCache[uid] = null;
        }
    }));
}

// Icon of a reaction: a custom <img> if "image" is set, otherwise the emoji
function createReactionIcon(reaction) {
    if (reaction.image) {
        const img = document.createElement('img');
        img.className = 'reaction-icon' + (reaction.pixelated ? ' pixelated' : '');
        img.src = reaction.image;
        img.alt = reaction.label;
        img.draggable = false;
        // If the file is missing, fall back to the emoji (or a placeholder)
        img.addEventListener('error', () => {
            img.replaceWith(createEl('span', 'reaction-icon-fallback', reaction.emoji || '❔'));
        });
        return img;
    }
    return createEl('span', 'reaction-icon-emoji', reaction.emoji || '❔');
}

/* ==========================================================================
   3. REACTION CONTROLLER (articles + anecdotes)
   ========================================================================== */
function createReactionController(collectionName, postId) {
    const listeners = [];
    let entries = [];            // { id, uid, nickname, reaction, createdAt }
    const pending = new Set();   // reaction keys with a write in flight (ignores double clicks)

    const reactionsRef = () => db.collection(collectionName).doc(postId).collection('reactions');
    const notify = () => listeners.forEach(fn => fn());

    const controller = {
        get entries() { return entries; },

        // Views register here and re-render whenever the data or login state changes
        onChange(fn) { listeners.push(fn); },

        // The logged-in user's entry for one reaction, or null
        getMine(key) {
            const user = firebase.auth().currentUser;
            return user ? (entries.find(e => e.uid === user.uid && e.reaction === key) || null) : null;
        },

        // One item per reaction with at least one vote, in REACTIONS order
        getSummary() {
            const user = firebase.auth().currentUser;
            return REACTIONS
                .map(r => {
                    const votes = entries.filter(e => e.reaction === r.key);
                    return {
                        ...r,
                        count: votes.length,
                        mine: !!user && votes.some(e => e.uid === user.uid),
                        names: votes.map(e => e.nickname || 'Uživatel')
                    };
                })
                .filter(item => item.count > 0);
        },

        // Returns the user, or opens the login modal and returns null
        requireLogin() {
            const user = firebase.auth().currentUser;
            if (!user) openLoginModal();
            return user;
        },

        async load() {
            try {
                const snap = await reactionsRef().get();
                entries = snap.docs.map(doc => ({ ...doc.data(), id: doc.id }));
            } catch (err) {
                console.error(`Failed to load reactions for ${collectionName}/${postId}:`, err);
                entries = [];
            }
            notify();
        },

        // Adds the reaction for the logged-in user, or removes it if they already used it
        async toggle(key) {
            const user = controller.requireLogin();
            if (!user || pending.has(key)) return false;
            pending.add(key);

            try {
                const existing = controller.getMine(key);

                if (existing) {
                    await reactionsRef().doc(existing.id).delete();
                    entries = entries.filter(e => e.id !== existing.id);
                } else {
                    const id = `${user.uid}_${key}`;
                    const entry = {
                        uid: user.uid,
                        nickname: await getDisplayName(user),
                        reaction: key,
                        createdAt: firebase.firestore.Timestamp.now()
                    };
                    await reactionsRef().doc(id).set(entry);
                    entries = [...entries.filter(e => e.id !== id), { ...entry, id }];
                }

                notify();
                return true;
            } catch (err) {
                reportReactionError(err);
                return false;
            } finally {
                pending.delete(key);
            }
        }
    };

    firebase.auth().onAuthStateChanged(() => notify());
    return controller;
}

/* ==========================================================================
   4. REACTION BAR (chips with counts + "add reaction" picker)
   ========================================================================== */
let popoverEl = null;

function closeReactionPopover() {
    if (popoverEl) {
        popoverEl.remove();
        popoverEl = null;
    }
}

// The picker is attached to <body> with fixed positioning so cards with
// overflow:hidden (anecdotes) can't clip it. It stays open so several
// reactions can be toggled in a row.
function openReactionPopover(anchor, controller) {
    closeReactionPopover();
    popoverEl = createEl('div', 'reaction-popover');

    REACTIONS.forEach(r => {
        const btn = createEl('button', 'reaction-popover-btn' + (controller.getMine(r.key) ? ' mine' : ''));
        btn.type = 'button';
        btn.appendChild(createReactionIcon(r));
        btn.title = r.label;
        btn.addEventListener('click', async () => {
            await controller.toggle(r.key);
            btn.classList.toggle('mine', !!controller.getMine(r.key));
        });
        popoverEl.appendChild(btn);
    });

    document.body.appendChild(popoverEl);

    const anchorRect = anchor.getBoundingClientRect();
    const popRect = popoverEl.getBoundingClientRect();
    const left = Math.max(10, Math.min(anchorRect.left, window.innerWidth - popRect.width - 10));
    let top = anchorRect.bottom + 6;
    if (top + popRect.height > window.innerHeight - 10) top = anchorRect.top - popRect.height - 6;

    popoverEl.style.left = left + 'px';
    popoverEl.style.top = top + 'px';
}

document.addEventListener('click', (e) => {
    if (popoverEl && !popoverEl.contains(e.target)) closeReactionPopover();
});
window.addEventListener('scroll', closeReactionPopover, true);
window.addEventListener('resize', closeReactionPopover);

// host: the element that will contain the chips
// alwaysShowAdd: true  = the "add reaction" button is visible even without any reactions
//                false = the whole bar stays hidden until there is at least one reaction
function renderReactionBar(host, controller, { alwaysShowAdd = false } = {}) {
    host.classList.add('reaction-bar');

    function render() {
        host.innerHTML = '';
        const summary = controller.getSummary();

        host.style.display = (summary.length || alwaysShowAdd) ? '' : 'none';
        if (!summary.length && !alwaysShowAdd) return;

        summary.forEach(item => {
            const chip = createEl('button', 'reaction-chip' + (item.mine ? ' mine' : ''));
            chip.type = 'button';

            const shownNames = item.names.slice(0, 10).join(', ') + (item.names.length > 10 ? '…' : '');
            chip.title = `${item.label}\n${shownNames}`;

            chip.append(
                createReactionIcon(item),
                createEl('span', 'reaction-chip-count', String(item.count))
            );
            chip.addEventListener('click', () => controller.toggle(item.key));
            host.appendChild(chip);
        });

        const addBtn = createEl('button', 'reaction-add-btn', summary.length ? '＋' : '＋ Přidat reakci');
        addBtn.type = 'button';
        addBtn.title = 'Přidat reakci';
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // otherwise the document click handler closes the picker at once
            if (!controller.requireLogin()) return;
            openReactionPopover(addBtn, controller);
        });
        host.appendChild(addBtn);
    }

    controller.onChange(render);
    render();
}

/* ==========================================================================
   5. COMMENT CONTROLLER (articles only)
   ========================================================================== */
function createCommentController(collectionName, postId) {
    const listeners = [];
    let comments = [];   // { id, uid, nickname, text, createdAt, updatedAt }

    const commentsRef = () => db.collection(collectionName).doc(postId).collection('comments');
    const notify = () => listeners.forEach(fn => fn());

    const controller = {
        get comments() { return comments; },

        onChange(fn) { listeners.push(fn); },

        requireLogin() {
            const user = firebase.auth().currentUser;
            if (!user) openLoginModal();
            return user;
        },

        async load() {
            try {
                const snap = await commentsRef().get();
                comments = snap.docs.map(doc => ({ ...doc.data(), id: doc.id }));
                await loadUserProfiles(comments.map(c => c.uid));
            } catch (err) {
                console.error(`Failed to load comments for ${collectionName}/${postId}:`, err);
                comments = [];
            }
            notify();
        },

        async add(text) {
            const user = controller.requireLogin();
            const clean = (text || '').trim();
            if (!user || !clean) return false;

            try {
                const now = firebase.firestore.Timestamp.now();
                const data = {
                    uid: user.uid,
                    nickname: await getDisplayName(user),
                    text: clean,
                    createdAt: now,
                    updatedAt: now
                };
                const ref = await commentsRef().add(data);
                await loadUserProfiles([user.uid]);
                comments = [...comments, { ...data, id: ref.id }];
                notify();
                return true;
            } catch (err) {
                reportReactionError(err);
                return false;
            }
        },

        async update(id, text) {
            const user = controller.requireLogin();
            const clean = (text || '').trim();
            if (!user || !clean) return false;

            try {
                const now = firebase.firestore.Timestamp.now();
                await commentsRef().doc(id).update({ text: clean, updatedAt: now });
                comments = comments.map(c => c.id === id ? { ...c, text: clean, updatedAt: now } : c);
                notify();
                return true;
            } catch (err) {
                reportReactionError(err);
                return false;
            }
        },

        async remove(id) {
            if (!controller.requireLogin()) return false;

            try {
                await commentsRef().doc(id).delete();
                comments = comments.filter(c => c.id !== id);
                notify();
                return true;
            } catch (err) {
                reportReactionError(err);
                return false;
            }
        }
    };

    firebase.auth().onAuthStateChanged(() => notify());
    return controller;
}

/* ==========================================================================
   6. COMMENTS SECTION (comment list + composer)
   ========================================================================== */
function renderCommentsSection(host, controller) {
    host.innerHTML = '';

    // Heading + list: hidden while there are no comments
    const listWrap = createEl('div', 'comments-list-wrap');
    const heading = createEl('h3', 'comments-title');
    const list = createEl('div', 'comments-list');
    listWrap.append(heading, list);

    // The composer is always present (otherwise nobody could write the first comment)
    const composerHost = createEl('div', 'comment-composer');
    host.append(listWrap, composerHost);

    // Inline edit state: which comment is being edited and its unsaved text
    let editingId = null;
    let editText = '';

    // The composer is rebuilt only when the login state changes,
    // so typed text and focus survive other updates
    let composerStateKey = null;

    function stopEditing() {
        editingId = null;
        editText = '';
        render();
    }

    function buildEditor(comment) {
        const wrap = createEl('div', 'comment-editor');

        const textarea = createEl('textarea', 'composer-text comment-edit-text');
        textarea.maxLength = MAX_COMMENT_LENGTH;
        textarea.value = editText;
        textarea.addEventListener('input', () => {
            editText = textarea.value;
            errorBox.textContent = '';
        });

        const errorBox = createEl('div', 'composer-error');

        const saveBtn = createEl('button', 'composer-submit small', 'Uložit');
        saveBtn.type = 'button';
        saveBtn.addEventListener('click', async () => {
            if (!textarea.value.trim()) {
                errorBox.textContent = 'Komentář nemůže být prázdný.';
                return;
            }
            saveBtn.disabled = true;
            if (await controller.update(comment.id, textarea.value)) {
                stopEditing();
            } else {
                saveBtn.disabled = false;
            }
        });

        const cancelBtn = createEl('button', 'composer-cancel', 'Zrušit');
        cancelBtn.type = 'button';
        cancelBtn.addEventListener('click', stopEditing);

        const actions = createEl('div', 'composer-actions');
        actions.append(saveBtn, cancelBtn);

        wrap.append(textarea, errorBox, actions);
        return wrap;
    }

    function buildComment(comment) {
        const user = firebase.auth().currentUser;
        const isMine = !!user && comment.uid === user.uid;
        const isEditing = isMine && editingId === comment.id;

        // Current profile data wins over the name saved with the comment
        const profile = userProfileCache[comment.uid] || null;
        const profileUrl = `profile.html?uid=${encodeURIComponent(comment.uid)}`;
        const displayName = (profile && profile.nickname) || comment.nickname || 'Uživatel';

        const item = createEl('div', 'comment-item');
        const body = createEl('div', 'comment-body');

        const wasEdited = comment.updatedAt && comment.createdAt
            && comment.updatedAt.toMillis() !== comment.createdAt.toMillis();

        const head = createEl('div', 'comment-head');

        const authorLink = createEl('a', 'comment-author', displayName);
        authorLink.href = profileUrl;
        head.appendChild(authorLink);

        // "aka <Minecraft name>" (skipped when it is the same as the display name)
        if (profile && profile.minecraftName
            && profile.minecraftName.toLowerCase() !== displayName.toLowerCase()) {
            head.appendChild(createEl('span', 'comment-aka', `aka ${profile.minecraftName}`));
        }

        head.appendChild(createEl('span', 'comment-date',
            formatReactionDate(comment.createdAt) + (wasEdited ? ' (upraveno)' : '')));
        body.appendChild(head);

        if (isEditing) {
            body.appendChild(buildEditor(comment));
        } else {
            body.appendChild(createEl('div', 'comment-text', comment.text));

            if (isMine) {
                const actions = createEl('div', 'comment-actions');

                const editBtn = createEl('button', 'comment-action-btn', 'Upravit');
                editBtn.type = 'button';
                editBtn.addEventListener('click', () => {
                    editingId = comment.id;
                    editText = comment.text;
                    render();

                    const textarea = list.querySelector('.comment-edit-text');
                    if (textarea) {
                        textarea.focus();
                        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
                    }
                });

                const deleteBtn = createEl('button', 'comment-action-btn delete', 'Smazat');
                deleteBtn.type = 'button';
                deleteBtn.addEventListener('click', async () => {
                    if (confirm('Opravdu chcete smazat tento komentář?')) {
                        await controller.remove(comment.id);
                    }
                });

                actions.append(editBtn, deleteBtn);
                body.appendChild(actions);
            }
        }

        item.append(createAvatar(profile && profile.photoURL, profileUrl), body);
        return item;
    }

    function renderComposer() {
        const user = firebase.auth().currentUser;
        const stateKey = !authKnown ? 'unknown' : (user ? user.uid : 'anon');
        if (stateKey === composerStateKey) return;

        composerStateKey = stateKey;
        composerHost.innerHTML = '';

        if (stateKey === 'unknown') return; // avoid flashing the "log in" prompt for logged-in users

        if (!user) {
            const prompt = createEl('div', 'composer-login');
            const loginBtn = createEl('button', 'composer-submit', 'Přihlásit se');
            loginBtn.type = 'button';
            loginBtn.addEventListener('click', openLoginModal);
            prompt.append(createEl('p', null, 'Pro přidání komentáře se musíte přihlásit.'), loginBtn);
            composerHost.appendChild(prompt);
            return;
        }

        const textarea = createEl('textarea', 'composer-text');
        textarea.placeholder = 'Napište komentář...';
        textarea.maxLength = MAX_COMMENT_LENGTH;

        const errorBox = createEl('div', 'composer-error');
        textarea.addEventListener('input', () => { errorBox.textContent = ''; });

        const submitBtn = createEl('button', 'composer-submit', 'Přidat komentář');
        submitBtn.type = 'button';
        submitBtn.addEventListener('click', async () => {
            if (!textarea.value.trim()) {
                errorBox.textContent = 'Napište prosím nějaký text.';
                return;
            }
            submitBtn.disabled = true;
            const ok = await controller.add(textarea.value);
            submitBtn.disabled = false;
            if (ok) textarea.value = '';
        });

        const actions = createEl('div', 'composer-actions');
        actions.appendChild(submitBtn);

        composerHost.append(
            createEl('div', 'composer-title', 'Přidat komentář'),
            textarea,
            errorBox,
            actions
        );
    }

    function render() {
        const sorted = [...controller.comments].sort((a, b) =>
            (a.createdAt ? a.createdAt.toMillis() : 0) - (b.createdAt ? b.createdAt.toMillis() : 0));

        listWrap.hidden = sorted.length === 0;
        heading.textContent = `Komentáře (${sorted.length})`;

        list.innerHTML = '';
        sorted.forEach(comment => list.appendChild(buildComment(comment)));

        renderComposer();
    }

    controller.onChange(render);
    render();
}