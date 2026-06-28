// scripts/editor.js

const workspace = document.getElementById('blocksWorkspace');
let blockCounter = 0;

// Track selected article IDs for the anecdote feature
let attachedArticleIds = new Set(); 

// Global variable to lock down the active author profile dynamically
let currentLoggedAuthor = "Anonymní redaktor";

// Spawn an initial empty text block for articles on load
if (workspace) {
    createBlockNode('paragraph');
}

/* ==========================================================================
   0. AUTHENTICATION STATE OBSERVER (WITH MANUAL NICKNAME LOOKUP)
   ========================================================================== */
firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
        // 1. Core fallback baseline
        currentLoggedAuthor = user.displayName || user.email.split('@')[0];

        try {
            // 2. FIXED: Lookup custom nickname override using user.email instead of user.uniqueId
            const userDoc = await db.collection("users").doc(user.email).get();
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
window.switchEditorMode = function(mode) {
    const artWS = document.getElementById('articleWorkspaceContainer');
    const aneWS = document.getElementById('anecdoteWorkspaceContainer');
    const btnArt = document.getElementById('modeBtnArticle');
    const btnAne = document.getElementById('modeBtnAnecdote');

    if (mode === 'anecdote') {
        artWS.style.display = 'none';
        aneWS.style.display = 'block';
        btnArt.style.borderBottom = '1px solid var(--border-color)';
        btnAne.style.borderBottom = '3px solid var(--text-color)';
        
        // Remove 'required' parameters from article fields to avoid validation blocking
        document.getElementById('title').required = false;
        document.getElementById('coverImageFile').required = false;
        document.getElementById('coverCaption').required = false;
    } else {
        artWS.style.display = 'block';
        aneWS.style.display = 'none';
        btnAne.style.borderBottom = '1px solid var(--border-color)';
        btnArt.style.borderBottom = '3px solid var(--text-color)';

        // Re-enable validation parameters on article fields
        document.getElementById('title').required = true;
        document.getElementById('coverImageFile').required = true;
        document.getElementById('coverCaption').required = true;
    }
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
   3. ANECDOTE FIREBASE SUBMISSION PIPELINE (SMART ENGINE)
   ========================================================================== */
const anecdoteForm = document.getElementById('anecdoteForm');
if (anecdoteForm) {
    anecdoteForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const fileObj = document.getElementById('anecdoteFile').files[0];
        if (!fileObj) {
            alert("Prosím vyberte soubor k nahrání.");
            return;
        }

        const submitBtn = document.getElementById('anecdoteSubmitBtn');
        submitBtn.innerText = "Nahrávám anekdotu...";
        submitBtn.disabled = true;

        try {
            // AUTOMATED TYPE DETECTION: Inspect system mime type property safely
            let detectedType = 'image'; // Baseline default fallback
            if (fileObj.type && fileObj.type.startsWith('video/')) {
                detectedType = 'video';
            } else if (fileObj.type && fileObj.type.startsWith('image/')) {
                detectedType = 'image';
            } else {
                // Secondary fallback via common video formats extension verification
                const fileExtension = fileObj.name.split('.').pop().toLowerCase();
                const videoExtensions = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'mov'];
                if (videoExtensions.includes(fileExtension)) {
                    detectedType = 'video';
                }
            }

            // 1. Process upload directly using the auto-computed paths
            const storagePath = `anecdotes/${Date.now()}_${fileObj.name}`;
            const snapshot = await storage.ref(storagePath).put(fileObj);
            const downloadURL = await snapshot.ref.getDownloadURL();

            // 2. Resolve document increment index counts ('001', '002'...)
            const querySnapshot = await db.collection("anecdotes")
                .orderBy(firebase.firestore.FieldPath.documentId(), "desc")
                .limit(1)
                .get();

            let nextIdString = "0001";
            if (!querySnapshot.empty) {
                const highestDocId = querySnapshot.docs[0].id;
                const numericId = parseInt(highestDocId, 10);
                nextIdString = String(numericId + 1).padStart(4, '0');
            }

            // 3. Assemble complete structured document mapping currentLoggedAuthor profile
            const anecdoteDocument = {
                author: currentLoggedAuthor,
                date: firebase.firestore.Timestamp.now(),
                type: detectedType,
                url: downloadURL,
                "Related articles": Array.from(attachedArticleIds)
            };

            // 4. Save directly into Firestore database collection node
            await db.collection("anecdotes").doc(nextIdString).set(anecdoteDocument);
            window.location.href = "anecdotes.html";

        } catch (err) {
            console.error("Anecdote submission loop crashed:", err);
            alert("Nahrávání anekdoty selhalo.");
            submitBtn.innerText = "Zveřejnit Anekdotu";
            submitBtn.disabled = false;
        }
    });
}

/* ==========================================================================
   4. ARTICLE FORM LOGIC MODULAR PIPELINE (ORIGINAL)
   ========================================================================== */
function createBlockNode(type) {
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
        const uniqueFilename = `${Date.now()}_${fileObject.name}`;
        const storageRef = storage.ref(`articles/${uniqueFilename}`);
        
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

        const submitBtn = e.target.querySelector('.submit-btn');
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
            const category = document.getElementById('category').value;
            const coverCaptionInput = document.getElementById('coverCaption').value.trim();
            const finalCoverCaption = coverCaptionInput || `Snímek pořízen redaktorem ${currentLoggedAuthor}`;

            const coverFileElement = document.getElementById('coverImageFile').files[0];
            const uploadedCoverUrl = await uploadFileAsync(coverFileElement);

            let blocksPayloadArray = [];

            for (let blockNode of DOMBlocks) {
                const type = blockNode.getAttribute('data-type');
                
                if (type === 'paragraph') {
                    const val = blockNode.querySelector('.content-field').value.trim();
                    blocksPayloadArray.push({ type: "paragraph", content: val });
                } 
                else if (type === 'blockquote') {
                    const val = blockNode.querySelector('.content-field').value.trim();
                    blocksPayloadArray.push({ type: "blockquote", content: val });
                } 
                else if (type === 'image') {
                    const inlineFileObject = blockNode.querySelector('.file-field').files[0];
                    const caption = blockNode.querySelector('.caption-field').value.trim();
                    const uploadedInlineImageUrl = await uploadFileAsync(inlineFileObject);
                    
                    blocksPayloadArray.push({ 
                        type: "image", 
                        url: uploadedInlineImageUrl, 
                        caption: caption 
                    });
                }
            }

            const querySnapshot = await db.collection("articles")
                .orderBy(firebase.firestore.FieldPath.documentId(), "desc")
                .limit(1)
                .get();

            let nextIdString = "0001";
            if (!querySnapshot.empty) {
                const highestDocId = querySnapshot.docs[0].id;
                const numericId = parseInt(highestDocId, 10);
                nextIdString = String(numericId + 1).padStart(4, '0');
            }

            const articleDocument = {
                title: title,
                author: currentLoggedAuthor, // Automatically tracking active user account string
                category: category,
                coverImage: uploadedCoverUrl,
                coverCaption: finalCoverCaption,
                date: firebase.firestore.Timestamp.now(),
                blocks: blocksPayloadArray,
            };

            await db.collection("articles").doc(nextIdString).set(articleDocument);
            window.location.href = "index.html";

        } catch (error) {
            console.error("Critical error in pipeline loop execution:", error);
            alert("Operace selhala.");
            submitBtn.innerText = "Zveřejnit článek";
            submitBtn.disabled = false;
        }
    });
}