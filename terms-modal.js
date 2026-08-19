import { auth, db, doc, getDoc, setDoc, onAuthStateChanged } from './firebase-config.js';

const TERMS_VERSION = '1.0';
const LOCAL_TERMS_PREFIX = 'ft_terms_accepted';

function isDemoMode() {
    try { return sessionStorage.getItem('demoMode') === 'true'; }
    catch { return false; }
}

function localTermsKey(uid) {
    return `${LOCAL_TERMS_PREFIX}::${uid}::${TERMS_VERSION}`;
}

function hasLocalAcceptance(uid) {
    if (!uid) return false;
    try {
        const saved = JSON.parse(localStorage.getItem(localTermsKey(uid)) || 'null');
        return saved?.accepted === true && saved?.version === TERMS_VERSION;
    } catch {
        return false;
    }
}

function rememberLocalAcceptance(uid, acceptedAt = new Date().toISOString()) {
    if (!uid) return;
    try {
        localStorage.setItem(localTermsKey(uid), JSON.stringify({
            accepted: true,
            acceptedAt,
            version: TERMS_VERSION
        }));
    } catch (e) {
        console.warn('Local terms cache unavailable', e);
    }
}

function injectTermsModal() {
    const style = document.createElement('style');
    style.textContent = `
        #ft-terms-overlay {
            display: none;
            position: fixed;
            inset: 0;
            background: rgba(10, 14, 26, 0.88);
            backdrop-filter: blur(6px);
            z-index: 99999;
            align-items: center;
            justify-content: center;
            font-family: 'Heebo', -apple-system, sans-serif;
        }
        #ft-terms-overlay.active { display: flex; }
        #ft-terms-box {
            background: var(--bg-surface, hsl(220, 18%, 10%));
            border: 1px solid var(--border, hsl(220, 14%, 16%));
            border-radius: 16px;
            box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
            width: 90%;
            max-width: 480px;
            padding: 32px;
            direction: rtl;
        }
        #ft-terms-box h2 {
            font-size: 1.25rem;
            font-weight: 700;
            color: var(--text-primary, hsl(210, 20%, 92%));
            margin: 0 0 20px;
        }
        #ft-terms-box p {
            font-size: 0.875rem;
            color: var(--text-secondary, hsl(210, 15%, 65%));
            line-height: 1.65;
            margin-bottom: 10px;
        }
        #ft-terms-checkbox-row {
            display: flex;
            align-items: center;
            gap: 10px;
            margin: 24px 0;
            font-size: 0.9rem;
            color: var(--text-primary, hsl(210, 20%, 92%));
            cursor: pointer;
            user-select: none;
        }
        #ft-terms-checkbox-row input[type="checkbox"] {
            width: 18px;
            height: 18px;
            flex-shrink: 0;
            cursor: pointer;
            accent-color: var(--accent, hsl(142, 60%, 50%));
        }
        #ft-terms-checkbox-row a {
            color: var(--accent, hsl(142, 60%, 50%));
            text-decoration: none;
        }
        #ft-terms-checkbox-row a:hover { text-decoration: underline; }
        #ft-terms-accept-btn {
            width: 100%;
            padding: 12px;
            background: var(--accent, hsl(142, 60%, 50%));
            color: #0a0e1a;
            border: none;
            border-radius: 10px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            font-family: inherit;
            transition: background 0.2s;
        }
        #ft-terms-accept-btn:disabled {
            background: var(--border, hsl(220, 14%, 22%));
            color: var(--text-secondary, hsl(210, 15%, 50%));
            cursor: not-allowed;
        }
        #ft-terms-accept-btn:not(:disabled):hover {
            background: var(--accent-hover, hsl(142, 60%, 42%));
        }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = 'ft-terms-overlay';
    overlay.innerHTML = `
        <div id="ft-terms-box">
            <h2>תנאי שימוש ופרטיות</h2>
            <p>האפליקציה מאחסנת נתוני תיק השקעות, תקציב ומשכנתא שאתה מכניס ידנית.</p>
            <p>הנתונים שלך מאוחסנים ב-Firebase (Google Cloud) ומוגנים — רק אתה יכול לגשת אליהם.</p>
            <p>האפליקציה אינה מספקת ייעוץ פיננסי. כל ההחלטות הפיננסיות הן באחריותך בלבד.</p>
            <label id="ft-terms-checkbox-row">
                <input type="checkbox" id="ft-terms-checkbox">
                <span>קראתי ואני מסכים ל<a href="terms.html" target="_blank">תנאי השימוש המלאים</a></span>
            </label>
            <button id="ft-terms-accept-btn" disabled>כניסה לאפליקציה</button>
        </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('ft-terms-checkbox').addEventListener('change', (e) => {
        document.getElementById('ft-terms-accept-btn').disabled = !e.target.checked;
    });

    document.getElementById('ft-terms-accept-btn').addEventListener('click', async () => {
        const user = auth.currentUser;
        if (!user) return;
        const btn = document.getElementById('ft-terms-accept-btn');
        btn.disabled = true;
        btn.textContent = 'שומר...';
        const acceptedAt = new Date().toISOString();

        // Consent must survive local development too, where Firebase writes are
        // deliberately blocked to protect the production account. The key is
        // scoped by uid + terms version so it never leaks between users and a
        // future terms revision can request consent again.
        rememberLocalAcceptance(user.uid, acceptedAt);
        try {
            const profileRef = doc(db, 'users', user.uid, 'profile', 'data');
            await setDoc(profileRef, {
                termsAccepted: true,
                termsAcceptedAt: acceptedAt,
                termsVersion: TERMS_VERSION
            }, { merge: true });
            document.getElementById('ft-terms-overlay').classList.remove('active');
        } catch (e) {
            console.error('Terms save failed', e);
            // The user explicitly accepted. Keep the device-local record and
            // allow entry; cloud persistence will be retried on a later accept
            // only if local storage is cleared or the terms version changes.
            document.getElementById('ft-terms-overlay').classList.remove('active');
        }
    });
}

injectTermsModal();

onAuthStateChanged(auth, async (user) => {
    if (!user || isDemoMode()) return;
    if (hasLocalAcceptance(user.uid)) return;
    try {
        const profileRef = doc(db, 'users', user.uid, 'profile', 'data');
        const profile = await getDoc(profileRef);
        const profileData = profile.exists() ? profile.data() : null;
        const acceptedInCloud = profileData?.termsAccepted === true &&
            (!profileData.termsVersion || profileData.termsVersion === TERMS_VERSION);
        if (acceptedInCloud) {
            rememberLocalAcceptance(user.uid, profileData.termsAcceptedAt);
        } else {
            document.getElementById('ft-terms-overlay').classList.add('active');
        }
    } catch (e) {
        console.error('Terms check failed', e);
    }
});
