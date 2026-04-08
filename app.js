"use strict";

const { get, set, del, keys } = idbKeyval;

const DB_PREFIX = "note_";
const ACTIVE_KEY = "active_note_id";

let currentNoteId = null;
let saveTimer = null;
let deferredInstallPrompt = null;

const noteList = document.getElementById("note-list");
const noteTitle = document.getElementById("note-title");
const noteBody = document.getElementById("note-body");
const charCount = document.getElementById("char-count");
const noteCountEl = document.getElementById("note-count");
const saveStatus = document.getElementById("save-status");
const toast = document.getElementById("toast");
const fabSave = document.getElementById("fab-save");
const fabDelete = document.getElementById("fab-delete");
const btnNew = document.getElementById("btn-new");
const installBanner = document.getElementById("install-banner");
const btnInstallYes = document.getElementById("btn-install-yes");
const btnInstallNo = document.getElementById("btn-install-no");
const sidebar = document.getElementById("sidebar");
const appTitle = document.querySelector(".app-title");

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function showToast(msg, type = "") {
  toast.textContent = msg;
  toast.className = "show " + type;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.className = "";
  }, 2600);
}

function setSaveStatus(state) {
  const map = {
    saving: "● enreg.",
    saved: "✓ sauvé",
    error: "✕ erreur",
    idle: "—",
  };
  saveStatus.textContent = map[state] || "—";
  saveStatus.className = "save-status " + (state !== "idle" ? state : "");
}

function updateCharCount() {
  const n = noteBody.value.length;
  charCount.textContent =
    n > 0 ? n.toLocaleString("fr-FR") + " car." : "0 car.";
}

async function loadAllNotes() {
  const allKeys = await keys();
  const noteKeys = allKeys.filter((k) => String(k).startsWith(DB_PREFIX));
  const notes = await Promise.all(noteKeys.map((k) => get(k)));
  return notes.filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
}

async function saveNote(id, title, body) {
  const existing = (await get(DB_PREFIX + id)) || {};
  const note = {
    id,
    title: title.trim() || "Note sans titre",
    body,
    createdAt: existing.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  await set(DB_PREFIX + id, note);
  await set(ACTIVE_KEY, id);
  return note;
}

async function deleteNote(id) {
  await del(DB_PREFIX + id);
}

function renderNoteItem(note, isActive) {
  const li = document.createElement("li");
  li.className = "note-item" + (isActive ? " active" : "");
  li.dataset.id = note.id;
  li.setAttribute("role", "option");
  li.setAttribute("aria-selected", isActive ? "true" : "false");

  const preview = note.body.replace(/\n/g, " ").slice(0, 60) || "…";
  li.innerHTML = `
    <div class="note-item-title">${escapeHtml(note.title)}</div>
    <div class="note-item-preview">${escapeHtml(preview)}</div>
    <div class="note-item-date">${formatDate(note.updatedAt)}</div>
  `;
  li.addEventListener("click", () => openNote(note.id));
  return li;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function refreshSidebar(activeId) {
  const notes = await loadAllNotes();
  noteList.innerHTML = "";
  noteCountEl.textContent = notes.length;

  if (notes.length === 0) {
    noteList.innerHTML = `
      <li class="empty-state">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span>Aucune note.<br/>Crée-en une !</span>
      </li>`;
    return;
  }

  notes.forEach((note) => {
    noteList.appendChild(renderNoteItem(note, note.id === activeId));
  });
}

async function openNote(id) {
  currentNoteId = id;
  const note = await get(DB_PREFIX + id);
  if (!note) return;

  noteTitle.value = note.title === "Note sans titre" ? "" : note.title;
  noteBody.value = note.body;
  updateCharCount();
  setSaveStatus("idle");
  await set(ACTIVE_KEY, id);
  await refreshSidebar(id);

  sidebar.classList.remove("open");
}

async function createNote() {
  const id = uid();
  const note = await saveNote(id, "", "");
  currentNoteId = id;
  noteTitle.value = "";
  noteBody.value = "";
  noteBody.focus();
  updateCharCount();
  setSaveStatus("idle");
  await refreshSidebar(id);
  showToast("Nouvelle note créée", "success");
}

async function persistCurrentNote() {
  if (!currentNoteId) return;
  setSaveStatus("saving");
  try {
    const note = await saveNote(currentNoteId, noteTitle.value, noteBody.value);
    setSaveStatus("saved");

    const activeItem = noteList.querySelector(
      `.note-item[data-id="${currentNoteId}"]`,
    );
    if (activeItem) {
      activeItem.querySelector(".note-item-title").textContent = note.title;
      const preview = note.body.replace(/\n/g, " ").slice(0, 60) || "…";
      activeItem.querySelector(".note-item-preview").textContent = preview;
      activeItem.querySelector(".note-item-date").textContent = formatDate(
        note.updatedAt,
      );
    }
    setTimeout(() => setSaveStatus("idle"), 2000);
  } catch (e) {
    setSaveStatus("error");
    showToast("Erreur de sauvegarde", "error");
    console.error(e);
  }
}

async function deleteCurrentNote() {
  if (!currentNoteId) return;
  const confirmed = window.confirm("Supprimer cette note définitivement ?");
  if (!confirmed) return;

  await deleteNote(currentNoteId);
  currentNoteId = null;
  noteTitle.value = "";
  noteBody.value = "";
  updateCharCount();
  setSaveStatus("idle");

  const notes = await loadAllNotes();
  if (notes.length > 0) {
    await openNote(notes[0].id);
  } else {
    await refreshSidebar(null);
  }
  showToast("Note supprimée", "");
}

function scheduleAutoSave() {
  clearTimeout(saveTimer);
  setSaveStatus("saving");
  saveTimer = setTimeout(persistCurrentNote, 800);
}

noteTitle.addEventListener("input", scheduleAutoSave);

noteBody.addEventListener("input", () => {
  updateCharCount();
  scheduleAutoSave();
});

fabSave.addEventListener("click", () => {
  clearTimeout(saveTimer);
  persistCurrentNote().then(() => showToast("Note enregistrée", "success"));
});

fabDelete.addEventListener("click", deleteCurrentNote);
btnNew.addEventListener("click", createNote);

appTitle.addEventListener("click", () => {
  if (window.innerWidth <= 640) sidebar.classList.toggle("open");
});

document.addEventListener("click", (e) => {
  if (
    window.innerWidth <= 640 &&
    sidebar.classList.contains("open") &&
    !sidebar.contains(e.target) &&
    !appTitle.contains(e.target)
  ) {
    sidebar.classList.remove("open");
  }
});

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    clearTimeout(saveTimer);
    persistCurrentNote().then(() => showToast("Note enregistrée", "success"));
  }
});

function isAppInstalled() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true ||
    localStorage.getItem("pwa_installed") === "true"
  );
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  if (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  ) {
    return;
  }
  deferredInstallPrompt = e;
  installBanner.hidden = false;
});

btnInstallYes.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installBanner.hidden = true;
  if (outcome === "accepted") showToast("Application installée !", "success");
  else showToast("Installation annulée", "");
});

btnInstallNo.addEventListener("click", () => {
  installBanner.hidden = true;
});

window.addEventListener("appinstalled", () => {
  showToast("NoteForge installé !", "success");
  installBanner.hidden = true;
});

const offlineBanner = document.getElementById("offline-banner");

function updateOnlineStatus() {
  if (!navigator.onLine) {
    offlineBanner.hidden = false;
    offlineBanner.classList.add("show");
  } else {
    offlineBanner.classList.remove("show");

    setTimeout(() => {
      offlineBanner.hidden = true;
    }, 400);
  }
}

window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);

updateOnlineStatus();

async function init() {
  const activeId = await get(ACTIVE_KEY);
  const notes = await loadAllNotes();

  if (notes.length === 0) {
    const id = uid();
    await saveNote(
      id,
      "Bienvenue sur NoteForge",
      `Bienvenue ! ✦

NoteForge est un gestionnaire de notes 100% hors-ligne.
Toutes vos notes sont sauvegardées automatiquement dans votre navigateur (IndexedDB).

━━━━━━━━━━━━━━━━━━━━━━
RACCOURCIS
  Ctrl/⌘ + S   → Sauvegarder
  + (en-tête)  → Nouvelle note
━━━━━━━━━━━━━━━━━━━━━━

Bonne écriture !`,
    );
    await openNote(id);
  } else {
    const idToOpen =
      activeId && notes.find((n) => n.id === activeId) ? activeId : notes[0].id;
    await openNote(idToOpen);
  }

  if ("serviceWorker" in navigator) {
    try {
      const reg = await navigator.serviceWorker.register("sw.js");
      console.log("[SW] Enregistré :", reg.scope);
    } catch (err) {
      console.warn("[SW] Échec :", err);
    }
  }
}

init();
