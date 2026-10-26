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
            loadRelatedAnecdotes(doc.data()).catch(err => console.warn("Related anecdotes error:", err));

            // Turn off loading element and display the completed grid layout workspace
            document.getElementById('articleLoadingState').style.display = 'none';
            document.getElementById('articleWorkspace').style.display = 'block';
        } else {
            document.getElementById('articleLoadingState').innerHTML = `
                <p style="color:red; font-weight:bold;">Článek ID: "${articleId}" nenalezen...</p>
                <a href="index.html" style="margin-top:10px;">Zpět na hlavní stranu</a>
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
    document.title = `${data.title} | Deník.GR`;
    
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

            // Limit slice extraction array index depth values to 5 items
            const selectedArticles = articlesPool.slice(0, 5);

            renderSuggestionsHTML(selectedArticles);
        })
        .catch((error) => {
            console.error("Failed to fetch suggested articles:", error);
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

// ==========================================================================
// RELATED ANECDOTES
// ==========================================================================

// Field names accepted on the article document (first one found is used)
const RELATED_ANECDOTES_FIELDS = ["Related anecdotes", "Related Anecdotes", "relatedAnecdotes"];

function getRelatedAnecdoteIds(articleData) {
    const field = RELATED_ANECDOTES_FIELDS.find(
        name => articleData[name] !== undefined && articleData[name] !== null
    );
    if (!field) return [];

    const raw = articleData[field];
    const list = Array.isArray(raw) ? raw : [raw];
    const ids = list.map(id => String(id).trim()).filter(id => id !== "");
    return [...new Set(ids)];
}

async function loadRelatedAnecdotes(articleData) {
    const widget = document.getElementById('relatedAnecdotesWidget');
    if (!widget) return;

    const ids = getRelatedAnecdoteIds(articleData);
    if (ids.length === 0) return; // field missing or empty -> widget stays hidden

    const results = await Promise.all(ids.map(async (id) => {
        try {
            const snap = await db.collection("anecdotes").doc(id).get();
            if (!snap.exists) return null;
            const d = snap.data();
            return {
                id: snap.id,
                author: d.author || "Neznámý autor",
                type: d.type || "image",
                url: d.url || "",
                date: d.date ? d.date.toDate().toLocaleDateString('cs-CZ') : ""
            };
        } catch (e) {
            console.warn(`Could not load anecdote "${id}":`, e);
            return null;
        }
    }));

    const anecdotes = results.filter(a => a && a.url);
    if (anecdotes.length === 0) return; // none of the IDs were valid -> stay hidden

    const viewport = document.getElementById('anecdoteViewport');
    const controls = document.getElementById('anecdoteControls');
    const counter = document.getElementById('anecdoteCounter');
    const prevBtn = document.getElementById('anecdotePrevBtn');
    const nextBtn = document.getElementById('anecdoteNextBtn');
    let index = 0;

    function renderActive() {
        const a = anecdotes[index];
        viewport.innerHTML = '';

        const card = document.createElement('div');
        card.className = 'mini-anecdote-card';
        card.setAttribute('role', 'button');
        card.tabIndex = 0;
        card.addEventListener('click', () => openMediaFullscreen(a.url, a.type));
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openMediaFullscreen(a.url, a.type);
            }
        });

        let thumb;
        if (a.type === "video") {
            thumb = document.createElement('video');
            thumb.src = a.url + '#t=0.1'; // shows a frame as the preview
            thumb.muted = true;
            thumb.preload = 'metadata';
            thumb.playsInline = true;
        } else {
            thumb = document.createElement('img');
            thumb.src = a.url;
            thumb.alt = "Náhled anekdoty";
        }
        thumb.className = 'mini-thumb';

        const details = document.createElement('div');
        details.className = 'mini-details';

        const title = document.createElement('div');
        title.className = 'mini-title';
        title.textContent = `Od: ${a.author}`;

        const meta = document.createElement('div');
        meta.className = 'mini-meta';
        meta.textContent = a.date;

        details.append(title, meta);
        card.append(thumb, details);
        viewport.appendChild(card);

        counter.textContent = `${index + 1}/${anecdotes.length}`;
    }

    renderActive();

    if (anecdotes.length > 1) {
        controls.style.display = 'flex';
        prevBtn.addEventListener('click', () => {
            index = (index - 1 + anecdotes.length) % anecdotes.length;
            renderActive();
        });
        nextBtn.addEventListener('click', () => {
            index = (index + 1) % anecdotes.length;
            renderActive();
        });
    }

    widget.hidden = false;
}

// ---- Lightbox (created on first use) ----
function ensureLightbox() {
    let lightbox = document.getElementById('globalLightbox');
    if (lightbox) return lightbox;

    lightbox = document.createElement('div');
    lightbox.className = 'lightbox-overlay';
    lightbox.id = 'globalLightbox';
    lightbox.innerHTML = `
        <button class="lightbox-close" id="closeLightboxBtn" aria-label="Zavřít">&times;</button>
        <div class="lightbox-content" id="lightboxContentTarget"></div>
    `;
    document.body.appendChild(lightbox);

    const close = () => {
        lightbox.classList.remove('active');
        setTimeout(() => {
            if (!lightbox.classList.contains('active')) {
                document.getElementById('lightboxContentTarget').innerHTML = '';
            }
        }, 300);
    };

    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox || e.target.id === 'closeLightboxBtn') close();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close();
    });

    return lightbox;
}

function openMediaFullscreen(mediaUrl, mediaType) {
    const lightbox = ensureLightbox();
    const container = document.getElementById('lightboxContentTarget');
    container.innerHTML = '';

    const media = document.createElement(mediaType === 'video' ? 'video' : 'img');
    media.src = mediaUrl;
    if (mediaType === 'video') {
        media.controls = true;
        media.autoplay = true;
    } else {
        media.alt = "Zvětšený náhled";
    }
    container.appendChild(media);

    lightbox.classList.add('active');
}

// ==========================================================================
// STICKY SIDEBAR
// ==========================================================================
// If the sidebar fits below the header, it sticks right under it.
// If it is taller than the visible area, it scrolls with the page until its
// bottom edge is visible and then sticks there (no inner scrollbar needed).
function setupStickySidebar() {
    const aside = document.querySelector('.article-grid > aside');
    const header = document.querySelector('body > header');
    if (!aside || !header) return;

    const GAP = 20;

    function updateStickyTop() {
        const topWhenFits = header.offsetHeight + GAP;
        const topWhenTall = window.innerHeight - aside.offsetHeight - GAP;
        aside.style.setProperty('--aside-top', Math.min(topWhenFits, topWhenTall) + 'px');
    }

    updateStickyTop();
    window.addEventListener('resize', updateStickyTop);

    // Sidebar content loads asynchronously (related articles, anecdotes, ad),
    // and the workspace starts hidden, so re-measure whenever sizes change.
    if ('ResizeObserver' in window) {
        const observer = new ResizeObserver(updateStickyTop);
        observer.observe(aside);
        observer.observe(header);
    }
}

setupStickySidebar();