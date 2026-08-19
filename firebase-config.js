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

const LS_ALLOW_FIREBASE_WRITES = 'ft_allowFirebaseWrites';

function isLocalDevHost() {
    if (typeof window === 'undefined') return false;
    const h = window.location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}

function isDemoModeActive() {
    if (typeof window === 'undefined') return false;
    try { return sessionStorage.getItem('demoMode') === 'true'; }
    catch { return false; }
}

/** On localhost, Firestore writes are skipped unless the user opts in (see window.ftLocalDev). */
function cloudFirestoreWritesAllowed() {
    if (typeof window === 'undefined') return true;
    // Demo is a hard security boundary on every host, including production.
    if (isDemoModeActive()) return false;
    if (!isLocalDevHost()) return true;
    return localStorage.getItem(LS_ALLOW_FIREBASE_WRITES) === 'true';
}

function emptyDocumentSnapshot() {
    return { exists: () => false, data: () => undefined, id: '', ref: null, metadata: { fromCache: true, hasPendingWrites: false } };
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
    if (!cloudFirestoreWritesAllowed()) {
        console.info(
            isDemoModeActive()
                ? '[Finance Tracker] Demo mode: setDoc blocked.'
                : '[Finance Tracker] Local dev: setDoc skipped (no production writes). To allow: window.ftLocalDev.allowCloudWrites()'
        );
        return;
    }
    return firestoreSetDoc(ref, data, options);
}

async function deleteDoc(ref) {
    if (!cloudFirestoreWritesAllowed()) {
        console.info(isDemoModeActive()
            ? '[Finance Tracker] Demo mode: deleteDoc blocked.'
            : '[Finance Tracker] Local dev: deleteDoc skipped (no production writes).');
        return;
    }
    return firestoreDeleteDoc(ref);
}

if (typeof window !== 'undefined') {
    window.ftLocalDev = {
        isLocalHost: isLocalDevHost(),
        cloudWritesAllowed: () => cloudFirestoreWritesAllowed(),
        allowCloudWrites: () => {
            localStorage.setItem(LS_ALLOW_FIREBASE_WRITES, 'true');
            window.location.reload();
        },
        blockCloudWrites: () => {
            localStorage.removeItem(LS_ALLOW_FIREBASE_WRITES);
            window.location.reload();
        },
    };
    if (isLocalDevHost() && !cloudFirestoreWritesAllowed()) {
        console.info(
            '[Finance Tracker] Local dev mode: Firestore writes are OFF. Reads still use your project. ' +
                'To push changes to Firebase from this machine: window.ftLocalDev.allowCloudWrites()'
        );
    }
}

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

// Export for use in other files (setDoc/deleteDoc are wrapped for local dev safety)
export { auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged, doc, setDoc, getDoc, collection, query, where, getDocs, deleteDoc };
