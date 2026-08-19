// Firebase Configuration
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
    initializeFirestore,
    doc,
    setDoc as firestoreSetDoc,
    getDoc as firestoreGetDoc,
    collection,
    query,
    where,
    getDocs as firestoreGetDocs,
    deleteDoc as firestoreDeleteDoc,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDltz8wMzV1nUpE1jiTxZbHJqoEYnhjIbk",
  authDomain: "finance-tracker-21e18.firebaseapp.com",
  projectId: "finance-tracker-21e18",
  storageBucket: "finance-tracker-21e18.firebasestorage.app",
  messagingSenderId: "401698469449",
  appId: "1:401698469449:web:962113ad605abed8d6b198"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// Force long-polling: Netspark's TLS-intercepting filter breaks Firestore's
// default WebChannel streaming transport ("Could not reach Cloud Firestore backend").
const db = initializeFirestore(app, { experimentalForceLongPolling: true });
const googleProvider = new GoogleAuthProvider();

// ── Demo-mode barrier ────────────────────────────────────────────────────────
// Demo mode is a session-scoped sandbox over fabricated data. Every page is
// already supposed to branch before it imports this module, so in normal
// operation nothing below ever fires. It exists because that guarantee is
// spread across five HTML files: one page that forgets to branch — or one new
// page added later — would otherwise read and overwrite the real account while
// the UI says "מצב הדגמה". The barrier belongs next to the data layer, where it
// holds for every caller, not in each page that remembers to ask.
//
// Reads return an empty snapshot rather than throwing, so a caller that treats
// "no document" as "new account" behaves the same as a genuinely empty account.
function isDemoModeActive() {
    if (typeof window === 'undefined') return false;
    try {
        return sessionStorage.getItem('demoMode') === 'true';
    } catch {
        // Storage can be unavailable in privacy-restricted contexts. Fail open
        // here: a signed-in user must not lose cloud access because sessionStorage
        // is blocked, and every page still performs its own demo check.
        return false;
    }
}

function emptyDocumentSnapshot() {
    return {
        exists: () => false,
        data: () => undefined,
        id: '',
        ref: null,
        metadata: { fromCache: true, hasPendingWrites: false },
    };
}

function emptyQuerySnapshot() {
    return {
        empty: true,
        size: 0,
        docs: [],
        forEach: () => {},
        metadata: { fromCache: true, hasPendingWrites: false },
    };
}

async function getDoc(ref) {
    if (isDemoModeActive()) {
        console.info('[Finance Tracker] Demo mode: Firestore read skipped.');
        return emptyDocumentSnapshot();
    }
    return firestoreGetDoc(ref);
}

async function getDocs(reference) {
    if (isDemoModeActive()) {
        console.info('[Finance Tracker] Demo mode: Firestore query skipped.');
        return emptyQuerySnapshot();
    }
    return firestoreGetDocs(reference);
}

async function setDoc(ref, data, options) {
    if (isDemoModeActive()) {
        console.info('[Finance Tracker] Demo mode: setDoc blocked.');
        return;
    }
    return firestoreSetDoc(ref, data, options);
}

async function deleteDoc(ref) {
    if (isDemoModeActive()) {
        console.info('[Finance Tracker] Demo mode: deleteDoc blocked.');
        return;
    }
    return firestoreDeleteDoc(ref);
}

// Export for use in other files (reads/writes are gated on demo mode above)
export { auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged, doc, setDoc, getDoc, collection, query, where, getDocs, deleteDoc };
