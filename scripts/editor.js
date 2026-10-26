// scripts/editor.js

const workspace = document.getElementById('blocksWorkspace');
let blockCounter = 0;

// Track selected article IDs for the anecdote feature
let attachedArticleIds = new Set();

// Track selected anecdote IDs for the article feature
let attachedAnecdoteIds = new Set();

// Edit mode state (null = the form is creating something new)
let editingArticleId = null;
let editingArticleCoverUrl = null;
let editingArticleOriginalUrls = [];   // Storage files the article used before editing
let editingAnecdoteId = null;
let editingAnecdoteOriginalUrl = null;

// Global variable to lock down the active author profile dynamically
let currentLoggedAuthor = "Anonymní redaktor";

// Resolves once Firebase knows whether somebody is logged in
const authReady = new Promise((resolve) => {
    const unsubscribe = firebase.auth().onAuthStateChanged((user) => {
        unsubscribe();
        resolve(user);
    });
});

// Spawn an initial empty text block for articles on load
if (workspace) {
    createBlockNode('paragraph');
}

/* ==========================================================================
   0. AUTHENTICATION STATE OBSERVER (WITH MANUAL NICKNAME LOOKUP)
   ========================================================================== */
firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
        currentLoggedAuthor = user.displayName || user.email.split('@')[0];

        try {
            // auth.js stores nicknames under the user's UID
            const userDoc = await db.collection("users").doc(user.uid).get();
            if (userDoc.exists && userDoc.data().nickname) {
                currentLoggedAuthor = userDoc.data().nickname;
            }
        } catch (err) {
            console.error("Failed to read user nickname override:", err);
        }

        console.log("Active author identity locked:", currentLoggedAuthor);
    } else {
        currentLoggedAuthor = "Anonymní redaktor";
    }
});

/* ==========================================================================
   1. EDITING MODE SWITCHER OPERATIONS
   ========================================================================== */
const EDITOR_MODES = {
    article:  { container: 'articleWorkspaceContainer',  tab: 'modeBtnArticle' },
    anecdote: { container: 'anecdoteWorkspaceContainer', tab: 'modeBtnAnecdote' },
    manage:   { container: 'manageWorkspaceContainer',   tab: 'modeBtnManage' }
};

// Shows one workspace and highlights its tab (does not touch the edit state)
function showWorkspace(mode) {
    Object.entries(EDITOR_MODES).forEach(([name, ids]) => {
        const isActive = name === mode;
        document.getElementById(ids.container).style.display = isActive ? 'block' : 'none';
        document.getElementById(ids.tab).style.borderBottom = isActive
            ? '3px solid var(--text-color)'
            : '1px solid var(--border-color)';
    });

    // File inputs are optional while editing (the existing file is kept)
    document.getElementById('title').required = (mode === 'article');
    document.getElementById('coverCaption').required = (mode === 'article');
    document.getElementById('coverImageFile').required = (mode === 'article' && !editingArticleId);
    document.getElementById('anecdoteFile').required = !editingAnecdoteId;
}

window.switchEditorMode = function(mode) {
    // The tabs always open a clean form, so leave edit mode if we were in it
    if (editingArticleId) resetArticleForm();
    if (editingAnecdoteId) resetAnecdoteForm();

    showWorkspace(mode);
    if (mode === 'manage') loadManagerLists();
};

/* ==========================================================================
   2. ARTICLES DIALOG POPUP SELECTION ENGINE
   ========================================================================== */
window.openArticlesPopup = async function() {
    const popup = document.getElementById('articlesPopupModal');
    const grid = document.getElementById('popupArticlesGrid');
    popup.style.display = 'flex';
    grid.innerHTML = `<div style="text-align:center; padding:30px; color:var(--meta-text);">Načítám články z databáze...</div>`;

    try {
        const snapshot = await db.collection("articles").get();
        if (snapshot.empty) {
            grid.innerHTML = `<div style="text-align:center; padding:20px;">Nenalezeny žádné články.</div>`;
            return;
        }

        grid.innerHTML = "";
        snapshot.forEach(doc => {
            const data = doc.data();
            const id = doc.id;
            
            if (attachedArticleIds.has(id)) return;

            const title = data.title || "Bez názvu";
            const cover = data.coverImage || "https://picsum.photos/100";

            const row = document.createElement('div');
            row.className = 'popup-article-row';
            row.innerHTML = `
                <img src="${cover}" class="popup-row-thumb" alt="Kryt">
                <div class="popup-row-title">${title}</div>
                <div class="popup-row-badge">ID: ${id}</div>
            `;
            
            row.onclick = () => selectArticleRelation(id, title, cover);
            grid.appendChild(row);
        });

        if(grid.innerHTML === "") {
            grid.innerHTML = `<div style="text-align:center; padding:20px; color:var(--meta-text);">Všechny dostupné články již byly připojeny.</div>`;
        }

    } catch (err) {
        console.error("Popup build process error:", err);
        grid.innerHTML = `<div style="text-align:center; padding:20px; color:red;">Chyba při komunikaci s Firestore.</div>`;
    }
};

window.closeArticlesPopup = function() {
    document.getElementById('articlesPopupModal').style.display = 'none';
};

function selectArticleRelation(id, title, cover) {
    attachedArticleIds.add(id);
    closeArticlesPopup();

    const relationWorkspace = document.getElementById('selectedArticlesWorkspace');
    const block = document.createElement('div');
    block.className = 'selected-relation-block';
    block.id = `rel_block_${id}`;
    
    block.innerHTML = `
        <img src="${cover}" style="width:40px; height:40px; object-fit:cover; border-radius:3px;" alt="Náhled">
        <div style="flex:1; font-size:0.85rem; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${title}</div>
        <div style="font-size:0.75rem; color:var(--meta-text); margin-right:10px;">ID: ${id}</div>
        <button type="button" class="remove-block-btn" onclick="removeArticleRelation('${id}')" style="background:none; color:#ff4d4d; border:1px solid #ffccd0; padding:4px 10px; font-size:0.7rem; cursor:pointer; border-radius:4px;">Odstranit</button>
    `;
    
    relationWorkspace.appendChild(block);
}

window.removeArticleRelation = function(id) {
    attachedArticleIds.delete(id);
    const targetBlock = document.getElementById(`rel_block_${id}`);
    
    if (targetBlock) {
        targetBlock.classList.add('removing');
        setTimeout(() => {
            targetBlock.remove();
        }, 200);
    }
};

/* ==========================================================================
   2B. ANECDOTES DIALOG POPUP SELECTION ENGINE (for the article form)
   ========================================================================== */

// Builds a small preview element: <img> for images, a muted first-frame <video> for videos
function createAnecdoteThumb(anecdote, className, inlineStyle) {
    let thumb;
    if (anecdote.type === 'video') {
        thumb = document.createElement('video');
        thumb.src = anecdote.url + '#t=0.1';
        thumb.muted = true;
        thumb.preload = 'metadata';
        thumb.playsInline = true;
    } else {
        thumb = document.createElement('img');
        thumb.src = anecdote.url;
        thumb.alt = "Náhled";
    }
    if (className) thumb.className = className;
    if (inlineStyle) thumb.style.cssText = inlineStyle;
    return thumb;
}

window.openAnecdotesPopup = async function() {
    const popup = document.getElementById('anecdotesPopupModal');
    const grid = document.getElementById('popupAnecdotesGrid');
    popup.style.display = 'flex';
    grid.innerHTML = `<div style="text-align:center; padding:30px; color:var(--meta-text);">Načítám anekdoty z databáze...</div>`;

    try {
        const snapshot = await db.collection("anecdotes").get();
        if (snapshot.empty) {
            grid.innerHTML = `<div style="text-align:center; padding:20px;">Nenalezeny žádné anekdoty.</div>`;
            return;
        }

        const anecdotes = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (attachedAnecdoteIds.has(doc.id)) return;
            anecdotes.push({
                id: doc.id,
                author: data.author || "Neznámý autor",
                type: data.type || "image",
                url: data.url || "",
                date: data.date ? data.date.toDate().toLocaleDateString('cs-CZ') : ""
            });
        });

        // Newest first, same as the anecdotes page
        anecdotes.sort((a, b) => b.id.localeCompare(a.id));

        grid.innerHTML = "";
        anecdotes.forEach(anecdote => {
            const row = document.createElement('div');
            row.className = 'popup-article-row';

            const thumb = createAnecdoteThumb(anecdote, 'popup-row-thumb');

            const title = document.createElement('div');
            title.className = 'popup-row-title';
            title.textContent = `Anekdota od ${anecdote.author}` + (anecdote.date ? ` • ${anecdote.date}` : '');

            const badge = document.createElement('div');
            badge.className = 'popup-row-badge';
            badge.textContent = `ID: ${anecdote.id}`;

            row.append(thumb, title, badge);
            row.onclick = () => selectAnecdoteRelation(anecdote);
            grid.appendChild(row);
        });

        if (anecdotes.length === 0) {
            grid.innerHTML = `<div style="text-align:center; padding:20px; color:var(--meta-text);">Všechny dostupné anekdoty již byly připojeny.</div>`;
        }

    } catch (err) {
        console.error("Anecdotes popup build error:", err);
        grid.innerHTML = `<div style="text-align:center; padding:20px; color:red;">Chyba při komunikaci s Firestore.</div>`;
    }
};

window.closeAnecdotesPopup = function() {
    document.getElementById('anecdotesPopupModal').style.display = 'none';
};

function selectAnecdoteRelation(anecdote) {
    attachedAnecdoteIds.add(anecdote.id);
    closeAnecdotesPopup();

    const relationWorkspace = document.getElementById('selectedAnecdotesWorkspace');
    const block = document.createElement('div');
    block.className = 'selected-relation-block';
    // Separate prefix from the article relations so IDs never collide in the DOM
    block.id = `rel_anecdote_block_${anecdote.id}`;

    const thumb = createAnecdoteThumb(anecdote, null, 'width:40px; height:40px; object-fit:cover; border-radius:3px;');

    const title = document.createElement('div');
    title.style.cssText = 'flex:1; font-size:0.85rem; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
    title.textContent = `Anekdota od ${anecdote.author}`;

    const idLabel = document.createElement('div');
    idLabel.style.cssText = 'font-size:0.75rem; color:var(--meta-text); margin-right:10px;';
    idLabel.textContent = `ID: ${anecdote.id}`;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-block-btn';
    removeBtn.style.cssText = 'background:none; color:#ff4d4d; border:1px solid #ffccd0; padding:4px 10px; font-size:0.7rem; cursor:pointer; border-radius:4px;';
    removeBtn.textContent = 'Odstranit';
    removeBtn.addEventListener('click', () => removeAnecdoteRelation(anecdote.id));

    block.append(thumb, title, idLabel, removeBtn);
    relationWorkspace.appendChild(block);
}

window.removeAnecdoteRelation = function(id) {
    attachedAnecdoteIds.delete(id);
    const targetBlock = document.getElementById(`rel_anecdote_block_${id}`);

    if (targetBlock) {
        targetBlock.classList.add('removing');
        setTimeout(() => {
            targetBlock.remove();
        }, 200);
    }
};

/* ==========================================================================
   3. SHARED HELPERS
   ========================================================================== */

// Image or video, based on the MIME type (falls back to the file extension)
function detectMediaType(file) {
    if (file.type && file.type.startsWith('video/')) return 'video';
    if (file.type && file.type.startsWith('image/')) return 'image';
    const extension = file.name.split('.').pop().toLowerCase();
    return ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(extension) ? 'video' : 'image';
}

function getRelatedIds(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(id => String(id).trim()).filter(Boolean);
}

// Every Storage file an article uses (cover + inline images)
function collectArticleMediaUrls(articleData) {
    const urls = [articleData.coverImage];
    (articleData.blocks || []).forEach(block => {
        if (block.type === 'image') urls.push(block.url);
    });
    return urls.filter(Boolean);
}

// Best-effort delete of files in Firebase Storage (never throws)
async function deleteStorageFiles(urls) {
    for (const url of urls) {
        if (!url || !url.includes('firebasestorage')) continue;
        try {
            await storage.refFromURL(url).delete();
        } catch (err) {
            console.warn("Could not delete storage file:", url, err.code || err);
        }
    }
}

function formatDate(timestamp) {
    return timestamp ? timestamp.toDate().toLocaleDateString('cs-CZ') : '';
}

function formatDateTime(timestamp) {
    return timestamp
        ? timestamp.toDate().toLocaleString('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' })
        : '';
}

/* ==========================================================================
   4. ANECDOTE FORM (CREATE + UPDATE)
   ========================================================================== */
const anecdoteForm = document.getElementById('anecdoteForm');
if (anecdoteForm) {
    anecdoteForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        const user = firebase.auth().currentUser;
        if (!user) {
            alert("Pro zveřejnění anekdoty se musíte přihlásit.");
            return;
        }

        const editId = editingAnecdoteId;
        const isEditing = !!editId;
        const fileObj = document.getElementById('anecdoteFile').files[0];

        if (!fileObj && !isEditing) {
            alert("Prosím vyberte soubor k nahrání.");
            return;
        }

        const submitBtn = document.getElementById('anecdoteSubmitBtn');
        const idleLabel = isEditing ? "Aktualizovat anekdotu" : "Zveřejnit Anekdotu";
        submitBtn.innerText = isEditing ? "Ukládám změny..." : "Nahrávám anekdotu...";
        submitBtn.disabled = true;

        try {
            // Upload only if a (new) file was chosen
            let mediaUrl = null;
            let mediaType = null;
            if (fileObj) {
                mediaType = detectMediaType(fileObj);
                // Per-user folder so Storage rules can verify ownership
                const storagePath = `anecdotes/${user.uid}/${Date.now()}_${fileObj.name}`;
                const snapshot = await storage.ref(storagePath).put(fileObj);
                mediaUrl = await snapshot.ref.getDownloadURL();
            }

            if (isEditing) {
                const changes = {
                    "Related articles": Array.from(attachedArticleIds),
                    updatedAt: firebase.firestore.Timestamp.now()
                };
                if (mediaUrl) {
                    changes.url = mediaUrl;
                    changes.type = mediaType;
                }

                await db.collection("anecdotes").doc(editId).update(changes);

                // The old file is no longer used
                if (mediaUrl) await deleteStorageFiles([editingAnecdoteOriginalUrl]);

                resetAnecdoteForm();
                showWorkspace('manage');
                loadManagerLists();
            } else {
                const querySnapshot = await db.collection("anecdotes")
                    .orderBy(firebase.firestore.FieldPath.documentId(), "desc")
                    .limit(1)
                    .get();

                let nextIdString = "0001";
                if (!querySnapshot.empty) {
                    const numericId = parseInt(querySnapshot.docs[0].id, 10);
                    nextIdString = String(numericId + 1).padStart(4, '0');
                }

                await db.collection("anecdotes").doc(nextIdString).set({
                    author: document.getElementById('userMenuBtn').textContent.replace('▾', '').trim(),
                    authorUid: user.uid, // ownership key used by the security rules
                    date: firebase.firestore.Timestamp.now(),
                    type: mediaType,
                    url: mediaUrl,
                    "Related articles": Array.from(attachedArticleIds)
                });

                window.location.href = "anecdotes.html";
            }

        } catch (err) {
            console.error("Anecdote submission failed:", err);
            alert(err.code === 'permission-denied'
                ? "Nemáte oprávnění provést tuto operaci."
                : "Nahrávání anekdoty selhalo.");
            submitBtn.innerText = idleLabel;
            submitBtn.disabled = false;
        }
    });
}

function resetAnecdoteForm() {
    editingAnecdoteId = null;
    editingAnecdoteOriginalUrl = null;

    document.getElementById('anecdoteForm').reset();
    attachedArticleIds = new Set();
    document.getElementById('selectedArticlesWorkspace').innerHTML = '';

    document.getElementById('anecdoteCurrentPreview').style.display = 'none';
    document.getElementById('anecdoteHeading').innerText = 'Kompilátor Anekdot';
    document.getElementById('anecdoteCancelEditBtn').style.display = 'none';

    const submitBtn = document.getElementById('anecdoteSubmitBtn');
    submitBtn.innerText = 'Zveřejnit Anekdotu';
    submitBtn.disabled = false;
}

/* ==========================================================================
   5. ARTICLE FORM (CREATE + UPDATE)
   ========================================================================== */
// data (optional) prefills the block when editing an existing article
function createBlockNode(type, data) {
    blockCounter++;
    const uniqueId = `block_${blockCounter}`;

    const blockWrapper = document.createElement('div');
    blockWrapper.className = 'block-item';
    blockWrapper.id = uniqueId;
    blockWrapper.setAttribute('data-type', type);

    let innerFormHTML = '';

    if (type === 'paragraph') {
        innerFormHTML = `
            <div class="block-meta">
                <span class="block-type-badge">📝 Odstavec</span>
                <button type="button" class="remove-block-btn" onclick="deleteBlockNode('${uniqueId}')">Odstranit</button>
            </div>
            <textarea placeholder="Sem napiš text odstavce..." required class="content-field"></textarea>
        `;
    } else if (type === 'image') {
        innerFormHTML = `
            <div class="block-meta">
                <span class="block-type-badge">📷 Obrázek z terénu</span>
                <button type="button" class="remove-block-btn" onclick="deleteBlockNode('${uniqueId}')">Odstranit</button>
            </div>
            <input type="file" accept="image/*" required class="file-field" style="display:block; width:100%; margin-bottom:10px; background:#f0f2f5; padding:8px; border-radius:4px; box-sizing:border-box;">
            <input type="text" placeholder="Popisek pod obrázek (např. Pohled z okna radnice)" class="caption-field">
        `;
    } else if (type === 'blockquote') {
        innerFormHTML = `
            <div class="block-meta">
                <span class="block-type-badge">💬 Výpověď / Citace</span>
                <button type="button" class="remove-block-btn" onclick="deleteBlockNode('${uniqueId}')">Odstranit</button>
            </div>
            <textarea placeholder="„Sem vlož přímou řeč svědka...“" required class="content-field"></textarea>
        `;
    }

    blockWrapper.innerHTML = innerFormHTML;
    workspace.appendChild(blockWrapper);

    // Prefill when editing
    if (data) {
        if (type === 'paragraph' || type === 'blockquote') {
            blockWrapper.querySelector('.content-field').value = data.content || '';
        } else if (type === 'image') {
            blockWrapper.dataset.existingUrl = data.url || '';
            blockWrapper.querySelector('.caption-field').value = data.caption || '';

            const fileField = blockWrapper.querySelector('.file-field');
            fileField.required = false; // keep the current image unless a new one is chosen

            const note = document.createElement('div');
            note.className = 'current-media-note';
            const preview = document.createElement('img');
            preview.src = data.url;
            preview.alt = 'Současný obrázek';
            const hint = document.createElement('span');
            hint.textContent = 'Současný obrázek. Pokud nevyberete nový soubor, zůstane zachován.';
            note.append(preview, hint);
            blockWrapper.insertBefore(note, fileField);
        }
    }
}

window.deleteBlockNode = function(id) {
    const target = document.getElementById(id);
    if (target) target.remove();
};

function uploadFileAsync(fileObject) {
    return new Promise((resolve, reject) => {
        if (!fileObject) {
            resolve("https://picsum.photos/800/500");
            return;
        }

        const user = firebase.auth().currentUser;
        if (!user) {
            reject(new Error("Not logged in"));
            return;
        }

        // Per-user folder so Storage rules can verify ownership
        const storageRef = storage.ref(`articles/${user.uid}/${Date.now()}_${fileObject.name}`);

        storageRef.put(fileObject)
            .then(snapshot => snapshot.ref.getDownloadURL())
            .then(downloadURL => resolve(downloadURL))
            .catch(err => reject(err));
    });
}

const modularArticleForm = document.getElementById('modularArticleForm');
if (modularArticleForm) {
    modularArticleForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        const user = firebase.auth().currentUser;
        if (!user) {
            alert("Pro zveřejnění článku se musíte přihlásit.");
            return;
        }

        const editId = editingArticleId;
        const isEditing = !!editId;
        const submitBtn = document.getElementById('articleSubmitBtn');
        const idleLabel = isEditing ? "Aktualizovat článek" : "Zveřejnit článek";
        const DOMBlocks = workspace.querySelectorAll('.block-item');

        if (DOMBlocks.length === 0) {
            alert("Článek musí obsahovat alespoň jeden funkční modul!");
            return;
        }

        const firstBlockType = DOMBlocks[0].getAttribute('data-type');
        if (firstBlockType === 'image') {
            alert("Strukturální chyba: Prvním elementem článku nesmí být Obrázek, protože hned nad ním se zobrazuje velký náhledový krycí obrázek (Cover image).");
            return;
        }

        submitBtn.innerText = "Nahrávám obrázky a texty na server (Čekejte)...";
        submitBtn.disabled = true;

        try {
            const title = document.getElementById('title').value.trim();
            const category = document.querySelector('input[name="category"]:checked')?.value || "Aktuality";
            const coverCaptionInput = document.getElementById('coverCaption').value.trim();
            const finalCoverCaption = coverCaptionInput || `Snímek pořízen redaktorem ${currentLoggedAuthor}`;

            // Keep the existing cover when editing and no new file was chosen
            const coverFile = document.getElementById('coverImageFile').files[0];
            const coverUrl = (isEditing && !coverFile && editingArticleCoverUrl)
                ? editingArticleCoverUrl
                : await uploadFileAsync(coverFile);

            const blocksPayloadArray = [];

            for (let blockNode of DOMBlocks) {
                const type = blockNode.getAttribute('data-type');

                if (type === 'paragraph' || type === 'blockquote') {
                    const val = blockNode.querySelector('.content-field').value.trim();
                    blocksPayloadArray.push({ type: type, content: val });
                }
                else if (type === 'image') {
                    const inlineFile = blockNode.querySelector('.file-field').files[0];
                    const caption = blockNode.querySelector('.caption-field').value.trim();
                    const existingUrl = blockNode.dataset.existingUrl;

                    const imageUrl = (!inlineFile && existingUrl)
                        ? existingUrl
                        : await uploadFileAsync(inlineFile);

                    blocksPayloadArray.push({ type: "image", url: imageUrl, caption: caption });
                }
            }

            const articleFields = {
                title: title,
                category: category,
                coverImage: coverUrl,
                coverCaption: finalCoverCaption,
                blocks: blocksPayloadArray,
                "Related anecdotes": Array.from(attachedAnecdoteIds)
            };

            if (isEditing) {
                await db.collection("articles").doc(editId).update({
                    ...articleFields,
                    updatedAt: firebase.firestore.Timestamp.now()
                });

                // Remove images that were replaced or dropped during the edit
                const keptUrls = collectArticleMediaUrls(articleFields);
                await deleteStorageFiles(editingArticleOriginalUrls.filter(url => !keptUrls.includes(url)));

                resetArticleForm();
                showWorkspace('manage');
                loadManagerLists();
            } else {
                const querySnapshot = await db.collection("articles")
                    .orderBy(firebase.firestore.FieldPath.documentId(), "desc")
                    .limit(1)
                    .get();

                let nextIdString = "0001";
                if (!querySnapshot.empty) {
                    const numericId = parseInt(querySnapshot.docs[0].id, 10);
                    nextIdString = String(numericId + 1).padStart(4, '0');
                }

                await db.collection("articles").doc(nextIdString).set({
                    ...articleFields,
                    author: document.getElementById('userMenuBtn').textContent.replace('▾', '').trim(),
                    authorUid: user.uid, // ownership key used by the security rules
                    date: firebase.firestore.Timestamp.now()
                });

                window.location.href = "index.html";
            }

        } catch (error) {
            console.error("Critical error in pipeline loop execution:", error);
            alert(error.code === 'permission-denied'
                ? "Nemáte oprávnění provést tuto operaci."
                : "Operace selhala.");
            submitBtn.innerText = idleLabel;
            submitBtn.disabled = false;
        }
    });
}

function resetArticleForm() {
    editingArticleId = null;
    editingArticleCoverUrl = null;
    editingArticleOriginalUrls = [];

    document.getElementById('modularArticleForm').reset();
    workspace.innerHTML = '';
    createBlockNode('paragraph');
    attachedAnecdoteIds = new Set();
    document.getElementById('selectedAnecdotesWorkspace').innerHTML = '';

    document.getElementById('coverCurrentPreview').style.display = 'none';
    document.getElementById('articleHeading').innerText = 'Kompilátor Článků';
    document.getElementById('articleCancelEditBtn').style.display = 'none';

    const submitBtn = document.getElementById('articleSubmitBtn');
    submitBtn.innerText = 'Zveřejnit článek';
    submitBtn.disabled = false;
}

/* ==========================================================================
   6. "MY POSTS" MANAGER (LIST / EDIT / DELETE)
   ========================================================================== */
async function loadManagerLists() {
    const articlesList = document.getElementById('manageArticlesList');
    const anecdotesList = document.getElementById('manageAnecdotesList');
    const showMessage = (text, color) => {
        const html = `<div class="manage-empty"${color ? ` style="color:${color};"` : ''}>${text}</div>`;
        articlesList.innerHTML = html;
        anecdotesList.innerHTML = html;
    };

    showMessage('Načítám...');

    await authReady;
    const user = firebase.auth().currentUser;
    if (!user) {
        showMessage('Pro správu příspěvků se musíte přihlásit.');
        return;
    }

    try {
        // Equality-only queries need no composite index; sorting happens below
        const [articleSnap, anecdoteSnap] = await Promise.all([
            db.collection("articles").where("authorUid", "==", user.uid).get(),
            db.collection("anecdotes").where("authorUid", "==", user.uid).get()
        ]);

        renderManagerList(articlesList, sortNewestFirst(articleSnap.docs), 'article');
        renderManagerList(anecdotesList, sortNewestFirst(anecdoteSnap.docs), 'anecdote');
    } catch (err) {
        console.error("Failed to load the user's posts:", err);
        showMessage('Chyba při načítání příspěvků.', 'red');
    }
}

function sortNewestFirst(docs) {
    const millis = (doc) => doc.data().date ? doc.data().date.toMillis() : 0;
    return [...docs].sort((a, b) => millis(b) - millis(a));
}

function renderManagerList(container, docs, kind) {
    container.innerHTML = '';

    if (docs.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'manage-empty';
        empty.textContent = kind === 'article'
            ? 'Zatím jste nezveřejnili žádný článek.'
            : 'Zatím jste nezveřejnili žádnou anekdotu.';
        container.appendChild(empty);
        return;
    }

    docs.forEach((doc) => {
        const data = doc.data();
        let thumb, mainText, subText;

        if (kind === 'article') {
            thumb = createAnecdoteThumb(
                { type: 'image', url: data.coverImage || 'https://picsum.photos/100' },
                'manage-row-thumb'
            );
            mainText = data.title || 'Bez názvu';
            subText = [data.category, formatDate(data.date)].filter(Boolean).join(' • ');
        } else {
            thumb = createAnecdoteThumb({ type: data.type, url: data.url }, 'manage-row-thumb');
            mainText = formatDateTime(data.date) || 'Neznámé datum';
            subText = data.type === 'video' ? 'Video' : 'Obrázek';
        }

        const info = document.createElement('div');
        info.className = 'manage-row-info';
        const titleEl = document.createElement('div');
        titleEl.className = 'manage-row-title';
        titleEl.textContent = mainText;
        const subEl = document.createElement('div');
        subEl.className = 'manage-row-sub';
        subEl.textContent = subText;
        info.append(titleEl, subEl);

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'manage-btn';
        editBtn.textContent = 'Upravit';
        editBtn.addEventListener('click', () => {
            if (kind === 'article') startEditArticle(doc.id);
            else startEditAnecdote(doc.id);
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'manage-btn delete';
        deleteBtn.textContent = 'Smazat';
        deleteBtn.addEventListener('click', () => deleteEntry(kind, doc.id, mainText, data));

        const actions = document.createElement('div');
        actions.className = 'manage-row-actions';
        actions.append(editBtn, deleteBtn);

        const row = document.createElement('div');
        row.className = 'manage-row';
        row.append(thumb, info, actions);
        container.appendChild(row);
    });
}

async function deleteEntry(kind, id, label, data) {
    const noun = kind === 'article' ? 'článek' : 'anekdotu';
    if (!confirm(`Opravdu chcete smazat ${noun} „${label}“?\nTuto akci nelze vrátit zpět.`)) return;

        const collectionName = kind === 'article' ? 'articles' : 'anecdotes';

    try {
        const postRef = db.collection(collectionName).doc(id);

        // Remove the post's reactions/comments first (the rules allow the post owner to do this)
        const reactionsSnap = await postRef.collection('reactions').get();
        if (!reactionsSnap.empty) {
            const batch = db.batch();
            reactionsSnap.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
        }

        await postRef.delete();
    } catch (err) {
        console.error("Delete failed:", err);
        alert(err.code === 'permission-denied'
            ? "Nemáte oprávnění tento příspěvek smazat."
            : "Smazání se nezdařilo.");
        return;
    }
    
    // The Firestore document is gone; now clean up its files (best effort)
    await deleteStorageFiles(kind === 'article' ? collectArticleMediaUrls(data) : [data.url]);
    loadManagerLists();
}

async function startEditArticle(id) {
    try {
        const snap = await db.collection("articles").doc(id).get();
        if (!snap.exists) {
            alert("Článek nebyl nalezen.");
            loadManagerLists();
            return;
        }
        const data = snap.data();

        // Start from a clean form, then fill it
        resetArticleForm();
        editingArticleId = id;
        editingArticleCoverUrl = data.coverImage || null;
        editingArticleOriginalUrls = collectArticleMediaUrls(data);

        document.getElementById('title').value = data.title || '';
        document.querySelectorAll('input[name="category"]').forEach(radio => {
            radio.checked = (radio.value === data.category);
        });
        document.getElementById('coverCaption').value = data.coverCaption || '';

        // Current cover preview
        if (data.coverImage) {
            const preview = document.getElementById('coverCurrentPreview');
            const hint = document.createElement('span');
            hint.textContent = 'Současný náhledový obrázek. Pokud nevyberete nový soubor, zůstane zachován.';
            preview.innerHTML = '';
            preview.append(createAnecdoteThumb({ type: 'image', url: data.coverImage }, null), hint);
            preview.style.display = 'flex';
        }

        // Content blocks
        workspace.innerHTML = '';
        const knownTypes = ['paragraph', 'image', 'blockquote'];
        const blocks = (data.blocks || []).filter(block => knownTypes.includes(block.type));
        blocks.forEach(block => createBlockNode(block.type, block));
        if (blocks.length === 0) createBlockNode('paragraph');

        // Related anecdotes (skip any that no longer exist)
        const anecdoteSnaps = await Promise.all(
            getRelatedIds(data["Related anecdotes"]).map(relId => db.collection("anecdotes").doc(relId).get())
        );
        anecdoteSnaps.filter(s => s.exists).forEach(s => {
            const d = s.data();
            selectAnecdoteRelation({
                id: s.id,
                author: d.author || "Neznámý autor",
                type: d.type || "image",
                url: d.url || ""
            });
        });

        document.getElementById('articleHeading').innerText = 'Úprava článku';
        document.getElementById('articleSubmitBtn').innerText = 'Aktualizovat článek';
        document.getElementById('articleCancelEditBtn').style.display = 'flex';

        showWorkspace('article');
        window.scrollTo({ top: 0, behavior: 'smooth' });

    } catch (err) {
        console.error("Failed to open the article for editing:", err);
        alert("Článek se nepodařilo načíst k úpravě.");
    }
}

async function startEditAnecdote(id) {
    try {
        const snap = await db.collection("anecdotes").doc(id).get();
        if (!snap.exists) {
            alert("Anekdota nebyla nalezena.");
            loadManagerLists();
            return;
        }
        const data = snap.data();

        resetAnecdoteForm();
        editingAnecdoteId = id;
        editingAnecdoteOriginalUrl = data.url || null;

        // Current media preview
        const preview = document.getElementById('anecdoteCurrentPreview');
        const hint = document.createElement('span');
        hint.textContent = 'Současný soubor. Pokud nevyberete nový, zůstane zachován.';
        preview.innerHTML = '';
        preview.append(createAnecdoteThumb({ type: data.type, url: data.url }, null), hint);
        preview.style.display = 'flex';

        // Related articles (skip any that no longer exist)
        const articleSnaps = await Promise.all(
            getRelatedIds(data["Related articles"]).map(relId => db.collection("articles").doc(relId).get())
        );
        articleSnaps.filter(s => s.exists).forEach(s => {
            const d = s.data();
            selectArticleRelation(s.id, d.title || "Bez názvu", d.coverImage || "https://picsum.photos/100");
        });

        document.getElementById('anecdoteHeading').innerText = 'Úprava anekdoty';
        document.getElementById('anecdoteSubmitBtn').innerText = 'Aktualizovat anekdotu';
        document.getElementById('anecdoteCancelEditBtn').style.display = 'flex';

        showWorkspace('anecdote');
        window.scrollTo({ top: 0, behavior: 'smooth' });

    } catch (err) {
        console.error("Failed to open the anecdote for editing:", err);
        alert("Anekdotu se nepodařilo načíst k úpravě.");
    }
}

window.cancelEdit = function(kind) {
    if (kind === 'article') resetArticleForm();
    else resetAnecdoteForm();

    showWorkspace('manage');
    loadManagerLists();
};