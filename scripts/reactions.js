// scripts/reactions.js
// Shared reactions + comments engine for articles and anecdotes.
//
// Data model: <articles|anecdotes>/<postId>/reactions/<userUid>
//   { uid, nickname, reaction, comment, createdAt, updatedAt }
// One entry per user per post: the reaction is required, the comment is optional.

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
    { key: 'angry', emoji: '😡', label: 'Grrrr' }
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
    console.error("Reaction request failed:", err);
    alert(err.code === 'permission-denied'
        ? "Nemáte oprávnění provést tuto akci."
        : "Akci se nepodařilo dokončit. Zkuste to prosím znovu.");
}

/* ==========================================================================
   3. CONTROLLER (data + actions for one article / anecdote)
   ========================================================================== */
function createReactionController(collectionName, postId) {
    const listeners = [];
    let entries = [];

    const reactionsRef = () => db.collection(collectionName).doc(postId).collection('reactions');
    const notify = () => listeners.forEach(fn => fn());

    const controller = {
        get entries() { return entries; },

        // Views register here and re-render whenever the data or login state changes
        onChange(fn) { listeners.push(fn); },

        getMine() {
            const user = firebase.auth().currentUser;
            return user ? (entries.find(e => e.uid === user.uid) || null) : null;
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
                entries = snap.docs.map(doc => ({ ...doc.data(), uid: doc.id }));
            } catch (err) {
                console.error(`Failed to load reactions for ${collectionName}/${postId}:`, err);
                entries = [];
            }
            notify();
        },

        // Creates or updates the logged-in user's entry
        async save({ reaction, comment }) {
            const user = controller.requireLogin();
            if (!user) return false;

            try {
                const existing = controller.getMine();
                const now = firebase.firestore.Timestamp.now();

                await reactionsRef().doc(user.uid).set({
                    uid: user.uid,
                    nickname: await getDisplayName(user),
                    reaction: reaction,
                    comment: (comment || '').trim(),
                    createdAt: existing && existing.createdAt ? existing.createdAt : now,
                    updatedAt: now
                });

                await controller.load();
                return true;
            } catch (err) {
                reportReactionError(err);
                return false;
            }
        },

        async remove() {
            const user = controller.requireLogin();
            if (!user) return false;

            try {
                await reactionsRef().doc(user.uid).delete();
                await controller.load();
                return true;
            } catch (err) {
                reportReactionError(err);
                return false;
            }
        },

        // Chip / picker click: set this reaction, or remove it if it is already yours
        async quickToggle(key) {
            if (!controller.requireLogin()) return;
            const mine = controller.getMine();

            if (mine && mine.reaction === key) {
                if (mine.comment && !confirm('Odebráním reakce smažete také svůj komentář. Pokračovat?')) return;
                await controller.remove();
            } else {
                await controller.save({ reaction: key, comment: mine ? mine.comment : '' });
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
// overflow:hidden (anecdotes) can't clip it
function openReactionPopover(anchor, controller) {
    closeReactionPopover();

    const mine = controller.getMine();
    popoverEl = createEl('div', 'reaction-popover');

    REACTIONS.forEach(r => {
        const btn = createEl('button', 'reaction-popover-btn' + (mine && mine.reaction === r.key ? ' mine' : ''), r.emoji);
        btn.type = 'button';
        btn.title = r.label;
        btn.addEventListener('click', () => {
            closeReactionPopover();
            controller.quickToggle(r.key);
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
// alwaysShowAdd: false = hide the whole bar while there are no reactions (articles)
//                true  = keep the "add reaction" button visible (anecdotes)
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
                createEl('span', 'reaction-chip-emoji', item.emoji),
                createEl('span', 'reaction-chip-count', String(item.count))
            );
            chip.addEventListener('click', () => controller.quickToggle(item.key));
            host.appendChild(chip);
        });

        const addBtn = createEl('button', 'reaction-add-btn', summary.length ? '❤️＋' : 'Přidat reakci');
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
   5. COMMENTS SECTION (comment list + composer) - articles only
   ========================================================================== */
function renderCommentsSection(host, controller) {
    host.innerHTML = '';

    // Heading + list: hidden while there are no comments
    const listWrap = createEl('div', 'comments-list-wrap');
    const heading = createEl('h3', 'comments-title');
    const list = createEl('div', 'comments-list');
    listWrap.append(heading, list);

    // The composer is always present (otherwise nobody could post the first one)
    const composerHost = createEl('div', 'comment-composer');
    host.append(listWrap, composerHost);

    // Unsaved input. null = "untouched, follow the saved entry"
    const draft = { reaction: null, comment: null };

    async function confirmAndRemove() {
        if (!confirm('Opravdu chcete smazat svou reakci a komentář?')) return;
        if (await controller.remove()) {
            draft.reaction = null;
            draft.comment = null;
            render();
        }
    }

    function buildComment(entry) {
        const user = firebase.auth().currentUser;
        const isMine = !!user && entry.uid === user.uid;
        const reaction = REACTIONS.find(r => r.key === entry.reaction);

        const item = createEl('div', 'comment-item' + (isMine ? ' mine' : ''));

        const badge = createEl('div', 'comment-reaction', reaction ? reaction.emoji : '💬');
        if (reaction) badge.title = reaction.label;

        const body = createEl('div', 'comment-body');
        const head = createEl('div', 'comment-head');
        head.append(createEl('span', 'comment-author', entry.nickname || 'Uživatel'));

        const wasEdited = entry.updatedAt && entry.createdAt
            && entry.updatedAt.toMillis() !== entry.createdAt.toMillis();
        head.append(createEl('span', 'comment-date',
            formatReactionDate(entry.createdAt) + (wasEdited ? ' (upraveno)' : '')));

        body.append(head, createEl('div', 'comment-text', entry.comment));

        if (isMine) {
            const actions = createEl('div', 'comment-actions');

            const editBtn = createEl('button', 'comment-action-btn', 'Upravit');
            editBtn.type = 'button';
            editBtn.addEventListener('click', () => {
                composerHost.scrollIntoView({ behavior: 'smooth', block: 'center' });
                const textarea = composerHost.querySelector('.composer-text');
                if (textarea) textarea.focus({ preventScroll: true });
            });

            const deleteBtn = createEl('button', 'comment-action-btn delete', 'Smazat');
            deleteBtn.type = 'button';
            deleteBtn.addEventListener('click', confirmAndRemove);

            actions.append(editBtn, deleteBtn);
            body.appendChild(actions);
        }

        item.append(badge, body);
        return item;
    }

    function renderComposer() {
        composerHost.innerHTML = '';
        if (!authKnown) return; // avoid flashing the "log in" prompt for logged-in users

        const user = firebase.auth().currentUser;
        if (!user) {
            const prompt = createEl('div', 'composer-login');
            const loginBtn = createEl('button', 'composer-submit', 'Přihlásit se');
            loginBtn.type = 'button';
            loginBtn.addEventListener('click', openLoginModal);
            prompt.append(
                createEl('p', null, 'Bez přihlášení už ani krok.'),
                loginBtn
            );
            composerHost.appendChild(prompt);
            return;
        }

        const mine = controller.getMine();
        const selectedReaction = draft.reaction !== null ? draft.reaction : (mine ? mine.reaction : null);
        const commentText = draft.comment !== null ? draft.comment : (mine ? (mine.comment || '') : '');

        const errorBox = createEl('div', 'composer-error');

        // Reaction picker: radio buttons, so only one can be selected
        const picker = createEl('div', 'reaction-picker');
        picker.setAttribute('role', 'radiogroup');
        REACTIONS.forEach(r => {
            const label = createEl('label', 'reaction-option');
            const input = document.createElement('input');
            input.type = 'radio';
            input.name = 'composerReaction';
            input.value = r.key;
            input.checked = (r.key === selectedReaction);
            input.addEventListener('change', () => {
                draft.reaction = r.key;
                errorBox.textContent = '';
            });
            label.append(input, createEl('span', null, `${r.emoji} ${r.label}`));
            picker.appendChild(label);
        });

        const textarea = createEl('textarea', 'composer-text');
        textarea.placeholder = 'Napište komentář (nepovinné)...';
        textarea.maxLength = MAX_COMMENT_LENGTH;
        textarea.value = commentText;

        const submitBtn = createEl('button', 'composer-submit');
        submitBtn.type = 'button';

        const updateSubmitLabel = () => {
            submitBtn.textContent = mine
                ? 'Uložit změny'
                : (textarea.value.trim() ? 'Přidat komentář' : 'Přidat reakci');
        };
        updateSubmitLabel();

        textarea.addEventListener('input', () => {
            draft.comment = textarea.value;
            updateSubmitLabel();
        });

        submitBtn.addEventListener('click', async () => {
            const checked = picker.querySelector('input:checked');
            if (!checked) {
                errorBox.textContent = 'Vyberte prosím reakci.';
                return;
            }

            submitBtn.disabled = true;
            const ok = await controller.save({ reaction: checked.value, comment: textarea.value });
            if (ok) {
                draft.reaction = null;
                draft.comment = null;
                render();
            } else {
                submitBtn.disabled = false;
            }
        });

        const actions = createEl('div', 'composer-actions');
        actions.appendChild(submitBtn);

        if (mine) {
            const deleteBtn = createEl('button', 'composer-delete', 'Smazat');
            deleteBtn.type = 'button';
            deleteBtn.addEventListener('click', confirmAndRemove);
            actions.appendChild(deleteBtn);
        }

        composerHost.append(
            createEl('div', 'composer-title', mine ? 'Vaše reakce a komentář' : 'Přidat reakci nebo komentář'),
            picker,
            textarea,
            errorBox,
            actions
        );
    }

    function render() {
        // Only entries with text are comments; reaction-only entries show up in the counts
        const comments = controller.entries
            .filter(e => e.comment && e.comment.trim())
            .sort((a, b) => (a.createdAt ? a.createdAt.toMillis() : 0) - (b.createdAt ? b.createdAt.toMillis() : 0));

        listWrap.hidden = comments.length === 0;
        heading.textContent = `Komentáře (${comments.length})`;

        list.innerHTML = '';
        comments.forEach(entry => list.appendChild(buildComment(entry)));

        renderComposer();
    }

    controller.onChange(render);
    render();
}