/* ==========================================================================
   GOLD FITNESS GYM - COMPLETE CLIENT ENGINE
   - Mobile Keyboard Auto-Dismiss: Calls blur() on Enter, Go, and Form Submits
   - Custom Plan Support: Full manual day input (e.g. 1, 20, 45 days)
   - Original Classic Theme Toggle: Restored with '🌓'
   - Full Admission Performa: Plan, Start/End Dates, Dues, Paid, Notes
   - Optional Phone: Defaults to unique Member ID if phone is omitted
   - Dual-Mode Member Card: Allows Owner to inspect full card with "← Back to Hub"
   - Date Format: D Mon YYYY (e.g. 2 Jul 2026)
   - Table Display: Plan Start Date column enabled for quick ledger tracking
   - Owner Security: PIN verified in Google Sheets 'Admin' tab with progressive lockout
   - Persistent Sessions: 15-day sliding inactivity auto-login for Owner & Members
   - Single-Pass Loading: Zero redundant spinners on login
   ========================================================================== */

const CONFIG = {
  // Replace with your Google Apps Script Web App Deployment URL
  apiUrl: "https://script.google.com/macros/s/AKfycbzPl-XV9RlJU4XVEa5HaTOsK_aPaMp3QSf449ir-MDHjW1svy_H3iHERKTi6sgbBYrINA/exec",
  pollInterval: 8000
};

const SESSION_CONFIG = {
  storageKey: "gym_member_session",
  inactivityLimitMs: 15 * 24 * 60 * 60 * 1000 // 15 Days
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

const State = {
  theme: localStorage.getItem("gym_theme") || "system",
  activeView: "auth",
  ownerTab: "all",
  isOwnerAuthenticated: false,
  isOwnerInspecting: false,
  members: [],
  transactions: [],
  activeIdentifier: null,
  isFetching: false,
  timer: null,
  lockoutInterval: null
};

// --- MOBILE KEYBOARD DISMISSAL HELPER ---
function dismissMobileKeyboard() {
  if (document.activeElement && typeof document.activeElement.blur === "function") {
    document.activeElement.blur();
  }
}

// --- INITIALIZATION ---
document.addEventListener("DOMContentLoaded", () => {
  setupTheme();
  setupEvents();
  initDates();
  startSync();
  checkLockoutStatus();

  // 1. Check Owner auto-login
  const isOwnerLoggedIn = checkOwnerAutoLogin();
  if (isOwnerLoggedIn) return;

  // 2. Check Member auto-login
  const isMemberLoggedIn = checkAutoLogin();
  if (!isMemberLoggedIn) {
    resetAuthTabsToMember();
    switchView("auth", true);
  }
});

// --- OWNER 15-DAY INACTIVITY SESSION ---
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
  State.isOwnerInspecting = false;
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

function handleOwnerExit() {
  dismissMobileKeyboard();
  clearOwnerSession();
  const pinInput = document.getElementById("input-owner-pin");
  if (pinInput) pinInput.value = "";
  resetAuthTabsToMember();
  switchView("auth", true);
  showToast("Owner session closed");
}

// --- MEMBER 15-DAY INACTIVITY SESSION ---
function saveMemberSession(identifier) {
  localStorage.setItem(SESSION_CONFIG.storageKey, JSON.stringify({ identifier: identifier, lastActive: Date.now() }));
}

function touchMemberSession() {
  const raw = localStorage.getItem(SESSION_CONFIG.storageKey);
  if (!raw) return;
  try {
    const session = JSON.parse(raw);
    session.lastActive = Date.now();
    localStorage.setItem(SESSION_CONFIG.storageKey, JSON.stringify(session));
  } catch (e) {
    localStorage.removeItem(SESSION_CONFIG.storageKey);
  }
}

function clearMemberSession() {
  localStorage.removeItem(SESSION_CONFIG.storageKey);
  State.activeIdentifier = null;
}

function checkAutoLogin() {
  const raw = localStorage.getItem(SESSION_CONFIG.storageKey);
  if (!raw) return false;
  try {
    const session = JSON.parse(raw);
    if (Date.now() - session.lastActive > SESSION_CONFIG.inactivityLimitMs) {
      clearMemberSession();
      showToast("Session expired after 15 days of inactivity.", true);
      return false;
    }
    touchMemberSession();
    State.activeIdentifier = session.identifier;
    State.isOwnerInspecting = false;
    switchView("member", false);
    return true;
  } catch (e) {
    clearMemberSession();
    return false;
  }
}

function handleMemberLogout() {
  dismissMobileKeyboard();
  clearMemberSession();
  const loginInput = document.getElementById("input-member-phone");
  if (loginInput) loginInput.value = "";
  resetAuthTabsToMember();
  switchView("auth", true);
  showToast("Logged out successfully");
}

// --- OWNER ROW-INSPECTION NAVIGATION ---
function inspectMemberCard(memberId) {
  dismissMobileKeyboard();
  State.isOwnerInspecting = true;
  State.activeIdentifier = memberId;
  switchView("member", true);
}

function returnToOwnerHub() {
  dismissMobileKeyboard();
  State.isOwnerInspecting = false;
  switchView("owner", true);
}

// --- OWNER SECURITY LOCKOUT ENGINE ---
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
      bannerText.innerText = `Too many failed attempts. Locked for ${mins > 0 ? `${mins}m ${secs}s` : `${secs}s`}.`;
    }
    if (pinInput) { pinInput.disabled = true; pinInput.value = ""; }
    if (loginBtn) loginBtn.disabled = true;
  } else {
    if (banner) banner.classList.add("hidden");
    if (pinInput) pinInput.disabled = false;
    if (loginBtn) loginBtn.disabled = false;
  }
}

function resetAuthTabsToMember() {
  const tabMember = document.getElementById("tab-member");
  const tabOwner = document.getElementById("tab-owner");
  const paneMember = document.getElementById("auth-member-pane");
  const paneOwner = document.getElementById("auth-owner-pane");

  if (tabMember && tabOwner && paneMember && paneOwner) {
    tabMember.classList.add("active");
    tabOwner.classList.remove("active");
    paneMember.classList.remove("hidden");
    paneOwner.classList.add("hidden");
  }
}

// --- DATE FORMATTER UTILITY (D Mon YYYY, e.g. 2 Jul 2026) ---
function formatDate(dateInput) {
  if (!dateInput) return "--";
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return "--";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// --- PRIVACY PHONE MASKING ---
function maskPhoneNumber(phoneStr) {
  if (!phoneStr) return "Not Provided";
  const clean = String(phoneStr).trim();
  if (clean.startsWith("MEM-") || clean.toLowerCase() === "not provided") {
    return `<span class="badge" style="background:var(--surface-alt); font-size:10px;">ANONYMOUS</span>`;
  }
  return clean.length < 4 ? clean : clean.slice(0, -3) + "***";
}

// --- SPINNER & TOAST UTILITIES ---
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

// --- THEME ENGINE ---
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
      showToast(`Switched to ${next} theme`);
    });
  }
}

// --- VIEW NAVIGATION ---
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
  } else {
    if (tableView) tableView.classList.remove("hidden");
    if (formView) formView.classList.add("hidden");
    renderOwner();
  }
}

// --- EVENT BINDINGS & MOBILE KEYBOARD LISTENERS ---
function setupEvents() {
  const tabMember = document.getElementById("tab-member");
  const tabOwner = document.getElementById("tab-owner");
  const paneMember = document.getElementById("auth-member-pane");
  const paneOwner = document.getElementById("auth-owner-pane");

  // Lift Owner PIN card when mobile keyboard pops up
  const pinInput = document.getElementById("input-owner-pin");
  const authCard = document.querySelector("#view-auth .card") || document.getElementById("auth-owner-pane");

  if (pinInput) {
    pinInput.addEventListener("focus", () => {
      // Small timeout ensures the mobile keyboard has begun opening before scrolling
      setTimeout(() => {
        const unlockBtn = document.getElementById("btn-login-owner");
        if (unlockBtn) {
          unlockBtn.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 300);
    });

    pinInput.addEventListener("blur", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  if (tabMember && tabOwner) {
    tabMember.addEventListener("click", () => {
      tabMember.classList.add("active");
      tabOwner.classList.remove("active");
      if (paneMember) paneMember.classList.remove("hidden");
      if (paneOwner) paneOwner.classList.add("hidden");
    });

    tabOwner.addEventListener("click", () => {
      tabOwner.classList.add("active");
      tabMember.classList.remove("active");
      if (paneOwner) paneOwner.classList.remove("hidden");
      if (paneMember) paneMember.classList.add("hidden");
      checkLockoutStatus();
      document.getElementById("input-owner-pin")?.focus();
    });
  }

  // Member Login
  document.getElementById("btn-login-member")?.addEventListener("click", handleMemberLogin);
  document.getElementById("input-member-phone")?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      dismissMobileKeyboard();
      handleMemberLogin();
    }
  });

  // Owner PIN Login
  document.getElementById("btn-login-owner")?.addEventListener("click", handleOwnerPinLogin);
  document.getElementById("input-owner-pin")?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      dismissMobileKeyboard();
      handleOwnerPinLogin();
    }
  });

  // Global Input Enter Key Listener to Hide Mobile Keyboard
  document.querySelectorAll("input").forEach(input => {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        dismissMobileKeyboard();
      }
    });
  });

  // Owner Controls
  document.getElementById("btn-refresh")?.addEventListener("click", () => {
    dismissMobileKeyboard();
    fetchData(false);
  });
  document.getElementById("owner-search")?.addEventListener("input", renderOwner);

  window.addEventListener("click", () => {
    if (State.activeView === "owner" || State.isOwnerInspecting) touchOwnerSession();
    if (State.activeView === "member" && !State.isOwnerInspecting) touchMemberSession();
  });

  // Admission Date & Custom Plan Listeners
  const fStartDate = document.getElementById("f-start-date");
  const fPlan = document.getElementById("f-plan");
  const fCustomDays = document.getElementById("f-custom-days");

  if (fStartDate) fStartDate.addEventListener("change", calcEndDate);
  if (fPlan) fPlan.addEventListener("change", () => {
    toggleCustomDaysInput("f-plan", "f-custom-days-group");
    calcEndDate();
  });
  if (fCustomDays) fCustomDays.addEventListener("input", calcEndDate);

  document.getElementById("admission-form")?.addEventListener("submit", handleAdmission);

  // Renewal Dates & Custom Plan Listeners
  const rStartDate = document.getElementById("r-start-date");
  const rPlan = document.getElementById("r-plan");
  const rCustomDays = document.getElementById("r-custom-days");

  if (rStartDate) rStartDate.addEventListener("change", calcRenewEndDate);
  if (rPlan) rPlan.addEventListener("change", () => {
    toggleCustomDaysInput("r-plan", "r-custom-days-group");
    calcRenewEndDate();
  });
  if (rCustomDays) rCustomDays.addEventListener("input", calcRenewEndDate);

  document.getElementById("renew-form")?.addEventListener("submit", handleRenewSubmit);
}

// --- SECURE OWNER PIN VERIFICATION ---
async function handleOwnerPinLogin() {
  dismissMobileKeyboard();
  if (checkLockoutStatus()) return showToast("Account temporarily locked. Please wait.", true);

  const pinInput = document.getElementById("input-owner-pin");
  const enteredPin = (pinInput?.value || "").trim();
  if (!enteredPin) return showToast("Please enter the owner security PIN.", true);

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
      
      await fetchData(true);
      hideSpinner();

      showToast("Owner authentication successful!");
      switchView("owner", true);
    } else {
      hideSpinner();
      dismissMobileKeyboard(); // Instantly closes keyboard so the warning is fully unobstructed
      recordFailedOwnerAttempt();
      const currentFailures = getLockoutData().failedAttempts;
      if (currentFailures < LOCKOUT_CONFIG.maxFreeAttempts) {
        showToast(`Incorrect PIN. ${LOCKOUT_CONFIG.maxFreeAttempts - currentFailures} attempt(s) remaining.`, true);
      }
      if (pinInput) { pinInput.value = ""; pinInput.focus(); }
    }
  } catch (err) {
    hideSpinner();
    showToast("Verification failed. Check network.", true);
  }
}

// --- MEMBER LOGIN ---
async function handleMemberLogin() {
  dismissMobileKeyboard();
  const inputVal = document.getElementById("input-member-phone").value.trim();
  if (!inputVal) return showToast("Please enter Phone Number or Member ID", true);

  showSpinner("Verifying gym membership...");
  await fetchData(true);
  hideSpinner();

  const member = State.members.find(m => 
    String(m.Phone_Number).trim().toLowerCase() === inputVal.toLowerCase() ||
    String(m.Member_ID).trim().toLowerCase() === inputVal.toLowerCase()
  );

  if (!member) {
    showToast("User is not registered as a gym member.", true);
    return;
  }

  State.isOwnerInspecting = false;
  State.activeIdentifier = inputVal;
  saveMemberSession(inputVal);
  showToast(`Welcome back, ${member.Full_Name || "Member"}!`);
  switchView("member", true);
}

// --- DYNAMIC CUSTOM PLAN DAYS TOGGLE & CALCULATIONS ---
function toggleCustomDaysInput(selectId, groupId) {
  const select = document.getElementById(selectId);
  const group = document.getElementById(groupId);
  if (select && group) {
    if (select.value === "Custom Plan") {
      group.classList.remove("hidden");
    } else {
      group.classList.add("hidden");
    }
  }
}

function initDates() {
  const today = new Date().toISOString().split("T")[0];
  const fStartDate = document.getElementById("f-start-date");
  if (fStartDate) {
    fStartDate.value = today;
    calcEndDate();
  }
}

function calcEndDate() {
  const startStr = document.getElementById("f-start-date").value;
  if (!startStr) return;

  const planSelect = document.getElementById("f-plan");
  let days = 30;

  if (planSelect.value === "Custom Plan") {
    const customVal = parseInt(document.getElementById("f-custom-days").value, 10);
    days = isNaN(customVal) || customVal < 1 ? 1 : customVal;
  } else {
    days = parseInt(planSelect.options[planSelect.selectedIndex].getAttribute("data-days"), 10) || 30;
  }

  const start = new Date(startStr);
  const end = new Date(start.setDate(start.getDate() + days));
  document.getElementById("f-end-date").value = end.toISOString().split("T")[0];
}

function calcRenewEndDate() {
  const startStr = document.getElementById("r-start-date").value;
  if (!startStr) return;

  const planSelect = document.getElementById("r-plan");
  let days = 30;

  if (planSelect.value === "Custom Plan") {
    const customVal = parseInt(document.getElementById("r-custom-days").value, 10);
    days = isNaN(customVal) || customVal < 1 ? 1 : customVal;
  } else {
    days = parseInt(planSelect.options[planSelect.selectedIndex].getAttribute("data-days"), 10) || 30;
  }

  const start = new Date(startStr);
  const end = new Date(start.setDate(start.getDate() + days));
  document.getElementById("r-end-date").value = end.toISOString().split("T")[0];
}

function getDaysRemaining(endDateStr) {
  if (!endDateStr) return 0;
  const target = new Date(endDateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}

// --- REAL-TIME SYNC ---
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

    if (State.activeView === "owner") renderOwner();
    if (State.activeView === "member") renderMember();
  } catch (err) {
    if (!silent) showToast("Connection failed. Check network.", true);
  } finally {
    State.isFetching = false;
    if (!silent) hideSpinner();
  }
}

// --- OWNER DASHBOARD (WITH TAB-SPECIFIC DUE HIGHLIGHTING) ---
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

  // Tab Filtering
  if (State.ownerTab === "expiring") {
    list = list.filter(m => getDaysRemaining(m.Plan_End_Date) <= 7);
  } else if (State.ownerTab === "dues") {
    list = list.filter(m => Number(m.Total_Due_Amount || 0) > 0);
  }

  // Search Filter
  list = list.filter(m => {
    const nameMatch = String(m.Full_Name || "").toLowerCase().includes(query);
    const idMatch = String(m.Member_ID || "").toLowerCase().includes(query);
    const phoneMatch = String(m.Phone_Number || "").trim().toLowerCase().startsWith(query);
    return nameMatch || idMatch || phoneMatch;
  });

  if (!tbody) return;
  tbody.innerHTML = "";

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 24px; color: var(--text-muted);">No records found.</td></tr>`;
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

    // Only highlight in 'all' and 'expiring' tabs if there is a due balance
    const shouldHighlight = (State.ownerTab === "all" || State.ownerTab === "expiring") && dueAmount > 0;
    tr.className = shouldHighlight ? "row-due-highlight" : "";

    // Render cells (First 3 cells have onclick="inspectMemberCard(...)")
    tr.innerHTML = `
      <td class="clickable-cell" onclick="inspectMemberCard('${m.Member_ID}')" title="Click to view member dashboard">
        <span class="badge ${badgeClass}">${statusText}</span>
      </td>
      <td class="clickable-cell" onclick="inspectMemberCard('${m.Member_ID}')" title="Click to view member dashboard">
        <strong>${m.Full_Name || "Unnamed"}</strong>
        <div style="font-size: 10px; color: var(--text-muted);">${m.Member_ID}</div>
      </td>
      <td class="clickable-cell" onclick="inspectMemberCard('${m.Member_ID}')" title="Click to view member dashboard">
        <strong>${formatDate(m.Plan_Start_Date || m["Plan Start Date"])}</strong>
      </td>
      <td><span class="badge" style="background: var(--surface-alt);">${m["Plan Name"] || m.Plan_Name || "Standard"}</span></td>
      <td class="${dueAmount > 0 ? 'text-warning font-bold' : 'text-subtle'}">
        ₹${dueAmount.toLocaleString()}
      </td>
      <td><strong>${maskPhoneNumber(m.Phone_Number)}</strong></td>
      <td class="text-right">
        <div class="action-cluster">
          <button class="btn-renew" onclick="openRenewModal('${m.Member_ID}')">Renew</button>
          <button class="btn-delete" onclick="deleteMember('${m.Member_ID}', '${m.Full_Name}')">Delete</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// --- ADMISSION SUBMISSION ---
async function handleAdmission(e) {
  e.preventDefault();
  dismissMobileKeyboard();

  const btn = document.getElementById("btn-save-member");
  btn.disabled = true;
  showSpinner("Recording admission to Google Sheets...");

  const phoneVal = document.getElementById("f-phone").value.trim();
  const planSelect = document.getElementById("f-plan");
  let chosenPlanName = planSelect.value;

  if (chosenPlanName === "Custom Plan") {
    const customDays = parseInt(document.getElementById("f-custom-days").value, 10) || 30;
    chosenPlanName = `Custom (${customDays} Days)`;
  }

  const payload = {
    action: "addMember",
    fullName: document.getElementById("f-name").value.trim(),
    phoneNumber: phoneVal,
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
      const idNotice = phoneVal ? "" : ` (Assigned ID: ${result.memberId})`;
      showToast(`Member successfully saved!${idNotice}`);
      document.getElementById("admission-form").reset();
      toggleCustomDaysInput("f-plan", "f-custom-days-group");
      initDates();
      setOwnerTab("all");
      fetchData(true);
    } else {
      showToast("Error saving member", true);
    }
  } catch (err) {
    showToast("Member successfully saved!");
    document.getElementById("admission-form").reset();
    toggleCustomDaysInput("f-plan", "f-custom-days-group");
    initDates();
    setOwnerTab("all");
    setTimeout(() => fetchData(true), 1200);
  } finally {
    btn.disabled = false;
    hideSpinner();
  }
}

// --- RENDER MEMBER DASHBOARD (REORDERED TRANSACTIONS TABLE) ---
function renderMember() {
  const member = State.members.find(m => 
    String(m.Phone_Number).trim().toLowerCase() === String(State.activeIdentifier).trim().toLowerCase() ||
    String(m.Member_ID).trim().toLowerCase() === String(State.activeIdentifier).trim().toLowerCase()
  );
  if (!member) return;

  const btnOwnerBack = document.getElementById("btn-owner-back");
  const btnMemberLogout = document.getElementById("btn-member-logout");

  if (State.isOwnerInspecting) {
    if (btnOwnerBack) btnOwnerBack.classList.remove("hidden");
    if (btnMemberLogout) btnMemberLogout.classList.add("hidden");
  } else {
    if (btnOwnerBack) btnOwnerBack.classList.add("hidden");
    if (btnMemberLogout) btnMemberLogout.classList.remove("hidden");
  }

  const days = getDaysRemaining(member.Plan_End_Date);
  const dues = Number(member.Total_Due_Amount || 0);

  const displayPhone = String(member.Phone_Number).startsWith("MEM-") ? "Anonymous Access" : member.Phone_Number;

  document.getElementById("m-member-name").innerText = member.Full_Name;
  document.getElementById("m-member-sub").innerText = `ID: ${member.Member_ID} • ${displayPhone}`;
  document.getElementById("m-plan-badge").innerText = member["Plan Name"] || member.Plan_Name || "Membership";
  document.getElementById("m-days-number").innerText = Math.max(0, days);
  
  document.getElementById("m-start-date").innerText = formatDate(member.Plan_Start_Date);
  document.getElementById("m-end-date").innerText = formatDate(member.Plan_End_Date);
  document.getElementById("m-due-amount").innerText = dues.toLocaleString();

  const planName = String(member["Plan Name"] || member.Plan_Name || "");
  let totalDays = 30;

  if (planName.includes("3 Month")) totalDays = 90;
  else if (planName.includes("6 Month")) totalDays = 180;
  else if (planName.includes("1 Year")) totalDays = 365;
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
    .filter(t => 
      (t.Member_ID && String(t.Member_ID).trim() === String(member.Member_ID).trim()) || 
      (t.Phone_Number && String(t.Phone_Number).trim() === String(member.Phone_Number).trim())
    )
    .reverse();

  const txnBody = document.getElementById("m-transaction-rows");
  if (!txnBody) return;
  txnBody.innerHTML = "";

  if (userTxns.length === 0) {
    txnBody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 16px; color: var(--text-muted);">No payment records.</td></tr>`;
  } else {
    // 1. Date | 2. Amount Paid | 3. Payment Mode | 4. Notes / Purpose
    userTxns.forEach(t => {
      txnBody.innerHTML += `
        <tr>
          <td><strong>${formatDate(t.Date)}</strong></td>
          <td><strong>₹${Number(t["Amount Paid"] || t.Amount_Paid || 0).toLocaleString()}</strong></td>
          <td><span class="badge" style="background: var(--surface-alt);">${t["Payment Mode"] || t.Payment_Mode || "Cash"}</span></td>
          <td>${t.Notes || "Payment"}</td>
        </tr>
      `;
    });
  }
}

// --- OWNER RENEWAL & DELETE ---
function openRenewModal(memberId) {
  dismissMobileKeyboard();
  const member = State.members.find(m => String(m.Member_ID).trim() === String(memberId).trim());
  if (!member) return;

  document.getElementById("r-member-id").value = member.Member_ID;
  document.getElementById("r-full-name").value = member.Full_Name;
  document.getElementById("r-phone").value = member.Phone_Number;
  document.getElementById("renew-sub-title").innerText = `${member.Full_Name} (${member.Member_ID})`;

  const today = new Date().toISOString().split("T")[0];
  document.getElementById("r-start-date").value = today;
  toggleCustomDaysInput("r-plan", "r-custom-days-group");
  calcRenewEndDate();

  document.getElementById("renew-modal").classList.remove("hidden");
}

function closeRenewModal() {
  dismissMobileKeyboard();
  document.getElementById("renew-modal")?.classList.add("hidden");
  document.getElementById("renew-form")?.reset();
  toggleCustomDaysInput("r-plan", "r-custom-days-group");
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
    phoneNumber: document.getElementById("r-phone").value,
    planName: chosenPlanName,
    startDate: document.getElementById("r-start-date").value,
    endDate: document.getElementById("r-end-date").value,
    amountPaid: document.getElementById("r-paid").value,
    dueAmount: document.getElementById("r-due").value,
    paymentMode: document.getElementById("r-mode").value,
    notes: "Membership Resumed / Renewed"
  };

  try {
    await fetch(CONFIG.apiUrl, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    showToast("Membership renewed and activated!");
    closeRenewModal();
    setTimeout(() => fetchData(true), 1200);
  } catch (err) {
    showToast("Error processing renewal", true);
  } finally {
    btn.disabled = false;
    hideSpinner();
  }
}

async function deleteMember(memberId, fullName) {
  dismissMobileKeyboard();
  
  const confirmed = confirm(`Are you sure you want to delete ${fullName} (ID: ${memberId}) from gym records?`);
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
    showToast("Error deleting member. Check network or script logs.", true);
  } finally {
    hideSpinner();
  }
}
