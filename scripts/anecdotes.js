// scripts/anecdotes.js

document.addEventListener("DOMContentLoaded", () => {
    initAnecdotesEngine();
    createLightboxElements();
});

// Primary lifecycle system loader
async function initAnecdotesEngine() {
    const feedContainer = document.getElementById("anecdotesFeedContainer");
    if (!feedContainer) return;

    try {
        // 1. Fetch all documents from 'anecdotes' ordered by ID descending
        const snapshot = await db.collection("anecdotes").get();
        
        if (snapshot.empty) {
            feedContainer.innerHTML = `<div class="anecdotes-loader-wrap">Zatím nebyly publikovány žádné anekdoty.</div>`;
            return;
        }

        // Clear loading indicators out
        feedContainer.innerHTML = "";

        // Memory cache containing array items mapped across indices to manage pagination state loops
        const anecdotesCollection = [];

        snapshot.forEach(doc => {
            const data = doc.data();
            anecdotesCollection.push({
                id: doc.id,
                author: data.author || "Neznámý autor",
                date: data.date ? data.date.toDate().toLocaleDateString('cs-CZ') : "Neznámé datum",
                type: data.type || "image",
                url: data.url || "",
                relatedIds: data["Related articles"] || []
            });

            console.log(`Anecdote ID: ${doc.id}, Author: ${data.author}, Type: ${data.type}, URL: ${data.url}`, data["Related articles"]);
        });

        // 2. Build DOM structural cards pipeline looping items array sequentially
        for (let anecdoteItem of anecdotesCollection) {
            const cardNode = buildAnecdoteCardNode(anecdoteItem);
            feedContainer.appendChild(cardNode);
        }

    } catch (error) {
        console.error("Pipeline failure collecting records payload documents:", error);
        feedContainer.innerHTML = `<div class="anecdotes-loader-wrap" style="color:red;">Chyba při stahování dat. Zkontrolujte připojení k databázi.</div>`;
    }
}

// Layout creation generator node parsing record structures
function buildAnecdoteCardNode(item) {
    const card = document.createElement("div");
    card.className = "card";

    // Build media DOM component matching item definitions tags
    let mediaHTML = "";
    if (item.type === "video") {
        mediaHTML = `<video src="${item.url}" muted loop playsinline></video>`;
    } else {
        mediaHTML = `<img src="${item.url}" alt="Anekdota od ${item.author}">`;
    }

    card.innerHTML = `
        <div class="anecdote-media-container" onclick="openMediaFullscreen('${item.url}', '${item.type}')">
            ${mediaHTML}
        </div>
        <div class="card-content">
            <div class="meta">Zveřejnil: <strong>${item.author}</strong> • ${item.date}</div>
            
            <div class="related-articles-section">
                <div class="related-title">
                    <span>Související články</span>
                    <div class="carousel-controls" class="controls-wrapper" style="display:none;">
                        <button class="carousel-btn prev-btn">◀</button>
                        <span class="counter-span" style="font-size:0.75rem;">1/1</span>
                        <button class="carousel-btn next-btn">▶</button>
                    </div>
                </div>
                <div class="related-articles-viewport">
                    <div style="font-size:0.8rem; color:var(--meta-text); font-style:italic;">Žádné provázané články.</div>
                </div>
            </div>
        </div>
    `;

    // Process article lookups asynchronously by passing elements directly
    if (item.relatedIds && item.relatedIds.length > 0) {
        const viewport = card.querySelector('.related-articles-viewport');
        const controls = card.querySelector('.carousel-controls');
        const counterSpan = card.querySelector('.counter-span');
        const prevBtn = card.querySelector('.prev-btn');
        const nextBtn = card.querySelector('.next-btn');

        fetchAndInjectRelatedArticles(item.relatedIds, viewport, controls, counterSpan, prevBtn, nextBtn);
    }

    return card;
}

// Sub-tier content delivery engine gathering specific reference documentation maps
async function fetchAndInjectRelatedArticles(articleIdsArray, viewport, controls, counterSpan, prevBtn, nextBtn) {
    const validArticlesPayload = [];

    // Map-loop asynchronous document structural fetches targeting single arrays
    for (let id of articleIdsArray) {
        try {
            // Document reference parsing exact string codes
            const docSnap = await db.collection("articles").doc(String(id)).get();
            if (docSnap.exists) {
                const data = docSnap.data();
                validArticlesPayload.push({
                    id: docSnap.id,
                    title: data.title || "Bez názvu",
                    cover: data.coverImage || "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=200",
                    date: data.date ? data.date.toDate().toLocaleDateString('cs-CZ') : ""
                });
            }
        } catch (e) {
            console.warn(`Could not trace interconnected article document index parameter: ${id}`, e);
        }
    }

    if (validArticlesPayload.length === 0) return;

    // Carousel current active state tracking parameters
    let activeCarouselIndex = 0;

    // Functional callback loop refreshing preview panels inline dynamically
    function renderActiveItem() {
        const activeArticle = validArticlesPayload[activeCarouselIndex];
        viewport.innerHTML = `
            <a href="article.html?id=${activeArticle.id}" class="mini-article-card">
                <img src="${activeArticle.cover}" class="mini-thumb" alt="Náhled">
                <div class="mini-details">
                    <div class="mini-title">${activeArticle.title}</div>
                    <div class="mini-meta">${activeArticle.date}</div>
                </div>
            </a>
        `;

        if (counterSpan) {
            counterSpan.innerText = `${activeCarouselIndex + 1}/${validArticlesPayload.length}`;
        }
    }

    renderActiveItem();

    // Enable button mechanics and append dynamic click handlers if multiple items are present
    if (validArticlesPayload.length > 1) {
        controls.style.display = "flex";
        
        prevBtn.addEventListener("click", () => {
            activeCarouselIndex = (activeCarouselIndex - 1 + validArticlesPayload.length) % validArticlesPayload.length;
            renderActiveItem();
        });

        nextBtn.addEventListener("click", () => {
            activeCarouselIndex = (activeCarouselIndex + 1) % validArticlesPayload.length;
            renderActiveItem();
        });
    }
}

// Lightbox Darkroom Dynamic DOM Generator Component
function createLightboxElements() {
    const lightbox = document.createElement("div");
    lightbox.className = "lightbox-overlay";
    lightbox.id = "globalLightbox";
    lightbox.innerHTML = `
        <button class="lightbox-close" id="closeLightboxBtn">&times;</button>
        <div class="lightbox-content" id="lightboxContentTarget"></div>
    `;
    document.body.appendChild(lightbox);

    // Event hooks to easily close the fullscreen display
    lightbox.addEventListener("click", (e) => {
        if (e.target === lightbox || e.target.id === "closeLightboxBtn") {
            lightbox.classList.remove("active");
            
            // Wait for the fade-out transition to complete before wiping source content
            setTimeout(() => {
                if(!lightbox.classList.contains('active')) {
                    document.getElementById("lightboxContentTarget").innerHTML = "";
                }
            }, 300);
        }
    });
}

// Open target inside fullscreen view container window frame
function openMediaFullscreen(mediaUrl, mediaType) {
    const lightbox = document.getElementById("globalLightbox");
    const container = document.getElementById("lightboxContentTarget");
    
    if (!lightbox || !container) return;
    
    if (mediaType === "video") {
        container.innerHTML = `<video src="${mediaUrl}" controls autoplay class="fullscreen-node"></video>`;
    } else {
        container.innerHTML = `<img src="${mediaUrl}" class="fullscreen-node" alt="Zvětšený náhled">`;
    }
    
    // Trigger animation frame class hook
    lightbox.classList.add("active");
}