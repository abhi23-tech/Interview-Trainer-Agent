/**
 * InterviewAI — Main JavaScript Application
 * ChatGPT-style chat UI with markdown, syntax highlighting,
 * panel navigation, resume upload, and dashboard.
 */

"use strict";

/* ════════════════════════════════════════════════════════════════
   0.  GLOBALS
════════════════════════════════════════════════════════════════ */
const State = {
  isLoading:   false,
  profile:     {},
  scores:      { interview_readiness: 0, resume_score: 0, technical_score: 0, communication_score: 0 },
  sessionId:   null,
  messageCount: 0,
  activeConversationId: null,
};

/* ════════════════════════════════════════════════════════════════
   1.  MARKED.JS CONFIGURATION (markdown renderer)
════════════════════════════════════════════════════════════════ */
function configureMarked() {
  if (typeof marked === "undefined") return;
  marked.setOptions({
    gfm: true,
    breaks: true,
    highlight: (code, lang) => {
      if (typeof hljs !== "undefined" && lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
      }
      return typeof hljs !== "undefined"
        ? hljs.highlightAuto(code).value
        : code;
    },
  });
}

function renderMarkdown(text) {
  if (typeof marked === "undefined") return escapeHtml(text).replace(/\n/g, "<br>");
  try {
    return marked.parse(text);
  } catch {
    return escapeHtml(text).replace(/\n/g, "<br>");
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ════════════════════════════════════════════════════════════════
   2.  DOM HELPERS
════════════════════════════════════════════════════════════════ */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function now() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/* ════════════════════════════════════════════════════════════════
   3.  PANEL NAVIGATION
════════════════════════════════════════════════════════════════ */
function switchPanel(name) {
  // Hide all panels
  $$(".panel").forEach(p => p.classList.remove("active"));
  $$(".nav-item").forEach(n => n.classList.remove("active"));

  const panel = $(`#panel-${name}`);
  if (panel) panel.classList.add("active");

  const navItem = $(`#nav${name.charAt(0).toUpperCase() + name.slice(1)}`);
  if (navItem) navItem.classList.add("active");

  // Close sidebar on mobile
  if (window.innerWidth < 992) closeSidebar();

  // Refresh dashboard data when switching to it
  if (name === "dashboard") loadDashboard();
}

/* ════════════════════════════════════════════════════════════════
   4.  SIDEBAR (mobile)
════════════════════════════════════════════════════════════════ */
let sidebarOverlay = null;

function openSidebar() {
  const sidebar = $("#sidebar");
  sidebar.classList.add("open");
  if (!sidebarOverlay) {
    sidebarOverlay = document.createElement("div");
    sidebarOverlay.className = "sidebar-overlay";
    sidebarOverlay.addEventListener("click", closeSidebar);
    document.body.appendChild(sidebarOverlay);
  }
  setTimeout(() => sidebarOverlay.classList.add("show"), 10);
}

function closeSidebar() {
  $("#sidebar").classList.remove("open");
  if (sidebarOverlay) {
    sidebarOverlay.classList.remove("show");
    setTimeout(() => {
      sidebarOverlay?.remove();
      sidebarOverlay = null;
    }, 300);
  }
}

/* ════════════════════════════════════════════════════════════════
   5.  TOAST NOTIFICATIONS
════════════════════════════════════════════════════════════════ */
let toastTimer = null;

function showToast(message, type = "info") {
  const toast = $("#appToast");
  const body  = $("#toastBody");
  const icon  = $("#toastIcon");

  body.textContent = message;
  toast.className = `app-toast ${type}`;

  const icons = { success: "bi-check-circle-fill", error: "bi-exclamation-circle-fill", info: "bi-info-circle-fill" };
  icon.innerHTML = `<i class="bi ${icons[type] || icons.info}"></i>`;

  void toast.offsetWidth; // force reflow
  toast.classList.add("show");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 4000);
}

function hideToast() {
  $("#appToast")?.classList.remove("show");
}

/* ════════════════════════════════════════════════════════════════
   6.  CHAT — Message rendering
════════════════════════════════════════════════════════════════ */
function createMessageRow(role, content, isError = false) {
  const row = document.createElement("div");
  row.className = `message-row ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.innerHTML = role === "user"
    ? `<i class="bi bi-person-fill"></i>`
    : `<i class="bi bi-cpu-fill"></i>`;

  const bubble = document.createElement("div");

  if (isError) {
    bubble.className = "message-bubble error-bubble";
    bubble.innerHTML = `<i class="bi bi-exclamation-triangle-fill"></i> ${escapeHtml(content)}`;
  } else if (role === "user") {
    bubble.className = "message-bubble user-bubble";
    const msgContent = document.createElement("div");
    msgContent.className = "message-content";
    msgContent.textContent = content;
    bubble.appendChild(msgContent);
  } else {
    bubble.className = "message-bubble assistant-bubble";
    const msgContent = document.createElement("div");
    msgContent.className = "message-content";
    msgContent.innerHTML = renderMarkdown(content);
    bubble.appendChild(msgContent);

    // Add copy-code buttons to all pre blocks
    $$("pre", msgContent).forEach(addCopyCodeButton);

    // Message meta (time + copy button)
    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.innerHTML = `
      <span class="message-time">${now()}</span>
      <button class="copy-msg-btn" title="Copy response">
        <i class="bi bi-clipboard"></i> Copy
      </button>`;
    meta.querySelector(".copy-msg-btn").addEventListener("click", function() {
      copyToClipboard(content, this);
    });
    bubble.appendChild(meta);

    // Init highlight.js on any code blocks
    if (typeof hljs !== "undefined") {
      $$("pre code", msgContent).forEach(hljs.highlightElement);
    }
  }

  row.appendChild(avatar);
  row.appendChild(bubble);
  return row;
}

function addCopyCodeButton(preEl) {
  const btn = document.createElement("button");
  btn.className = "copy-code-btn";
  btn.innerHTML = `<i class="bi bi-clipboard"></i> Copy`;
  btn.addEventListener("click", () => {
    const code = preEl.querySelector("code")?.innerText || preEl.innerText;
    copyToClipboard(code, btn);
  });
  preEl.style.position = "relative";
  preEl.appendChild(btn);
}

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.innerHTML;
    btn.innerHTML = `<i class="bi bi-check2"></i> Copied!`;
    btn.classList.add("copied");
    setTimeout(() => {
      btn.innerHTML = orig;
      btn.classList.remove("copied");
    }, 2000);
  }).catch(() => showToast("Copy failed — use Ctrl+C", "error"));
}

function appendMessage(role, content, isError = false) {
  const container = $("#chatMessages");
  const row = createMessageRow(role, content, isError);
  container.appendChild(row);
  scrollToBottom();
  if (role === "user") State.messageCount++;
  return row;
}

function scrollToBottom() {
  const el = $("#chatMessages");
  if (el) el.scrollTop = el.scrollHeight;
}

/* ════════════════════════════════════════════════════════════════
   7.  CHAT — Send message
════════════════════════════════════════════════════════════════ */
async function sendMessage(text) {
  if (!text || State.isLoading) return;

  setLoading(true);
  appendMessage("user", text);
  appendMessageToActiveConversation("user", text);
  showTyping(true);

  try {
    const body = { message: text };
    if (Object.keys(State.profile).length > 0) {
      body.profile = State.profile;
    }

    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await resp.json();

    showTyping(false);

    if (!resp.ok) {
      const errMsg = data.error || `Server error (${resp.status})`;
      appendMessage("assistant", errMsg, true);
      appendMessageToActiveConversation("assistant", errMsg);
      if (resp.status === 503) {
        showToast("⚙️ Configure your IBM API key in the .env file to activate AI responses.", "error");
      }
    } else {
      appendMessage("assistant", data.response);
      appendMessageToActiveConversation("assistant", data.response);
      if (data.scores) {
        updateScores(data.scores);
      }
    }
  } catch (err) {
    showTyping(false);
    appendMessage("assistant", "Connection error. Please check your network and try again.", true);
    appendMessageToActiveConversation("assistant", "Connection error. Please check your network and try again.");
    console.error("Chat error:", err);
  } finally {
    setLoading(false);
  }
}

function setLoading(loading) {
  State.isLoading = loading;
  const sendBtn = $("#sendBtn");
  const input   = $("#chatInput");
  if (sendBtn) sendBtn.disabled = loading;
  if (input)   input.disabled   = loading;
  if (loading) {
    updateAgentStatus("Thinking…", true);
  } else {
    updateAgentStatus("Ready to coach", false);
    setTimeout(() => input?.focus(), 50);
  }
}

function showTyping(show) {
  const el = $("#typingIndicator");
  if (el) {
    el.style.display = show ? "block" : "none";
    if (show) scrollToBottom();
  }
}

function updateAgentStatus(text, animated = false) {
  const el = $("#agentStatus");
  if (el) el.textContent = text;
  const dot = $(".status-dot");
  if (dot) {
    dot.style.background = animated ? "var(--warning)" : "var(--success)";
  }
}

/* ════════════════════════════════════════════════════════════════
   8.  CHAT INPUT — Auto-resize + char counter
════════════════════════════════════════════════════════════════ */
function initChatInput() {
  const input   = $("#chatInput");
  const sendBtn = $("#sendBtn");
  const counter = $("#charCounter");

  if (!input) return;

  input.addEventListener("input", () => {
    // Auto-resize
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 180) + "px";

    // Char counter
    const len = input.value.length;
    if (counter) {
      counter.textContent = `${len}/2000`;
      counter.style.color = len > 1800 ? "var(--danger)" : "var(--text-muted)";
    }

    // Enable/disable send
    if (sendBtn) sendBtn.disabled = len === 0 || State.isLoading;
  });

  // Send on Enter (not Shift+Enter)
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const text = input.value.trim();
      if (text) {
        input.value = "";
        input.style.height = "auto";
        if (counter) counter.textContent = "0/2000";
        if (sendBtn) sendBtn.disabled = true;
        sendMessage(text);
      }
    }
  });

  if (sendBtn) {
    sendBtn.addEventListener("click", () => {
      const text = input.value.trim();
      if (text) {
        input.value = "";
        input.style.height = "auto";
        if (counter) counter.textContent = "0/2000";
        sendBtn.disabled = true;
        sendMessage(text);
      }
    });
  }
}

/* ════════════════════════════════════════════════════════════════
   9.  QUICK PROMPTS
════════════════════════════════════════════════════════════════ */
function initQuickPrompts() {
  $$(".quick-prompt-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const prompt = chip.dataset.prompt;
      if (prompt) {
        switchPanel("chat");
        sendMessage(prompt);
      }
    });
  });
}

/* ════════════════════════════════════════════════════════════════
  10.  CLEAR CHAT
════════════════════════════════════════════════════════════════ */
function initClearChat() {
  const clearModal = new bootstrap.Modal("#clearModal");

  const openClear = () => clearModal.show();

  $("#clearChatBtn")?.addEventListener("click", openClear);
  $("#mobileClearBtn")?.addEventListener("click", openClear);

  $("#confirmClearBtn")?.addEventListener("click", async () => {
    clearModal.hide();
    try {
      await fetch("/api/clear-chat", { method: "POST" });
      const container = $("#chatMessages");
      if (container) {
        container.innerHTML = "";
        // Re-add welcome message
        appendMessage("assistant",
          "✨ Chat cleared! Ready for a fresh session.\n\nWhat would you like to practice today?");
      }
      State.messageCount = 0;
      showToast("Chat cleared successfully", "success");
    } catch {
      showToast("Failed to clear chat", "error");
    }
  });
}

/* ════════════════════════════════════════════════════════════════
  11.  SESSION LIST (sidebar) — LocalStorage management
════════════════════════════════════════════════════════════════ */
function getSavedConversations() {
  try {
    const raw = localStorage.getItem("interview_conversations");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(c => c && typeof c === "object" && c.id && Array.isArray(c.messages));
  } catch {
    return [];
  }
}

function saveConversations(conversations) {
  localStorage.setItem("interview_conversations", JSON.stringify(conversations));
}

function ensureActiveConversation() {
  const conversations = getSavedConversations();
  if (!State.activeConversationId) {
    if (conversations.length > 0) {
      State.activeConversationId = conversations[0].id;
    } else {
      createNewConversation();
    }
  }
}

function createNewConversation(jobRole = null) {
  const conversations = getSavedConversations();
  const id = "conv_" + Math.random().toString(36).substr(2, 9);
  const role = jobRole || State.profile.job_role || "General";
  const newConv = {
    id: id,
    title: `Session: ${role}`,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    messages: [
      {
        role: "assistant",
        content: `👋 Hi! I'm **Alex**, your AI-powered interview coach, built on **IBM Granite**.\n\nI can help you with:\n\n* 🎯 **Technical questions** — DSA, system design, coding\n* 🤝 **HR & behavioral** — STAR-format coaching\n* 🏢 **Company-specific** — Google, Amazon, Microsoft & more\n* 📄 **Resume review** — actionable improvements\n* 📊 **Readiness scoring** — know where you stand\n\nTo get started, tell me: **What role are you preparing for?**`
      }
    ]
  };
  conversations.unshift(newConv);
  saveConversations(conversations);
  State.activeConversationId = id;
  renderSidebarConversations();
  loadConversation(id, false);
  return id;
}

async function loadConversation(id, syncWithServer = true) {
  const conversations = getSavedConversations();
  const conv = conversations.find(c => c.id === id);
  if (!conv) return;

  State.activeConversationId = id;
  switchPanel("chat");

  // Render messages safely
  const container = $("#chatMessages");
  if (container && conv.messages && Array.isArray(conv.messages)) {
    container.innerHTML = "";
    conv.messages.forEach(msg => {
      const row = createMessageRow(msg.role, msg.content, false);
      container.appendChild(row);
    });
    scrollToBottom();
  }

  // Highlight active item in sidebar
  $$(".session-item").forEach(item => {
    if (item.dataset.id === id) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  });

  if (syncWithServer && conv.messages) {
    try {
      const serverHistory = conv.messages
        .filter(m => m.role === "user" || m.role === "assistant")
        .map(m => ({ role: m.role, content: m.content }));
      
      const resp = await fetch("/api/set-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history: serverHistory })
      });
      const data = await resp.json();
      if (data.scores) {
        updateScores(data.scores);
      }
    } catch (err) {
      console.error("Failed to sync history with server:", err);
    }
  }
}

function appendMessageToActiveConversation(role, content) {
  const conversations = getSavedConversations();
  const conv = conversations.find(c => c.id === State.activeConversationId);
  if (conv) {
    if (!conv.messages) conv.messages = [];
    conv.messages.push({ role, content });
    
    // Auto-update title if it's the first user message
    if (role === "user" && conv.messages.filter(m => m.role === "user").length === 1) {
      conv.title = content.slice(0, 30) + (content.length > 30 ? "…" : "");
    }
    
    conv.timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    saveConversations(conversations);
    renderSidebarConversations();
  }
}

async function deleteConversation(id, event) {
  if (event) event.stopPropagation();

  const conversations = getSavedConversations();
  const index = conversations.findIndex(c => c.id === id);
  if (index === -1) return;

  conversations.splice(index, 1);
  saveConversations(conversations);

  try {
    await fetch("/api/delete-session-record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: id })
    });
  } catch (err) {
    console.error("Failed to delete session record on server:", err);
  }

  showToast("Session deleted", "success");

  if (State.activeConversationId === id) {
    State.activeConversationId = null;
    if (conversations.length > 0) {
      loadConversation(conversations[0].id);
    } else {
      createNewConversation();
    }
  } else {
    renderSidebarConversations();
  }
}

function renderSidebarConversations() {
  const list = $("#sessionList");
  if (!list) return;

  const conversations = getSavedConversations();
  if (conversations.length === 0) {
    list.innerHTML = `
      <div class="session-empty">
        <i class="bi bi-clock-history"></i>
        <span>No sessions yet</span>
      </div>`;
    return;
  }

  list.innerHTML = conversations.map(c => `
    <div class="session-item ${c.id === State.activeConversationId ? 'active' : ''}" data-id="${c.id}">
      <div class="session-item-content" data-id="${c.id}">
        <div class="session-item-title" data-id="${c.id}">${escapeHtml(c.title || "Session")}</div>
        <div class="session-item-time" data-id="${c.id}">${c.timestamp || ""}</div>
      </div>
      <button class="session-delete-btn" title="Delete session" data-id="${c.id}">
        <i class="bi bi-trash3" data-id="${c.id}"></i>
      </button>
    </div>
  `).join("");
}

function initSessionListEvents() {
  const list = $("#sessionList");
  if (!list) return;

  list.addEventListener("click", (e) => {
    // 1. Check if clicked delete button or trash icon
    const deleteBtn = e.target.closest(".session-delete-btn");
    if (deleteBtn) {
      const id = deleteBtn.dataset.id;
      if (id) {
        deleteConversation(id, e);
      }
      return;
    }

    // 2. Check if clicked session item or session item content
    const sessionItem = e.target.closest(".session-item");
    if (sessionItem) {
      const id = sessionItem.dataset.id;
      if (id) {
        loadConversation(id);
      }
    }
  });
}

/* ════════════════════════════════════════════════════════════════
  12.  NEW CHAT
════════════════════════════════════════════════════════════════ */
function initNewChat() {
  $("#newChatBtn")?.addEventListener("click", async () => {
    try {
      await fetch("/api/clear-chat", { method: "POST" });
    } catch {/* ignore */}
    switchPanel("chat");
    createNewConversation();
    State.messageCount = 0;
    $("#chatInput")?.focus();
  });
}

/* ════════════════════════════════════════════════════════════════
  13.  SCORES + DASHBOARD
════════════════════════════════════════════════════════════════ */
function updateScores(scores) {
  State.scores = { ...State.scores, ...scores };

  const circumference = 2 * Math.PI * 24; // r=24 → ~150.8

  const map = [
    { id: "Readiness",    key: "interview_readiness", ring: "ringReadiness",    badge: "readinessBadge" },
    { id: "Resume",       key: "resume_score",         ring: "ringResume"       },
    { id: "Technical",    key: "technical_score",      ring: "ringTechnical"    },
    { id: "Communication",key: "communication_score",  ring: "ringCommunication"},
  ];

  map.forEach(({ id, key, ring, badge }) => {
    const val   = scores[key] || 0;
    const scoreEl = $(`#score${id}`);
    const ringEl  = $(`#${ring}`);

    if (scoreEl) {
      // Animate counter
      animateCounter(scoreEl, parseInt(scoreEl.textContent) || 0, val, "%");
    }

    if (ringEl) {
      const filled = (val / 100) * circumference;
      const gap    = circumference - filled;
      ringEl.style.strokeDasharray = `${filled.toFixed(1)} ${gap.toFixed(1)}`;
    }

    if (badge) {
      const badgeEl = $(`#${badge}`);
      if (badgeEl) badgeEl.textContent = `${val}%`;
    }
  });
}

function animateCounter(el, from, to, suffix = "") {
  const duration = 800;
  const step     = 16;
  const steps    = duration / step;
  const inc      = (to - from) / steps;
  let current    = from;
  const timer    = setInterval(() => {
    current += inc;
    if ((inc > 0 && current >= to) || (inc < 0 && current <= to)) {
      current = to;
      clearInterval(timer);
    }
    el.textContent = `${Math.round(current)}${suffix}`;
  }, step);
}

async function loadDashboard() {
  try {
    const resp = await fetch("/api/dashboard");
    const data = await resp.json();

    if (data.scores) updateScores(data.scores);

    // Stats
    const statMsgs = $("#statMessages");
    if (statMsgs) statMsgs.textContent = data.total_messages || 0;

    const statResume = $("#statResume");
    if (statResume) statResume.textContent = data.has_resume ? "Uploaded ✓" : "Not uploaded";

    const statCompany = $("#statCompany");
    if (statCompany) statCompany.textContent = data.profile?.target_company || "—";

    // Sessions table
    renderSessionsTable(data.session_records || []);

    // Profile form sync
    if (data.profile) syncProfileForm(data.profile);

  } catch (err) {
    console.error("Dashboard load error:", err);
  }
}

function renderSessionsTable(records) {
  const container = $("#sessionsTable");
  if (!container) return;

  if (!records.length) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="bi bi-chat-square-dots empty-icon"></i>
        <p>Start a chat session to see your history here.</p>
        <button class="btn-primary-custom" onclick="switchPanel('chat')">
          <i class="bi bi-chat-dots-fill"></i> Start Practicing
        </button>
      </div>`;
    return;
  }

  const html = `<div class="sessions-list">
    ${records.map(r => `
      <div class="session-row">
        <span class="session-role-badge">${escapeHtml(r.profile || "General")}</span>
        <span class="session-preview">${escapeHtml(r.preview || "")}</span>
        <span class="session-time">${escapeHtml(r.timestamp || "")}</span>
      </div>`).join("")}
  </div>`;
  container.innerHTML = html;
}

/* ════════════════════════════════════════════════════════════════
  14.  PROFILE FORM
════════════════════════════════════════════════════════════════ */
function initProfileForm() {
  const form = $("#profileForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const profile = {
      job_role:         $("#profileRole")?.value.trim()       || null,
      experience_level: $("#profileExperience")?.value       || null,
      skills:           $("#profileSkills")?.value.trim()     || null,
      target_company:   $("#profileCompany")?.value           || null,
    };

    // Remove nulls
    Object.keys(profile).forEach(k => { if (!profile[k]) delete profile[k]; });

    try {
      const resp = await fetch("/api/update-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      const data = await resp.json();
      if (data.success) {
        State.profile = profile;
        if (data.scores) updateScores(data.scores);
        showToast("Profile saved successfully!", "success");
      }
    } catch {
      showToast("Failed to save profile", "error");
    }
  });

  $("#startWithProfileBtn")?.addEventListener("click", () => {
    const role = $("#profileRole")?.value.trim();
    if (role) {
      State.profile.job_role = role;
      switchPanel("chat");
      const intro = `I'm preparing for a ${role} interview. Let's start with the most important topics I should focus on.`;
      sendMessage(intro);
    } else {
      switchPanel("chat");
    }
  });
}

function syncProfileForm(profile) {
  if (profile.job_role        && $("#profileRole"))        $("#profileRole").value = profile.job_role;
  if (profile.experience_level && $("#profileExperience")) $("#profileExperience").value = profile.experience_level;
  if (profile.skills          && $("#profileSkills"))      $("#profileSkills").value = profile.skills;
  if (profile.target_company  && $("#profileCompany"))     $("#profileCompany").value = profile.target_company;
  State.profile = { ...State.profile, ...profile };
}

/* ════════════════════════════════════════════════════════════════
  15.  RESUME UPLOAD
════════════════════════════════════════════════════════════════ */
function initResumeUpload() {
  const dropZone   = $("#dropZone");
  const fileInput  = $("#resumeFile");
  const progress   = $("#uploadProgress");
  const resultDiv  = $("#uploadResult");
  const dropContent = $("#dropContent");
  const uploadBar  = $("#uploadBar");

  if (!dropZone) return;

  // File input change
  fileInput?.addEventListener("change", (e) => {
    if (e.target.files[0]) handleFileUpload(e.target.files[0]);
  });

  // Drag and drop
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    const file = e.dataTransfer?.files[0];
    if (file) handleFileUpload(file);
  });

  // Upload another
  $("#uploadAnotherBtn")?.addEventListener("click", () => {
    resultDiv.style.display = "none";
    dropContent.style.display = "flex";
    if (fileInput) fileInput.value = "";
  });

  // Manual text resume
  $("#submitManualResume")?.addEventListener("click", async () => {
    const text = $("#manualResumeText")?.value.trim();
    if (!text) { showToast("Please enter some text first", "error"); return; }

    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Please review this resume/experience description and give me detailed feedback:\n\n${text}`,
        }),
      });
      const data = await resp.json();
      if (data.response) {
        switchPanel("chat");
        appendMessage("user", "Review my resume/experience…");
        appendMessage("assistant", data.response);
        if (data.scores) updateScores(data.scores);
      }
    } catch {
      showToast("Failed to submit text", "error");
    }
  });

  async function handleFileUpload(file) {
    // Validate
    const allowed = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                     "application/msword", "text/plain"];
    const allowedExt = ["pdf", "docx", "doc", "txt"];
    const ext = file.name.split(".").pop().toLowerCase();
    if (!allowedExt.includes(ext)) {
      showToast("Please upload a PDF, DOCX, DOC, or TXT file", "error");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast("File too large (max 10 MB)", "error");
      return;
    }

    // Show progress
    dropContent.style.display = "none";
    resultDiv.style.display   = "none";
    progress.style.display    = "flex";

    // Animate progress bar
    let pct = 0;
    const barTimer = setInterval(() => {
      pct = Math.min(pct + 8, 85);
      if (uploadBar) uploadBar.style.width = pct + "%";
    }, 100);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const resp = await fetch("/api/upload-resume", { method: "POST", body: formData });
      const data = await resp.json();

      clearInterval(barTimer);
      if (uploadBar) uploadBar.style.width = "100%";

      await new Promise(r => setTimeout(r, 300));

      progress.style.display = "none";

      if (!resp.ok || data.error) {
        dropContent.style.display = "flex";
        showToast(data.error || "Upload failed", "error");
        return;
      }

      // Show success
      resultDiv.style.display = "flex";
      $("#uploadResultTitle").textContent = `✓ ${file.name}`;
      $("#uploadResultMsg").textContent   = data.message || "Resume parsed successfully!";

      // Show detected skills
      if (data.detected_skills?.length) {
        const wrap = $("#detectedSkillsWrap");
        const list = $("#detectedSkillsList");
        if (wrap && list) {
          list.innerHTML = data.detected_skills
            .map(s => `<span class="skill-tag">${escapeHtml(s)}</span>`)
            .join("");
          wrap.style.display = "block";
        }
      }

      if (data.scores) updateScores(data.scores);
      showToast("Resume uploaded and parsed! Personalised coaching activated.", "success");

    } catch (err) {
      clearInterval(barTimer);
      progress.style.display   = "none";
      dropContent.style.display = "flex";
      showToast("Upload failed. Please try again.", "error");
      console.error("Upload error:", err);
    }
  }
}

/* ════════════════════════════════════════════════════════════════
  16.  INIT
════════════════════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  configureMarked();

  // Navigation
  $$(".nav-item[data-panel]").forEach(item => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      switchPanel(item.dataset.panel);
    });
  });

  // Mobile sidebar toggles
  $("#sidebarOpenBtn")?.addEventListener("click",  openSidebar);
  $("#sidebarCloseBtn")?.addEventListener("click", closeSidebar);

  // Init all modules
  initChatInput();
  initQuickPrompts();
  initClearChat();
  initNewChat();
  initProfileForm();
  initResumeUpload();
  initSessionListEvents();

  // Load saved sessions or create first one
  ensureActiveConversation();
  renderSidebarConversations();
  loadConversation(State.activeConversationId);

  // Load initial dashboard data (scores)
  loadDashboard();

  // Focus input
  setTimeout(() => $("#chatInput")?.focus(), 100);

  // ESC closes sidebar
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSidebar();
  });

  console.log("🚀 InterviewAI — IBM Granite powered — ready");
});

// Expose for inline HTML onclick
window.switchPanel = switchPanel;
window.hideToast   = hideToast;
