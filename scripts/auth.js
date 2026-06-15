const auth = firebase.auth();

// Modal DOM Access Selectors
const authOverlay = document.getElementById('authOverlay');
const openAuthBtn = document.getElementById('openAuthBtn');
const closeAuthBtn = document.getElementById('closeAuthBtn');
const nicknameGroup = document.getElementById('nicknameFormGroup');
const authSubmitBtn = document.getElementById('authSubmitBtn');
const tabLogin = document.getElementById('tabLogin');
const tabRegister = document.getElementById('tabRegister');

// Unified Single Click Handler for the Navbar Button
if (openAuthBtn) {
    openAuthBtn.addEventListener('click', () => {
        // Check if the button is currently in "sign-out" mode
        if (openAuthBtn.getAttribute('data-action') === 'logout') {
            if (confirm('Opravdu se chcete odhlásit?')) {
                auth.signOut().then(() => {
                    alert('Byli jste odhlášeni.');
                    window.location.reload();
                });
            }
        } else {
            // Otherwise, open the login overlay modal
            authOverlay.classList.add('active');
        }
    });
}

if (closeAuthBtn) {
    closeAuthBtn.addEventListener('click', () => {
        authOverlay.classList.remove('active');
    });
}

// Window Escape Clicks Closure Hook
window.addEventListener('click', (e) => {
    if (e.target === authOverlay) {
        authOverlay.classList.remove('active');
    }
});

// Client Tab Interceptor Mechanics
function switchAuthTab(mode) {
    const nicknameInput = document.getElementById('authNickname');

    if (mode === 'login') {
        tabLogin.classList.add('active');
        tabRegister.classList.remove('active');
        
        // Remove the animation trigger class
        nicknameGroup.classList.remove('show');
        
        // Disable html5 validation requirement for login mode
        if (nicknameInput) nicknameInput.removeAttribute('required');
        
        authSubmitBtn.innerText = 'Přihlásit se';
    } else if (mode === 'register') {
        tabRegister.classList.add('active');
        tabLogin.classList.remove('active');
        
        // Add the animation trigger class
        nicknameGroup.classList.add('show');
        
        // Require field completion for registration mode
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
    
    // Determine mode based on which tab contains the active status layout class
    const isRegisterMode = document.getElementById('tabRegister').classList.contains('active');
    
    if (isRegisterMode) {
        // --- REGISTRATION WORKFLOW ---
        auth.createUserWithEmailAndPassword(email, password)
            .then((userCredential) => {
                const user = userCredential.user;
                
                // Save the Minecraft Nickname to their profile display name attributes
                return user.updateProfile({
                    displayName: nickname
                });
            })
            .then(() => {
                alert('Registrace proběhla úspěšně.');
                closeAuthModalAndReset();
            })
            .catch((error) => {
                handleAuthError(error);
            });
            
    } else {
        // --- LOGIN WORKFLOW ---
        auth.signInWithEmailAndPassword(email, password)
            .then((userCredential) => {
                alert('Přihlášení proběhlo úspěšně!');
                closeAuthModalAndReset();
            })
            .catch((error) => {
                handleAuthError(error);
            });
    }
});

// Setup Google Authentication Identity Provider
const googleProvider = new firebase.auth.GoogleAuthProvider();

// Hook helper to the button element template
const googleBtn = document.querySelector('.google-auth-btn');
if (googleBtn) {
    googleBtn.addEventListener('click', function() {
        auth.signInWithPopup(googleProvider)
            .then((result) => {
                const user = result.user;
                alert(`Úspěšně přihlášen přes Google jako: ${user.displayName || user.email}`);
                closeAuthModalAndReset();
            })
            .catch((error) => {
                handleAuthError(error);
            });
    });
}

// Global Session Monitor Tracker Hook
auth.onAuthStateChanged((user) => {
    const loginBtn = document.getElementById('openAuthBtn');
    if (!loginBtn) return; // Guard clause in case the DOM isn't ready
    
    if (user) {
        // User is signed in. Change appearance and set custom action token attribute
        const displayName = user.displayName || user.email.split('@')[0];
        loginBtn.innerText = `${displayName} (Odhlásit)`;
        loginBtn.setAttribute('data-action', 'logout');
    } else {
        // No user is signed in. Reset to default login text and actions safely
        loginBtn.innerText = 'Přihlásit se';
        loginBtn.removeAttribute('data-action');
    }
});

// Clean overlay form structures
function closeAuthModalAndReset() {
    document.getElementById('authOverlay').classList.remove('active');
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