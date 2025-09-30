const DAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const SLOT_DURATION_MINUTES = 30;
const DAY_START_MINUTES = 6 * 60;
const DAY_END_MINUTES = 24 * 60;
const SLOTS_PER_DAY =
  (DAY_END_MINUTES - DAY_START_MINUTES) / SLOT_DURATION_MINUTES;
const TOTAL_SLOTS = DAYS.length * SLOTS_PER_DAY;

const personalGrid = document.getElementById("personal-grid");
const aggregateGrid = document.getElementById("aggregate-grid");
const eventTitleEl = document.getElementById("event-title");
const eventMetaEl = document.getElementById("event-meta");
const shareLinkInput = document.getElementById("share-link");
const copyBtn = document.getElementById("copy-link");
const personalAxis = document.getElementById("personal-axis");
const aggregateAxis = document.getElementById("aggregate-axis");
const SLOT_HEIGHT_PX = 10;
const SLOT_HEADER_HEIGHT_PX = 28;

document.documentElement.style.setProperty("--slot-height", `${SLOT_HEIGHT_PX}px`);
document.documentElement.style.setProperty(
  "--slot-header-height",
  `${SLOT_HEADER_HEIGHT_PX}px`
);

const readNumericCSSVar = (name, fallback) => {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
};

const getSlotMetrics = () => ({
  slotHeight: readNumericCSSVar("--slot-height", SLOT_HEIGHT_PX),
  slotHeaderHeight: readNumericCSSVar("--slot-header-height", SLOT_HEADER_HEIGHT_PX)
});

const eventId = window.location.pathname.split("/").pop();
let currentShareLink = window.location.href;
const applyShareLink = (link) => {
  currentShareLink = link || window.location.href;
  if (shareLinkInput) {
    shareLinkInput.value = currentShareLink;
  }
};

applyShareLink(currentShareLink);

const copyToClipboard = async (text) => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fallback
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);
  return ok;
};

copyBtn?.addEventListener("click", async () => {
  const success = await copyToClipboard(currentShareLink);
  copyBtn.textContent = success ? "已复制" : "复制失败";
  setTimeout(() => (copyBtn.textContent = "复制"), 1800);
});

const ensureUserId = () => {
  const key = "coMeetingUserId";
  const existing = localStorage.getItem(key);
  if (existing) return existing;

  const cryptoObj = window.crypto || window.msCrypto;
  let id;
  if (cryptoObj?.randomUUID) {
    id = cryptoObj.randomUUID();
  } else if (cryptoObj?.getRandomValues) {
    const bytes = cryptoObj.getRandomValues(new Uint8Array(16));
    id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  } else {
    id = `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  }

  localStorage.setItem(key, id);
  return id;
};

const userId = ensureUserId();
const selectedSlots = new Set();
let isPointerSelecting = false;
let pointerSelectionMode = "add";
const dragVisitedSlots = new Set();

const slotBoundaryToLabel = (boundaryIndex) => {
  const minutes = DAY_START_MINUTES + boundaryIndex * SLOT_DURATION_MINUTES;
  const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
  const minute = String(minutes % 60).padStart(2, "0");
  return `${hour}:${minute}`;
};

const buildTimeAxis = (axisEl) => {
  if (!axisEl) return;
  axisEl.innerHTML = "";

  const { slotHeight, slotHeaderHeight } = getSlotMetrics();
  const totalHeight = slotHeaderHeight + SLOTS_PER_DAY * slotHeight;
  axisEl.style.height = `${totalHeight}px`;

  const fragment = document.createDocumentFragment();

  for (let boundaryIndex = 0; boundaryIndex <= SLOTS_PER_DAY; boundaryIndex += 1) {
    const label = document.createElement("div");
    label.className = "time-axis__label";
    label.dataset.boundary = String(boundaryIndex);
    const top = slotHeaderHeight + boundaryIndex * slotHeight;
    label.style.top = `${top}px`;
    label.textContent = slotBoundaryToLabel(boundaryIndex);
    fragment.appendChild(label);
  }

  axisEl.appendChild(fragment);
};

const makeHeaderCell = (text) => {
  const el = document.createElement("div");
  el.textContent = text;
  el.className = "header";
  return el;
};

const buildGrid = (gridEl, { interactive }) => {
  gridEl.innerHTML = "";
  gridEl.style.gridTemplateColumns = `repeat(${DAYS.length}, minmax(0, 1fr))`;
  gridEl.style.gridTemplateRows = `var(--slot-header-height) repeat(${SLOTS_PER_DAY}, var(--slot-height))`;

  DAYS.forEach((day) => gridEl.appendChild(makeHeaderCell(day)));

  for (let slotIndex = 0; slotIndex < SLOTS_PER_DAY; slotIndex += 1) {
    DAYS.forEach((_, dayIdx) => {
      const globalSlot = dayIdx * SLOTS_PER_DAY + slotIndex;
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.slot = String(globalSlot);
      if (interactive) {
        attachSelectionHandlers(cell);
      }
      gridEl.appendChild(cell);
    });
  }
};

function attachSelectionHandlers(cell) {
  cell.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary) return;
    event.preventDefault();
    const slot = Number(cell.dataset.slot);
    pointerSelectionMode = selectedSlots.has(slot) ? "remove" : "add";
    isPointerSelecting = true;
    dragVisitedSlots.clear();
    dragVisitedSlots.add(slot);
    toggleCell(slot, pointerSelectionMode === "add");
  });

  cell.addEventListener("pointerenter", () => {
    if (!isPointerSelecting) return;
    const slot = Number(cell.dataset.slot);
    if (dragVisitedSlots.has(slot)) return;
    dragVisitedSlots.add(slot);
    toggleCell(slot, pointerSelectionMode === "add");
  });

  cell.addEventListener("dragstart", (event) => event.preventDefault());
  cell.setAttribute("tabindex", "0");
  cell.addEventListener("keydown", (event) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    const slot = Number(cell.dataset.slot);
    const shouldSelect = !selectedSlots.has(slot);
    toggleCell(slot, shouldSelect);
    pushSelection();
  });
}

const toggleCell = (slot, shouldSelect) => {
  if (shouldSelect) {
    selectedSlots.add(slot);
  } else {
    selectedSlots.delete(slot);
  }
  renderPersonalSelection();
};

const renderPersonalSelection = () => {
  personalGrid.querySelectorAll(".cell").forEach((cell) => {
    const slot = Number(cell.dataset.slot);
    cell.classList.toggle("selected", selectedSlots.has(slot));
  });
};

const renderAggregate = ({ slotTotals, participantCount }) => {
  const maxActive = participantCount || 1;
  aggregateGrid.querySelectorAll(".cell").forEach((cell) => {
    const slot = Number(cell.dataset.slot);
    const count = slotTotals?.[slot] || 0;
    const ratio = count / maxActive;
    const alpha = count === 0 ? 0 : Math.min(1, 0.15 + ratio * 0.75);
    const lightness = 90 - ratio * 40;
    cell.style.backgroundColor =
      count === 0
        ? "transparent"
        : `hsla(210, 68%, ${lightness}%, ${alpha.toFixed(2)})`;
    cell.textContent = count ? String(count) : "";
  });

  eventMetaEl.textContent =
    participantCount > 0
      ? `已有 ${participantCount} 人填写`
      : "还没有人填写";
};

const pushSelection = (() => {
  let timeoutId = null;
  return () => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      socket.emit("updateSlots", {
        eventId,
        userId,
        slots: Array.from(selectedSlots.values()).sort((a, b) => a - b)
      });
    }, 120);
  };
})();

const finishPointerSelection = () => {
  if (!isPointerSelecting) return;
  isPointerSelecting = false;
  pointerSelectionMode = "add";
  dragVisitedSlots.clear();
  pushSelection();
};

["pointerup", "pointercancel"].forEach((eventName) => {
  document.addEventListener(eventName, finishPointerSelection);
});

buildGrid(personalGrid, { interactive: true });
buildGrid(aggregateGrid, { interactive: false });
buildTimeAxis(personalAxis);
buildTimeAxis(aggregateAxis);

const socket = io();
socket.on("connect", () => {
  socket.emit("joinEvent", { eventId, userId });
});

socket.on("eventState", (state) => {
  eventTitleEl.textContent = state.title;
  renderAggregate(state);
  if (state.shareLink) {
    applyShareLink(state.shareLink);
  }
  selectedSlots.clear();
  for (const slot of state.yourSlots || []) {
    selectedSlots.add(Number(slot));
  }
  renderPersonalSelection();
});

socket.on("eventUpdate", (state) => {
  renderAggregate(state);
});

socket.on("yourSlots", (slots) => {
  selectedSlots.clear();
  for (const slot of slots || []) {
    selectedSlots.add(Number(slot));
  }
  renderPersonalSelection();
});

socket.on("eventError", ({ message }) => {
  eventTitleEl.textContent = "事件不存在";
  eventMetaEl.textContent = message;
});

(async () => {
  try {
    const response = await fetch(`/api/events/${eventId}`);
    if (!response.ok) throw new Error("无法加载事件信息");
    const data = await response.json();
    eventTitleEl.textContent = data.title;
    renderAggregate(data);
    if (data.shareLink) {
      applyShareLink(data.shareLink);
    }
  } catch (error) {
    eventTitleEl.textContent = "加载事件失败";
    eventMetaEl.textContent = error.message;
  }
})();
