// scripts/category.js

// 1. Get the category name string out of the URL bar (defaults to "Aktuality")
const urlParams = new URLSearchParams(window.location.search);
const activeCategory = urlParams.get('name') || "Aktuality";

// Update the top heading title instantly to let the user know where they are
document.getElementById('categoryHeaderName').innerText = `Kategorie: ${activeCategory}`;
document.title = `${activeCategory} | Deník.GB`;

// 2. Query Firestore: filter articles matching the category, sorted newest first
db.collection("articles")
    .where("category", "==", activeCategory)
    .orderBy(firebase.firestore.FieldPath.documentId(), "desc")
    .get()
    .then((querySnapshot) => {
        const feedContainer = document.getElementById('categoryFeedContainer');
        feedContainer.innerHTML = ''; // Wipe out loading message

        if (querySnapshot.empty) {
            feedContainer.innerHTML = `<p style="color: #777; grid-column: 1/-1;">V této kategorii zatím nebyly publikovány žádné články.</p>`;
            return;
        }

        // Loop through all records matching this category criteria
        querySnapshot.forEach((doc) => {
            const article = doc.data();
            
            // Extract the first paragraph to use as a description preview snippet
            let previewText = "Zobrazit podrobnosti o tomto článku...";
            if (article.blocks && Array.isArray(article.blocks)) {
                const firstParagraph = article.blocks.find(block => block.type === 'paragraph');
                if (firstParagraph) {
                    previewText = firstParagraph.content;
                    if (previewText.length > 140) {
                        previewText = previewText.substring(0, 140) + "...";
                    }
                }
            }

            // Parse out the timestamp if it exists
            let displayDate = "Nedávno";
            if (article.date) {
                displayDate = article.date.toDate().toLocaleDateString('cs-CZ', {
                    day: 'numeric', month: 'long', year: 'numeric'
                });
            }

            // Create and append a card element matching your home sub-grid layout specs
            const card = document.createElement('article');
            card.className = 'card';
            card.innerHTML = `
                <a href="article.html?id=${doc.id}">
                    <img src="${article.coverImage || 'https://picsum.photos/500/350'}" alt="Obrázek Článku">
                </a>
                <div class="card-content">
                    <span class="category">${article.category || activeCategory}</span>
                    <h3 class="card-title"><a href="article.html?id=${doc.id}">${article.title}</a></h3>
                    <div class="meta">Vydáno: ${displayDate}</div>
                    <p style="margin-top: 10px; font-size: 0.9rem; color: #555; line-height: 1.4;">${previewText}</p>
                </div>
            `;
            
            feedContainer.appendChild(card);
        });
    })
    .catch((error) => {
        console.error("Chyba při stahování článků kategorie:", error);
        document.getElementById('categoryFeedContainer').innerHTML = `
            <p style="color: red; grid-column: 1/-1;">Nastala chyba při stahování článků z databáze.</p>
        `;
    });