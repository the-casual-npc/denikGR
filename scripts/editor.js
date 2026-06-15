// scripts/editor.js

const workspace = document.getElementById('blocksWorkspace');
let blockCounter = 0;

// Spawn an initial empty text block
createBlockNode('paragraph');

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
            <input type="file" accept="image/*" required class="file-field" style="display:block; width:100%; margin-bottom:10px; background:var(--secondary-bg); padding:8px; border-radius:4px; color:var(--text-color); border:1px solid var(--border-color);">
            <input type="text" placeholder="Titulek pod obrázkem (nepovinné)..." class="caption-field">
        `;
    } else if (type === 'blockquote') {
        innerFormHTML = `
            <div class="block-meta">
                <span class="block-type-badge">💬 Výpověď / Citace</span>
                <button type="button" class="remove-block-btn" onclick="deleteBlockNode('${uniqueId}')">Odstranit</button>
            </div>
            <textarea placeholder="„Sem napiš citaci svědka nebo citovanou osobu...“" required class="content-field" style="font-style: italic; border-left: 3px solid var(--link-hover);"></textarea>
            <input type="text" placeholder="- Jméno autora citace (např. Jan Žižka, místní občan)" class="citation-author-field" style="margin-top: 8px; width: 100%;">
        `;
    }

    blockWrapper.innerHTML = innerFormHTML;
    workspace.appendChild(blockWrapper);
}

function deleteBlockNode(id) {
    const targetBlock = document.getElementById(id);
    if (targetBlock) {
        targetBlock.remove();
    }
}

// Global Submission Pipeline execution Interceptor Hook
document.getElementById('modularArticleForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    // Query submit button directly using form context class
    const submitBtn = this.querySelector('.submit-btn');
    const originalBtnText = submitBtn.innerText;
    
    submitBtn.innerText = "Nahrávání článku...";
    submitBtn.disabled = true;

    try {
        // Verification: Ensure an account session is still currently alive
        const currentUser = firebase.auth().currentUser;
        if (!currentUser) {
            alert("Chyba: K publikování článku musíte být přihlášeni!");
            submitBtn.innerText = originalBtnText;
            submitBtn.disabled = false;
            return;
        }

        // Corrected mapping IDs to match your precise HTML values
        const title = document.getElementById('title').value.trim();
        const category = document.getElementById('category').value;
        const coverFileInput = document.getElementById('coverImageFile').files[0];
        const finalCoverCaption = document.getElementById('coverCaption').value.trim();

        // 1. Upload Cover Image to Firebase Storage bucket paths
        let uploadedCoverUrl = "";
        // Safely check for storage availability since it gets initiated elsewhere
        const storageInstance = typeof storage !== 'undefined' ? storage : firebase.storage();
        
        if (coverFileInput) {
            const coverStorageRef = storageInstance.ref(`covers/${Date.now()}_${coverFileInput.name}`);
            const uploadSnapshot = await coverStorageRef.put(coverFileInput);
            uploadedCoverUrl = await uploadSnapshot.ref.getDownloadURL();
        }

        // 2. Loop compile arrays building child blocks configurations structural components
        const blockElementsArray = workspace.querySelectorAll('.block-item');
        const blocksPayloadArray = [];

        for (let blockElement of blockElementsArray) {
            const blockType = blockElement.getAttribute('data-type');
            
            if (blockType === 'paragraph') {
                const textValue = blockElement.querySelector('.content-field').value.trim();
                blocksPayloadArray.push({
                    type: 'paragraph',
                    value: textValue
                });
            } else if (blockType === 'blockquote') {
                const quoteValue = blockElement.querySelector('.content-field').value.trim();
                const authorValue = blockElement.querySelector('.citation-author-field').value.trim();
                blocksPayloadArray.push({
                    type: 'blockquote',
                    value: quoteValue,
                    author: authorValue
                });
            } else if (blockType === 'image') {
                const imgFileInput = blockElement.querySelector('.file-field').files[0];
                const captionValue = blockElement.querySelector('.caption-field').value.trim();

                if (imgFileInput) {
                    const blockImgStorageRef = storageInstance.ref(`content_images/${Date.now()}_${imgFileInput.name}`);
                    const imgUploadSnapshot = await blockImgStorageRef.put(imgFileInput);
                    const imgDownloadUrl = await imgUploadSnapshot.ref.getDownloadURL();

                    blocksPayloadArray.push({
                        type: 'image',
                        value: imgDownloadUrl,
                        caption: captionValue
                    });
                }
            }
        }

        // 3. Fetch Next Custom Incremented String ID Identifier from Firestore collection node
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

        // 4. Group data parameters into structural JSON formats blueprint
        const articleDocument = {
            title: title,
            author: currentUser.displayName || currentUser.email.split('@')[0],
            category: category,
            coverImage: uploadedCoverUrl,
            coverCaption: finalCoverCaption,
            date: firebase.firestore.Timestamp.now(),
            blocks: blocksPayloadArray
        };

        // 5. Push clean payload configuration metadata to Firestore
        await db.collection("articles").doc(nextIdString).set(articleDocument);

        alert("Článek i se všemi obrázky byl úspěšně publikován!");
        window.location.href = "index.html";

    } catch (error) {
        console.error("Critical error in pipeline loop execution:", error);
        alert("Operace selhala! Zkontrolujte internetové připojení, vaše oprávnění k zápisu, nebo formát obrázků.");
        submitBtn.innerText = originalBtnText;
        submitBtn.disabled = false;
    }
});