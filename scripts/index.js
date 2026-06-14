// scripts/index.js

// 1. Fetch up to 5 newest documents using the zero-padded string ID descending sorting order
db.collection("articles")
    .orderBy(firebase.firestore.FieldPath.documentId(), "desc")
    .get()
    .then((querySnapshot) => {
        let sortedArticles = [];

        querySnapshot.forEach((doc) => {
            sortedArticles.push({
                id: doc.id,
                data: doc.data()
            });
        });

        // 2. Hand data off to rendering pipelines if records exist
        if (sortedArticles.length > 0) {
            const latestFeatured = sortedArticles[0]; // Highest ID string
            const olderGridItems = sortedArticles.slice(1); // The following 4 items

            renderFeaturedHTML(latestFeatured);
            renderSubGridHTML(olderGridItems);
        } else {
            document.getElementById('featuredContainer').innerHTML = "<p style='padding:20px; color:#666;'>Zatím nebyly vydány žádné články.</p>";
            document.getElementById('subGridContainer').innerHTML = "";
        }
    })
    .catch((error) => {
        console.error("Chyba při komunikaci s Firestore:", error);
        document.getElementById('featuredContainer').innerHTML = "<p style='color:red; padding:20px;'>Nepodařilo se načíst data z databáze.</p>";
    });

// 3. Inject the dominant Top Article
function renderFeaturedHTML(item) {
    const container = document.getElementById('featuredContainer');
    const article = item.data;

    // Scan your modular array and pick out the very first paragraph block for the home synopsis snippet
    let previewText = "Kliknutím otevřete kompletní podrobnosti o tomto článku...";
    if (article.blocks && Array.isArray(article.blocks)) {
        const firstParagraphBlock = article.blocks.find(block => block.type === 'paragraph');
        if (firstParagraphBlock) {
            previewText = firstParagraphBlock.content;
            // Trim down if paragraph string is incredibly lengthy
            if (previewText.length > 180) {
                previewText = previewText.substring(0, 180) + "...";
            }
        }
    }

    // Date converter format setup
    let displayDate = "Nedávno";
    if (article.date) {
        displayDate = article.date.toDate().toLocaleDateString('cs-CZ', {
            day: 'numeric', month: 'long', year: 'numeric'
        });
    }

    container.innerHTML = `
        <article class="card">
            <a href="article.html?id=${item.id}">
                <img src="${article.coverImage || 'https://picsum.photos/800/500'}" alt="Hlavní Obrázek">
            </a>
            <div class="card-content">
                <span class="category">${article.category || 'Aktuality'}</span>
                <h2 class="card-title"><a href="article.html?id=${item.id}">${article.title}</a></h2>
                <div class="meta">Vydáno: ${displayDate}</div>
                <p>${previewText}</p>
            </div>
        </article>
    `;
}

// 4. Inject the underlying 4 grid cards
function renderSubGridHTML(articlesList) {
    const container = document.getElementById('subGridContainer');
    container.innerHTML = ''; // Wipe pre-existing placeholder examples clean

    if (articlesList.length === 0) {
        return; // Safe exit if there's only 1 post total in database
    }

    articlesList.forEach(item => {
        const article = item.data;
        const card = document.createElement('article');
        card.className = 'card';

        let displayDate = "Nedávno";
        if (article.date) {
            displayDate = article.date.toDate().toLocaleDateString('cs-CZ', {
                day: 'numeric', month: 'long', year: 'numeric'
            });
        }

        card.innerHTML = `
            <a href="article.html?id=${item.id}">
                <img src="${article.coverImage || 'https://picsum.photos/500/350'}" alt="Miniatura">
            </a>
            <div class="card-content">
                <span class="category">${article.category || 'Aktuality'}</span>
                <h3 class="card-title"><a href="article.html?id=${item.id}">${article.title}</a></h3>
                <div class="meta">${displayDate}</div>
            </div>
        `;
        
        container.appendChild(card);
    });
}