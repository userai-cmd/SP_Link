/* SAT-Postex Connect — SPA (vanilla JS) */

const state = {
  token: localStorage.getItem("sp-token") || null,
  user: null,
  theme: localStorage.getItem("sp-theme") === "soft" ? "soft" : "dark",
  channels: [],
  activeChannelId: null,
  messages: [],
  tasks: [],
  users: [],
  view: "chat", // chat | admin
  mobileTab: "chat", // chat | tasks
  wsLive: false,
  pendingFile: null, // { fileUrl, fileName }
};

const app = document.getElementById("app");
let ws = null;
let wsRetry = 0;

/* ———————————————— API ———————————————— */

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.body);
  }
  const res = await fetch(`/api${path}`, { ...options, headers });
  if (res.status === 401 && state.token) {
    logout();
    throw new Error("Сесія завершилась, увійдіть знову");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Помилка ${res.status}`);
  return data;
}

/* ———————————————— Helpers ———————————————— */

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === "dataset") {
      Object.assign(node.dataset, v);
    } else if (v !== null && v !== undefined && v !== false) {
      node.setAttribute(k, v === true ? "" : v);
    }
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

function fmtTime(iso) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const hm = d.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return hm;
  return `${d.toLocaleDateString("uk-UA", { day: "numeric", month: "short" })}, ${hm}`;
}

function fmtDeadline(iso) {
  return new Date(iso).toLocaleDateString("uk-UA", { day: "numeric", month: "short" });
}

function initialOf(name) {
  return (name || "?").trim().charAt(0).toUpperCase() || "?";
}

function isImage(url) {
  return /\.(png|jpe?g|gif|webp|heic|avif)$/i.test(url || "");
}

let toastTimer = null;
function toast(text) {
  let node = document.querySelector(".sp-toast");
  if (!node) {
    node = el("div", { class: "sp-toast" });
    document.body.append(node);
  }
  node.textContent = text;
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 3000);
}

function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem("sp-token");
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  render();
}

/* ———————————————— WebSocket ———————————————— */

function connectWS() {
  if (!state.token) return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(state.token)}`);

  ws.onopen = () => {
    state.wsLive = true;
    wsRetry = 0;
    updateLivePill();
  };

  ws.onmessage = (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    const { type, data } = payload;

    if (type === "message:new") {
      if (data.channelId === state.activeChannelId) {
        state.messages.push(data);
        renderMessagesList();
      }
    } else if (type === "task:new") {
      if (!state.tasks.some((t) => t.id === data.id)) state.tasks.unshift(data);
      renderKanbanBoard();
    } else if (type === "task:updated") {
      const i = state.tasks.findIndex((t) => t.id === data.id);
      if (i >= 0) state.tasks[i] = data;
      else state.tasks.unshift(data);
      renderKanbanBoard();
    } else if (type === "task:deleted") {
      state.tasks = state.tasks.filter((t) => t.id !== data.id);
      renderKanbanBoard();
    }
  };

  ws.onclose = () => {
    state.wsLive = false;
    updateLivePill();
    if (!state.token) return;
    const delay = Math.min(1000 * 2 ** wsRetry, 15000);
    wsRetry += 1;
    setTimeout(connectWS, delay);
  };

  ws.onerror = () => ws.close();
}

function updateLivePill() {
  const pill = document.querySelector(".sat-status-pill");
  if (!pill) return;
  pill.dataset.live = state.wsLive ? "true" : "false";
  pill.querySelector("span:last-child").textContent = state.wsLive
    ? "Онлайн"
    : "Перепідключення…";
}

/* ———————————————— Login view ———————————————— */

function renderLogin() {
  app.replaceChildren();
  const page = el("div", { class: "sat-page", "data-theme": state.theme });
  page.append(el("div", { class: "sat-stars", "aria-hidden": "true" }));

  const error = el("p", { class: "sp-error", role: "alert", style: "display:none" });

  const form = el(
    "form",
    {
      class: "sp-form-grid",
      onsubmit: async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const btn = e.target.querySelector("button[type=submit]");
        btn.disabled = true;
        error.style.display = "none";
        try {
          const data = await api("/auth/login", {
            method: "POST",
            body: { email: fd.get("email"), password: fd.get("password") },
          });
          state.token = data.token;
          state.user = data.user;
          localStorage.setItem("sp-token", data.token);
          await bootstrapData();
          render();
          connectWS();
        } catch (err) {
          error.textContent = err.message;
          error.style.display = "";
          btn.disabled = false;
        }
      },
    },
    el(
      "label",
      { class: "sp-field" },
      el("span", {}, "Email"),
      el("input", {
        class: "sp-input",
        type: "email",
        name: "email",
        autocomplete: "username",
        required: true,
      }),
    ),
    el(
      "label",
      { class: "sp-field" },
      el("span", {}, "Пароль"),
      el("input", {
        class: "sp-input",
        type: "password",
        name: "password",
        autocomplete: "current-password",
        required: true,
      }),
    ),
    error,
    el("button", { class: "sp-btn-primary", type: "submit" }, "Увійти"),
  );

  page.append(
    el(
      "main",
      { class: "sp-login-root" },
      el(
        "div",
        { class: "sp-login-card" },
        el(
          "div",
          { class: "sp-login-brand" },
          el("div", { class: "sp-login-logo" }, "SAT · POSTEX"),
          el("div", { class: "sp-login-sub" }, "Connect — комунікація та задачі"),
        ),
        el(
          "div",
          { class: "sp-hero" },
          el("span", { class: "sp-hero-badge" }, "Вхід"),
          el("span", { class: "sp-hero-line", "aria-hidden": "true" }),
        ),
        form,
      ),
    ),
  );

  app.append(page);
}

/* ———————————————— App shell ———————————————— */

function renderApp() {
  app.replaceChildren();

  const page = el("div", { class: "sat-page", "data-theme": state.theme });
  page.append(el("div", { class: "sat-stars", "aria-hidden": "true" }));

  const sidebar = renderSidebar();
  const backdrop = el("div", {
    class: "sp-sidebar-backdrop",
    onclick: () => closeSidebar(),
  });

  const main = el("div", { class: "sat-main" }, renderTopbar(), renderContent());

  page.append(el("div", { class: "sat-wrap" }, sidebar, main), backdrop, renderMobileTabs());
  app.append(page);

  renderMessagesList();
  renderKanbanBoard();
  startClock();
}

function openSidebar() {
  document.querySelector(".sat-left")?.classList.add("open");
  document.querySelector(".sp-sidebar-backdrop")?.classList.add("show");
}

function closeSidebar() {
  document.querySelector(".sat-left")?.classList.remove("open");
  document.querySelector(".sp-sidebar-backdrop")?.classList.remove("show");
}

function renderSidebar() {
  const channelLinks = state.channels.map((ch) =>
    el(
      "button",
      {
        class:
          state.view === "chat" && ch.id === state.activeChannelId
            ? "sat-nav-link active"
            : "sat-nav-link",
        type: "button",
        onclick: () => {
          switchChannel(ch.id);
          closeSidebar();
        },
      },
      `# ${ch.name}`,
    ),
  );

  const sections = [
    el("div", { class: "sat-left-title" },
      el("span", { class: "sat-left-main" }, "SAT · POSTEX"),
      el("span", { class: "sat-left-sub" }, "Connect"),
    ),
    el(
      "div",
      { class: "sat-left-section" },
      el("span", {}, "Канали"),
      state.user?.role === "admin"
        ? el(
            "button",
            {
              class: "sat-add-channel-btn",
              type: "button",
              title: "Новий канал",
              onclick: () => openChannelDialog(),
            },
            "+",
          )
        : null,
    ),
    el("nav", { class: "sat-left-nav", "aria-label": "Канали" }, channelLinks),
  ];

  if (state.user?.role === "admin") {
    sections.push(
      el("div", { class: "sat-left-section" }, el("span", {}, "Управління")),
      el(
        "nav",
        { class: "sat-left-nav" },
        el(
          "button",
          {
            class: state.view === "admin" ? "sat-nav-link active" : "sat-nav-link",
            type: "button",
            onclick: () => {
              state.view = "admin";
              renderApp();
            },
          },
          "Адмін користувачі",
        ),
      ),
    );
  }

  return el("aside", { class: "sat-left" }, sections);
}

function renderTopbar() {
  const activeChannel = state.channels.find((c) => c.id === state.activeChannelId);

  const profileMenu = el("div", { class: "sat-profile" });
  const trigger = el(
    "button",
    {
      class: "sat-profile-trigger",
      type: "button",
      onclick: (e) => {
        e.stopPropagation();
        const menu = profileMenu.querySelector(".sat-profile-menu");
        if (menu) menu.remove();
        else {
          profileMenu.append(
            el(
              "div",
              { class: "sat-profile-menu", role: "menu" },
              el(
                "div",
                { class: "sat-profile-info" },
                el("strong", {}, state.user.displayName || state.user.email),
                el("span", {}, `${state.user.email} · ${state.user.companyType}`),
                el("span", {}, state.user.role === "admin" ? "Адміністратор" : "Користувач"),
              ),
              el(
                "button",
                { class: "sat-profile-logout", type: "button", onclick: () => logout() },
                "↪ Вийти",
              ),
            ),
          );
        }
      },
    },
    el("span", { class: "sat-profile-avatar" }, initialOf(state.user.displayName || state.user.email)),
    el("span", { class: "sat-profile-name" }, state.user.displayName || state.user.email),
  );
  profileMenu.append(trigger);

  document.addEventListener("click", (e) => {
    if (!profileMenu.contains(e.target)) {
      profileMenu.querySelector(".sat-profile-menu")?.remove();
    }
  });

  return el(
    "header",
    { class: "sat-top" },
    el(
      "button",
      { class: "sp-burger-btn", type: "button", "aria-label": "Меню", onclick: () => openSidebar() },
      "☰",
    ),
    el(
      "div",
      { class: "sat-top-brand" },
      el("span", { class: "sat-top-eyebrow" }, "SAT-Postex Connect"),
      el(
        "span",
        { class: "sat-top-name" },
        state.view === "admin" ? "Адміністрування" : activeChannel ? `# ${activeChannel.name}` : "—",
      ),
    ),
    el(
      "div",
      { class: "sat-top-actions" },
      el(
        "div",
        { class: "sat-status-pill", "data-live": state.wsLive ? "true" : "false" },
        el("span", { class: "sat-status-dot" }),
        el("span", {}, state.wsLive ? "Онлайн" : "Перепідключення…"),
      ),
      el(
        "button",
        {
          class: "sat-theme-btn",
          type: "button",
          onclick: () => {
            state.theme = state.theme === "dark" ? "soft" : "dark";
            localStorage.setItem("sp-theme", state.theme);
            document.querySelector(".sat-page").dataset.theme = state.theme;
            renderThemeButtons();
          },
        },
        state.theme === "dark" ? "Soft" : "Dark",
      ),
      profileMenu,
      el(
        "div",
        { class: "sat-clock" },
        el("span", { class: "sat-clock-time" }, "--:--:--"),
        el("span", { class: "sat-clock-date" }, ""),
      ),
    ),
  );
}

function renderThemeButtons() {
  const btn = document.querySelector(".sat-theme-btn");
  if (btn) btn.textContent = state.theme === "dark" ? "Soft" : "Dark";
}

let clockInterval = null;
function startClock() {
  clearInterval(clockInterval);
  const tick = () => {
    const t = document.querySelector(".sat-clock-time");
    const d = document.querySelector(".sat-clock-date");
    if (!t) return;
    const now = new Date();
    t.textContent = now.toLocaleTimeString("uk-UA");
    d.textContent = now.toLocaleDateString("uk-UA", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };
  tick();
  clockInterval = setInterval(tick, 1000);
}

function renderMobileTabs() {
  if (state.view !== "chat") return el("div");
  const make = (id, label) =>
    el(
      "button",
      {
        class: state.mobileTab === id ? "sp-mobile-tab active" : "sp-mobile-tab",
        type: "button",
        onclick: (e) => {
          state.mobileTab = id;
          const content = document.querySelector(".sp-content");
          if (content) content.dataset.mobileTab = id;
          document.querySelectorAll(".sp-mobile-tab").forEach((b) => b.classList.remove("active"));
          e.currentTarget.classList.add("active");
        },
      },
      label,
    );
  return el("div", { class: "sp-mobile-tabs" }, make("chat", "💬 Чат"), make("tasks", "✓ Задачі"));
}

/* ———————————————— Content ———————————————— */

function renderContent() {
  if (state.view === "admin") return renderAdminView();
  return el(
    "div",
    { class: "sp-content", "data-mobile-tab": state.mobileTab },
    renderChatPane(),
    renderTasksPane(),
  );
}

function renderChatPane() {
  const activeChannel = state.channels.find((c) => c.id === state.activeChannelId);

  const fileInput = el("input", {
    type: "file",
    style: "display:none",
    onchange: async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const pendingNote = document.querySelector(".sp-upload-pending");
      pendingNote.textContent = `Завантаження: ${file.name}…`;
      try {
        const fd = new FormData();
        fd.append("file", file);
        const data = await api("/upload", { method: "POST", body: fd });
        state.pendingFile = data;
        pendingNote.textContent = `📎 ${data.fileName} — буде надіслано з повідомленням`;
      } catch (err) {
        state.pendingFile = null;
        pendingNote.textContent = "";
        toast(err.message);
      }
      e.target.value = "";
    },
  });

  const textarea = el("textarea", {
    placeholder: activeChannel ? `Повідомлення у # ${activeChannel.name}` : "Повідомлення…",
    rows: 1,
    onkeydown: (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
  });

  async function sendMessage() {
    const text = textarea.value.trim();
    if (!text && !state.pendingFile) return;
    textarea.value = "";
    const file = state.pendingFile;
    state.pendingFile = null;
    const pendingNote = document.querySelector(".sp-upload-pending");
    if (pendingNote) pendingNote.textContent = "";
    try {
      await api("/messages", {
        method: "POST",
        body: {
          channelId: state.activeChannelId,
          messageText: text,
          fileUrl: file?.fileUrl || null,
          fileName: file?.fileName || null,
        },
      });
      // ws broadcast додасть повідомлення; якщо ws лежить — підстрахуємось
      if (!state.wsLive) await reloadMessages();
    } catch (err) {
      toast(err.message);
      textarea.value = text;
    }
  }

  return el(
    "section",
    { class: "sp-pane sp-chat-pane" },
    el(
      "div",
      { class: "sp-pane-head" },
      el(
        "div",
        {},
        el("h2", { class: "sp-pane-title" }, activeChannel ? `# ${activeChannel.name}` : "Чат"),
        activeChannel?.description
          ? el("p", { class: "sp-pane-sub" }, activeChannel.description)
          : null,
      ),
    ),
    el("div", { class: "sp-messages" }),
    el("div", { class: "sp-upload-pending" }),
    el(
      "div",
      { class: "sp-composer" },
      el(
        "button",
        {
          class: "sp-icon-btn",
          type: "button",
          title: "Прикріпити файл",
          onclick: () => fileInput.click(),
        },
        "📎",
      ),
      fileInput,
      textarea,
      el(
        "button",
        { class: "sp-icon-btn sp-send-btn", type: "button", title: "Надіслати", onclick: sendMessage },
        "➤",
      ),
    ),
  );
}

function renderMessagesList() {
  const wrap = document.querySelector(".sp-messages");
  if (!wrap) return;
  wrap.replaceChildren();

  if (state.messages.length === 0) {
    wrap.append(el("div", { class: "sp-empty" }, "Повідомлень ще немає. Напишіть перше!"));
    return;
  }

  for (const m of state.messages) {
    const fileBlock = m.fileUrl
      ? isImage(m.fileUrl)
        ? el("a", { href: m.fileUrl, target: "_blank", rel: "noopener" },
            el("img", { class: "sp-msg-img", src: m.fileUrl, alt: m.fileName || "Зображення", loading: "lazy" }))
        : el("a", { class: "sp-msg-file", href: m.fileUrl, target: "_blank", rel: "noopener" },
            `📄 ${m.fileName || "Файл"}`)
      : null;

    wrap.append(
      el(
        "div",
        { class: "sp-msg" },
        el("div", { class: "sp-msg-avatar", "data-company": m.authorCompany }, initialOf(m.authorName)),
        el(
          "div",
          { class: "sp-msg-body" },
          el(
            "div",
            { class: "sp-msg-meta" },
            el("span", { class: "sp-msg-author" }, m.authorName),
            el("span", { class: "sp-company-chip", "data-company": m.authorCompany }, m.authorCompany),
            el("span", { class: "sp-msg-time" }, fmtTime(m.createdAt)),
          ),
          m.messageText ? el("p", { class: "sp-msg-text" }, m.messageText) : null,
          fileBlock,
          el(
            "div",
            { class: "sp-msg-actions" },
            el(
              "button",
              {
                class: "sp-msg-totask-btn",
                type: "button",
                onclick: () => openTaskDialog({ fromMessage: m }),
              },
              "→ Створити задачу",
            ),
          ),
        ),
      ),
    );
  }

  wrap.scrollTop = wrap.scrollHeight;
}

/* ———————————————— Tasks (kanban) ———————————————— */

const STATUSES = [
  { id: "Todo", label: "Todo" },
  { id: "In_Progress", label: "In Progress" },
  { id: "Done", label: "Done" },
];

function renderTasksPane() {
  return el(
    "section",
    { class: "sp-pane sp-tasks-pane" },
    el(
      "div",
      { class: "sp-pane-head" },
      el("h2", { class: "sp-pane-title" }, "Задачі"),
      el(
        "button",
        { class: "sp-btn-primary", type: "button", onclick: () => openTaskDialog({}) },
        "+ Нова",
      ),
    ),
    el("div", { class: "sp-kanban" }),
  );
}

function renderKanbanBoard() {
  const board = document.querySelector(".sp-kanban");
  if (!board) return;
  board.replaceChildren();

  for (const status of STATUSES) {
    const tasks = state.tasks.filter((t) => t.status === status.id);
    const cards = el("div", { class: "sp-kanban-cards" }, tasks.map(renderTaskCard));

    const col = el(
      "div",
      {
        class: "sp-kanban-col",
        ondragover: (e) => {
          e.preventDefault();
          col.classList.add("drag-over");
        },
        ondragleave: () => col.classList.remove("drag-over"),
        ondrop: async (e) => {
          e.preventDefault();
          col.classList.remove("drag-over");
          const id = Number(e.dataTransfer.getData("text/task-id"));
          if (id) await moveTask(id, status.id);
        },
      },
      el(
        "div",
        { class: "sp-kanban-col-head", "data-status": status.id },
        el("span", {}, status.label),
        el("span", { class: "sp-kanban-count" }, String(tasks.length)),
      ),
      cards,
    );
    board.append(col);
  }
}

function renderTaskCard(task) {
  const statusIdx = STATUSES.findIndex((s) => s.id === task.status);
  const overdue =
    task.deadline && task.status !== "Done" && new Date(task.deadline) < new Date();

  const moveButtons = el(
    "div",
    { class: "sp-task-row-actions" },
    statusIdx > 0
      ? el(
          "button",
          {
            class: "sp-task-move-btn",
            type: "button",
            title: `Перемістити у ${STATUSES[statusIdx - 1].label}`,
            onclick: (e) => {
              e.stopPropagation();
              moveTask(task.id, STATUSES[statusIdx - 1].id);
            },
          },
          `◀ ${STATUSES[statusIdx - 1].label}`,
        )
      : null,
    statusIdx < STATUSES.length - 1
      ? el(
          "button",
          {
            class: "sp-task-move-btn",
            type: "button",
            title: `Перемістити у ${STATUSES[statusIdx + 1].label}`,
            onclick: (e) => {
              e.stopPropagation();
              moveTask(task.id, STATUSES[statusIdx + 1].id);
            },
          },
          `${STATUSES[statusIdx + 1].label} ▶`,
        )
      : null,
  );

  const card = el(
    "div",
    {
      class: "sp-task-card",
      draggable: "true",
      ondragstart: (e) => {
        e.dataTransfer.setData("text/task-id", String(task.id));
        card.classList.add("dragging");
      },
      ondragend: () => card.classList.remove("dragging"),
      onclick: () => openTaskDialog({ task }),
    },
    el("div", { class: "sp-task-title" }, task.title),
    task.description ? el("p", { class: "sp-task-desc" }, task.description) : null,
    el(
      "div",
      { class: "sp-task-meta" },
      task.assigneeName ? el("span", { class: "sp-task-chip" }, `👤 ${task.assigneeName}`) : null,
      task.deadline
        ? el(
            "span",
            { class: "sp-task-chip", "data-overdue": overdue ? "true" : "false" },
            `⏰ ${fmtDeadline(task.deadline)}`,
          )
        : null,
      task.messageId ? el("span", { class: "sp-task-chip", title: task.sourceMessageText || "" }, "💬 з чату") : null,
    ),
    moveButtons,
  );
  return card;
}

async function moveTask(id, status) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task || task.status === status) return;
  const prev = task.status;
  task.status = status;
  renderKanbanBoard();
  try {
    await api(`/tasks/${id}`, { method: "PATCH", body: { status } });
  } catch (err) {
    task.status = prev;
    renderKanbanBoard();
    toast(err.message);
  }
}

/* ———————————————— Dialogs ———————————————— */

function openDialog(panelChildren, label) {
  const overlay = el("div", {
    class: "sp-dialog-overlay",
    role: "presentation",
    onmousedown: (e) => {
      if (e.target === overlay) overlay.remove();
    },
  });
  const panel = el(
    "div",
    { class: "sp-dialog-panel", role: "dialog", "aria-modal": "true", "aria-label": label },
    panelChildren,
  );
  overlay.append(panel);
  document.querySelector(".sat-page").append(overlay);

  const onKey = (e) => {
    if (e.key === "Escape") {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
    }
  };
  document.addEventListener("keydown", onKey);
  return overlay;
}

function userOptions(selectedId) {
  return [
    el("option", { value: "" }, "— не призначено —"),
    ...state.users
      .filter((u) => u.isActive)
      .map((u) =>
        el(
          "option",
          { value: String(u.id), selected: u.id === selectedId ? true : null },
          `${u.displayName} (${u.companyType})`,
        ),
      ),
  ];
}

function openTaskDialog({ task, fromMessage }) {
  const isEdit = Boolean(task);
  const error = el("p", { class: "sp-error", style: "display:none" });

  const form = el(
    "form",
    {
      class: "sp-form-grid",
      onsubmit: async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const body = {
          title: fd.get("title"),
          description: fd.get("description"),
          assignedTo: fd.get("assignedTo") ? Number(fd.get("assignedTo")) : null,
          deadline: fd.get("deadline") ? new Date(fd.get("deadline")).toISOString() : null,
        };
        const btn = e.target.querySelector("button[type=submit]");
        btn.disabled = true;
        error.style.display = "none";
        try {
          if (isEdit) {
            await api(`/tasks/${task.id}`, { method: "PATCH", body });
          } else {
            if (fromMessage) body.messageId = fromMessage.id;
            await api("/tasks", { method: "POST", body });
            if (!state.wsLive) await reloadTasks();
          }
          overlay.remove();
        } catch (err) {
          error.textContent = err.message;
          error.style.display = "";
          btn.disabled = false;
        }
      },
    },
    el(
      "label",
      { class: "sp-field" },
      el("span", {}, "Назва задачі"),
      el("input", {
        class: "sp-input",
        name: "title",
        required: true,
        maxlength: 200,
        value: task?.title || (fromMessage ? fromMessage.messageText.slice(0, 120) : ""),
      }),
    ),
    el(
      "label",
      { class: "sp-field" },
      el("span", {}, "Опис"),
      el(
        "textarea",
        { class: "sp-input", name: "description", rows: 3 },
        task?.description || "",
      ),
    ),
    el(
      "label",
      { class: "sp-field" },
      el("span", {}, "Виконавець"),
      el("select", { class: "sp-input", name: "assignedTo" }, userOptions(task?.assignedTo)),
    ),
    el(
      "label",
      { class: "sp-field" },
      el("span", {}, "Дедлайн"),
      el("input", {
        class: "sp-input",
        type: "date",
        name: "deadline",
        value: task?.deadline ? new Date(task.deadline).toISOString().slice(0, 10) : "",
      }),
    ),
    error,
    el(
      "div",
      { class: "sp-dialog-actions" },
      isEdit
        ? el(
            "button",
            {
              class: "sp-btn-danger",
              type: "button",
              onclick: async () => {
                if (!confirm("Видалити задачу?")) return;
                try {
                  await api(`/tasks/${task.id}`, { method: "DELETE" });
                  if (!state.wsLive) await reloadTasks();
                  overlay.remove();
                } catch (err) {
                  toast(err.message);
                }
              },
            },
            "Видалити",
          )
        : null,
      el(
        "button",
        { class: "sp-btn-secondary", type: "button", onclick: () => overlay.remove() },
        "Скасувати",
      ),
      el("button", { class: "sp-btn-primary", type: "submit" }, isEdit ? "Зберегти" : "Створити"),
    ),
  );

  const overlay = openDialog(
    [
      el("h3", { class: "sp-dialog-title" }, isEdit ? "Редагування задачі" : "Нова задача"),
      fromMessage
        ? el("p", { class: "sp-quote" }, `💬 ${fromMessage.authorName}: ${fromMessage.messageText.slice(0, 200)}`)
        : null,
      form,
    ],
    isEdit ? "Редагування задачі" : "Нова задача",
  );
}

function openChannelDialog() {
  const error = el("p", { class: "sp-error", style: "display:none" });
  const form = el(
    "form",
    {
      class: "sp-form-grid",
      onsubmit: async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          const data = await api("/channels", {
            method: "POST",
            body: { name: fd.get("name"), description: fd.get("description") },
          });
          state.channels.push(data.channel);
          overlay.remove();
          renderApp();
        } catch (err) {
          error.textContent = err.message;
          error.style.display = "";
        }
      },
    },
    el(
      "label",
      { class: "sp-field" },
      el("span", {}, "Назва (латиницею, без #)"),
      el("input", { class: "sp-input", name: "name", required: true, maxlength: 60 }),
    ),
    el(
      "label",
      { class: "sp-field" },
      el("span", {}, "Опис"),
      el("input", { class: "sp-input", name: "description", maxlength: 200 }),
    ),
    error,
    el(
      "div",
      { class: "sp-dialog-actions" },
      el("button", { class: "sp-btn-secondary", type: "button", onclick: () => overlay.remove() }, "Скасувати"),
      el("button", { class: "sp-btn-primary", type: "submit" }, "Створити"),
    ),
  );

  const overlay = openDialog(
    [el("h3", { class: "sp-dialog-title" }, "Новий канал"), form],
    "Новий канал",
  );
}

/* ———————————————— Admin view ———————————————— */

function renderAdminView() {
  const pane = el(
    "section",
    { class: "sp-pane", style: "flex:1" },
    el(
      "div",
      { class: "sp-pane-head" },
      el(
        "div",
        {},
        el("h2", { class: "sp-pane-title" }, "Користувачі доступу"),
        el("p", { class: "sp-pane-sub" }, "Створення акаунтів для співробітників SAT і Postex"),
      ),
      el(
        "div",
        { style: "display:flex; gap:8px;" },
        el(
          "button",
          {
            class: "sp-btn-secondary",
            type: "button",
            onclick: () => {
              state.view = "chat";
              renderApp();
            },
          },
          "← До чату",
        ),
        el("button", { class: "sp-btn-primary", type: "button", onclick: () => openUserDialog({}) }, "+ Новий користувач"),
      ),
    ),
    el("div", { class: "sp-admin-scroll" }, renderUsersTable()),
  );

  return el("div", { class: "sp-content" }, pane);
}

function renderUsersTable() {
  return el(
    "div",
    { class: "table-wrap" },
    el(
      "table",
      { class: "data-table" },
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          el("th", {}, "Email"),
          el("th", {}, "ПІБ"),
          el("th", {}, "Компанія"),
          el("th", {}, "Роль"),
          el("th", {}, "Статус"),
          el("th", {}, "Дії"),
        ),
      ),
      el(
        "tbody",
        {},
        state.users.map((u) =>
          el(
            "tr",
            {},
            el("td", { class: "mono" }, u.email),
            el("td", {}, u.displayName),
            el("td", {}, el("span", { class: "sp-company-chip", "data-company": u.companyType }, u.companyType)),
            el("td", {}, u.role === "admin" ? el("span", { class: "sp-badge", "data-kind": "admin" }, "admin") : "user"),
            el(
              "td",
              {},
              u.isActive
                ? "active"
                : el("span", { class: "sp-badge", "data-kind": "inactive" }, "inactive"),
            ),
            el(
              "td",
              {},
              el(
                "div",
                { class: "admin-actions" },
                el(
                  "button",
                  { class: "sp-mini-btn", type: "button", title: "Редагувати", onclick: () => openUserDialog({ user: u }) },
                  "✎",
                ),
                el(
                  "button",
                  { class: "sp-mini-btn", type: "button", title: "Скинути пароль", onclick: () => openResetPasswordDialog(u) },
                  "🔐",
                ),
                el(
                  "button",
                  {
                    class: "sp-mini-btn",
                    type: "button",
                    title: "Видалити",
                    disabled: u.id === state.user.id ? true : null,
                    onclick: () => openDeleteUserDialog(u),
                  },
                  "🗑",
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

function refreshAdminTable() {
  const scroll = document.querySelector(".sp-admin-scroll");
  if (scroll) scroll.replaceChildren(renderUsersTable());
}

function openUserDialog({ user }) {
  const isEdit = Boolean(user);
  const error = el("p", { class: "sp-error", style: "display:none" });

  const form = el(
    "form",
    {
      class: "sp-form-grid",
      onsubmit: async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const btn = e.target.querySelector("button[type=submit]");
        btn.disabled = true;
        error.style.display = "none";
        try {
          if (isEdit) {
            const data = await api(`/users/${user.id}`, {
              method: "PATCH",
              body: {
                displayName: fd.get("displayName"),
                companyType: fd.get("companyType"),
                role: fd.get("role"),
                isActive: fd.get("isActive") === "on",
              },
            });
            const i = state.users.findIndex((x) => x.id === user.id);
            if (i >= 0) state.users[i] = data.user;
          } else {
            const data = await api("/users", {
              method: "POST",
              body: {
                email: fd.get("email"),
                password: fd.get("password"),
                displayName: fd.get("displayName"),
                companyType: fd.get("companyType"),
                role: fd.get("role"),
              },
            });
            state.users.push(data.user);
          }
          overlay.remove();
          refreshAdminTable();
        } catch (err) {
          error.textContent = err.message;
          error.style.display = "";
          btn.disabled = false;
        }
      },
    },
    !isEdit
      ? el(
          "label",
          { class: "sp-field" },
          el("span", {}, "Email"),
          el("input", { class: "sp-input", name: "email", type: "email", required: true }),
        )
      : null,
    el(
      "label",
      { class: "sp-field" },
      el("span", {}, "ПІБ"),
      el("input", { class: "sp-input", name: "displayName", required: true, value: user?.displayName || "" }),
    ),
    !isEdit
      ? el(
          "label",
          { class: "sp-field" },
          el("span", {}, "Пароль (мін. 8 символів)"),
          el("input", { class: "sp-input", name: "password", type: "password", minlength: 8, required: true }),
        )
      : null,
    el(
      "label",
      { class: "sp-field" },
      el("span", {}, "Компанія"),
      el(
        "select",
        { class: "sp-input", name: "companyType" },
        el("option", { value: "SAT", selected: user?.companyType === "SAT" ? true : null }, "SAT"),
        el("option", { value: "POSTEX", selected: user?.companyType === "POSTEX" ? true : null }, "POSTEX"),
      ),
    ),
    el(
      "label",
      { class: "sp-field" },
      el("span", {}, "Роль"),
      el(
        "select",
        { class: "sp-input", name: "role" },
        el("option", { value: "user", selected: user?.role !== "admin" ? true : null }, "user"),
        el("option", { value: "admin", selected: user?.role === "admin" ? true : null }, "admin"),
      ),
    ),
    isEdit
      ? el(
          "label",
          { class: "sp-field", style: "flex-direction:row; align-items:center; gap:8px;" },
          el("input", { type: "checkbox", name: "isActive", checked: user.isActive ? true : null }),
          el("span", {}, "Активний акаунт"),
        )
      : null,
    error,
    el(
      "div",
      { class: "sp-dialog-actions" },
      el("button", { class: "sp-btn-secondary", type: "button", onclick: () => overlay.remove() }, "Скасувати"),
      el("button", { class: "sp-btn-primary", type: "submit" }, isEdit ? "Зберегти" : "Створити"),
    ),
  );

  const overlay = openDialog(
    [el("h3", { class: "sp-dialog-title" }, isEdit ? "Редагування користувача" : "Новий користувач"), form],
    "Користувач",
  );
}

function openResetPasswordDialog(user) {
  const error = el("p", { class: "sp-error", style: "display:none" });
  const form = el(
    "form",
    {
      class: "sp-form-grid",
      onsubmit: async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          await api(`/users/${user.id}/reset-password`, {
            method: "POST",
            body: { password: fd.get("password") },
          });
          overlay.remove();
          toast("Пароль оновлено");
        } catch (err) {
          error.textContent = err.message;
          error.style.display = "";
        }
      },
    },
    el("input", {
      class: "sp-input",
      type: "password",
      name: "password",
      minlength: 8,
      placeholder: "Новий пароль (>=8)",
      required: true,
    }),
    error,
    el(
      "div",
      { class: "sp-dialog-actions" },
      el("button", { class: "sp-btn-secondary", type: "button", onclick: () => overlay.remove() }, "Скасувати"),
      el("button", { class: "sp-btn-primary", type: "submit" }, "Оновити пароль"),
    ),
  );

  const overlay = openDialog(
    [
      el("h3", { class: "sp-dialog-title" }, "Скинути пароль"),
      el("p", { class: "muted" }, `Користувач: ${user.email}`),
      form,
    ],
    "Скинути пароль",
  );
}

function openDeleteUserDialog(user) {
  const overlay = openDialog(
    [
      el("h3", { class: "sp-dialog-title" }, "Видалити користувача?"),
      el("p", { class: "muted" }, `${user.displayName} (${user.email})`),
      el(
        "div",
        { class: "sp-dialog-actions" },
        el("button", { class: "sp-btn-secondary", type: "button", onclick: () => overlay.remove() }, "Скасувати"),
        el(
          "button",
          {
            class: "sp-btn-danger",
            type: "button",
            onclick: async () => {
              try {
                await api(`/users/${user.id}`, { method: "DELETE" });
                state.users = state.users.filter((x) => x.id !== user.id);
                overlay.remove();
                refreshAdminTable();
              } catch (err) {
                toast(err.message);
              }
            },
          },
          "Видалити",
        ),
      ),
    ],
    "Видалити користувача",
  );
}

/* ———————————————— Data loading ———————————————— */

async function bootstrapData() {
  const [channelsData, usersData, tasksData] = await Promise.all([
    api("/channels"),
    api("/users"),
    api("/tasks"),
  ]);
  state.channels = channelsData.channels;
  state.users = usersData.users;
  state.tasks = tasksData.tasks;
  if (!state.activeChannelId && state.channels.length > 0) {
    state.activeChannelId = state.channels[0].id;
  }
  await reloadMessages();
}

async function reloadMessages() {
  if (!state.activeChannelId) {
    state.messages = [];
    return;
  }
  const data = await api(`/messages/channel/${state.activeChannelId}`);
  state.messages = data.messages;
  renderMessagesList();
}

async function reloadTasks() {
  const data = await api("/tasks");
  state.tasks = data.tasks;
  renderKanbanBoard();
}

async function switchChannel(id) {
  state.activeChannelId = id;
  state.view = "chat";
  state.messages = [];
  renderApp();
  try {
    await reloadMessages();
  } catch (err) {
    toast(err.message);
  }
}

/* ———————————————— Boot ———————————————— */

function render() {
  if (!state.token || !state.user) renderLogin();
  else renderApp();
}

async function boot() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  if (state.token) {
    try {
      const data = await api("/auth/me");
      state.user = data.user;
      await bootstrapData();
      render();
      connectWS();
      return;
    } catch {
      state.token = null;
      localStorage.removeItem("sp-token");
    }
  }
  render();
}

boot();
