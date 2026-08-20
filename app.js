/* ==========================================================================
   GOLD FITNESS GYM - OWNER CONTROLLER ENGINE (PRIVATE)
   ========================================================================== */

const CONFIG = {
  apiUrl: "https://api.goldfitness.workers.dev",
  pollInterval: 8000
};

const OWNER_SESSION_CONFIG = {
  storageKey: "gym_owner_session",
  inactivityLimitMs: 15 * 24 * 60 * 60 * 1000 // 15 Days
};

const LOCKOUT_CONFIG = {
  storageKey: "gym_owner_lockout",
  maxFreeAttempts: 3,
  durations: {
    3: 30,    // 30 seconds
    4: 60,    // 1 minute
    5: 300,   // 5 minutes
    6: 900    // 15 minutes
  }
};

let GymPlans = {
  "1 Month (Without Treadmill)": 1200,
  "3 Month (Without Treadmill)": 3000,
  "6 Month (Without Treadmill)": 5500,
  "12 Month (Without Treadmill)": 10000,
  "1 Month (With Treadmill)": 1500,
  "3 Month (With Treadmill)": 4000,
  "6 Month (With Treadmill)": 7500,
  "12 Month (With Treadmill)": 14000
};

const State = {
  theme: localStorage.getItem("gym_theme") || "system",
  activeView: "auth",
  ownerTab: "all",
  isOwnerAuthenticated: false,
  members: [],
  transactions: [],
  activeIdentifier: null,
  isFetching: false,
  timer: null,
  lockoutInterval: null
};

function dismissMobileKeyboard() {
  if (document.activeElement && typeof document.activeElement.blur === "function") {
    document.activeElement.blur();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setupTheme();
  setupEvents();
  initDates();
  startSync();
  checkLockoutStatus();

  const isOwnerLoggedIn = checkOwnerAutoLogin();
  if (!isOwnerLoggedIn) {
    switchView("auth", true);
  }
});

function saveOwnerSession() {
  localStorage.setItem(OWNER_SESSION_CONFIG.storageKey, JSON.stringify({ authenticated: true, lastActive: Date.now() }));
  State.isOwnerAuthenticated = true;
}

function touchOwnerSession() {
  const raw = localStorage.getItem(OWNER_SESSION_CONFIG.storageKey);
  if (!raw) return;
  try {
    const session = JSON.parse(raw);
    session.lastActive = Date.now();
    localStorage.setItem(OWNER_SESSION_CONFIG.storageKey, JSON.stringify(session));
  } catch (e) {
    localStorage.removeItem(OWNER_SESSION_CONFIG.storageKey);
  }
}

function clearOwnerSession() {
  localStorage.removeItem(OWNER_SESSION_CONFIG.storageKey);
  State.isOwnerAuthenticated = false;
}

function checkOwnerAutoLogin() {
  const raw = localStorage.getItem(OWNER_SESSION_CONFIG.storageKey);
  if (!raw) return false;
  try {
    const session = JSON.parse(raw);
    if (Date.now() - session.lastActive > OWNER_SESSION_CONFIG.inactivityLimitMs) {
      clearOwnerSession();
      showToast("Owner session expired after 15 days of inactivity.", true);
      return false;
    }
    touchOwnerSession();
    State.isOwnerAuthenticated = true;
    switchView("owner", false);
    return true;
  } catch (e) {
    clearOwnerSession();
    return false;
  }
}

async function promptOwnerExit() {
  dismissMobileKeyboard();
  const confirmed = await showCustomConfirm("Are you sure you want to log out of the owner console?", "Log Out Confirmation", "#3b82f6");
  if (confirmed) {
    clearOwnerSession();
    const pinInput = document.getElementById("input-owner-pin");
    if (pinInput) pinInput.value = "";
    switchView("auth", true);
    showToast("Owner session closed successfully");
  }
}

function inspectMemberCard(memberId) {
  dismissMobileKeyboard();
  State.activeIdentifier = memberId;
  switchView("member", true);
}

function returnToOwnerHub() {
  dismissMobileKeyboard();
  switchView("owner", true);
}

function getLockoutData() {
  const raw = localStorage.getItem(LOCKOUT_CONFIG.storageKey);
  if (!raw) return { failedAttempts: 0, lockedUntil: 0 };
  try { return JSON.parse(raw); } catch (e) { return { failedAttempts: 0, lockedUntil: 0 }; }
}

function saveLockoutData(data) {
  localStorage.setItem(LOCKOUT_CONFIG.storageKey, JSON.stringify(data));
}

function clearLockoutData() {
  localStorage.removeItem(LOCKOUT_CONFIG.storageKey);
  if (State.lockoutInterval) clearInterval(State.lockoutInterval);
  renderLockoutUI(false);
}

function recordFailedOwnerAttempt() {
  const data = getLockoutData();
  data.failedAttempts += 1;
  if (data.failedAttempts >= LOCKOUT_CONFIG.maxFreeAttempts) {
    const penaltyIndex = Math.min(data.failedAttempts, 6);
    const penaltySeconds = LOCKOUT_CONFIG.durations[penaltyIndex] || 900;
    data.lockedUntil = Date.now() + (penaltySeconds * 1000);
  }
  saveLockoutData(data);
  checkLockoutStatus();
}

function checkLockoutStatus() {
  const data = getLockoutData();
  const now = Date.now();
  if (data.lockedUntil > now) {
    renderLockoutUI(true, Math.ceil((data.lockedUntil - now) / 1000));
    if (State.lockoutInterval) clearInterval(State.lockoutInterval);
    State.lockoutInterval = setInterval(() => {
      const remainingSeconds = Math.ceil((data.lockedUntil - Date.now()) / 1000);
      if (remainingSeconds <= 0) {
        clearInterval(State.lockoutInterval);
        renderLockoutUI(false);
      } else {
        renderLockoutUI(true, remainingSeconds);
      }
    }, 1000);
    return true;
  } else {
    renderLockoutUI(false);
    return false;
  }
}

function renderLockoutUI(isLocked, secondsLeft = 0) {
  const banner = document.getElementById("owner-lockout-banner");
  const bannerText = document.getElementById("owner-lockout-text");
  const pinInput = document.getElementById("input-owner-pin");
  const loginBtn = document.getElementById("btn-login-owner");

  if (isLocked) {
    if (banner) banner.classList.remove("hidden");
    if (bannerText) {
      const mins = Math.floor(secondsLeft / 60);
      const secs = secondsLeft % 60;
      bannerText.innerText = `Too many failed attempts. Locked for ${mins > 0 ? `${mins}m${secs}s` : `${secs}s`}.`;
    }
    if (pinInput) { pinInput.disabled = true; pinInput.value = ""; }
    if (loginBtn) loginBtn.disabled = true;
  } else {
    if (banner) banner.classList.add("hidden");
    if (pinInput) pinInput.disabled = false;
    if (loginBtn) loginBtn.disabled = false;
  }
}

function formatDate(dateInput, includeYear = true) {
  if (!dateInput) return "--";
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return "--";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = d.getDate();
  const month = months[d.getMonth()];
  return includeYear ? `${day} ${month} ${d.getFullYear()}` : `${day} ${month}`;
}

function showSpinner(text = "Syncing with Google Sheets...") {
  const spinner = document.getElementById("loading-spinner");
  const spinnerText = document.getElementById("spinner-text");
  if (spinnerText) spinnerText.innerText = text;
  if (spinner) spinner.classList.remove("hidden");
}

function hideSpinner() {
  const spinner = document.getElementById("loading-spinner");
  if (spinner) spinner.classList.add("hidden");
}

function showToast(msg, isError = false) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.innerText = msg;
  toast.style.borderColor = isError ? "var(--rose)" : "var(--emerald)";
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 3500);
}

function showCustomConfirm(messageHTML, title = "Delete Member", confirmColor = "#e11d48") {
  return new Promise((resolve) => {
    const modal = document.getElementById("custom-alert-modal");
    const titleEl = document.getElementById("custom-alert-title");
    const msgEl = document.getElementById("custom-alert-msg");
    const confirmBtn = document.getElementById("custom-alert-confirm");
    const cancelBtn = document.getElementById("custom-alert-cancel");

    if (titleEl) titleEl.innerText = title;
    if (msgEl) msgEl.innerHTML = messageHTML;
    if (confirmBtn) confirmBtn.style.background = confirmColor;

    modal.classList.remove("hidden");

    function cleanup(result) {
      modal.classList.add("hidden");
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
      resolve(result);
    }

    function onConfirm() { cleanup(true); }
    function onCancel() { cleanup(false); }

    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
  });
}

function setupTheme() {
  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const current = State.theme === "system" ? (isDark ? "dark" : "light") : State.theme;
  document.documentElement.setAttribute("data-theme", current);

  const themeBtn = document.getElementById("theme-btn");
  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      const active = document.documentElement.getAttribute("data-theme");
      const next = active === "dark" ? "light" : "dark";
      State.theme = next;
      localStorage.setItem("gym_theme", next);
      document.documentElement.setAttribute("data-theme", next);
    });
  }
}

function switchView(viewName, skipFetch = false) {
  State.activeView = viewName;
  document.querySelectorAll(".panel").forEach(p => p.classList.add("hidden"));
  const target = document.getElementById(`view-${viewName}`);
  if (target) target.classList.remove("hidden");

  const syncPill = document.getElementById("sync-pill");
  if (viewName === "auth") {
    if (syncPill) syncPill.classList.add("hidden");
  } else {
    if (syncPill) syncPill.classList.remove("hidden");
    if (!skipFetch) {
      fetchData();
    } else {
      if (viewName === "owner") renderOwner();
      if (viewName === "member") renderMember();
    }
  }
}

function setOwnerTab(tab) {
  State.ownerTab = tab;
  document.querySelectorAll(".tab-item").forEach(t => t.classList.remove("active"));
  const activeBtn = document.getElementById(`btn-owner-${tab}`);
  if (activeBtn) activeBtn.classList.add("active");

  const tableView = document.getElementById("owner-table-view");
  const formView = document.getElementById("owner-form-view");

  if (tab === "add") {
    if (tableView) tableView.classList.add("hidden");
    if (formView) formView.classList.remove("hidden");
    onPlanSelectionChange("f-plan", "f-paid", "f-custom-days-group");
    calcEndDate();
  } else {
    if (tableView) tableView.classList.remove("hidden");
    if (formView) formView.classList.add("hidden");
    renderOwner();
  }
}

// --- PLAN SELECTION & PRICE AUTO-FILL ENGINE ---
function onPlanSelectionChange(selectId, paidInputId, customGroupId) {
  const planSelect = document.getElementById(selectId);
  const paidInput = document.getElementById(paidInputId);
  const customGroup = document.getElementById(customGroupId);
  
  if (!planSelect) return;

  const selectedOpt = planSelect.options[planSelect.selectedIndex];
  if (!selectedOpt) return;

  if (planSelect.value === "Custom Plan") {
    if (customGroup) customGroup.classList.remove("hidden");
  } else {
    if (customGroup) customGroup.classList.add("hidden");
  }

  const defaultPrice = selectedOpt.getAttribute("data-price");
  if (paidInput && defaultPrice !== null && defaultPrice !== "0") {
    paidInput.value = defaultPrice;
  }
}

async function openPlanEditorModal() {
  dismissMobileKeyboard();
  showSpinner("Fetching latest plan prices from database...");

  try {
    const res = await fetch(`${CONFIG.apiUrl}?action=getAllData`);
    const data = await res.json();
    
    if (data.status === "success" && data.plans) {
      GymPlans = data.plans;
      updateDropdownDataAttributes();
    }
  } catch (err) {
    showToast("Could not refresh prices from cloud. Using cached values.", true);
  } finally {
    hideSpinner();
  }

  document.getElementById("ep-1m-no").value = GymPlans["1 Month (Without Treadmill)"] || 1200;
  document.getElementById("ep-3m-no").value = GymPlans["3 Month (Without Treadmill)"] || 3000;
  document.getElementById("ep-6m-no").value = GymPlans["6 Month (Without Treadmill)"] || 5500;
  document.getElementById("ep-12m-no").value = GymPlans["12 Month (Without Treadmill)"] || 10000;

  document.getElementById("ep-1m-yes").value = GymPlans["1 Month (With Treadmill)"] || 1500;
  document.getElementById("ep-3m-yes").value = GymPlans["3 Month (With Treadmill)"] || 4000;
  document.getElementById("ep-6m-yes").value = GymPlans["6 Month (With Treadmill)"] || 7500;
  document.getElementById("ep-12m-yes").value = GymPlans["12 Month (With Treadmill)"] || 14000;

  document.getElementById("plan-editor-modal").classList.remove("hidden");
}

function closePlanEditorModal() {
  dismissMobileKeyboard();
  document.getElementById("plan-editor-modal")?.classList.add("hidden");
}

async function handlePlanPricesSubmit(e) {
  e.preventDefault();
  dismissMobileKeyboard();

  const btn = document.getElementById("btn-save-prices");
  btn.disabled = true;
  showSpinner("Updating plan prices to cloud...");

  const newPrices = {
    "1 Month (Without Treadmill)": Number(document.getElementById("ep-1m-no").value),
    "3 Month (Without Treadmill)": Number(document.getElementById("ep-3m-no").value),
    "6 Month (Without Treadmill)": Number(document.getElementById("ep-6m-no").value),
    "12 Month (Without Treadmill)": Number(document.getElementById("ep-12m-no").value),
    "1 Month (With Treadmill)": Number(document.getElementById("ep-1m-yes").value),
    "3 Month (With Treadmill)": Number(document.getElementById("ep-3m-yes").value),
    "6 Month (With Treadmill)": Number(document.getElementById("ep-6m-yes").value),
    "12 Month (With Treadmill)": Number(document.getElementById("ep-12m-yes").value)
  };

  try {
    const res = await fetch(CONFIG.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "updatePlanPrices", prices: newPrices })
    });
    const result = await res.json();

    if (result.status === "success") {
      GymPlans = newPrices;
      updateDropdownDataAttributes();
      showToast("Plan prices updated successfully!");
      closePlanEditorModal();
    } else {
      showToast(result.message || "Failed to update prices", true);
    }
  } catch (err) {
    showToast("Network error updating prices.", true);
  } finally {
    btn.disabled = false;
    hideSpinner();
  }
}

function updateDropdownDataAttributes() {
  ["f-plan", "r-plan"].forEach(selectId => {
    const select = document.getElementById(selectId);
    if (!select) return;
    
    for (let i = 0; i < select.options.length; i++) {
      const opt = select.options[i];
      const val = opt.value;
      
      if (GymPlans[val] !== undefined) {
        const livePrice = GymPlans[val];
        opt.setAttribute("data-price", livePrice);

        if (val.includes("1 Month")) {
          opt.innerText = `1 Month - ₹${livePrice.toLocaleString()}`;
        } else if (val.includes("3 Month")) {
          opt.innerText = `3 Month - ₹${livePrice.toLocaleString()}`;
        } else if (val.includes("6 Month")) {
          opt.innerText = `6 Month - ₹${livePrice.toLocaleString()}`;
        } else if (val.includes("12 Month")) {
          opt.innerText = `12 Month - ₹${livePrice.toLocaleString()}`;
        }
      }
    }
  });

  onPlanSelectionChange("f-plan", "f-paid", "f-custom-days-group");
  onPlanSelectionChange("r-plan", "r-paid", "r-custom-days-group");
}

function setupEvents() {
  document.getElementById("btn-login-owner")?.addEventListener("click", handleOwnerPinLogin);
  
  const pinInput = document.getElementById("input-owner-pin");
  if (pinInput) {
    pinInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        dismissMobileKeyboard();
        handleOwnerPinLogin();
      }
    });

    // Smoothly scrolls the executive card into view above the mobile keyboard on focus
    pinInput.addEventListener("focus", () => {
      setTimeout(() => {
        pinInput.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 300);
    });
  }

  document.querySelectorAll("input").forEach(input => {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") dismissMobileKeyboard();
    });
  });

  document.getElementById("btn-refresh")?.addEventListener("click", () => {
    dismissMobileKeyboard();
    fetchData(false);
  });
  document.getElementById("owner-search")?.addEventListener("input", renderOwner);

  window.addEventListener("click", () => {
    if (State.activeView === "owner" || State.activeView === "member") touchOwnerSession();
  });

  const fStartDate = document.getElementById("f-start-date");
  const fPlan = document.getElementById("f-plan");
  const fCustomDays = document.getElementById("f-custom-days");

  if (fStartDate) fStartDate.addEventListener("change", calcEndDate);
  if (fPlan) fPlan.addEventListener("change", () => {
    onPlanSelectionChange("f-plan", "f-paid", "f-custom-days-group");
    calcEndDate();
  });
  if (fCustomDays) fCustomDays.addEventListener("input", calcEndDate);

  document.getElementById("admission-form")?.addEventListener("submit", handleAdmission);

  const rStartDate = document.getElementById("r-start-date");
  const rPlan = document.getElementById("r-plan");
  const rCustomDays = document.getElementById("r-custom-days");

  if (rStartDate) rStartDate.addEventListener("change", calcRenewEndDate);
  if (rPlan) rPlan.addEventListener("change", () => {
    onPlanSelectionChange("r-plan", "r-paid", "r-custom-days-group");
    calcRenewEndDate();
  });
  if (rCustomDays) rCustomDays.addEventListener("input", calcRenewEndDate);

  document.getElementById("renew-form")?.addEventListener("submit", handleRenewSubmit);
}

// --- HELPER TO DISPLAY IN-LINE PIN ERROR ---
function setPinError(message) {
  let errorEl = document.getElementById("owner-pin-error");
  if (!errorEl) {
    const pinGroup = document.querySelector("#input-owner-pin").closest(".field-group");
    errorEl = document.createElement("div");
    errorEl.id = "owner-pin-error";
    errorEl.style.fontSize = "12px";
    errorEl.style.fontWeight = "600";
    errorEl.style.color = "var(--rose-text)";
    errorEl.style.marginTop = "6px";
    pinGroup.appendChild(errorEl);
  }
  errorEl.innerText = message || "";
}

async function handleOwnerPinLogin() {
  dismissMobileKeyboard();
  setPinError(""); // Clear previous errors

  if (checkLockoutStatus()) {
    setPinError("Account temporarily locked. Please wait.");
    return;
  }

  const pinInput = document.getElementById("input-owner-pin");
  const enteredPin = (pinInput?.value || "").trim();
  if (!enteredPin) {
    setPinError("Please enter the master security PIN.");
    return;
  }

  showSpinner("Verifying PIN & loading dashboard...");

  try {
    const res = await fetch(CONFIG.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "verifyOwnerPin", pin: enteredPin })
    });
    const data = await res.json();

    if (data.status === "success") {
      clearLockoutData();
      saveOwnerSession();
      if (pinInput) pinInput.value = "";
      setPinError("");
      
      await fetchData(true);
      hideSpinner();

      showToast("Owner authentication successful!");
      switchView("owner", true);
    } else {
      hideSpinner();
      dismissMobileKeyboard();
      recordFailedOwnerAttempt();
      const currentFailures = getLockoutData().failedAttempts;
      
      if (currentFailures < LOCKOUT_CONFIG.maxFreeAttempts) {
        setPinError(`Incorrect PIN. ${LOCKOUT_CONFIG.maxFreeAttempts - currentFailures} attempt(s) remaining.`);
      } else {
        setPinError("Too many failed attempts. Account locked.");
      }
      
      if (pinInput) { pinInput.value = ""; pinInput.focus(); }
    }
  } catch (err) {
    hideSpinner();
    setPinError("Verification failed. Check network.");
  }
}

function initDates() {
  const today = new Date().toISOString().split("T")[0];
  const fStartDate = document.getElementById("f-start-date");
  if (fStartDate) {
    fStartDate.value = today;
    onPlanSelectionChange("f-plan", "f-paid", "f-custom-days-group");
    calcEndDate();
  }
}

function computeEndDate(startDateStr, planVal, customDaysVal) {
  if (!startDateStr) return "";
  const parts = startDateStr.split("-");
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);

  let targetDate;

  if (planVal.includes("1 Month")) {
    targetDate = new Date(year, month + 1, day - 1);
  } else if (planVal.includes("3 Month")) {
    targetDate = new Date(year, month + 3, day - 1);
  } else if (planVal.includes("6 Month")) {
    targetDate = new Date(year, month + 6, day - 1);
  } else if (planVal.includes("12 Month") || planVal.includes("1 Year")) {
    targetDate = new Date(year + 1, month, day - 1);
  } else if (planVal === "Custom Plan") {
    const days = parseInt(customDaysVal, 10) || 1;
    targetDate = new Date(year, month, day + (days - 1));
  } else {
    targetDate = new Date(year, month + 1, day - 1);
  }

  const y = targetDate.getFullYear();
  const m = String(targetDate.getMonth() + 1).padStart(2, "0");
  const d = String(targetDate.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function calcEndDate() {
  const startStr = document.getElementById("f-start-date").value;
  const planSelect = document.getElementById("f-plan");
  const customDays = document.getElementById("f-custom-days")?.value;
  
  const calculated = computeEndDate(startStr, planSelect.value, customDays);
  if (calculated) document.getElementById("f-end-date").value = calculated;
}

function calcRenewEndDate() {
  const startStr = document.getElementById("r-start-date").value;
  const planSelect = document.getElementById("r-plan");
  const customDays = document.getElementById("r-custom-days")?.value;

  const calculated = computeEndDate(startStr, planSelect.value, customDays);
  if (calculated) document.getElementById("r-end-date").value = calculated;
}

function getDaysRemaining(endDateStr) {
  if (!endDateStr) return 0;
  const parts = String(endDateStr).split("T")[0].split("-");
  if (parts.length < 3) return 0;

  const target = new Date(parts[0], parts[1] - 1, parts[2]);
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const diffMs = target.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  return diffDays >= 0 ? diffDays + 1 : diffDays;
}

function startSync() {
  if (State.timer) clearInterval(State.timer);
  State.timer = setInterval(() => {
    if (State.activeView !== "auth" && !State.isFetching) fetchData(true);
  }, CONFIG.pollInterval);
}

async function fetchData(silent = false) {
  if (!CONFIG.apiUrl || CONFIG.apiUrl.includes("YOUR_GOOGLE_APPS_SCRIPT")) return;

  State.isFetching = true;
  if (!silent) showSpinner("Loading latest gym records...");

  try {
    const res = await fetch(`${CONFIG.apiUrl}?action=getAllData`);
    const data = await res.json();
    State.members = data.members || [];
    State.transactions = data.transactions || [];
    if (data.plans) {
      GymPlans = data.plans;
      updateDropdownDataAttributes();
    }

    if (State.activeView === "owner") renderOwner();
    if (State.activeView === "member") renderMember();
  } catch (err) {
    if (!silent) showToast("Connection failed. Check network.", true);
  } finally {
    State.isFetching = false;
    if (!silent) hideSpinner();
  }
}

// --- COMPACT OWNER TABLE PLAN FORMATTER ---
function formatPlanDisplay(rawPlan) {
  if (!rawPlan) return "Standard";
  const str = String(rawPlan).trim();
  const isTreadmill = /with treadmill/i.test(str) || /\bT\b/i.test(str);

  let baseName = str
    .replace(/\s*\((With|Without)\s*Treadmill\)/i, "")
    .replace(/\s*(With|Without)\s*Treadmill/i, "")
    .replace(/Basic|Pro|VIP/i, "")
    .trim();

  return isTreadmill ? `${baseName} (T)` : baseName;
}

function renderOwner() {
  const tbody = document.getElementById("owner-member-rows");
  const query = (document.getElementById("owner-search")?.value || "").trim().toLowerCase();

  let expiring = 0;
  let expired = 0;

  State.members.forEach(m => {
    const days = getDaysRemaining(m.Plan_End_Date);
    if (days < 0) expired++;
    else if (days <= 7) expiring++;
  });

  const statTotal = document.getElementById("stat-total");
  const statExpiring = document.getElementById("stat-expiring");
  const statExpired = document.getElementById("stat-expired");

  if (statTotal) statTotal.innerText = State.members.length;
  if (statExpiring) statExpiring.innerText = expiring;
  if (statExpired) statExpired.innerText = expired;

  let list = [...State.members].reverse();

  if (State.ownerTab === "expiring") {
    list = list.filter(m => getDaysRemaining(m.Plan_End_Date) <= 7);
  } else if (State.ownerTab === "dues") {
    list = list.filter(m => Number(m.Total_Due_Amount || 0) > 0);
  }

  list = list.filter(m => {
    const nameMatch = String(m.Full_Name || "").toLowerCase().includes(query);
    const idMatch = String(m.Member_ID || "").toLowerCase().includes(query);
    return nameMatch || idMatch;
  });

  if (!tbody) return;
  tbody.innerHTML = "";

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: left; padding: 16px 10px; color: var(--text-muted);">No records found.</td></tr>`;
    return;
  }

  list.forEach(m => {
    const days = getDaysRemaining(m.Plan_End_Date);
    const dueAmount = Number(m.Total_Due_Amount || 0);

    let badgeClass = "badge-emerald";
    let statusText = `${days} Days Left`;

    if (days < 0) {
      badgeClass = "badge-rose";
      statusText = `Expired (${Math.abs(days)}d ago)`;
    } else if (days <= 7) {
      badgeClass = "badge-amber";
      statusText = `Expiring (${days}d left)`;
    }

    const tr = document.createElement("tr");
    const shouldHighlight = (State.ownerTab === "all" || State.ownerTab === "expiring") && dueAmount > 0;
    tr.className = shouldHighlight ? "row-due-highlight" : "";

    const safeName = String(m.Full_Name || "Unnamed").replace(/'/g, "\\'");

    tr.innerHTML = `
      <td class="clickable-cell" onclick="inspectMemberCard('${m.Member_ID}')" title="Click to view member dashboard">
        <span class="badge ${badgeClass}">${statusText}</span>
      </td>
      <td class="clickable-cell" onclick="inspectMemberCard('${m.Member_ID}')" title="Click to view member dashboard">
        <strong>${m.Full_Name || "Unnamed"}</strong>
      </td>
      <td class="clickable-cell" onclick="inspectMemberCard('${m.Member_ID}')" title="Click to view member dashboard">
        <span>${formatDate(m.Plan_Start_Date, false)}</span>
      </td>
      <td>
        <span style="color: var(--text-main); font-weight: 600;">${formatPlanDisplay(m.Plan_Name)}</span>
      </td>
      <td class="${dueAmount > 0 ? 'text-warning font-bold' : 'text-subtle'}">
        ₹${dueAmount.toLocaleString()}
      </td>
      <td class="text-right">
        <div class="action-cluster" onclick="event.stopPropagation()">
          <button type="button" class="btn-renew" onclick="openRenewModal('${m.Member_ID}')">Renew</button>
          <button type="button" class="btn-delete" onclick="deleteMember('${m.Member_ID}', '${safeName}')">Delete</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function handleAdmission(e) {
  e.preventDefault();
  dismissMobileKeyboard();

  const btn = document.getElementById("btn-save-member");
  btn.disabled = true;
  showSpinner("Recording admission to Google Sheets...");

  const phoneOrId = document.getElementById("f-phone").value.trim();
  const planSelect = document.getElementById("f-plan");
  let chosenPlanName = planSelect.value;

  if (chosenPlanName === "Custom Plan") {
    const customDays = parseInt(document.getElementById("f-custom-days").value, 10) || 30;
    chosenPlanName = `Custom (${customDays} Days)`;
  }

  const payload = {
    action: "addMember",
    fullName: document.getElementById("f-name").value.trim(),
    memberId: phoneOrId,
    planName: chosenPlanName,
    startDate: document.getElementById("f-start-date").value,
    endDate: document.getElementById("f-end-date").value,
    amountPaid: document.getElementById("f-paid").value,
    dueAmount: document.getElementById("f-due").value,
    paymentMode: document.getElementById("f-mode").value,
    notes: document.getElementById("f-notes").value || "Initial Admission"
  };

  try {
    const res = await fetch(CONFIG.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload)
    });
    const result = await res.json();

    if (result.status === "success") {
      const idNotice = phoneOrId ? "" : ` (Assigned ID: ${result.memberId})`;
      showToast(`Member successfully saved!${idNotice}`);
      document.getElementById("admission-form").reset();
      initDates();
      setOwnerTab("all");
      await fetchData(true);
    } else {
      showToast(result.message || "Error saving member", true);
    }
  } catch (err) {
    console.error("Add Member Error:", err);
    showToast("Error adding member. Please check connection.", true);
  } finally {
    btn.disabled = false;
    hideSpinner();
  }
}

function renderMember() {
  const member = State.members.find(m => 
    String(m.Member_ID).trim().toLowerCase() === String(State.activeIdentifier).trim().toLowerCase()
  );
  if (!member) return;

  const days = getDaysRemaining(member.Plan_End_Date);
  const dues = Number(member.Total_Due_Amount || 0);

  document.getElementById("m-member-name").innerText = member.Full_Name;
  document.getElementById("m-member-sub").innerText = `Member ID: ${member.Member_ID}`;
  
  // Renders the full unabbreviated plan name
  document.getElementById("m-plan-badge").innerText = member.Plan_Name || "Membership";
  document.getElementById("m-days-number").innerText = Math.max(0, days);
  
  document.getElementById("m-start-date").innerText = formatDate(member.Plan_Start_Date);
  document.getElementById("m-end-date").innerText = formatDate(member.Plan_End_Date);
  document.getElementById("m-due-amount").innerText = dues.toLocaleString();

  const planName = String(member.Plan_Name || "");
  let totalDays = 30;

  if (planName.includes("3 Month")) totalDays = 90;
  else if (planName.includes("6 Month")) totalDays = 180;
  else if (planName.includes("12 Month") || planName.includes("1 Year")) totalDays = 365;
  else if (planName.includes("Custom")) {
    const matched = planName.match(/\d+/);
    totalDays = matched ? parseInt(matched[0], 10) : 30;
  }

  const progressPercent = Math.min(100, Math.max(0, (days / totalDays) * 100));
  const progressBar = document.getElementById("m-progress-bar");
  if (progressBar) progressBar.style.width = `${progressPercent}%`;

  const statusPill = document.getElementById("m-status-pill");
  if (statusPill) {
    if (days < 0) {
      statusPill.className = "status-pill status-expired";
      statusPill.innerText = "Membership Expired";
    } else {
      statusPill.className = "status-pill status-active";
      statusPill.innerText = dues > 0 ? "Active (Dues Pending)" : "Active Member";
    }
  }

  const userTxns = State.transactions
    .filter(t => String(t.Member_ID).trim() === String(member.Member_ID).trim())
    .reverse();

  const txnBody = document.getElementById("m-transaction-rows");
  if (!txnBody) return;
  txnBody.innerHTML = "";

  if (userTxns.length === 0) {
    txnBody.innerHTML = `<tr><td colspan="4" style="text-align: left; padding: 14px 10px; color: var(--text-muted);">No payment records.</td></tr>`;
  } else {
    userTxns.forEach(t => {
      txnBody.innerHTML += `
        <tr>
          <td><strong>${formatDate(t.Date)}</strong></td>
          <td><strong>₹${Number(t.Amount_Paid || 0).toLocaleString()}</strong></td>
          <td><span class="badge" style="color: var(--text-main); font-weight: 600;">${t.Payment_Mode || "Cash"}</span></td>
          <td>${t.Notes || "Payment"}</td>
        </tr>
      `;
    });
  }
}

function openRenewModal(memberId) {
  dismissMobileKeyboard();
  const member = State.members.find(m => String(m.Member_ID).trim() === String(memberId).trim());
  if (!member) return;

  document.getElementById("r-member-id").value = member.Member_ID;
  document.getElementById("r-full-name").value = member.Full_Name;
  document.getElementById("renew-sub-title").innerText = `${member.Full_Name} (${member.Member_ID})`;

  const today = new Date().toISOString().split("T")[0];
  document.getElementById("r-start-date").value = today;
  
  onPlanSelectionChange("r-plan", "r-paid", "r-custom-days-group");
  calcRenewEndDate();

  document.getElementById("renew-modal").classList.remove("hidden");
}

function closeRenewModal() {
  dismissMobileKeyboard();
  document.getElementById("renew-modal")?.classList.add("hidden");
  document.getElementById("renew-form")?.reset();
  onPlanSelectionChange("r-plan", "r-paid", "r-custom-days-group");
}

async function handleRenewSubmit(e) {
  e.preventDefault();
  dismissMobileKeyboard();

  const btn = document.getElementById("btn-submit-renew");
  btn.disabled = true;
  showSpinner("Renewing membership plan...");

  const planSelect = document.getElementById("r-plan");
  let chosenPlanName = planSelect.value;

  if (chosenPlanName === "Custom Plan") {
    const customDays = parseInt(document.getElementById("r-custom-days").value, 10) || 30;
    chosenPlanName = `Custom (${customDays} Days)`;
  }

  const payload = {
    action: "renewMember",
    memberId: document.getElementById("r-member-id").value,
    fullName: document.getElementById("r-full-name").value,
    planName: chosenPlanName,
    startDate: document.getElementById("r-start-date").value,
    endDate: document.getElementById("r-end-date").value,
    amountPaid: document.getElementById("r-paid").value,
    dueAmount: document.getElementById("r-due").value,
    paymentMode: document.getElementById("r-mode").value,
    notes: "Membership Resumed / Renewed"
  };

  try {
    const res = await fetch(CONFIG.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload)
    });
    const result = await res.json();

    if (result.status === "success") {
      showToast("Membership renewed and activated!");
      closeRenewModal();
      await fetchData(true);
    } else {
      showToast(result.message || "Error processing renewal", true);
    }
  } catch (err) {
    console.error("Renewal Error:", err);
    showToast("Error processing renewal. Please check network.", true);
  } finally {
    btn.disabled = false;
    hideSpinner();
  }
}

async function deleteMember(memberId, fullName) {
  const confirmMsg = `Are you sure you want to delete <strong>${fullName}</strong> (ID: <strong>${memberId}</strong>) from gym records?`;
  
  const confirmed = await showCustomConfirm(confirmMsg, "Delete Member", "#e11d48");
  if (!confirmed) return;

  showSpinner(`Deleting ${fullName}...`);

  try {
    const res = await fetch(CONFIG.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        action: "deleteMember",
        memberId: String(memberId).trim()
      })
    });

    const result = await res.json();

    if (result.status === "success") {
      showToast(`${fullName} deleted successfully`);
      await fetchData(true);
    } else {
      showToast(result.message || "Failed to delete member", true);
    }
  } catch (err) {
    console.error("Delete Error:", err);
    showToast("Error deleting member. Please check network.", true);
  } finally {
    hideSpinner();
  }
}
