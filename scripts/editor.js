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
    blockWrapper.id = uniqueIdPrefix = uniqueId;
    blockWrapper.setAttribute('data-type', type);

    let innerFormHTML = '';

    if (type === 'paragraph') {
        innerFormHTML = `
            <div class=\"block-meta\">
                <span class=\"block-type-badge\">📝 Odstavec</span>\n                <button type=\"button\" class=\"remove-block-btn\" onclick=\"deleteBlockNode('${uniqueId}')\">Odstranit</button>\n            </div>\n            <textarea placeholder=\"Sem napiš text odstavce...\" required class=\"content-field\"></textarea>\n        `;
    } else if (type === 'image') {
        innerFormHTML = `
            <div class=\"block-meta\">\n                <span class=\"block-type-badge\">📷 Obrázek z terénu</span>\n                <button type=\"button\" class=\"remove-block-btn\" onclick=\"deleteBlockNode('${uniqueId}')\">Odstranit</button>\n            </div>\n            <input type=\"file\" accept=\"image/*\" required class=\"file-field\" style=\"display:block; width:100%; margin-bottom:10px; background:#f0f2f5; padding:8px; border-radius:4px;\">\n            <input type=\"text\" placeholder=\"Titulek pod obrázkem (nepovinné)...\" class=\"caption-field\">\n        `;
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
document.getElementById('editorForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    const submitBtn = document.getElementById('submitArticleBtn');
    submitBtn.innerText = "Nahrávání článku...";
    submitBtn.disabled = true;

    try {
        // Verification: Ensure an account session is still currently alive
        const currentUser = firebase.auth().currentUser;
        if (!currentUser) {
            alert("Chyba: K publikování článku musíte být přihlášeni!");
            submitBtn.innerText = "Odeslat do rotaček";
            submitBtn.disabled = false;
            return;
        }

        const title = document.getElementById('articleTitle').value.trim();
        const category = document.getElementById('articleCategory').value;
        const coverFileInput = document.getElementById('articleCover').files[0];
        const finalCoverCaption = document.getElementById('articleCoverCaption').value.trim();

        // 1. Upload Cover Image to Firebase Storage bucket paths
        let uploadedCoverUrl = "";
        if (coverFileInput) {
            const coverStorageRef = storage.ref(`covers/${Date.now()}_${coverFileInput.name}`);
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
            } else if (blockType === 'image') {
                const imgFileInput = blockElement.querySelector('.file-field').files[0];
                const captionValue = blockElement.querySelector('.caption-field').value.trim();

                if (imgFileInput) {
                    const blockImgStorageRef = storage.ref(`content_images/${Date.now()}_${imgFileInput.name}`);
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
        // Dynamically assigns author parameter to active account's nickname display attribute
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
        submitBtn.innerText = "Odeslat do rotaček";
        submitBtn.disabled = false;
    }
});