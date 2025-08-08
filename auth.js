// Firebase Auth + Firestore integration
// 1) Fill in your Firebase web app config below
// 2) Store tasks under users/{uid}/tasks in Firestore

// eslint-disable-next-line import/no-unresolved
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
// eslint-disable-next-line import/no-unresolved
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
// eslint-disable-next-line import/no-unresolved
import { getFirestore, collection, doc, getDocs, onSnapshot, writeBatch, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAYYq3uWBzUfuVX5H6dzadmRzqRrvNk-3o",
    authDomain: "glasstask-f4a65.firebaseapp.com",
    projectId: "glasstask-f4a65",
    storageBucket: "glasstask-f4a65.firebasestorage.app",
    messagingSenderId: "512175308976",
    appId: "1:512175308976:web:0d1710528a983cd4133b75",
    measurementId: "G-EB1T4LSXG4"
  };
  

let app = null;
let auth = null;
let db = null;

const enabled = Boolean(
  firebaseConfig &&
    firebaseConfig.apiKey &&
    !String(firebaseConfig.apiKey).startsWith("YOUR_") &&
    firebaseConfig.projectId &&
    !String(firebaseConfig.projectId).startsWith("YOUR_")
);

if (enabled) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} else {
  console.warn("Firebase not configured. Fill in firebaseConfig in auth.js to enable sign-in & sync.");
}

// Google sign-in removed; email/password only

function getTasksCollectionRef(userId) {
  if (!db) return null;
  return collection(db, `users/${userId}/tasks`);
}

async function readAllRemoteTasks(userId) {
  const ref = getTasksCollectionRef(userId);
  if (!ref) return [];
  const snap = await getDocs(ref);
  const tasks = [];
  snap.forEach((docSnap) => {
    const data = docSnap.data();
    // Defensive mapping to the Task schema used by the app
    tasks.push({
      id: String(data.id || docSnap.id),
      title: String(data.title || "Untitled"),
      description: String(data.description || ""),
      notesByUser: (data.notesByUser && typeof data.notesByUser === 'object') ? data.notesByUser : undefined,
      dueDate: data.dueDate || null,
      priority: ["low", "medium", "high"].includes(data.priority) ? data.priority : "medium",
      status: data.status === "done" ? "done" : "open",
      tags: Array.isArray(data.tags) ? data.tags.filter((t) => typeof t === "string").slice(0, 8) : [],
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: data.updatedAt || new Date().toISOString(),
      completedAt: data.completedAt || null,
    });
  });
  return tasks;
}

async function replaceAllRemoteTasks(userId, tasks) {
  const ref = getTasksCollectionRef(userId);
  if (!ref) return;

  // Fetch current remote docs to compute deletions
  const existingSnap = await getDocs(ref);
  const existingIds = new Set();
  existingSnap.forEach((d) => existingIds.add(d.id));

  const nextIds = new Set(tasks.map((t) => String(t.id)));

  const batch = writeBatch(db);

  // Upsert all tasks
  for (const task of tasks) {
    const taskId = String(task.id);
    const taskDoc = doc(ref, taskId);
    const payload = {
      id: taskId,
      title: task.title,
      description: task.description || "",
      dueDate: task.dueDate || null,
      priority: task.priority || "medium",
      status: task.status === "done" ? "done" : "open",
      tags: Array.isArray(task.tags) ? task.tags.slice(0, 8) : [],
      createdAt: task.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: task.completedAt || null,
    };
    if (task.notesByUser && typeof task.notesByUser === 'object') {
      payload.notesByUser = task.notesByUser;
    }
    batch.set(taskDoc, payload);
  }

  // Delete remote tasks that are no longer present locally
  for (const existingId of existingIds) {
    if (!nextIds.has(existingId)) {
      batch.delete(doc(ref, existingId));
    }
  }

  await batch.commit();
}

function listenRemoteTasks(userId, onChange) {
  const ref = getTasksCollectionRef(userId);
  if (!ref) return () => {};
  return onSnapshot(ref, (snap) => {
    const tasks = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      tasks.push({
        id: String(data.id || docSnap.id),
        title: String(data.title || "Untitled"),
        description: String(data.description || ""),
        notesByUser: (data.notesByUser && typeof data.notesByUser === 'object') ? data.notesByUser : undefined,
        dueDate: data.dueDate || null,
        priority: ["low", "medium", "high"].includes(data.priority) ? data.priority : "medium",
        status: data.status === "done" ? "done" : "open",
        tags: Array.isArray(data.tags) ? data.tags.filter((t) => typeof t === "string").slice(0, 8) : [],
        createdAt: data.createdAt || new Date().toISOString(),
        updatedAt: data.updatedAt || new Date().toISOString(),
        completedAt: data.completedAt || null,
      });
    });
    onChange(tasks);
  });
}

function getUserLabel(user) {
  if (!user) return "";
  return user.displayName || user.email || user.uid;
}

function wireAuthButtons() {
  const signInBtn = document.getElementById("signInBtn");
  const signOutBtn = document.getElementById("signOutBtn");
  const emailAuthBtn = document.getElementById("emailAuthBtn");
  if (signInBtn) {
    signInBtn.addEventListener("click", async () => {
      if (!enabled) {
        alert("Sign-in not configured. Please edit auth.js and add your Firebase config.");
        return;
      }
      try {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        const isGithubPages = typeof location !== 'undefined' && location.hostname.endsWith('.github.io');
        const isMobile = /Mobi|Android/i.test(navigator.userAgent);
        if (isGithubPages || isMobile) {
          await signInWithRedirect(auth, provider);
          return;
        }
        await signInWithPopup(auth, provider);
      } catch (err) {
        console.error("Sign-in failed (popup)", err);
        const code = err && err.code ? String(err.code) : "unknown";
        if (
          code === "auth/popup-blocked" ||
          code === "auth/operation-not-supported-in-this-environment" ||
          code === "auth/unauthorized-domain"
        ) {
          try {
            const provider = new GoogleAuthProvider();
            provider.setCustomParameters({ prompt: "select_account" });
            await signInWithRedirect(auth, provider);
            return;
          } catch (redirErr) {
            console.error("Sign-in failed (redirect)", redirErr);
            alert(`Sign-in failed: ${redirErr && redirErr.message ? redirErr.message : "See console"}`);
            return;
          }
        }
        alert(`Sign-in failed: ${err && err.message ? err.message : "See console for details"}`);
      }
    });
  }
  if (signOutBtn) {
    signOutBtn.addEventListener("click", async () => {
      if (!enabled) return;
      try {
        await signOut(auth);
      } catch (err) {
        console.error("Sign-out failed", err);
      }
    });
  }

  // Email/Password modal wiring
  const authModal = document.getElementById('authModal');
  const emailAuthForm = document.getElementById('emailAuthForm');
  const authCloseBtn = document.getElementById('authCloseBtn');
  const authToggleMode = document.getElementById('authToggleMode');
  const authSubmitBtn = document.getElementById('authSubmitBtn');
  const authError = document.getElementById('authError');
  const authModeLabel = document.getElementById('authModeLabel');
  const authEmail = document.getElementById('authEmail');
  const authPassword = document.getElementById('authPassword');

  let isSignup = false;
  function openAuth() { authModal && authModal.classList.remove('hidden'); setTimeout(() => authEmail && authEmail.focus(), 0); }
  function closeAuth() { authModal && authModal.classList.add('hidden'); if (emailAuthForm) emailAuthForm.reset(); if (authError) authError.textContent = ''; }
  function updateMode() {
    if (authModeLabel) authModeLabel.textContent = isSignup ? 'Create account' : 'Sign in';
    if (authToggleMode) authToggleMode.textContent = isSignup ? 'Have an account?' : 'Create account';
    if (authSubmitBtn) authSubmitBtn.textContent = isSignup ? 'Create' : 'Continue';
  }

  if (emailAuthBtn) emailAuthBtn.addEventListener('click', () => { isSignup = false; updateMode(); openAuth(); });
  if (authCloseBtn) authCloseBtn.addEventListener('click', closeAuth);
  if (authToggleMode) authToggleMode.addEventListener('click', () => { isSignup = !isSignup; updateMode(); });
  if (emailAuthForm) emailAuthForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!enabled) return;
    try {
      const email = authEmail && authEmail.value.trim();
      const password = authPassword && authPassword.value;
      if (!email || !password) throw new Error('Email and password are required');
      if (isSignup) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      closeAuth();
    } catch (err) {
      if (authError) authError.textContent = err && err.message ? err.message : 'Authentication failed';
    }
  });
  const authForgotBtn = document.getElementById('authForgotBtn');
  if (authForgotBtn) authForgotBtn.addEventListener('click', async () => {
    if (!enabled) return;
    try {
      const email = authEmail && authEmail.value.trim();
      if (!email) { if (authError) authError.textContent = 'Enter your email first'; return; }
      await sendPasswordResetEmail(auth, email);
      if (authError) authError.textContent = 'Password reset email sent';
    } catch (err) {
      if (authError) authError.textContent = err && err.message ? err.message : 'Failed to send reset email';
    }
  });
}

// Expose minimal API to the rest of the app via window.Auth
window.Auth = {
  isEnabled() { return enabled; },
  isSignedIn() { return Boolean(enabled && auth && auth.currentUser); },
  currentUser() { return enabled ? auth.currentUser : null; },
  onAuthStateChanged(callback) {
    if (!enabled) return () => {};
    return onAuthStateChanged(auth, callback);
  },
  async readAllTasks() {
    if (!enabled || !auth.currentUser) return [];
    return readAllRemoteTasks(auth.currentUser.uid);
  },
  async saveAllTasks(tasks) {
    if (!enabled || !auth.currentUser) return;
    await replaceAllRemoteTasks(auth.currentUser.uid, tasks);
  },
  listenTasks(onChange) {
    if (!enabled || !auth.currentUser) return () => {};
    return listenRemoteTasks(auth.currentUser.uid, onChange);
  },
  getUserLabel,
  async signInWithGoogleIdToken(idToken) {
    if (!enabled) throw new Error("Auth not enabled");
    if (!customAuthEndpoint || customAuthEndpoint.includes("YOUR_BACKEND_HOST")) {
      throw new Error("Custom auth endpoint not configured");
    }
    const res = await fetch(customAuthEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: idToken }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data || !data.customToken) {
      const msg = data && (data.error || data.message) ? (data.error || data.message) : `HTTP ${res.status}`;
      throw new Error(`Exchange failed: ${msg}`);
    }
    await signInWithCustomToken(auth, String(data.customToken));
  },
};

// Wire UI buttons and reflect auth state in the header
document.addEventListener("DOMContentLoaded", () => {
  wireAuthButtons();
  const userLabelEl = document.getElementById("userLabel");
  const signInBtn = document.getElementById("signInBtn");
  const signOutBtn = document.getElementById("signOutBtn");

  if (!enabled) {
    // Keep buttons but no-op sign-in
    if (userLabelEl) userLabelEl.style.display = "none";
    if (signOutBtn) signOutBtn.style.display = "none";
    if (signInBtn) signInBtn.style.display = "";
    return;
  }

  onAuthStateChanged(auth, (user) => {
    if (userLabelEl) {
      userLabelEl.textContent = getUserLabel(user);
      userLabelEl.style.display = user ? "" : "none";
    }
    if (signInBtn) signInBtn.style.display = user ? "none" : "";
    if (signOutBtn) signOutBtn.style.display = user ? "" : "none";
  });

  getRedirectResult(auth).catch((e) => {
    if (e && e.code) {
      console.error("Sign-in redirect error:", e.code, e.message);
    }
  });
});


