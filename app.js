// Task Manager - Vanilla JS
// Data model version
const STORAGE_KEY = "taskManager.v1";

/**
 * @typedef {Object} Task
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {string|null} dueDate // yyyy-mm-dd or null
 * @property {"low"|"medium"|"high"} priority
 * @property {"open"|"done"} status
 * @property {string[]} tags
 * @property {string} createdAt // ISO
 * @property {string} updatedAt // ISO
 * @property {string|null} completedAt // ISO or null
 */

/**
 * Global application state
 */
const state = {
  tasks: /** @type {Task[]} */ ([]),
  filters: {
    status: "all", // all | open | done
    priority: "all", // all | low | medium | high
    due: "all", // all | today | week | overdue | none
  },
  sort: {
    field: "dueDate", // dueDate | priority | createdAt | title
    direction: "asc", // asc | desc
  },
  searchQuery: "",
};

// DOM
const dom = {
  searchInput: document.getElementById("searchInput"),
  addTaskBtn: document.getElementById("addTaskBtn"),
  emptyAddBtn: document.getElementById("emptyAddBtn"),
  exportBtn: document.getElementById("exportBtn"),
  importFile: document.getElementById("importFile"),
  priorityFilter: document.getElementById("priorityFilter"),
  dueFilter: document.getElementById("dueFilter"),
  sortSelect: document.getElementById("sortSelect"),
  toggleSortDir: document.getElementById("toggleSortDir"),
  taskList: document.getElementById("taskList"),
  emptyState: document.getElementById("emptyState"),
  counts: document.getElementById("counts"),
  clearCompletedBtn: document.getElementById("clearCompletedBtn"),
  // modal
  modal: document.getElementById("taskModal"),
  modalTitle: document.getElementById("modalTitle"),
  closeModalBtn: document.getElementById("closeModalBtn"),
  form: document.getElementById("taskForm"),
  fieldId: document.getElementById("taskId"),
  fieldTitle: document.getElementById("title"),
  fieldTitleError: document.getElementById("titleError"),
  fieldDesc: document.getElementById("description"),
  fieldDue: document.getElementById("dueDate"),
  fieldPriority: document.getElementById("priority"),
  fieldTags: document.getElementById("tags"),
  cancelBtn: document.getElementById("cancelBtn"),
  saveBtn: document.getElementById("saveBtn"),
};

// Utils
const isString = (v) => typeof v === "string";
const nowIso = () => new Date().toISOString();
const safeJsonParse = (str, fallback) => {
  try { return JSON.parse(str); } catch { return fallback; }
};
const generateId = () => {
  if (window.crypto && "randomUUID" in window.crypto) return window.crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
};
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

/** Format yyyy-mm-dd to friendly label */
function formatDateLabel(dateStr) {
  if (!dateStr) return "No due date";
  const d = new Date(dateStr + "T00:00:00");
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.round((d - startOfToday) / (1000 * 60 * 60 * 24));
  const opts = { month: "short", day: "numeric" };
  const label = d.toLocaleDateString(undefined, opts);
  if (diffDays < 0) return `${label} (overdue)`;
  if (diffDays === 0) return `${label} (today)`;
  if (diffDays === 1) return `${label} (tomorrow)`;
  if (diffDays <= 7) return `${label} (in ${diffDays}d)`;
  return label;
}

function parseTags(input) {
  if (!input) return [];
  return input
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8);
}

// Persistence
function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  const data = safeJsonParse(raw, null);
  if (!data || !Array.isArray(data.tasks)) return;
  state.tasks = data.tasks.map((t) => ({
    id: isString(t.id) ? t.id : generateId(),
    title: isString(t.title) ? t.title : "Untitled",
    description: isString(t.description) ? t.description : "",
    dueDate: t.dueDate || null,
    priority: ["low", "medium", "high"].includes(t.priority) ? t.priority : "medium",
    status: t.status === "done" ? "done" : "open",
    tags: Array.isArray(t.tags) ? t.tags.filter(isString).slice(0, 8) : [],
    createdAt: t.createdAt || nowIso(),
    updatedAt: t.updatedAt || nowIso(),
    completedAt: t.completedAt || null,
  }));
}

let saveTimeout = null;
function scheduleSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    const payload = { tasks: state.tasks };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, 150);
}

// Filters & sorting
function getVisibleTasks() {
  const { status, priority, due } = state.filters;
  const query = state.searchQuery.trim().toLowerCase();
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const endOfWeek = new Date(startOfToday);
  endOfWeek.setDate(endOfWeek.getDate() + 7);

  let tasks = state.tasks.filter((t) => {
    if (status !== "all" && t.status !== status) return false;
    if (priority !== "all" && t.priority !== priority) return false;

    if (due !== "all") {
      if (due === "none" && t.dueDate) return false;
      if (due !== "none") {
        if (!t.dueDate) return false;
        const d = new Date(t.dueDate + "T00:00:00");
        if (due === "today") {
          if (d < startOfToday || d >= new Date(startOfToday.getTime() + 24 * 3600 * 1000)) return false;
        } else if (due === "week") {
          if (d < startOfToday || d > endOfWeek) return false;
        } else if (due === "overdue") {
          if (d >= startOfToday) return false;
        }
      }
    }

    if (query) {
      const hay = `${t.title}\n${t.description}\n${t.tags.join(",")}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  const dir = state.sort.direction === "asc" ? 1 : -1;
  const field = state.sort.field;
  const priorityRank = { high: 3, medium: 2, low: 1 };

  tasks.sort((a, b) => {
    let va, vb;
    switch (field) {
      case "priority":
        va = priorityRank[a.priority];
        vb = priorityRank[b.priority];
        break;
      case "createdAt":
        va = a.createdAt; vb = b.createdAt; break;
      case "title":
        va = a.title.toLowerCase(); vb = b.title.toLowerCase(); break;
      case "dueDate":
      default:
        va = a.dueDate || "9999-12-31"; vb = b.dueDate || "9999-12-31"; break;
    }
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });

  return tasks;
}

// Rendering
function render() {
  const visible = getVisibleTasks();
  dom.taskList.innerHTML = "";

  if (visible.length === 0) {
    dom.emptyState.classList.remove("hidden");
  } else {
    dom.emptyState.classList.add("hidden");
  }

  for (const task of visible) {
    const card = renderTaskCard(task);
    dom.taskList.appendChild(card);
  }

  const total = state.tasks.length;
  const open = state.tasks.filter((t) => t.status === "open").length;
  const done = total - open;
  dom.counts.textContent = `${open} open • ${done} done • ${total} total`;
}

function renderTaskCard(task) {
  const card = document.createElement("article");
  card.className = "task-card" + (task.status === "done" ? " done" : "");
  card.setAttribute("data-id", task.id);

  const titleRow = document.createElement("div");
  titleRow.className = "task-title";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = task.status === "done";
  checkbox.addEventListener("change", () => toggleTaskDone(task.id, checkbox.checked));
  const titleText = document.createElement("div");
  titleText.className = "text" + (task.status === "done" ? " done" : "");
  titleText.textContent = task.title;
  titleRow.appendChild(checkbox);
  titleRow.appendChild(titleText);

  const desc = document.createElement("div");
  if (task.description) {
    desc.textContent = task.description;
    desc.style.color = "var(--muted)";
    desc.style.fontSize = "13px";
  }

  const meta = document.createElement("div");
  meta.className = "task-meta";
  // priority badge
  const pri = document.createElement("span");
  pri.className = `badge ${task.priority}`;
  pri.textContent = `Priority: ${capitalize(task.priority)}`;
  meta.appendChild(pri);
  // due badge
  const due = document.createElement("span");
  const dueLabel = formatDateLabel(task.dueDate);
  due.className = "badge";
  if (!task.dueDate) {
    due.classList.add("muted");
  } else {
    const d = new Date(task.dueDate + "T00:00:00");
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (d < startOfToday) due.classList.add("overdue");
    if (d.toDateString() === startOfToday.toDateString()) due.classList.add("duetoday");
  }
  due.textContent = `Due: ${dueLabel}`;
  meta.appendChild(due);

  // tags
  const tags = document.createElement("div");
  tags.className = "tags";
  for (const tag of task.tags) {
    const el = document.createElement("span");
    el.className = "tag";
    el.textContent = tag;
    tags.appendChild(el);
  }

  const actions = document.createElement("div");
  actions.className = "card-actions";
  const editBtn = document.createElement("button");
  editBtn.className = "btn";
  editBtn.innerHTML = svgIcon("edit") + "Edit";
  editBtn.addEventListener("click", () => openEditModal(task.id));

  const delBtn = document.createElement("button");
  delBtn.className = "btn";
  delBtn.style.color = "#ffd7d7";
  delBtn.innerHTML = svgIcon("delete") + "Delete";
  delBtn.addEventListener("click", () => deleteTask(task.id));

  actions.appendChild(editBtn);
  actions.appendChild(delBtn);

  card.appendChild(titleRow);
  if (task.description) card.appendChild(desc);
  card.appendChild(meta);
  if (task.tags.length) card.appendChild(tags);
  card.appendChild(actions);
  return card;
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function svgIcon(name) {
  if (name === "edit") return '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 18.08V21h2.92l8.63-8.63-2.92-2.92L5 18.08zM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.76 3.76 1.83-1.83z"/></svg>';
  if (name === "delete") return '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z"/></svg>';
  return "";
}

// Actions
function addTask(payload) {
  const task = /** @type {Task} */ ({
    id: generateId(),
    title: payload.title,
    description: payload.description || "",
    dueDate: payload.dueDate || null,
    priority: payload.priority || "medium",
    status: "open",
    tags: payload.tags || [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
    completedAt: null,
  });
  state.tasks.unshift(task);
  scheduleSave();
  render();
}

function updateTask(id, updates) {
  const idx = state.tasks.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const prev = state.tasks[idx];
  const next = { ...prev, ...updates, updatedAt: nowIso() };
  if (prev.status !== "done" && next.status === "done") next.completedAt = nowIso();
  if (prev.status === "done" && next.status !== "done") next.completedAt = null;
  state.tasks[idx] = next;
  scheduleSave();
  render();
}

function deleteTask(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  const ok = confirm(`Delete task: "${task.title}"?`);
  if (!ok) return;
  state.tasks = state.tasks.filter((t) => t.id !== id);
  scheduleSave();
  render();
}

function toggleTaskDone(id, done) {
  updateTask(id, { status: done ? "done" : "open" });
}

function clearCompleted() {
  const hasAny = state.tasks.some((t) => t.status === "done");
  if (!hasAny) return;
  const ok = confirm("Clear all completed tasks?");
  if (!ok) return;
  state.tasks = state.tasks.filter((t) => t.status !== "done");
  scheduleSave();
  render();
}

// Modal
function openAddModal() {
  dom.modalTitle.textContent = "Add task";
  dom.fieldId.value = "";
  dom.fieldTitle.value = "";
  dom.fieldTitleError.textContent = "";
  dom.fieldDesc.value = "";
  dom.fieldDue.value = "";
  dom.fieldPriority.value = "medium";
  dom.fieldTags.value = "";
  dom.modal.classList.remove("hidden");
  setTimeout(() => dom.fieldTitle.focus(), 0);
}

function openEditModal(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  dom.modalTitle.textContent = "Edit task";
  dom.fieldId.value = task.id;
  dom.fieldTitle.value = task.title;
  dom.fieldTitleError.textContent = "";
  dom.fieldDesc.value = task.description || "";
  dom.fieldDue.value = task.dueDate || "";
  dom.fieldPriority.value = task.priority;
  dom.fieldTags.value = task.tags.join(", ");
  dom.modal.classList.remove("hidden");
  setTimeout(() => dom.fieldTitle.focus(), 0);
}

function closeModal() {
  dom.modal.classList.add("hidden");
}

function handleSubmit(e) {
  e.preventDefault();
  const title = dom.fieldTitle.value.trim();
  if (!title) {
    dom.fieldTitleError.textContent = "Title is required";
    dom.fieldTitle.focus();
    return;
  }
  dom.fieldTitleError.textContent = "";
  const description = dom.fieldDesc.value.trim();
  const dueDate = dom.fieldDue.value || null;
  const priority = dom.fieldPriority.value;
  const tags = parseTags(dom.fieldTags.value);

  const id = dom.fieldId.value;
  if (id) {
    updateTask(id, { title, description, dueDate, priority, tags });
  } else {
    addTask({ title, description, dueDate, priority, tags });
  }
  closeModal();
}

// Import / Export
function exportData() {
  const payload = { exportedAt: nowIso(), tasks: state.tasks };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tasks-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const data = safeJsonParse(String(reader.result || ""), null);
    if (!data) { alert("Invalid file"); return; }
    if (!Array.isArray(data.tasks)) { alert("File missing tasks[]"); return; }
    const imported = [];
    for (const t of data.tasks) {
      if (!t || !isString(t.title)) continue;
      imported.push({
        id: isString(t.id) ? t.id : generateId(),
        title: t.title,
        description: isString(t.description) ? t.description : "",
        dueDate: t.dueDate || null,
        priority: ["low","medium","high"].includes(t.priority) ? t.priority : "medium",
        status: t.status === "done" ? "done" : "open",
        tags: Array.isArray(t.tags) ? t.tags.filter(isString).slice(0,8) : [],
        createdAt: t.createdAt || nowIso(),
        updatedAt: nowIso(),
        completedAt: t.status === "done" ? (t.completedAt || nowIso()) : null,
      });
    }
    const ok = confirm(`Import ${imported.length} tasks? This will append to your current list.`);
    if (!ok) return;
    state.tasks = [...imported, ...state.tasks];
    scheduleSave();
    render();
  };
  reader.readAsText(file);
}

// Event wiring
function bindEvents() {
  dom.addTaskBtn.addEventListener("click", openAddModal);
  dom.emptyAddBtn.addEventListener("click", openAddModal);
  dom.closeModalBtn.addEventListener("click", closeModal);
  dom.cancelBtn.addEventListener("click", closeModal);
  dom.form.addEventListener("submit", handleSubmit);

  dom.exportBtn.addEventListener("click", exportData);
  dom.importFile.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) importData(file);
    e.target.value = ""; // reset
  });

  // segmented controls: status
  document.querySelectorAll('.segmented .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.segmented .seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.filters.status = btn.getAttribute('data-status');
      render();
    });
  });

  dom.priorityFilter.addEventListener("change", () => {
    state.filters.priority = dom.priorityFilter.value;
    render();
  });
  dom.dueFilter.addEventListener("change", () => {
    state.filters.due = dom.dueFilter.value;
    render();
  });
  dom.sortSelect.addEventListener("change", () => {
    state.sort.field = dom.sortSelect.value;
    render();
  });
  dom.toggleSortDir.addEventListener("click", () => {
    state.sort.direction = state.sort.direction === "asc" ? "desc" : "asc";
    dom.toggleSortDir.textContent = state.sort.direction === "asc" ? "▲" : "▼";
    render();
  });
  dom.clearCompletedBtn.addEventListener("click", clearCompleted);

  // search with debounce
  let si = null;
  dom.searchInput.addEventListener("input", () => {
    if (si) clearTimeout(si);
    si = setTimeout(() => {
      state.searchQuery = dom.searchInput.value;
      render();
    }, 150);
  });

  // Close modal on Escape
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !dom.modal.classList.contains("hidden")) {
      closeModal();
    }
  });
}

// Boot
function main() {
  loadState();
  bindEvents();
  render();
}

document.addEventListener("DOMContentLoaded", main);


