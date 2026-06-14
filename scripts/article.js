// scripts/article.js

// 1. Instantly parse the query parameter from the URL bar
const urlParams = new URLSearchParams(window.location.search);
const articleId = urlParams.get('id') || "0001";

// 2. Query Firestore using the global 'db' reference
db.collection("articles").doc(articleId).get()
    .then((doc) => {
        if (doc.exists) {
            // Populate data into placeholders
            renderArticleHTML(doc.data());
            
            // Trigger recommendations engine passing the current ID to filter it out
            fetchRandomSuggestions(articleId);

            // Turn off loading element and display the completed grid layout workspace
            document.getElementById('articleLoadingState').style.display = 'none';
            document.getElementById('articleWorkspace').style.display = 'block';
        } else {
            document.getElementById('articleLoadingState').innerHTML = `
                <p style="color:red; font-weight:bold;">Článek s ID "${articleId}" nebyl v databázi nalezen.</p>
                <a href="index.html" style="margin-top:10px; color:#111;">Zpět na hlavní stranu</a>
            `;
        }
    })
    .catch((error) => {
        console.error("Database read error:", error);
        document.getElementById('articleLoadingState').innerHTML = `<p style="color:red;">Nastala chyba při stahování dat.</p>`;
    });

// 3. Keep your page-painting function cleanly structured
function renderArticleHTML(data) {
    document.querySelector('.article-title').innerText = data.title;
    document.title = `${data.title} | Deník.GB`;
    
    // Update all matching class elements (Breadcrumb and Content header tag together)
    document.querySelectorAll('.categorySwap').forEach(el => {
        el.innerText = data.category || "Aktuality";
        if(el.tagName === 'A') {
            el.href = `category.html?name=${encodeURIComponent(data.category || 'Aktuality')}`;
        }
    });

    document.querySelector('.author').innerText = data.author || "SH_Omega";

    // Safely verify cover image assets exist before display assignments
    if (data.coverImage) {
        document.getElementById('mainCoverImg').src = data.coverImage;
        document.getElementById('mainCoverCaption').innerText = data.coverCaption || "";
        document.getElementById('mainCoverContainer').style.display = 'block';
    } else {
        document.getElementById('mainCoverContainer').style.display = 'none';
    }

    // Format Dates nicely using native locale standards
    if (data.date) {
        const formattedDate = data.date.toDate().toLocaleDateString('cs-CZ', {
            month: 'long', day: 'numeric', year: 'numeric'
        });
        document.querySelector('.date').innerText = formattedDate;
    } else {
        document.querySelector('.date').innerText = "Nedávno";
    }

    const contentDiv = document.querySelector('.content');
    contentDiv.innerHTML = ''; // Wipe fallback design configurations

    if (data.blocks && Array.isArray(data.blocks)) {
        data.blocks.forEach(block => {
            switch (block.type) {
                case "paragraph":
                    const p = document.createElement('p');
                    p.innerText = block.content;
                    contentDiv.appendChild(p);
                    break;

                case "image":
                    const imgWrap = document.createElement('div');
                    imgWrap.classList.add('featured-image-container');
                    imgWrap.innerHTML = `
                        <img src="${block.url}" alt="Obrázek v článku">
                        <div class="image-caption">${block.caption || ''}</div>
                    `;
                    contentDiv.appendChild(imgWrap);
                    break;

                case "blockquote":
                    const bq = document.createElement('blockquote');
                    bq.innerText = block.content;
                    contentDiv.appendChild(bq);
                    break;
            }
        });
    }
}

// 4. Fetch random recommendations while hiding the active viewer element code loop
function fetchRandomSuggestions(excludeId) {
    db.collection("articles").get()
        .then((querySnapshot) => {
            let articlesPool = [];

            querySnapshot.forEach((doc) => {
                // Only collect records that aren't the one we are actively viewing
                if (doc.id !== excludeId) {
                    articlesPool.push({
                        id: doc.id,
                        data: doc.data()
                    });
                }
            });

            // Randomize array index layout positions
            articlesPool.sort(() => 0.5 - Math.random());

            // Limit slice extraction array index depth values to 3 items
            const selectedArticles = articlesPool.slice(0, 3);

            renderSuggestionsHTML(selectedArticles);
        })
        .catch((error) => {
            console.error("Chyba při stahování dalších článků:", error);
        });
}

function renderSuggestionsHTML(articlesList) {
    const container = document.getElementById('randomArticlesContainer');
    container.innerHTML = '';

    if (articlesList.length === 0) {
        container.innerHTML = '<li style="font-size:0.85rem; color:#777; padding: 10px 0;">Žádné další články nejsou k dispozici.</li>';
        return;
    }

    articlesList.forEach(item => {
        const article = item.data;
        const li = document.createElement('li');
        li.className = 'related-item';

        let displayDate = "Nedávno";
        if (article.date) {
            displayDate = article.date.toDate().toLocaleDateString('cs-CZ', {
                day: 'numeric', month: 'long', year: 'numeric'
            });
        }

        li.innerHTML = `
            <img class="related-thumb" src="${article.coverImage || 'https://picsum.photos/100/100'}" alt="Miniatura">
            <div class="related-content">
                <a href="article.html?id=${item.id}">${article.title}</a>
                <div class="related-meta">${displayDate}</div>
            </div>
        `;
        
        container.appendChild(li);
    });
}