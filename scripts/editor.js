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
        // SWAPPED INPUT URL FOR LOCAL FILE CHIPS
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

// Helper function to safely stream individual files to Firebase Storage bucket
function uploadFileAsync(fileObject) {
    return new Promise((resolve, reject) => {
        if (!fileObject) {
            resolve("https://picsum.photos/800/500"); // Fallback safety asset
            return;
        }
        // Unique tracking paths based on precise system timestamps to avoid overwrites
        const uniqueFilename = `${Date.now()}_${fileObject.name}`;
        const storageRef = storage.ref(`articles/${uniqueFilename}`);
        
        storageRef.put(fileObject)
            .then(snapshot => snapshot.ref.getDownloadURL())
            .then(downloadURL => resolve(downloadURL))
            .catch(err => reject(err));
    });
}

// Master Submission Sequence Loop
document.getElementById('modularArticleForm').addEventListener('submit', async function(e) {
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

    // Change interface button state so Omega doesn't click twice while big images upload
    submitBtn.innerText = "Nahrávám obrázky a texty na server (Čekejte)...";
    submitBtn.disabled = true;

    try {
        const token = document.getElementById('secretToken').value.trim();
        const title = document.getElementById('title').value.trim();
        const category = document.getElementById('category').value;
        const coverCaptionInput = document.getElementById('coverCaption').value.trim();
        const finalCoverCaption = coverCaptionInput || `Snímek pořízen redaktorem SH_Omega`;

        // 1. Core Upload Action: Handle the main cover image file stream first
        const coverFileElement = document.getElementById('coverImageFile').files[0];
        const uploadedCoverUrl = await uploadFileAsync(coverFileElement);

        // 2. Loop and process content items arrays sequentially using async promises
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
                
                // Pause current loop thread execution until the binary upload returns its reference string link
                const uploadedInlineImageUrl = await uploadFileAsync(inlineFileObject);
                
                blocksPayloadArray.push({ 
                    type: "image", 
                    url: uploadedInlineImageUrl, 
                    caption: caption 
                });
            }
        }

        // 3. Request the document index count tracking string from Firestore collection node
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
            author: "SH_Omega",
            category: category,
            coverImage: uploadedCoverUrl,
            coverCaption: finalCoverCaption,
            date: firebase.firestore.Timestamp.now(),
            blocks: blocksPayloadArray,
            secretToken: token
        };

        // 5. Push clean payload configuration metadata to Firestore
        await db.collection("articles").doc(nextIdString).set(articleDocument);

        alert("Článek i se všemi obrázky byl úspěšně publikován!");
        window.location.href = "index.html";

    } catch (error) {
        console.error("Critical error in pipeline loop execution:", error);
        alert("Operace selhala! Zkontrolujte internetové připojení, správnost vašeho Tokenu, nebo zda jste nahráli správné soubory obrázků.");
        submitBtn.innerText = "Odeslat do rotaček";
        submitBtn.disabled = false;
    }
});