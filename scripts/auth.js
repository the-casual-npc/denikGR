const auth = firebase.auth();

// 1. Array of master administrator/editor account emails
const ADMIN_EMAILS = [
    "casual.npc.guy@gmail.com"
];

// Modal DOM Access Selectors
const authOverlay = document.getElementById('authOverlay');
const nicknameGroup = document.getElementById('nicknameFormGroup');
const authSubmitBtn = document.getElementById('authSubmitBtn');
const tabLogin = document.getElementById('tabLogin');
const tabRegister = document.getElementById('tabRegister');

// Base Modal Toggles (Delegated checking since DOM contents modify dynamically)
document.addEventListener('click', (e) => {
    // Open login modal
    if (e.target && e.target.id === 'openAuthBtn') {
        authOverlay.classList.add('active');
    }
    // Close login modal via button
    if (e.target && e.target.id === 'closeAuthBtn') {
        authOverlay.classList.remove('active');
    }
    // Close login modal via overlay background click
    if (e.target === authOverlay) {
        authOverlay.classList.remove('active');
    }
    
    // Dropdown structural click mechanics
    const userMenuBtn = document.getElementById('userMenuBtn');
    const userDropdown = document.getElementById('userDropdown');
    
    if (userMenuBtn && userDropdown) {
        if (userMenuBtn.contains(e.target)) {
            userDropdown.classList.toggle('open');
        } else if (!userDropdown.contains(e.target)) {
            // Close dropdown if clicking anywhere outside of it
            userDropdown.classList.remove('open');
        }
    }
});

// Client Tab Interceptor Mechanics
function switchAuthTab(mode) {
    const nicknameInput = document.getElementById('authNickname');

    if (mode === 'login') {
        tabLogin.classList.add('active');
        tabRegister.classList.remove('active');
        nicknameGroup.classList.remove('show');
        if (nicknameInput) nicknameInput.removeAttribute('required');
        authSubmitBtn.innerText = 'Přihlásit se';
    } else if (mode === 'register') {
        tabRegister.classList.add('active');
        tabLogin.classList.remove('active');
        nicknameGroup.classList.add('show');
        if (nicknameInput) nicknameInput.setAttribute('required', '');
        authSubmitBtn.innerText = 'Vytvořit účet';
    }
}

// Generic form submission handler
document.getElementById('authForm').addEventListener('submit', function(e) {
    e.preventDefault();
    
    const email = document.getElementById('authEmail').value;
    const password = document.getElementById('authPassword').value;
    const nickname = document.getElementById('authNickname').value;
    const isRegisterMode = document.getElementById('tabRegister').classList.contains('active');
    
    if (isRegisterMode) {
        auth.createUserWithEmailAndPassword(email, password)
            .then((userCredential) => {
                const user = userCredential.user;
                return user.updateProfile({ displayName: nickname });
            })
            .then(() => {
                alert('Registrace proběhla úspěšně.');
                closeAuthModalAndReset();
            })
            .catch((error) => { handleAuthError(error); });
    } else {
        auth.signInWithEmailAndPassword(email, password)
            .then(() => {
                alert('Přihlášení proběhlo úspěšně!');
                closeAuthModalAndReset();
            })
            .catch((error) => { handleAuthError(error); });
    }
});

// Setup Google Authentication Identity Provider
const googleProvider = new firebase.auth.GoogleAuthProvider();
const googleBtn = document.querySelector('.google-auth-btn');
if (googleBtn) {
    googleBtn.addEventListener('click', function() {
        auth.signInWithPopup(googleProvider)
            .then((result) => {
                alert(`Úspěšně přihlášen přes Google jako: ${result.user.displayName || result.user.email}`);
                closeAuthModalAndReset();
            })
            .catch((error) => { handleAuthError(error); });
    });
}

// Global Session Monitor Tracker Hook (Dynamic Dropdown Generator)
auth.onAuthStateChanged((user) => {
    setTimeout(() => {
        const authWrapper = document.getElementById('authWrapper');
        if (!authWrapper) return;
        
        if (user) {
            // Fetch identity payload
            const displayName = user.displayName || user.email.split('@')[0];
            
            // Check if the authenticated email exists inside our ADMIN_EMAILS array
            const isUserAdmin = user.email && ADMIN_EMAILS.map(e => e.toLowerCase()).includes(user.email.toLowerCase());
            
            // Generate a feature-rich dropdown layout panel inside the navbar wrapper
            authWrapper.innerHTML = `
                <button id="userMenuBtn" class="login-trigger-btn" style="border-color: var(--text-color); color: var(--text-color);">
                    ${displayName} ▾
                </button>
                <div id="userDropdown" class="user-dropdown-menu">
                    <button class="user-dropdown-item" onclick="alert('Coming soon: Úprava profilu')">Upravit Profil</button>
                    <button class="user-dropdown-item" onclick="alert('Coming soon: Nastavení')">Nastavení</button>
                    
                    ${isUserAdmin ? `<a href="editor.html" class="user-dropdown-item" style="color: var(--link-hover);">📝 Administrace/Editor</a>` : ''}
                    
                    <button id="logoutBtn" class="user-dropdown-item logout-item">Odhlásit se</button>
                </div>
            `;
            
            // Explicitly attach action callback hook onto generated log-out button link element
            document.getElementById('logoutBtn').addEventListener('click', () => {
                if (confirm('Opravdu se chcete odhlásit?')) {
                    auth.signOut().then(() => {
                        alert('Byli jste odhlášeni.');
                        window.location.reload();
                    });
                }
            });
            
        } else {
            // Fallback UI reset to primitive action button triggers if user session vanishes
            authWrapper.innerHTML = `<button id="openAuthBtn" class="login-trigger-btn">Přihlásit se</button>`;
        }
    }, 50);
});

// Clean overlay form structures
function closeAuthModalAndReset() {
    authOverlay.classList.remove('active');
    document.getElementById('authForm').reset();
}

// Friendly localization handler for typical Firebase structural exceptions
function handleAuthError(error) {
    console.error("Auth Error Code:", error.code, error.message);
    switch (error.code) {
        case 'auth/email-already-in-use':
            alert('Tento e-mail už používá jiný účet.');
            break;
        case 'auth/weak-password':
            alert('Heslo je příliš slabé. Zvolte alespoň 6 znaků.');
            break;
        case 'auth/wrong-password':
        case 'auth/user-not-found':
            alert('Nesprávný e-mail nebo heslo.');
            break;
        case 'auth/invalid-email':
            alert('Zadaná e-mailová adresa nemá správný formát.');
            break;
        default:
            alert(`Chyba: ${error.message}`);
    }
}