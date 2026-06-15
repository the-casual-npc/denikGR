document.addEventListener("DOMContentLoaded", () => {
    const adContainer = document.getElementById("dynamicAdContainer");
    if (!adContainer) return;

    // 1. Your pool manifest of images and videos
    const adPool = [
        "1.png",
        "2.png",
        "3.png",
        "4.png",
        "5.mp4",
        "6.mp4",
        "7.png",
        "8.gif",
        "9.png",
        "10.png"
    ];

    // Track the last seen index so the user doesn't get the same ad twice in a row
    let currentAdIndex = -1;

    function renderRandomAd() {
        if (adPool.length === 0) return;

        // Roll a new index that is different from the current one
        let randomIndex = Math.floor(Math.random() * adPool.length);
        if (adPool.length > 1) {
            while (randomIndex === currentAdIndex) {
                randomIndex = Math.floor(Math.random() * adPool.length);
            }
        }
        currentAdIndex = randomIndex;
        
        const chosenAsset = adPool[currentAdIndex];
        const assetPath = `img/ads/${chosenAsset}`;
        const isVideo = assetPath.match(/\.(mp4|webm|ogg|mov)$/i);

        if (isVideo) {
            // Note: 'loop' is removed so the 'ended' event listener can trigger
            adContainer.innerHTML = `
                <video id="adVideo" class="ad-media-element" autoplay playsinline>
                    <source src="${assetPath}" type="video/${chosenAsset.split('.').pop()}">
                    Váš prohlížeč nepodporuje přehrávání videa.
                </video>
                <button id="adMuteBtn" class="ad-mute-toggle" type="button" aria-label="Přepnout zvuk">🔊</button>
            `;

            const videoElement = document.getElementById("adVideo");
            const muteButton = document.getElementById("adMuteBtn");

            videoElement.volume = 0.1;

            // Attempt to play unmuted right away
            videoElement.muted = false;

            // Catch browser restriction rejections
            videoElement.play().catch(error => {
                // If blocked, mute the video so it can still autoplay silently
                videoElement.muted = true;
                muteButton.innerHTML = "🔇";
                videoElement.play();
            });

            // Handle manual toggle clicks
            muteButton.addEventListener("click", () => {
                if (videoElement.muted) {
                    videoElement.muted = false;
                    muteButton.innerHTML = "🔊";
                } else {
                    videoElement.muted = true;
                    muteButton.innerHTML = "🔇";
                }
            });

            // 2. CRITICAL CHANGE: Listen for the video ending, then switch the ad
            videoElement.addEventListener("ended", () => {
                renderRandomAd();
            });

        } else {
            // If it's an image, render it cleanly
            adContainer.innerHTML = `
                <img src="${assetPath}" alt="Reklamní sdělení" class="ad-media-element">
            `;
            
            // Optional: If you want images to cycle out too, uncomment below (e.g. after 10 seconds)
            // setTimeout(renderRandomAd, 10000);
        }
    }

    // Run the cycle engine initialization
    renderRandomAd();
});