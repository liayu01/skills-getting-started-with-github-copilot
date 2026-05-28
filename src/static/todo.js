/* =====================================================
   备忘录 Todo App – frontend logic
   ===================================================== */

"use strict";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const REMINDER_CHECK_INTERVAL = 30000;   // ms between reminder polls
const REMINDER_WINDOW_MS = 31000;        // fire reminder if within this window after due time
const MAX_TAGS = 10;                     // maximum tags per todo item

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let todos = [];          // array of todo objects from API
let activeFilter = "all";
let activeTag = null;    // null = no tag filter
let searchQuery = "";
let sortMode = "newest";
let editingId = null;    // null = creating new

// Timer state: { [id]: { interval, startedAt, elapsed } }
const timers = {};

// All unique tags seen so far
let knownTags = new Set();

// Reminder check interval handle
let reminderInterval = null;

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const todoList      = document.getElementById("todo-list");
const emptyState    = document.getElementById("empty-state");
const modalOverlay  = document.getElementById("modal-overlay");
const modalTitle    = document.getElementById("modal-title");
const fieldTitle    = document.getElementById("field-title");
const fieldDesc     = document.getElementById("field-desc");
const fieldReminder = document.getElementById("field-reminder");
const fieldProgress = document.getElementById("field-progress");
const progressLabel = document.getElementById("progress-label");
const tagInput      = document.getElementById("tag-input");
const tagChips      = document.getElementById("tag-chips");
const tagSuggestions = document.getElementById("tag-suggestions");
const tagFilterList = document.getElementById("tag-filter-list");
const searchInput   = document.getElementById("search-input");
const sortSelect    = document.getElementById("sort-select");
const toastContainer = document.getElementById("toast-container");

// Current modal tag list
let modalTags = [];

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------
async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "API error");
  return data;
}

// ---------------------------------------------------------------------------
// Load & render
// ---------------------------------------------------------------------------
async function loadTodos() {
  try {
    todos = await apiFetch("/todos");
    rebuildKnownTags();
    render();
  } catch (e) {
    showToast("加载失败：" + e.message, "error");
  }
}

function rebuildKnownTags() {
  knownTags = new Set();
  todos.forEach(t => t.tags.forEach(tag => knownTags.add(tag)));
}

function getFilteredSorted() {
  let list = [...todos];

  // Filter by sidebar button
  if (activeFilter === "active")    list = list.filter(t => !t.completed);
  if (activeFilter === "completed") list = list.filter(t => t.completed);
  if (activeFilter === "reminder")  list = list.filter(t => t.reminder);

  // Filter by tag
  if (activeTag) list = list.filter(t => t.tags.includes(activeTag));

  // Search
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(t =>
      t.title.toLowerCase().includes(q) ||
      (t.description && t.description.toLowerCase().includes(q)) ||
      t.tags.some(tag => tag.toLowerCase().includes(q))
    );
  }

  // Sort
  if (sortMode === "newest")  list.sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (sortMode === "oldest")  list.sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (sortMode === "progress") list.sort((a, b) => b.progress - a.progress);
  if (sortMode === "reminder") {
    list.sort((a, b) => {
      if (!a.reminder && !b.reminder) return 0;
      if (!a.reminder) return 1;
      if (!b.reminder) return -1;
      return a.reminder.localeCompare(b.reminder);
    });
  }

  return list;
}

function render() {
  updateBadges();
  renderTagFilters();
  renderTodoList();
}

function updateBadges() {
  document.getElementById("badge-all").textContent       = todos.length;
  document.getElementById("badge-active").textContent    = todos.filter(t => !t.completed).length;
  document.getElementById("badge-completed").textContent = todos.filter(t => t.completed).length;
  document.getElementById("badge-reminder").textContent  = todos.filter(t => t.reminder).length;
}

function renderTagFilters() {
  tagFilterList.innerHTML = "";
  if (!knownTags.size) return;
  [...knownTags].sort().forEach(tag => {
    const pill = document.createElement("button");
    pill.className = "tag-filter-pill" + (activeTag === tag ? " active" : "");
    pill.textContent = tag;
    pill.addEventListener("click", () => {
      activeTag = activeTag === tag ? null : tag;
      renderTagFilters();
      renderTodoList();
    });
    tagFilterList.appendChild(pill);
  });
}

function renderTodoList() {
  // Remove existing cards (keep empty-state node)
  Array.from(todoList.children).forEach(el => {
    if (!el.id || el.id !== "empty-state") el.remove();
  });

  const list = getFilteredSorted();

  if (!list.length) {
    emptyState.style.display = "";
    return;
  }
  emptyState.style.display = "none";

  list.forEach(todo => {
    todoList.appendChild(buildCard(todo));
  });
}

// ---------------------------------------------------------------------------
// Card builder
// ---------------------------------------------------------------------------
function buildCard(todo) {
  const card = document.createElement("div");
  card.className = "todo-card" + (todo.completed ? " completed" : "");
  card.dataset.id = todo.id;

  // Top row
  const top = document.createElement("div");
  top.className = "card-top";

  // Checkbox
  const cb = document.createElement("div");
  cb.className = "complete-checkbox" + (todo.completed ? " checked" : "");
  cb.title = todo.completed ? "标记为未完成" : "标记为完成";
  cb.textContent = todo.completed ? "✓" : "";
  cb.addEventListener("click", () => toggleComplete(todo.id, !todo.completed));

  // Content
  const content = document.createElement("div");
  content.className = "card-content";

  const titleEl = document.createElement("div");
  titleEl.className = "card-title";
  titleEl.textContent = todo.title;

  content.appendChild(titleEl);

  if (todo.description) {
    const descEl = document.createElement("div");
    descEl.className = "card-desc";
    descEl.textContent = todo.description;
    content.appendChild(descEl);
  }

  // Actions
  const actions = document.createElement("div");
  actions.className = "card-actions";

  const timerRunning = !!(timers[todo.id]);
  const timerBtn = document.createElement("button");
  timerBtn.className = "icon-btn timer-btn" + (timerRunning ? " timer-running" : "");
  timerBtn.title = timerRunning ? "停止计时" : "开始计时";
  timerBtn.textContent = timerRunning ? "⏸" : "▶";
  timerBtn.addEventListener("click", () => toggleTimer(todo.id));

  const editBtn = document.createElement("button");
  editBtn.className = "icon-btn";
  editBtn.title = "编辑";
  editBtn.textContent = "✏️";
  editBtn.addEventListener("click", () => openEditModal(todo.id));

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "icon-btn danger";
  deleteBtn.title = "删除";
  deleteBtn.textContent = "🗑";
  deleteBtn.addEventListener("click", () => deleteTodo(todo.id));

  actions.append(timerBtn, editBtn, deleteBtn);
  top.append(cb, content, actions);

  // Meta row
  const meta = document.createElement("div");
  meta.className = "card-meta";

  if (todo.reminder) {
    const reminderEl = document.createElement("span");
    const rd = new Date(todo.reminder);
    const overdue = !todo.completed && rd < new Date();
    reminderEl.className = "meta-reminder" + (overdue ? " overdue" : "");
    reminderEl.textContent = (overdue ? "⚠️ " : "⏰ ") + formatDateTime(todo.reminder);
    meta.appendChild(reminderEl);
  }

  // Time spent
  const timeEl = document.createElement("span");
  timeEl.className = "meta-time";
  timeEl.id = "time-" + todo.id;
  timeEl.textContent = "⏱ " + formatDuration(todo.time_spent + (timers[todo.id] ? timers[todo.id].elapsed : 0));
  meta.appendChild(timeEl);

  // Tags
  if (todo.tags && todo.tags.length) {
    const tagsRow = document.createElement("div");
    tagsRow.className = "tags-row";
    todo.tags.forEach(tag => {
      const pill = document.createElement("span");
      pill.className = "tag-pill " + tagColorClass(tag);
      pill.textContent = tag;
      tagsRow.appendChild(pill);
    });
    card.append(top, meta, tagsRow);
  } else {
    card.append(top, meta);
  }

  // Progress
  const progressArea = document.createElement("div");
  progressArea.className = "progress-area";

  const progressHeader = document.createElement("div");
  progressHeader.className = "progress-header";
  progressHeader.innerHTML = `<span>进度</span><span>${todo.progress}%</span>`;

  const track = document.createElement("div");
  track.className = "progress-bar-track";

  const fill = document.createElement("div");
  fill.className = "progress-bar-fill" + (todo.progress === 100 ? " complete" : "");
  fill.style.width = todo.progress + "%";

  track.appendChild(fill);
  progressArea.append(progressHeader, track);
  card.appendChild(progressArea);

  return card;
}

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------
function toggleTimer(id) {
  if (timers[id]) {
    stopTimer(id);
  } else {
    startTimer(id);
  }
}

function startTimer(id) {
  timers[id] = { startedAt: Date.now(), elapsed: 0, interval: null };
  timers[id].interval = setInterval(() => {
    timers[id].elapsed = Math.floor((Date.now() - timers[id].startedAt) / 1000);
    // Update time display in-place without full re-render
    const el = document.getElementById("time-" + id);
    const todo = todos.find(t => t.id === id);
    if (el && todo) {
      el.textContent = "⏱ " + formatDuration(todo.time_spent + timers[id].elapsed);
    }
    // Update timer button style
    const card = todoList.querySelector(`[data-id="${id}"]`);
    if (card) {
      const btn = card.querySelector(".icon-btn.timer-btn");
      if (btn) {
        btn.className = "icon-btn timer-btn timer-running";
        btn.title = "停止计时";
        btn.textContent = "⏸";
      }
    }
  }, 1000);
  // Re-render the card to reflect running state immediately
  rerenderCard(id);
}

async function stopTimer(id) {
  if (!timers[id]) return;
  clearInterval(timers[id].interval);
  const elapsed = timers[id].elapsed;
  delete timers[id];

  if (elapsed > 0) {
    try {
      const updated = await apiFetch(`/todos/${id}/time`, {
        method: "POST",
        body: JSON.stringify({ seconds: elapsed }),
      });
      const idx = todos.findIndex(t => t.id === id);
      if (idx !== -1) todos[idx].time_spent = updated.time_spent;
      showToast(`已记录 ${formatDuration(elapsed)}`, "success");
    } catch (e) {
      showToast("记录时长失败：" + e.message, "error");
    }
  }
  rerenderCard(id);
}

function rerenderCard(id) {
  const todo = todos.find(t => t.id === id);
  if (!todo) return;
  const existing = todoList.querySelector(`[data-id="${id}"]`);
  if (existing) {
    const newCard = buildCard(todo);
    existing.replaceWith(newCard);
  }
}

// ---------------------------------------------------------------------------
// CRUD actions
// ---------------------------------------------------------------------------
async function toggleComplete(id, completed) {
  try {
    const updated = await apiFetch(`/todos/${id}`, {
      method: "PUT",
      body: JSON.stringify({ completed }),
    });
    const idx = todos.findIndex(t => t.id === id);
    if (idx !== -1) todos[idx] = updated;
    render();
  } catch (e) {
    showToast("更新失败：" + e.message, "error");
  }
}

async function deleteTodo(id) {
  // Stop timer if running
  if (timers[id]) stopTimer(id);
  try {
    await apiFetch(`/todos/${id}`, { method: "DELETE" });
    todos = todos.filter(t => t.id !== id);
    rebuildKnownTags();
    render();
    showToast("已删除", "success");
  } catch (e) {
    showToast("删除失败：" + e.message, "error");
  }
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
function openAddModal() {
  editingId = null;
  modalTitle.textContent = "新建任务";
  fieldTitle.value = "";
  fieldDesc.value = "";
  fieldReminder.value = "";
  fieldProgress.value = 0;
  progressLabel.textContent = "0%";
  modalTags = [];
  renderModalChips();
  renderTagSuggestions();
  modalOverlay.classList.remove("hidden");
  fieldTitle.focus();
}

function openEditModal(id) {
  const todo = todos.find(t => t.id === id);
  if (!todo) return;
  editingId = id;
  modalTitle.textContent = "编辑任务";
  fieldTitle.value = todo.title;
  fieldDesc.value = todo.description || "";
  fieldReminder.value = todo.reminder ? todo.reminder.slice(0, 16) : "";
  fieldProgress.value = todo.progress;
  progressLabel.textContent = todo.progress + "%";
  modalTags = [...todo.tags];
  renderModalChips();
  renderTagSuggestions();
  modalOverlay.classList.remove("hidden");
  fieldTitle.focus();
}

function closeModal() {
  modalOverlay.classList.add("hidden");
  editingId = null;
}

async function saveModal() {
  const title = fieldTitle.value.trim();
  if (!title) { showToast("请输入任务标题", "warning"); fieldTitle.focus(); return; }

  const payload = {
    title,
    description: fieldDesc.value.trim(),
    reminder: fieldReminder.value || null,
    tags: [...modalTags],
    progress: parseInt(fieldProgress.value, 10),
  };

  try {
    if (editingId) {
      const updated = await apiFetch(`/todos/${editingId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      const idx = todos.findIndex(t => t.id === editingId);
      if (idx !== -1) todos[idx] = updated;
      showToast("已保存", "success");
    } else {
      const created = await apiFetch("/todos", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      todos.unshift(created);
      showToast("任务已创建", "success");
    }
    rebuildKnownTags();
    render();
    closeModal();
  } catch (e) {
    showToast("保存失败：" + e.message, "error");
  }
}

// ---------------------------------------------------------------------------
// Modal tag chips
// ---------------------------------------------------------------------------
function renderModalChips() {
  tagChips.innerHTML = "";
  modalTags.forEach((tag, i) => {
    const chip = document.createElement("span");
    chip.className = "chip " + tagColorClass(tag);
    chip.innerHTML = `${escHtml(tag)} <span class="chip-remove" data-i="${i}" title="移除">×</span>`;
    chip.querySelector(".chip-remove").addEventListener("click", () => {
      modalTags.splice(i, 1);
      renderModalChips();
      renderTagSuggestions();
    });
    tagChips.appendChild(chip);
  });
}

function renderTagSuggestions() {
  tagSuggestions.innerHTML = "";
  const existing = new Set(modalTags);
  const suggestions = [...knownTags].filter(t => !existing.has(t));
  if (!suggestions.length) return;

  const label = document.createElement("span");
  label.style.cssText = "font-size:.75rem;color:var(--text-muted);margin-right:4px;";
  label.textContent = "已有标签：";
  tagSuggestions.appendChild(label);

  suggestions.forEach(tag => {
    const s = document.createElement("span");
    s.className = "tag-suggestion " + tagColorClass(tag);
    s.textContent = tag;
    s.addEventListener("click", () => addModalTag(tag));
    tagSuggestions.appendChild(s);
  });
}

function addModalTag(tag) {
  tag = tag.trim().replace(/,/g, "");
  if (!tag || modalTags.includes(tag) || modalTags.length >= MAX_TAGS) return;
  modalTags.push(tag);
  renderModalChips();
  renderTagSuggestions();
  tagInput.value = "";
  tagInput.focus();
}

tagInput.addEventListener("keydown", e => {
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    addModalTag(tagInput.value);
  }
  if (e.key === "Backspace" && !tagInput.value && modalTags.length) {
    modalTags.pop();
    renderModalChips();
    renderTagSuggestions();
  }
});

tagInput.addEventListener("blur", () => {
  if (tagInput.value.trim()) addModalTag(tagInput.value);
});

// Click on tag-input-area focuses input
document.getElementById("tag-input-area").addEventListener("click", () => tagInput.focus());

// ---------------------------------------------------------------------------
// Progress slider live label
// ---------------------------------------------------------------------------
fieldProgress.addEventListener("input", () => {
  progressLabel.textContent = fieldProgress.value + "%";
});

// ---------------------------------------------------------------------------
// Reminders – check every 30 seconds
// ---------------------------------------------------------------------------
function checkReminders() {
  const now = new Date();
  todos.forEach(todo => {
    if (!todo.reminder || todo.completed || todo._reminded) return;
    const rd = new Date(todo.reminder);
    // Fire if reminder is within REMINDER_WINDOW_MS of the due time (catches the poll gap)
    if (rd <= now && (now - rd) < REMINDER_WINDOW_MS) {
      todo._reminded = true;
      showToast(`⏰ 提醒：${todo.title}`, "warning", 8000);
      // Browser notification if permission granted
      if (Notification.permission === "granted") {
        new Notification("备忘录提醒", { body: todo.title });
      }
    }
  });
}

// Request notification permission early
if ("Notification" in window && Notification.permission === "default") {
  Notification.requestPermission();
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------
function formatDuration(secs) {
  if (!secs) return "0 秒";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const parts = [];
  if (h) parts.push(h + " 时");
  if (m) parts.push(m + " 分");
  if (s || !parts.length) parts.push(s + " 秒");
  return parts.join(" ");
}

function formatDateTime(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (isNaN(d)) return isoStr;
  return d.toLocaleString("zh-CN", {
    month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

const TAG_COLORS = 8;
const tagColorMap = {};
let tagColorCounter = 0;

function tagColorClass(tag) {
  if (!(tag in tagColorMap)) {
    tagColorMap[tag] = tagColorCounter++ % TAG_COLORS;
  }
  return "tag-color-" + tagColorMap[tag];
}

function escHtml(str) {
  return str.replace(/[&<>"']/g, c => ({ "&": "&amp;","<": "&lt;",">": "&gt;",'"': "&quot;","'": "&#39;" }[c]));
}

function showToast(msg, type = "info", duration = 3000) {
  const t = document.createElement("div");
  t.className = "toast " + type;
  t.textContent = msg;
  toastContainer.appendChild(t);
  setTimeout(() => t.remove(), duration);
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------
document.getElementById("add-todo-btn").addEventListener("click", openAddModal);
document.getElementById("modal-close").addEventListener("click", closeModal);
document.getElementById("modal-cancel").addEventListener("click", closeModal);
document.getElementById("modal-save").addEventListener("click", saveModal);

modalOverlay.addEventListener("click", e => { if (e.target === modalOverlay) closeModal(); });

document.querySelectorAll(".filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeFilter = btn.dataset.filter;
    renderTodoList();
  });
});

searchInput.addEventListener("input", () => {
  searchQuery = searchInput.value.trim();
  renderTodoList();
});

sortSelect.addEventListener("change", () => {
  sortMode = sortSelect.value;
  renderTodoList();
});

// Keyboard shortcut: Escape to close modal
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !modalOverlay.classList.contains("hidden")) closeModal();
  if (e.key === "n" && e.ctrlKey) { e.preventDefault(); openAddModal(); }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
loadTodos();
reminderInterval = setInterval(checkReminders, REMINDER_CHECK_INTERVAL);
