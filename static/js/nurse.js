// =============================================
// NURSE PORTAL — JAVASCRIPT
// OrthoConnect Clinic Management System
// =============================================

// ---- SUPABASE CONFIG ----
const SUPABASE_URL = "https://ctoybxukmkcnwdeueorm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0b3lieHVrbWtjbndkZXVlb3JtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3ODg3NzAsImV4cCI6MjA4ODM2NDc3MH0.hLDzyCvNzWbrXW-5Z1NsE6eH2sF_3S5L33htZYjEiH0";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: window.sessionStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
});

// ---- Global State ----
let currentNurse = null;       // { id, name, role, specialty, image_base64, is_available }
let allStaffData = [];
let nurseAttendance = [];
let nursePayroll = [];
let nurseAppointments = [];
let nursePatients = [];
let nurseLeaveRecords = [];
let nurseInventory = [];
let activePage = null;
let lastQRToken = null; 
let deviceId = null; // Store device fingerprint
let activeProgressPatient = null; // Currently selected patient in treatment progress

// ---- Messenger Globals ----
let activeNurseSessionId = null;
let allNurseSessions = [];
let nursePrioritySessions = new Set();
let nurseMutedSessions = new Set();
let nurseArchivedSessions = new Set();
let nurseBlockedSessions = new Set();
let nurseDeletedSessions = new Set();
let nurseStagedImages = [];
let nurseReadSessions = new Set(JSON.parse(localStorage.getItem("nurseReadSessions") || "[]"));
let nurseClaimingMap = new Set();

// ---- Device Fingerprinting Logic ----
function getDeviceId() {
  let id = localStorage.getItem("OC_DEVICE_ID");
  if (!id) {
    // Generate a unique device fingerprint
    id = "DEV-" + Math.random().toString(36).substr(2, 9).toUpperCase() + "-" + Date.now().toString(36).toUpperCase();
    localStorage.setItem("OC_DEVICE_ID", id);
  }
  return id;
}

// ---- CLINIC CONFIG ----
const CLINIC_CONFIG = {
  openingTime: "09:00",
  closingTime: "17:00",
  graceMinutes: 10,
  maxLeavePerMonth: 3
};

// =============================================
// INITIALIZATION
// =============================================
document.addEventListener("DOMContentLoaded", async () => {
  // Initialize device ID
  deviceId = getDeviceId();
  
  // Mandatory Location Permission on Startup
  requestLocationPermission();
  
  if (window.lucide) window.lucide.createIcons();
  
  // Persistent Session Check via Supabase Auth
  const { data: { session } } = await sb.auth.getSession();
  
  if (session) {
    // If authenticated, fetch their staff record
    const { data: staff, error } = await sb
      .from("clinic_staff")
      .select("*")
      .eq("email", session.user.email)
      .single();

    if (staff && !error) {
      // Role-Based Access Control (RBAC) Check
      const role = (staff.role || "").toLowerCase();
      if (role !== "nurse") {
        console.error("Unauthorized role for Nurse portal:", role);
        await sb.auth.signOut();
        localStorage.removeItem("OC_NURSE_SESSION");
        window.location.href = "/";
        return;
      }

      currentNurse = staff;
      console.log("Authenticated nurse session:", currentNurse.name);
      
      // Before showing main app, fetch clinic status
      await fetchClinicStaticStatus();
      
      const mainContent = document.getElementById("nurseMainContent");
      if (mainContent) {
        mainContent.classList.remove("hidden");
        updateNurseIdentity();
        initNursePortal();
        initNurseRealtimeChat();
      }
    } else {
      console.error("Authenticated but no matching clinic_staff record found or error:", error);
      await sb.auth.signOut();
      localStorage.removeItem("OC_NURSE_SESSION");
      window.location.href = "/";
    }
  } else {
    window.location.href = "/";
  }

  setupNavigation();
  setupLogout();

  // Check for successful verification redirect
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('verified') === 'true') {
     // Clean the URL so the toast doesn't reappear on reload
     window.history.replaceState({}, document.title, window.location.pathname);
     
     // Delay slightly to ensure UI is ready
     setTimeout(() => {
        showNurseToast("✨ Your email has been successfully verified!", "success");
     }, 1000);
  }
});

async function requestLocationPermission() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => console.log("Location verified"),
      (err) => {
        alert("Location access is REQUIRED to access the Nurse Portal for security and attendance tracking. Please enable GPS/Location permissions.");
      }
    );
  }
}

// =============================================
// STAFF LOADER (for login dropdown)
// =============================================
function updateNurseIdentity() {
  if (!currentNurse) return;
  const nameEl = document.querySelector(".nurse-user-name");
  const emailEl = document.querySelector(".nurse-user-email");
  const initialsEl = document.querySelector(".nurse-initials-badge");
  
  if (nameEl) nameEl.textContent = currentNurse.name;
  if (emailEl) emailEl.textContent = currentNurse.email;
  if (initialsEl) {
    const initials = currentNurse.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
    initialsEl.textContent = initials;
  }
}

async function initNurseRealtimeChat() {
  if (!sb) return;
  
  sb.channel('realtime_nurse_chats')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
      loadNurseConversations(document.getElementById("nurseConvSearch")?.value || "");
      if (payload.new.session_id === activeNurseSessionId && payload.new.sender_type !== 'staff') {
        appendNurseMessage(payload.new.content, false, payload.new.created_at, payload.new.sender_avatar_base64, payload.new.sender_fullname, payload.new.is_seen, payload.new.id);
        sb.from('messages').update({ is_seen: true }).eq('session_id', activeNurseSessionId).eq('sender_type', 'patient').then();
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'patient_chat_states' }, (payload) => {
      const state = payload.new;
      if (state && state.session_id === activeNurseSessionId) {
        const indicator = document.getElementById("nurseChatTypingIndicator");
        if (indicator) {
          if (state.is_typing) indicator.classList.remove("hidden");
          else indicator.classList.add("hidden");
        }
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_chat_states' }, (payload) => {
      loadNurseConversations(document.getElementById("nurseConvSearch")?.value || "");
    })
    .subscribe();
}
// Staff loader is no longer needed with Email/Password login
async function loadStaffForLogin() {
  // Deprecated
}

// Login is now handled by the unified login page (login.html)
function initNursePortalFlow() {
  initNursePortal();
}

// =============================================
// NURSE IDENTITY UI
// =============================================
// =============================================
// NURSE IDENTITY UI
// =============================================
function updateNurseIdentity() {
  if (!currentNurse) return;
  const initials = (currentNurse.name || "??").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);

  // Top header (New compact)
  setEl("nurseInitialsBadge", initials);
  setEl("nurseNameLabel", currentNurse.name);

  // Sidebar
  setEl("sidebarNurseName", currentNurse.name);
  const sidebarAvatar = document.getElementById("sidebarNurseAvatar");
  if (sidebarAvatar) sidebarAvatar.textContent = initials;
}

// =============================================
// LOGOUT
// =============================================
function setupLogout() {
  const btns = [
    document.getElementById("nurseLogoutBtnTop"), 
    document.getElementById("nurseLogoutBtnSidebar")
  ];
  btns.forEach(btn => {
    if (btn) btn.addEventListener("click", async () => {
      await sb.auth.signOut();
      localStorage.removeItem("OC_NURSE_SESSION");
      window.location.href = "/";
    });
  });
}

// =============================================
// NAVIGATION
// =============================================
function setupNavigation() {
  document.querySelectorAll("[data-nurse-page]").forEach(btn => {
    btn.addEventListener("click", () => {
      const page = btn.dataset.nursePage;
      setNursePage(page);
    });
  });
}

function setNursePage(pageKey) {
  activePage = pageKey;

  // Auto-start at the top of the page when navigating anywhere
  window.scrollTo({ top: 0, behavior: 'instant' });
  const mainContent = document.getElementById("nurseMainContent");
  if (mainContent) mainContent.scrollTo({ top: 0, behavior: 'instant' });

  // Update nav items
  document.querySelectorAll("[data-nurse-page]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.nursePage === pageKey);
  });

  // Show/hide sections
  document.querySelectorAll("[id^='nurse-page-']").forEach(sec => {
    const secKey = sec.id.replace("nurse-page-", "");
    if (secKey === pageKey) {
      sec.classList.remove("hidden");
    } else {
      sec.classList.add("hidden");
    }
  });

  // Lazy load page data
  if (pageKey === "my-attendance") loadMyAttendance();
  if (pageKey === "my-payroll") loadMyPayroll();
  if (pageKey === "profile") renderProfile();
  if (pageKey === "inventory") loadInventory();
  if (pageKey === "settings") loadSettings();

  if (window.lucide) window.lucide.createIcons();
}

// =============================================
// INIT NURSE PORTAL (after login)
// =============================================
async function initNursePortal() {
  await fetchNurseStaffData(); // Needed for timetable and other lookups
  await fetchNursePatients(); // Needed for contact lookups in lists
  setNursePage("my-attendance");
  setupNurseNotifications();
  fetchNurseNotifications();
  setupNurseMessagingListeners();
  initNurseSchedule();

  // Start polling
  setInterval(async () => {
    // Refresh notifications periodically
    fetchNurseNotifications();

    // Auto-refresh QR if status changes (e.g. 10m before opening)
    if (activePage === "profile") {
      await fetchClinicStaticStatus();
      const currentToken = await getQRStatusToken();
      if (currentToken !== lastQRToken) {
        // Clear and re-render only the QR part
        const qrContent = document.getElementById("nurseProfileQR");
        if (qrContent) qrContent.innerHTML = "";
        renderProfile();
      }
    }
  }, 8000);
}

// ---- Utility: Robust Time Parser (handles 24h and 12h AM/PM) ----
function parseTimeString(timeStr) {
  if (!timeStr) return { h: 0, m: 0 };
  const match = timeStr.match(/(\d+):(\d+)(?:\s*(AM|PM))?/i);
  if (!match) return { h: 0, m: 0 };
  let h = parseInt(match[1], 10);
  let m = parseInt(match[2], 10);
  const ampm = match[3] ? match[3].toUpperCase() : null;
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return { h, m };
}

// ---- Utility: Check if QR should be Open (Now simplified to 5-min rotation) ----
// ---- Utility: Check clinic settings from Supabase ----
let dbClinicStatus = { is_open: true, operating_days: [1, 2, 3, 4, 5] };

async function fetchClinicStaticStatus() {
  try {
    const { data, error } = await sb.from("clinics").select("*").limit(1);
    if (!error && data && data.length > 0) {
      dbClinicStatus = data[0];
    }
  } catch (err) {
    console.warn("Could not fetch clinic settings:", err);
  }
}

function isClinicOpenNow() {
  if (dbClinicStatus.is_open === false) return false;
  const now = new Date();
  const day = now.getDay();
  const operatingDays = dbClinicStatus.operating_days || [1, 2, 3, 4, 5];
  const isDayMatch = operatingDays.some(d => parseInt(d, 10) === day);
  if (!isDayMatch) return false;

  // Time Check
  const openTime = dbClinicStatus.opening_time || "09:00";
  const closeTime = dbClinicStatus.closing_time || "17:00";
  
  const parseTime = (str) => {
    const match = str.match(/(\d+):(\d+)(?:\s*(AM|PM))?/i);
    if (!match) return { h: 0, m: 0 };
    let h = parseInt(match[1], 10);
    let m = parseInt(match[2], 10);
    const ampm = match[3] ? match[3].toUpperCase() : null;
    if (ampm === "PM" && h < 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    return { h, m };
  };

  const { h: oH, m: oM } = parseTime(openTime);
  const { h: cH, m: cM } = parseTime(closeTime);
  const nowH = now.getHours();
  const nowM = now.getMinutes();

  const nowTotal = nowH * 60 + nowM;
  const openTotal = oH * 60 + oM;
  const closeTotal = cH * 60 + cM;

  return nowTotal >= openTotal && nowTotal <= closeTotal;
}

// ---- Utility: Check if QR should be Open (Now simplified to 5-min rotation) ----
async function getQRStatusToken() {
  // Hardcoded to STATIC to prevent rotation/expiration
  return "STATIC";
}

// =============================================
// RENDER PROFILE
// =============================================
async function renderProfile() {
  if (!currentNurse) return;

  const initials = (currentNurse.name || "??").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
  const roleLabel = (currentNurse.role || "Nurse").charAt(0).toUpperCase() + (currentNurse.role || "Nurse").slice(1);

  // Ensure top and sidebar matches
  setEl("nurseInitialsBadge", initials);
  setEl("nurseNameLabel", currentNurse.name);
  setEl("sidebarNurseName", currentNurse.name);
  const sidebarAvatar = document.getElementById("sidebarNurseAvatar");
  if (sidebarAvatar) sidebarAvatar.textContent = initials;

  // Profile Info
  const infoEl = document.getElementById("nurseProfileInfo");
  if (infoEl) {
    infoEl.innerHTML = `
      <div class="flex items-center gap-4 mb-6">
        ${currentNurse.image_base64
          ? `<img src="${currentNurse.image_base64}" class="w-20 h-20 rounded-[24px] object-cover border-4 border-teal-100 shadow-lg" />`
          : `<div class="w-20 h-20 rounded-[24px] bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center text-white font-black text-2xl shadow-lg">${initials}</div>`
        }
        <div>
          <h2 class="text-xl font-black text-slate-800">${escapeHtml(currentNurse.name)}</h2>
          <p class="text-[11px] font-bold text-teal-600 uppercase tracking-widest">${roleLabel}</p>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="p-4 rounded-2xl bg-slate-50 border border-slate-100">
          <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Full Name</p>
          <p class="text-sm font-bold text-slate-700">${escapeHtml(currentNurse.name)}</p>
        </div>
        <div class="p-4 rounded-2xl bg-slate-50 border border-slate-100">
          <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Role</p>
          <p class="text-sm font-bold text-slate-700">${roleLabel}</p>
        </div>
        <div class="p-4 rounded-2xl bg-slate-50 border border-slate-100">
          <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Specialty</p>
          <p class="text-sm font-bold text-slate-700">${escapeHtml(currentNurse.specialty || "General")}</p>
        </div>
        <div class="p-4 rounded-2xl bg-slate-50 border border-slate-100">
          <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Status</p>
          <p class="text-sm font-bold ${currentNurse.is_available ? 'text-emerald-600' : 'text-slate-500'}">${currentNurse.is_available ? '✓ Available' : '✗ Not Available'}</p>
        </div>
      </div>
    `;
  }

  // Flip card identity
  setEl("profileFlipName", currentNurse.name);
  setEl("profileFlipRole", roleLabel);
  setEl("profileFlipSpecialty", currentNurse.specialty || "Orthodontics");
  const flipAvatar = document.getElementById("profileFlipAvatar");
  if (flipAvatar) flipAvatar.textContent = initials;

  // Generate QR code
  const qrContainer = document.getElementById("nurseProfileQR");
  if (qrContainer) {
    qrContainer.innerHTML = ""; // Clear
    
    // Clinic status check removed to keep QR always visible
    const qrVisible = true; 


    if (!qrContainer.querySelector("canvas") && !qrContainer.querySelector("img")) {
      const today = getTodayStr(); // Use local date for sync with scanner
      const statusToken = await getQRStatusToken();
      lastQRToken = statusToken; // Store for polling check
      // Format: ORTHO_STAFF:Name:Role:Date:Token:DeviceID
      const qrData = `ORTHO_STAFF:${currentNurse.name}:${currentNurse.role || "Nurse"}:${today}:${statusToken}:${deviceId}`;

      // Update indicator visibility (Always active now with rotation)
      const indicator = document.getElementById("qrActiveIndicator");
      if (indicator) {
        indicator.classList.remove("hidden");
      }
      
      try {
        new QRCode(qrContainer, {
          text: qrData,
          width: 256, // Larger source for better scaling
          height: 256,
          colorDark: "#0f172a",
          colorLight: "#ffffff",
          correctLevel: QRCode.CorrectLevel.M // Better for screen scanning
        });
      } catch (e) {
        console.error("QR generation error:", e);
      }
    }
  }

  if (window.lucide) window.lucide.createIcons();
}

// ---- Full QR View Logic ----
window.openFullQR = async function() {
  const modal = document.getElementById("fullQRModal");
  const container = document.getElementById("fullQRContainer");
  if (!modal || !container || !currentNurse) return;

  // Clear previous
  container.innerHTML = "";
  
  // Set UI Details
  setEl("fullQRName", currentNurse.name);
  setEl("fullQRRole", (currentNurse.role || "Nurse") + " Account");
  const initials = (currentNurse.name || "??").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
  setEl("fullQRNameInitials", initials);

  const today = getTodayStr();
  const statusToken = await getQRStatusToken();
  const qrData = `ORTHO_STAFF:${currentNurse.name}:${currentNurse.role || "Nurse"}:${today}:${statusToken}:${deviceId}`;

  try {
    new QRCode(container, {
      text: qrData,
      width: 512, // High res source
      height: 512,
      colorDark: "#0f172a",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M // Medium is best balance for screens
    });
    
    // Block right click on QR only
    setTimeout(() => {
      const target = container.querySelector("img") || container.querySelector("canvas");
      if (target) {
        target.oncontextmenu = (e) => {
          e.preventDefault();
          alert("Downloading or saving QR codes is disabled for staff security.");
          return false;
        };
      }
    }, 100);

    modal.classList.remove("hidden");
    if (window.lucide) window.lucide.createIcons();
  } catch(e) {
    console.error("Full QR Error:", e);
  }
};

window.closeFullQR = function() {
  const modal = document.getElementById("fullQRModal");
  if (modal) modal.classList.add("hidden");
};

// =============================================
// MY ATTENDANCE
// =============================================
async function loadMyAttendance() {
  if (!currentNurse) return;

  try {
    const { data, error } = await sb
      .from("attendance")
      .select("*")
      .eq("staff_name", currentNurse.name)
      .order("date", { ascending: false });
    if (error) throw error;
    nurseAttendance = data || [];
  } catch (err) {
    console.error("Attendance fetch error:", err);
    nurseAttendance = [];
  }

  renderMyAttendance();
}

function renderMyAttendance() {
  const body = document.getElementById("myAttBody");
  const countEl = document.getElementById("myAttCount");
  const dateFilter = document.getElementById("myAttFilterDate");

  let filtered = nurseAttendance;
  if (dateFilter?.value) {
    filtered = filtered.filter(r => r.date === dateFilter.value);
  }

  if (countEl) countEl.textContent = `${filtered.length} Record${filtered.length !== 1 ? "s" : ""}`;

  // Stats
  const present = nurseAttendance.filter(r => r.status === "present").length;
  const late = nurseAttendance.filter(r => r.status === "late").length;
  const absent = nurseAttendance.filter(r => r.status === "absent").length;
  const leave = nurseAttendance.filter(r => r.status === "on-leave").length;
  setEl("myAttPresent", present);
  setEl("myAttLate", late);
  setEl("myAttAbsent", absent);
  setEl("myAttLeave", leave);

  if (!body) return;

  if (filtered.length === 0) {
    body.innerHTML = `<tr><td colspan="5" class="text-center py-12"><div class="flex flex-col items-center gap-3"><div class="w-14 h-14 rounded-[20px] bg-teal-50 flex items-center justify-center"><i data-lucide="scan-line" class="w-7 h-7 text-teal-300"></i></div><p class="text-sm font-black text-slate-600">No attendance records found</p><p class="text-[11px] font-medium text-slate-400">Your clock-in/out records will appear here</p></div></td></tr>`;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  body.innerHTML = filtered.map((r, idx) => {
    const hours = calcHours(r.clock_in, r.clock_out);
    return `
    <tr class="border-b border-slate-100 hover:bg-teal-50/30 transition-colors" style="animation: nurseFadeIn 0.3s ease ${idx * 30}ms both;">
      <td class="px-5 py-3.5 text-[12px] font-bold text-slate-600">${r.date || "—"}</td>
      <td class="px-4 py-3.5"><span class="text-[12px] font-bold ${r.clock_in ? "text-emerald-600" : "text-slate-400"}">${formatTime12h(r.clock_in)}</span></td>
      <td class="px-4 py-3.5"><span class="text-[12px] font-bold ${r.clock_out ? "text-rose-500" : "text-slate-400"}">${formatTime12h(r.clock_out)}</span></td>
      <td class="px-4 py-3.5 text-[12px] font-black text-slate-700">${hours}</td>
      <td class="px-4 py-3.5">${statusPill(r.status)}</td>
    </tr>`;
  }).join("");

  if (window.lucide) window.lucide.createIcons();

  // Attach filter handler
  if (dateFilter && !dateFilter._bound) {
    dateFilter.addEventListener("change", () => renderMyAttendance());
    dateFilter._bound = true;
  }
}

// =============================================
// MY PAYROLL
// =============================================
async function loadMyPayroll() {
  if (!currentNurse) return;

  try {
    // 1. Fetch finalized payroll records
    const { data: payData, error: payError } = await sb
      .from("payroll")
      .select("*")
      .eq("staff_name", currentNurse.name)
      .order("pay_period", { ascending: false });
    if (payError) throw payError;
    nursePayroll = payData || [];

    // 2. Fetch current month attendance for live calculation
    const now = new Date();
    const monthStr = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    const firstDay = monthStr + "-01";
    
    const { data: attData, error: attError } = await sb
      .from("attendance")
      .select("*")
      .eq("staff_name", currentNurse.name)
      .gte("date", firstDay);
    
    if (!attError && attData) {
      calculateLivePayroll(attData, monthStr);
    }

  } catch (err) {
    console.error("Payroll fetch error:", err);
    nursePayroll = [];
  }

  renderMyPayroll();
}

function calculateLivePayroll(attRecords, period) {
  // Config for live computation
  const hourlyRate = currentNurse.hourly_rate || 150; // Default if not set
  let totalMinutes = 0;
  let presentCount = 0;
  let lateCount = 0;
  let deductions = 0;

  attRecords.forEach(r => {
    if (r.status === "present" || r.status === "late") {
      presentCount++;
      if (r.status === "late") {
        lateCount++;
        // Late penalty: 50 pesos or maybe 15 mins of work?
        deductions += 50; 
      }

      // Calc minutes worked
      if (r.clock_in && r.clock_out) {
        const [h1, m1] = r.clock_in.split(":").map(Number);
        const [h2, m2] = r.clock_out.split(":").map(Number);
        const mins = (h2 * 60 + m2) - (h1 * 60 + m1);
        if (mins > 0) totalMinutes += mins;
      }
    }
  });

  const grossPay = (totalMinutes / 60) * hourlyRate;
  const netPay = Math.max(0, grossPay - deductions);

  // Update UI
  setEl("livePayPeriodLabel", `Summary for ${period}`);
  setEl("livePayHours", `${(totalMinutes / 60).toFixed(1)}h`);
  setEl("livePayPresent", presentCount);
  setEl("livePayLate", lateCount);
  setEl("livePayDeductions", `₱${deductions.toLocaleString()}`);
  setEl("livePayTotal", `₱${netPay.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}`);
}

function renderMyPayroll() {
  const body = document.getElementById("myPayBody");
  const countEl = document.getElementById("myPayCount");

  if (countEl) countEl.textContent = `${nursePayroll.length} Record${nursePayroll.length !== 1 ? "s" : ""}`;
  if (!body) return;

  if (nursePayroll.length === 0) {
    body.innerHTML = `<tr><td colspan="5" class="text-center py-12"><div class="flex flex-col items-center gap-3"><div class="w-14 h-14 rounded-[20px] bg-violet-50 flex items-center justify-center"><i data-lucide="banknote" class="w-7 h-7 text-violet-300"></i></div><p class="text-sm font-black text-slate-600">No finalized payroll records yet</p><p class="text-[11px] font-medium text-slate-400">Past finalized records will appear here</p></div></td></tr>`;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  body.innerHTML = nursePayroll.map((r, idx) => {
    const base = r.base_salary || 0;
    const deductions = r.deductions || 0;
    const bonus = r.bonus || 0;
    const overtimeHours = r.overtime_hours || 0;
    // Simple OT calc if hourly_rate exists, otherwise assume monthly base includes it or handled by admin
    const net = r.net_pay || (base + bonus - deductions);
    const statusColor = r.status === "paid" ? "text-emerald-600 bg-emerald-50" : r.status === "pending" ? "text-amber-600 bg-amber-50" : "text-slate-500 bg-slate-100";

    return `
    <tr class="border-b border-slate-100 hover:bg-violet-50/30 transition-colors" style="animation: nurseFadeIn 0.3s ease ${idx * 30}ms both;">
      <td class="px-5 py-3.5 text-[12px] font-bold text-slate-700">${escapeHtml(r.pay_period || "—")}</td>
      <td class="px-4 py-3.5 text-[12px] font-bold text-slate-600">₱${base.toLocaleString()}</td>
      <td class="px-4 py-3.5 text-[12px] font-bold text-red-500">-₱${deductions.toLocaleString()}</td>
      <td class="px-4 py-3.5 text-[12px] font-black text-emerald-700">₱${net.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
      <td class="px-4 py-3.5"><span class="inline-flex px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${statusColor}">${escapeHtml(r.status || "pending")}</span></td>
    </tr>`;
  }).join("");
}

// =============================================
// LEAVE MANAGEMENT
// =============================================
async function loadLeaveManagement() {
  if (!currentNurse) return;

  // Load attendance for leave records (including pending, approved, denied)
  try {
    const { data, error } = await sb
      .from("attendance")
      .select("*")
      .eq("staff_name", currentNurse.name)
      .in("status", ["on-leave", "leave-pending", "leave-denied"])
      .order("date", { ascending: false });
    if (error) throw error;
    nurseLeaveRecords = data || [];
  } catch (err) {
    console.error("Leave fetch error:", err);
    nurseLeaveRecords = [];
  }

  renderLeaveRecords();
  renderLeaveBalance();
  setupLeaveForm();
}

function renderLeaveBalance() {
  const container = document.getElementById("nurseLeaveBalance");
  if (!container || !currentNurse) return;

  const now = new Date();
  const monthStr = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  const used = nurseLeaveRecords.filter(r => r.date && r.date.startsWith(monthStr) && r.status !== "leave-denied").length;
  const remaining = Math.max(0, CLINIC_CONFIG.maxLeavePerMonth - used);
  const pct = Math.round((used / CLINIC_CONFIG.maxLeavePerMonth) * 100);

  container.innerHTML = `
    <div class="flex items-center gap-4">
      <div class="nurse-leave-circle" style="--pct: ${pct}%">
        <div class="nurse-leave-circle-inner">${remaining}</div>
      </div>
      <div>
        <h4 class="text-sm font-black text-slate-800">${remaining} of ${CLINIC_CONFIG.maxLeavePerMonth} days remaining</h4>
        <p class="text-[11px] font-medium text-slate-500">${used} leave day${used !== 1 ? "s" : ""} used/pending this month</p>
      </div>
    </div>
  `;
}

function renderLeaveRecords() {
  const container = document.getElementById("nurseLeaveRecords");
  if (!container) return;

  if (nurseLeaveRecords.length === 0) {
    container.innerHTML = `<div class="text-center py-8"><div class="w-12 h-12 rounded-[18px] bg-pink-50 flex items-center justify-center mx-auto mb-3"><i data-lucide="calendar-off" class="w-6 h-6 text-pink-300"></i></div><p class="text-sm font-black text-slate-600">No leave records</p><p class="text-[11px] text-slate-400">Your filed leaves will appear here</p></div>`;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  container.innerHTML = nurseLeaveRecords.map((r, idx) => {
    const reason = (r.notes || "").replace("Leave: ", "").split(" | Attached")[0];
    const isPending = r.status === "leave-pending";
    const isDenied = r.status === "leave-denied";
    const statusLabel = isPending ? "Pending" : isDenied ? "Denied" : "Approved";
    const statusClass = isPending ? "bg-amber-50 text-amber-600" : isDenied ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600";
    return `
    <div class="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-100 nurse-att-card" style="animation: nurseFadeIn 0.3s ease ${idx * 40}ms both;">
      <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-pink-400 to-rose-500 flex items-center justify-center text-white text-[10px] font-black shadow-sm shrink-0">
        <i data-lucide="calendar-off" class="w-4 h-4"></i>
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-[12px] font-black text-slate-700">${r.date || "—"}</p>
        <p class="text-[10px] font-medium text-slate-400 truncate">${escapeHtml(reason || "No reason provided")}</p>
      </div>
      <span class="px-2.5 py-1 ${statusClass} rounded-full text-[9px] font-black uppercase tracking-widest shrink-0">${statusLabel}</span>
    </div>`;
  }).join("");

  if (window.lucide) window.lucide.createIcons();
}

function setupLeaveForm() {
  const form = document.getElementById("nurseLeaveForm");
  
  // Set min date restriction automatically so past dates are visually disabled
  const dateInput = document.getElementById("nurseLeaveDate");
  if (dateInput) {
      dateInput.min = getTodayStr();
  }

  // Bind character counter
  const reasonInput = document.getElementById("nurseLeaveReason");
  const charCounter = document.getElementById("reasonCharCount");
  if (reasonInput && charCounter) {
      reasonInput.addEventListener("input", () => {
          charCounter.textContent = reasonInput.value.length;
      });
  }

  if (!form || form._bound) return;
  form._bound = true;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentNurse) return;

    const leaveDate = document.getElementById("nurseLeaveDate")?.value;
    const leaveReason = document.getElementById("nurseLeaveReason")?.value?.trim() || "";
    const fileInput = document.getElementById("nurseLeaveFile");
    if (!leaveDate) {
      showNurseToast("Please select a valid leave date.", "error");
      return;
    }

    let fileInfo = "";
      let fileData = "";

      if (fileInput && fileInput.files && fileInput.files[0]) {
        const f = fileInput.files[0];
        const sizeMB = f.size / (1024 * 1024);
        if (sizeMB > 5) {
           showNurseToast("File is too large! Maximum allowed is 5MB.", "error");
           return;
        }

        // Read as DataURL if it's an image or small document
        const readFile = (file) => {
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
        };

        try {
          fileData = await readFile(f);
          fileInfo = ` | Attached Document: ${f.name} | DATA: ${fileData}`;
        } catch (e) {
          console.error("File read error:", e);
          fileInfo = ` | Attached Document: ${f.name}`;
        }
      }

    // Check balance
    const now = new Date(leaveDate);
    const monthStr = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    const used = nurseLeaveRecords.filter(r => r.date && r.date.startsWith(monthStr)).length;
    if (used >= CLINIC_CONFIG.maxLeavePerMonth) {
      showNurseToast(`You've used all ${CLINIC_CONFIG.maxLeavePerMonth} leave days this month!`, "error");
      return;
    }

    // Check duplicate
    const existing = nurseLeaveRecords.find(r => r.date === leaveDate);
    if (existing) {
      showNurseToast("You already have a leave record for this date.", "error");
      return;
    }

    try {
      const { error } = await sb.from("attendance").insert([{
        staff_name: currentNurse.name,
        staff_role: currentNurse.role || "Nurse",
        date: leaveDate,
        status: "leave-pending",
        notes: `Leave: ${leaveReason}${fileInfo}`
      }]);
      if (error) throw error;

      showNurseToast("Leave request submitted! Waiting for admin approval.", "success");
      form.reset();
      await loadLeaveManagement();
    } catch (err) {
      console.error("Leave submit error:", err);
      showNurseToast("Failed to submit leave: " + err.message, "error");
    }
  });
}

// =============================================
// APPOINTMENTS
// =============================================
async function loadAppointments() {
  try {
    const { data, error } = await sb
      .from("appointments")
      .select("*")
      .order("appointment_date", { ascending: false })
      .order("appointment_time", { ascending: false });
    if (error) throw error;
    nurseAppointments = data || [];
    if (nurseAppointments.length > 0) {
        console.log("Sample Appointment Data:", nurseAppointments[0]);
    }
  } catch (err) {
    console.error("Appointments fetch error:", err);
    nurseAppointments = [];
  }

  renderAppointments();
}

function renderAppointments() {
  const container = document.getElementById("nurseApptList");
  const countEl = document.getElementById("nurseApptCount");
  const searchEl = document.getElementById("nurseApptSearch");
  const dateEl = document.getElementById("nurseApptDateFilter");
  const statusEl = document.getElementById("nurseApptStatusFilter");
  const todayBtn = document.getElementById("nurseApptTodayBtn");
  const resetBtn = document.getElementById("nurseApptResetBtn");

  let filtered = nurseAppointments;
  const search = (searchEl?.value || "").toLowerCase();
  const dateVal = dateEl?.value || "";
  const statusVal = statusEl?.value || "all";

  if (search) {
    filtered = filtered.filter(a =>
      (a.patient_name || "").toLowerCase().includes(search) ||
      (a.doctor_name || "").toLowerCase().includes(search) ||
      (a.service || "").toLowerCase().includes(search) ||
      (a.condition || "").toLowerCase().includes(search)
    );
  }
  if (dateVal) {
    filtered = filtered.filter(a => a.appointment_date === dateVal);
  }
  if (statusVal !== "all") {
    filtered = filtered.filter(a => a.status === statusVal);
  }

  if (countEl) countEl.textContent = filtered.length;
  if (!container) return;

  // --- Reliability Score Pre-calculation ---
  const reliabilityMap = {};
  nurseAppointments.forEach(h => {
      const p = h.patient_name;
      if (!p) return;
      if (!reliabilityMap[p]) reliabilityMap[p] = { done: 0, noShow: 0 };
      if (h.status === 'done' || h.status === 'completed') reliabilityMap[p].done++;
      if (h.status === 'no_show') reliabilityMap[p].noShow++;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <tr>
        <td colspan="9" class="py-20 text-center">
          <div class="flex flex-col items-center justify-center">
            <i data-lucide="calendar-x" class="w-12 h-12 text-slate-200 mb-2"></i>
            <p class="text-xs font-black text-slate-400 uppercase tracking-widest">No matching appointments</p>
          </div>
        </td>
      </tr>`;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  container.innerHTML = filtered.map((a, idx) => {
    const statusColors = {
      pending: "text-amber-600 bg-amber-50 border-amber-100",
      scheduled: "text-blue-600 bg-blue-50 border-blue-100",
      accepted: "text-teal-600 bg-teal-50 border-teal-100",
      completed: "text-emerald-600 bg-emerald-50 border-emerald-100",
      done: "text-emerald-600 bg-emerald-50 border-emerald-100",
      cancelled: "text-red-500 bg-red-50 border-red-100",
      no_show: "text-rose-600 bg-rose-50 border-rose-100"
    };
    const statusKey = (a.status || "").toLowerCase();
    const sc = statusColors[statusKey] || "text-slate-500 bg-slate-50 border-slate-100";

    const rel = reliabilityMap[a.patient_name] || { done: 0, noShow: 0 };
    const total = rel.done + rel.noShow;
    const score = total > 0 ? (rel.done / total) * 100 : 100;
    const badgeColor = score >= 80 ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-500' : 'bg-rose-500';
    const badgeTitle = score >= 80 ? 'Trusted' : score >= 50 ? 'Occasional' : 'High Risk';
    
    const initials = (a.patient_name || "??").split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);

    const notes = a.patient_condition || "";
    const cleanDisplayNotes = notes.replace(/\[(PLAN|ReminderSent|Accomplished)(?:\s*\(.*?\))?:[\s\S]*?\]/gi, "").replace(/\[(BEFORE|AFTER)_JPG:.*?\]/gi, "").replace(/\[\d+[DMH]_REMINDER_SENT\]/gi, "").trim();
    const shortNotes = cleanDisplayNotes.length > 35 ? cleanDisplayNotes.slice(0, 32).trim() + "..." : cleanDisplayNotes;

    // Relative Time Logic
    let timeStatus = "";
    if (a.appointment_date === getTodayStr()) {
        try {
            const [h, m] = a.appointment_time.split(":").map(Number);
            const apptDate = new Date(); apptDate.setHours(h, m, 0, 0);
            const now = new Date();
            const diffMs = apptDate - now;
            const diffMin = Math.round(diffMs / 60000);
            
            if (diffMin > 0 && diffMin < 60) timeStatus = `<span class="text-[8px] text-amber-500 animate-pulse font-black ml-1">In ${diffMin}m</span>`;
            else if (diffMin >= 60 && diffMin < 300) timeStatus = `<span class="text-[8px] text-blue-500 font-black ml-1">In ${Math.floor(diffMin/60)}h</span>`;
            else if (diffMin <= 0 && diffMin > -60) timeStatus = `<span class="text-[8px] text-emerald-500 font-black ml-1">Ongoing</span>`;
        } catch(e) {}
    }

    return `
    <tr onclick="openNurseApptDetailModal('${a.id}')" class="group border-b border-slate-50 hover:bg-slate-50/50 transition-all duration-300 cursor-pointer" style="animation: nurseFadeIn 0.3s ease ${idx * 20}ms both;">
      <!-- Date -->
      <td class="px-3 py-3 whitespace-nowrap text-[11px] text-slate-600 font-bold">${a.appointment_date || "—"}</td>
      
      <!-- Time -->
      <td class="px-3 py-3 whitespace-nowrap">
        <div class="flex items-center">
            <div class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100/80 text-slate-700 text-[10px] font-black border border-slate-200/50">
              <i data-lucide="clock" class="w-3 h-3 text-slate-400"></i> ${formatAptTimeRange(a.appointment_time, a.duration_minutes || a.duration)}
            </div>
            ${timeStatus}
        </div>
      </td>

      <!-- Patient -->
      <td class="px-3 py-3 whitespace-nowrap min-w-[140px]">
        <div class="flex items-center gap-2">
          <div class="relative shrink-0 w-7 h-7 rounded-xl bg-gradient-to-tr from-teal-50 to-emerald-50 border border-teal-100/80 flex items-center justify-center shadow-inner group-hover:scale-105 transition-transform duration-300">
            <span class="text-[9px] font-black text-teal-600 tracking-tight">${initials}</span>
            <span class="absolute -bottom-0.5 -right-0.5 block h-2 w-2 rounded-full ring-1 ring-white ${badgeColor}" title="${badgeTitle} (Reliability: ${Math.round(score)}%)"></span>
          </div>
          <div class="flex flex-col min-w-0">
            <span class="text-[11px] font-black text-slate-800 tracking-tight group-hover:text-teal-600 transition-colors truncate">${escapeHtml(a.patient_name || "Unknown")}</span>
            <span class="text-[8px] font-bold text-slate-400 mt-0.5 uppercase tracking-tighter">Patient Profile</span>
          </div>
        </div>
      </td>

      <!-- Doctor -->
      <td class="px-3 py-3 whitespace-nowrap">
        <div class="flex items-center gap-1.5">
          <div class="w-5 h-5 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100/50">
            <i data-lucide="stethoscope" class="w-2.5 h-2.5"></i>
          </div>
          <span class="text-[10px] font-black text-slate-700">${escapeHtml(a.doctor_name || "Any Doctor")}</span>
        </div>
      </td>

      <!-- Type -->
      <td class="px-3 py-3 whitespace-nowrap">
        <span class="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-600 text-[9px] font-black uppercase tracking-widest border border-emerald-100/50 shadow-sm">${escapeHtml(a.service || a.condition || a.appointment_type || "Visit")}</span>
      </td>

      <!-- Contact -->
      <td class="px-3 py-3 whitespace-nowrap">
        <div class="flex flex-col gap-0.5">
          <div class="flex items-center gap-1 text-[9px] text-slate-600 font-bold">
            <i data-lucide="phone" class="w-2.5 h-2.5 text-slate-400"></i> ${escapeHtml(getPatientContact(a))}
          </div>
          <div class="flex items-center gap-1 text-[8px] text-slate-400 font-bold truncate max-w-[100px]">
            <i data-lucide="mail" class="w-2 h-2 text-slate-300"></i> ${escapeHtml(getPatientEmail(a))}
          </div>
        </div>
      </td>

      <!-- Status -->
      <td class="px-3 py-3 whitespace-nowrap">
        <span class="inline-flex px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border ${sc} shadow-sm">${escapeHtml(a.status || "—")}</span>
      </td>

      <!-- Notes -->
      <td class="px-3 py-3 text-[10px] font-semibold text-slate-500 max-w-[120px] truncate leading-relaxed" title="${escapeHtml(cleanDisplayNotes)}">
        ${escapeHtml(shortNotes || "—")}
      </td>

      <!-- Actions -->
      <td class="px-3 py-3 whitespace-nowrap text-right">
        <div class="flex items-center justify-end gap-1.5" onclick="event.stopPropagation()">
          ${statusKey === 'pending' ? `
            <button onclick="handleNurseApptAction('${a.id}', 'scheduled')" class="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-500 hover:text-white border border-emerald-200/50 flex items-center justify-center transition-all shadow-sm hover:shadow-md group/btn" title="Accept">
              <i data-lucide="check" class="w-3.5 h-3.5 group-hover/btn:scale-110 transition-transform"></i>
            </button>
            <button onclick="handleNurseApptAction('${a.id}', 'cancelled')" class="w-7 h-7 rounded-lg bg-red-50 text-red-600 hover:bg-red-500 hover:text-white border border-red-200/50 flex items-center justify-center transition-all shadow-sm hover:shadow-md group/btn" title="Decline">
              <i data-lucide="x" class="w-3.5 h-3.5 group-hover/btn:scale-110 transition-transform"></i>
            </button>
          ` : ''}
          
          ${statusKey === 'scheduled' || statusKey === 'accepted' ? `
            <button onclick="openNursePrecautionModal('${a.id}')" class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-br from-teal-500 to-emerald-600 text-white rounded-lg text-[9px] font-black uppercase tracking-widest shadow-md shadow-teal-500/20 hover:shadow-lg transition-all group/btn">
              <i data-lucide="check-circle" class="w-3 h-3 group-hover/btn:scale-110 transition-transform"></i> Done
            </button>
            <button onclick="handleNurseNoShow('${a.id}', '${escapeHtml(a.patient_name)}')" class="w-7 h-7 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-500 hover:text-white border border-rose-200/50 flex items-center justify-center transition-all shadow-sm group/btn" title="Mark No-Show">
              <i data-lucide="user-x" class="w-3.5 h-3.5 group-hover/btn:scale-110 transition-transform"></i>
            </button>
          ` : ''}

          ${statusKey === 'done' || statusKey === 'completed' ? `
            <button onclick="openNurseFollowupModal('${a.id}')" class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-blue-600 hover:text-white border border-blue-200/50 transition-all group/btn">
              <i data-lucide="calendar-plus" class="w-3 h-3 group-hover/btn:scale-110 transition-transform"></i> Follow Up
            </button>
          ` : ''}
          
          ${statusKey === 'no_show' ? `
            <button onclick="sendAutomatedChatRecapture('${escapeHtml(a.patient_name)}')" class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-600 rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-amber-600 hover:text-white border border-amber-200/50 transition-all group/btn">
              <i data-lucide="message-square" class="w-3 h-3"></i> Recapture
            </button>
          ` : ''}
        </div>
      </td>
    </tr>`;
  }).join("");

  if (window.lucide) window.lucide.createIcons({ root: container });

  // Attach filter handlers once
  if (searchEl && !searchEl._bound) {
    searchEl.addEventListener("input", () => renderAppointments());
    searchEl._bound = true;
  }
  if (dateEl && !dateEl._bound) {
    dateEl.addEventListener("change", () => renderAppointments());
    dateEl._bound = true;
  }
  if (statusEl && !statusEl._bound) {
    statusEl.addEventListener("change", () => renderAppointments());
    statusEl._bound = true;
  }
  if (todayBtn && !todayBtn._bound) {
    todayBtn.addEventListener("click", () => {
      if (dateEl) {
        dateEl.value = getTodayStr();
        renderAppointments();
      }
    });
    todayBtn._bound = true;
  }
  if (resetBtn && !resetBtn._bound) {
    resetBtn.addEventListener("click", () => {
      if (searchEl) searchEl.value = "";
      if (dateEl) dateEl.value = "";
      if (statusEl) statusEl.value = "all";
      renderAppointments();
    });
    resetBtn._bound = true;
  }
}

// --- Appointment Detail & History ---
window.currentDetailAppt = null;

window.openNurseApptDetailModal = async function(apptId) {
    console.log("Opening Nurse Appt Detail:", apptId);
    window.currentDetailAppt = nurseAppointments.find(a => String(a.id) === String(apptId));
    if (!window.currentDetailAppt) {
        console.error("Appointment not found in memory:", apptId);
        return;
    }

    const a = window.currentDetailAppt;
    const modal = document.getElementById("nurseApptDetailModal");
    if (!modal) return;

    // Show modal immediately with loading state for contact if needed
    document.getElementById("nurseDetailPhone").textContent = "Loading...";
    document.getElementById("nurseDetailEmail").textContent = "Loading...";

    // Try to get patient data from cache first
    let pMatch = null;
    if (a.patient_id) {
        pMatch = nursePatients.find(p => String(p.id) === String(a.patient_id));
    }
    if (!pMatch && a.patient_name) {
        const name = a.patient_name.trim().toLowerCase();
        pMatch = nursePatients.find(p => (p.full_name || "").trim().toLowerCase() === name);
    }

    // Fail-safe: Fetch from DB if not in cache
    if (!pMatch) {
        try {
            let query = sb.from("patients").select("*");
            if (a.patient_id) {
                query = query.eq("id", a.patient_id);
            } else if (a.patient_name) {
                query = query.eq("full_name", a.patient_name);
            }
            const { data, error } = await query.single();
            if (!error && data) pMatch = data;
        } catch (err) {
            console.error("Fail-safe patient fetch error:", err);
        }
    }

    // Populate Basic Info
    const patientNameEl = document.getElementById("nurseDetailPatientName");
    if (patientNameEl) patientNameEl.textContent = a.patient_name || "Unknown Patient";
    
    const initials = (a.patient_name || "??").split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
    const initialsEl = document.getElementById("nurseDetailInitials");
    if (initialsEl) initialsEl.textContent = initials;
    
    // Priority-based service/type display
    const type = a.service || a.condition || a.patient_condition || a.service_type || a.appointment_type || "General Visit";
    const typeEl = document.getElementById("nurseDetailApptType");
    if (typeEl) typeEl.textContent = type;
    
    const statusKey = (a.status || "").toLowerCase();
    const statusBadge = document.getElementById("nurseDetailStatusBadge");
    if (statusBadge) {
        statusBadge.textContent = a.status || "—";
        const statusColors = {
            pending: "bg-amber-50 text-amber-600 border-amber-100",
            scheduled: "bg-blue-50 text-blue-600 border-blue-100",
            accepted: "bg-teal-50 text-teal-600 border-teal-100",
            completed: "bg-emerald-50 text-emerald-600 border-emerald-100",
            done: "bg-emerald-50 text-emerald-600 border-emerald-100",
            cancelled: "bg-red-50 text-red-600 border-red-100",
            no_show: "bg-rose-50 text-rose-600 border-rose-100"
        };
        statusBadge.className = `px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest border ${statusColors[statusKey] || "bg-slate-100 text-slate-500 border-slate-200"}`;
    }

    // Populate Details
    const dateEl = document.getElementById("nurseDetailDate");
    if (dateEl) dateEl.textContent = a.appointment_date || "—";
    
    const timeEl = document.getElementById("nurseDetailTime");
    if (timeEl) timeEl.textContent = formatAptTimeRange(a.appointment_time, a.duration_minutes || a.duration);
    
    const docEl = document.getElementById("nurseDetailDoctor");
    if (docEl) docEl.textContent = a.doctor_name || "Any Doctor";
    
    // Contact Retrieval (using pMatch if found)
    const phoneEl = document.getElementById("nurseDetailPhone");
    const emailEl = document.getElementById("nurseDetailEmail");
    
    if (pMatch) {
        if (phoneEl) phoneEl.textContent = pMatch.contact_no || pMatch.phone || "No Contact";
        if (emailEl) emailEl.textContent = pMatch.email || "No Email";
    } else {
        // Fallback to direct appointment data
        if (phoneEl) phoneEl.textContent = a.patient_phone || a.phone || a.contact || a.mobile || "No Contact";
        if (emailEl) emailEl.textContent = a.patient_email || a.email || "No Email";
    }

    // Notes & Structured Info
    const rawNotes = a.patient_condition || "";
    
    // Parsers
    const planRegex = /\[PLAN(?:\s*\(.*?\))?:\s*([\s\S]*?)\]/i;
    const reminderRegex = /\[(?:CareReminder|ReminderSent)(?:\s*\(.*?\))?:\s*([\s\S]*?)\]/i;
    const accomplishedRegex = /\[accomplished:\s*([\s\S]*?)\]/gi;
    const imagesRegex = /\[(BEFORE|AFTER)_JPG:.*?\]/gi;

    const planMatch = rawNotes.match(planRegex);
    const reminderMatch = rawNotes.match(reminderRegex);
    
    // Extract ALL accomplished tags
    const accomplishedMatches = [];
    let match;
    const tempRegex = new RegExp(accomplishedRegex); // clone for exec
    while ((match = tempRegex.exec(rawNotes)) !== null) {
        accomplishedMatches.push(match[1].trim());
    }
    
    // Clean notes (remove structured blocks)
    let cleanNotes = rawNotes
        .replace(planRegex, "")
        .replace(reminderRegex, "")
        .replace(accomplishedRegex, "")
        .replace(imagesRegex, "")
        .replace(/\[\d+[DMH]_REMINDER_SENT\]/gi, "")
        .trim();

    // Populate Primary Service / Condition
    const notesEl = document.getElementById("nurseDetailNotes");
    // User requested to stop fetching from notes and use service/condition column instead
    const displayService = a.service || a.condition || a.patient_condition || a.service_type || "No specific clinical service recorded.";
    if (notesEl) notesEl.textContent = displayService;

    // Handle Accomplished Section
    const accomplishedWrap = document.getElementById("nurseDetailAccomplishedWrap");
    const accomplishedList = document.getElementById("nurseDetailAccomplishedList");
    if (accomplishedMatches.length > 0) {
        if (accomplishedList) {
            accomplishedList.innerHTML = accomplishedMatches.map(m => {
                // Handle "Name - Value" format or just "Value"
                const display = m.includes(" - ") ? m.split(" - ")[0].trim() : m;
                return `
                <div class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-indigo-100 text-indigo-700 shadow-sm animate-in zoom-in-95 duration-300">
                    <i data-lucide="check" class="w-3 h-3 text-indigo-500"></i>
                    <span class="text-[10px] font-black uppercase tracking-tight">${display}</span>
                </div>
                `;
            }).join("");
        }
        if (accomplishedWrap) accomplishedWrap.classList.remove("hidden");
    } else {
        if (accomplishedWrap) accomplishedWrap.classList.add("hidden");
    }

    // Handle Structured Section
    const structuredInfo = document.getElementById("nurseDetailStructuredInfo");
    const reminderWrap = document.getElementById("nurseDetailReminderWrap");
    const planWrap = document.getElementById("nurseDetailPlanWrap");
    
    let hasStructured = false;

    if (a.patient_reminder || (reminderMatch && reminderMatch[1])) {
        const reminderEl = document.getElementById("nurseDetailReminders");
        if (reminderEl) {
            reminderEl.textContent = a.patient_reminder || reminderMatch[1].trim();
        }
        if (reminderWrap) reminderWrap.classList.remove("hidden");
        hasStructured = true;
    } else {
        if (reminderWrap) reminderWrap.classList.add("hidden");
    }

    if (planMatch && planMatch[1]) {
        const planEl = document.getElementById("nurseDetailPlan");
        if (planEl) planEl.textContent = planMatch[1].trim();
        if (planWrap) planWrap.classList.remove("hidden");
        hasStructured = true;
    } else {
        if (planWrap) planWrap.classList.add("hidden");
    }

    if (hasStructured) {
        if (structuredInfo) structuredInfo.classList.remove("hidden");
    } else {
        if (structuredInfo) structuredInfo.classList.add("hidden");
    }

    // Actions
    const actionContainer = document.getElementById("nurseDetailActionContainer");
    if (actionContainer) {
        actionContainer.innerHTML = "";
        if (statusKey === 'pending') {
            actionContainer.innerHTML = `
                <button onclick="handleNurseApptAction('${a.id}', 'scheduled'); closeNurseApptDetailModal()" class="px-6 py-3 bg-emerald-500 text-white rounded-2xl text-[10px] font-black uppercase tracking-[2px] shadow-lg shadow-emerald-500/20 hover:scale-105 transition-all">Accept Appointment</button>
            `;
        } else if (statusKey === 'scheduled' || statusKey === 'accepted') {
            actionContainer.innerHTML = `
                <button onclick="openNursePrecautionModal('${a.id}'); closeNurseApptDetailModal()" class="px-6 py-3 bg-teal-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-[2px] shadow-lg shadow-teal-500/20 hover:scale-105 transition-all">Mark as Done</button>
            `;
        }
    }

    modal.classList.remove("hidden");
    if (window.lucide) window.lucide.createIcons({ root: modal });
};

window.closeNurseApptDetailModal = function() {
    const modal = document.getElementById("nurseApptDetailModal");
    if (modal) modal.classList.add("hidden");
    window.currentDetailAppt = null;
};

window.openNursePatientHistoryFromModal = function() {
    if (!window.currentDetailAppt) return;
    window.openNursePatientHistory(window.currentDetailAppt.patient_name);
};

window.openNursePatientHistory = async function(patientName) {
    const drawer = document.getElementById("nursePatientHistoryDrawer");
    const panel = document.getElementById("nurseHistoryPanel");
    const backdrop = document.getElementById("nurseHistoryBackdrop");
    const nameEl = document.getElementById("nurseHistoryPatientName");
    const timeline = document.getElementById("nurseHistoryTimeline");

    if (!drawer || !panel || !backdrop) return;

    nameEl.textContent = patientName;
    timeline.innerHTML = `<div class="py-12 flex flex-col items-center justify-center text-slate-400">
        <i data-lucide="loader-2" class="w-8 h-8 animate-spin mb-2"></i>
        <p class="text-[10px] font-black uppercase tracking-widest">Loading history...</p>
    </div>`;
    if (window.lucide) window.lucide.createIcons({ root: timeline });

    // Show drawer structure
    drawer.classList.remove("hidden");
    setTimeout(() => {
        panel.style.transform = "translateX(0)";
        backdrop.style.opacity = "1";
    }, 10);

    try {
        const { data, error } = await sb
            .from("appointments")
            .select("*")
            .eq("patient_name", patientName)
            .in("status", ["done", "completed", "no_show"])
            .order("appointment_date", { ascending: false });

        if (error) throw error;

        if (!data || data.length === 0) {
            timeline.innerHTML = `<div class="flex flex-col items-center justify-center py-20 text-slate-300 opacity-50">
                <i data-lucide="calendar-search" class="w-12 h-12 mb-2"></i>
                <p class="text-[10px] font-black uppercase tracking-widest">No previous history</p>
            </div>`;
        } else {
            timeline.innerHTML = data.map(h => {
                const statusColors = {
                    done: "bg-emerald-500",
                    completed: "bg-emerald-500",
                    no_show: "bg-rose-500"
                };
                const iconMap = {
                    done: "check-circle",
                    completed: "check-circle",
                    no_show: "user-x"
                };
                
                const notes = h.patient_condition || "";
                const cleanNotes = notes
                    .replace(/\[(PLAN|ReminderSent|Accomplished|CareReminder)(?:\s*\(.*?\))?:[\s\S]*?\]/gi, "")
                    .replace(/\[accomplished:\s*([\s\S]*?)\]/gi, "")
                    .replace(/\[(BEFORE|AFTER)_JPG:.*?\]/gi, "")
                    .trim();

                return `
                <div class="relative pl-10 animate-in slide-in-from-right-4 duration-500">
                    <div class="absolute left-0 top-1 w-9 h-9 rounded-xl ${statusColors[h.status.toLowerCase()] || "bg-slate-400"} flex items-center justify-center text-white shadow-lg shadow-inner z-10">
                        <i data-lucide="${iconMap[h.status.toLowerCase()] || "calendar"}" class="w-4.5 h-4.5"></i>
                    </div>
                    <div class="p-4 rounded-2xl bg-white border border-slate-100 shadow-sm hover:shadow-md transition-all">
                        <div class="flex items-center justify-between gap-2 mb-2">
                            <span class="text-[11px] font-black text-slate-800 shrink-0">${h.appointment_date}</span>
                            <span class="text-[9px] font-bold text-slate-400 uppercase tracking-widest truncate">${h.appointment_type || "Visit"}</span>
                        </div>
                        <p class="text-[10px] font-semibold text-slate-600 leading-relaxed italic break-words overflow-hidden">
                            ${cleanNotes || "No specific clinical notes for this visit."}
                        </p>
                        <div class="mt-3 pt-3 border-t border-slate-50 flex items-center justify-between">
                            <div class="flex items-center gap-1.5">
                                <i data-lucide="stethoscope" class="w-3 h-3 text-emerald-500"></i>
                                <span class="text-[9px] font-bold text-slate-400">${h.doctor_name || "Any Doctor"}</span>
                            </div>
                            <span class="px-1.5 py-0.5 rounded-md bg-slate-50 text-slate-400 text-[8px] font-black uppercase tracking-tighter">${h.status}</span>
                        </div>
                    </div>
                </div>
                `;
            }).join("");
        }
        if (window.lucide) window.lucide.createIcons({ root: timeline });
    } catch (err) {
        console.error("History fetch error:", err);
        timeline.innerHTML = `<p class="text-xs text-red-500 text-center py-10">Failed to load history</p>`;
    }
};

window.closeNursePatientHistory = function() {
    const drawer = document.getElementById("nursePatientHistoryDrawer");
    const panel = document.getElementById("nurseHistoryPanel");
    const backdrop = document.getElementById("nurseHistoryBackdrop");

    if (!drawer || !panel || !backdrop) return;

    panel.style.transform = "translateX(100%)";
    backdrop.style.opacity = "0";
    
    setTimeout(() => {
        drawer.classList.add("hidden");
    }, 500);
};

// ---- Appointment Actions Logic ----
window.handleNurseApptAction = async function(apptId, newStatus) {
  try {
    const { error } = await sb.from("appointments").update({ status: newStatus }).eq("id", apptId);
    if (error) throw error;
    
    showNurseToast(`Appointment successfully ${newStatus === 'scheduled' ? 'accepted' : newStatus}!`, "success");
    await loadAppointments(); // Refresh list
  } catch (err) {
    console.error("Action failed:", err);
    showNurseToast("Action failed: " + err.message, "error");
  }
};

// ---- Patient Reminder (Precaution) Modal logic ----
const nursePrecautionModal = document.getElementById("nursePrecautionModal");
const nursePrecautionForm = document.getElementById("nursePrecautionForm");

window.openNursePrecautionModal = function(apptId) {
  const appt = nurseAppointments.find(a => a.id == apptId);
  if (!appt || !nursePrecautionModal) return;

  document.getElementById("nursePrecautionApptId").value = apptId;
  document.getElementById("nursePrecautionPatientName").textContent = appt.patient_name || "Unknown Patient";
  document.getElementById("nursePrecautionTemplate").value = "";
  document.getElementById("nursePrecautionMessage").value = "";
  
  nursePrecautionModal.classList.remove("hidden");
};

// Template change logic
document.getElementById("nursePrecautionTemplate")?.addEventListener("change", (e) => {
  const templates = {
    post_braces: "Regular adjustments are key to your progress. Remember to avoid hard or sticky foods for the next 24 hours. If any wire feels sharp, use the provided dental wax.",
    post_extraction: "Please keep the gauze in place for 30-45 minutes. Avoid rinsing, spitting, or using a straw today. Rest with your head elevated and use an ice pack if swelling occurs.",
    hygiene_reminder: "Brushing after every meal and daily flossing is essential during orthodontic treatment. Use your interdental brushes for areas around the brackets.",
    surgery_care: "Stick to soft foods and cool liquids for the next 48 hours. Take prescribed medications as directed. Avoid strenuous activity and keep the surgical site clean."
  };
  const msgInput = document.getElementById("nursePrecautionMessage");
  if (msgInput) msgInput.value = templates[e.target.value] || "";
});

// Close buttons
[document.getElementById("closeNursePrecautionBtn"), document.getElementById("cancelNursePrecautionBtn")].forEach(btn => {
  btn?.addEventListener("click", () => nursePrecautionModal.classList.add("hidden"));
});

// Form Submission
nursePrecautionForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const apptId = document.getElementById("nursePrecautionApptId").value;
  const message = document.getElementById("nursePrecautionMessage").value.trim();
  const patientName = document.getElementById("nursePrecautionPatientName").textContent;

  if (!apptId || !message) return;

  const btn = nursePrecautionForm.querySelector('button[type="submit"]');
  const origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Processing...`;
  if (window.lucide) window.lucide.createIcons();

  try {
    // 1. Send notification to patient
    await sb.from("notifications").insert([{
      patient_name: patientName,
      title: "Care Instructions & Precautions",
      message: message,
      appt_id: apptId,
      is_read: false,
      created_at: new Date().toISOString()
    }]);

    // 2. Mark appointment as Done
    const appt = nurseAppointments.find(a => a.id == apptId);
    const newNotes = (appt?.patient_condition || "") + `\n[CareReminder: ${message}]`;
    const { error: apptErr } = await sb.from("appointments").update({ status: "done", patient_condition: newNotes }).eq("id", apptId);
    if (apptErr) throw apptErr;

    showNurseToast("Patient reminder sent and Marked as Done!", "success");
    nursePrecautionModal.classList.add("hidden");
    await loadAppointments();
  } catch (err) {
    console.error("Reminder error:", err);
    showNurseToast("Failed to process: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHtml;
    if (window.lucide) window.lucide.createIcons();
  }
});

// ---- Treatment Progression Data (Same as Admin) ----
const treatmentJourneys = {
  Braces: [
    { title: "Consultation", desc: "Initial checkup & clinical evaluation", keywords: ["consultation", "checkup", "evaluation"] },
    { title: "Diagnostics", desc: "X-ray, impressions & study models", keywords: ["diagnostic", "x-ray", "impression"] },
    { title: "Placement", desc: "Bonding of braces or appliances", keywords: ["placement", "bonding", "braces"] },
    { title: "Adjustments", desc: "Regular tightening & wire changes", keywords: ["adjustment", "tightening", "wire"] },
    { title: "Retention", desc: "Final alignment & retainer fitting", keywords: ["retention", "retainer", "completed"] }
  ],
  Extraction: [
    { title: "Pre-Op", desc: "Initial evaluation & anesthesia plan", keywords: ["pre-op", "evaluation", "preparation"] },
    { title: "Procedure", desc: "Tooth extraction or surgical care", keywords: ["extraction", "surgery", "procedure"] },
    { title: "Recovery", desc: "Post-operative monitoring", keywords: ["recovery", "monitoring"] },
    { title: "Follow-up", desc: "Stitch removal & healing check", keywords: ["follow-up", "healing", "stitch"] }
  ],
  Cleaning: [
    { title: "Examination", desc: "Oral health & cavity check", keywords: ["exam", "checkup", "examination"] },
    { title: "Scaling", desc: "Removal of plaque & tartar", keywords: ["scaling", "cleaning"] },
    { title: "Polishing", desc: "Teeth cleaning & stain removal", keywords: ["polishing", "stain"] },
    { title: "Fluoride", desc: "Protective coating application", keywords: ["fluoride", "coating"] }
  ],
  "Root Canal": [
    { title: "Consultation", desc: "Nerve vitality & X-ray check", keywords: ["consultation", "x-ray"] },
    { title: "Cleaning", desc: "Infected pulp removal & cleaning", keywords: ["pulp", "canal", "cleaning"] },
    { title: "Filling", desc: "Gutta-percha sealing of canals", keywords: ["filling", "sealing"] },
    { title: "Restoration", desc: "Final crown or composite build-up", keywords: ["crown", "restoration"] }
  ]
};

async function markNursePhaseAccomplished(patientName, kw, title) {
  try {
    const { data: latest } = await sb.from("appointments").select("id, patient_condition, created_at").eq("patient_name", patientName).order("created_at", { ascending: false }).limit(1);
    if (!latest || latest.length === 0) return;
    const appt = latest[0];
    const tag = `[accomplished: ${title.toLowerCase()} - ${kw.toLowerCase()}]`;
    if (appt.patient_condition && appt.patient_condition.includes(tag)) return;
    const newNotes = (appt.patient_condition || "") + " " + tag;
    await sb.from("appointments").update({ patient_condition: newNotes }).eq("id", appt.id);
    showNurseToast(`Phase "${title}" marked as accomplished.`, "success");
  } catch (err) {
    console.error("Error marking phase:", err);
  }
}

async function unmarkNursePhaseAccomplished(patientName, kw, title) {
  try {
    const { data: appts } = await sb.from("appointments").select("id, patient_condition").eq("patient_name", patientName).ilike("patient_condition", `%[accomplished: ${title.toLowerCase()} - ${kw.toLowerCase()}]%`);
    if (!appts || appts.length === 0) return;
    for (const appt of appts) {
      const tag = `[accomplished: ${title.toLowerCase()} - ${kw.toLowerCase()}]`;
      const cleaned = appt.patient_condition.replace(tag, "").trim();
      await sb.from("appointments").update({ patient_condition: cleaned }).eq("id", appt.id);
    }
    showNurseToast(`Phase "${title}" unmarked.`, "info");
  } catch (err) {
    console.error("Error unmarking phase:", err);
  }
}

window.openNurseFollowupModal = function(apptId) {
  const appt = nurseAppointments.find(a => a.id == apptId);
  if (!appt || !nurseFollowupModal) return;

  const patientName = appt.patient_name || "";
  document.getElementById("nurseFollowupPatientName").value = patientName;
  document.getElementById("nurseFollowupDoctorName").value = appt.doctor_name || currentNurse.name;
  document.getElementById("nurseFollowupDate").value = "";
  document.getElementById("nurseFollowupTime").value = "";
  document.getElementById("nurseFollowupNotes").value = "Follow-up visit regarding previous treatment.";
  
  // Detect active plan
  const phasesWrap = document.getElementById("nurseFollowupPhasesWrap");
  const phasesList = document.getElementById("nurseFollowupPhasesList");
  const planAssignWrap = document.getElementById("nurseFollowupPlanAssignWrap");
  const planSelect = document.getElementById("nurseFollowupPlanSelect");
  const changeBtn = document.getElementById("nurseChangePlanBtn");

  const patientAppts = nurseAppointments.filter(a => a.patient_name === patientName);
  let activePlanKey = null;
  const allNotes = patientAppts.map(a => (a.patient_condition || "") + " " + (a.appointment_type || "")).join(" ");
  
  Object.keys(treatmentJourneys).forEach(k => {
    if (allNotes.includes(`[PLAN:${k}]`)) activePlanKey = k;
  });

  if (activePlanKey) {
    phasesWrap.classList.remove("hidden");
    planAssignWrap.classList.add("hidden");
    planSelect.value = activePlanKey;
    
    phasesList.innerHTML = "";
    const phases = treatmentJourneys[activePlanKey];
    const notesLower = allNotes.toLowerCase();

    phases.forEach((p, i) => {
      const isDone = notesLower.includes(`[accomplished: ${p.title.toLowerCase()} - ${p.keywords[0].toLowerCase()}]`);
      const div = document.createElement("div");
      div.className = `flex items-center justify-between p-2 rounded-xl border ${isDone ? 'bg-emerald-50 border-emerald-100' : 'bg-white border-slate-100 shadow-sm'}`;
      div.innerHTML = `
        <div class="flex items-center gap-2">
           <div class="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black ${isDone ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400'}">
               ${isDone ? '<i data-lucide="check" class="w-3 h-3"></i>' : (i + 1)}
           </div>
           <span class="text-[10px] font-bold ${isDone ? 'text-emerald-700' : 'text-slate-600'}">${p.title}</span>
        </div>
        ${isDone ? `
           <button type="button" class="unmark-phase-btn px-2 py-1 text-[8px] font-black text-rose-500 uppercase tracking-tighter" data-kw="${p.keywords[0]}" data-title="${p.title}">Unmark</button>
        ` : `
           <button type="button" class="mark-phase-btn px-2 py-1 text-[8px] font-black text-teal-600 uppercase tracking-tighter" data-kw="${p.keywords[0]}" data-title="${p.title}">Mark Done</button>
        `}
      `;
      
      div.querySelector(".mark-phase-btn")?.addEventListener("click", async () => {
        await markNursePhaseAccomplished(patientName, p.keywords[0], p.title);
        await loadAppointments(); // Refresh data
        window.openNurseFollowupModal(apptId); // Re-render modal
      });
      div.querySelector(".unmark-phase-btn")?.addEventListener("click", async () => {
        await unmarkNursePhaseAccomplished(patientName, p.keywords[0], p.title);
        await loadAppointments();
        window.openNurseFollowupModal(apptId);
      });

      phasesList.appendChild(div);
    });

    if (changeBtn && !changeBtn._bound) {
      changeBtn.onclick = () => {
        phasesWrap.classList.add("hidden");
        planAssignWrap.classList.remove("hidden");
      };
      changeBtn._bound = true;
    }
  } else {
    phasesWrap.classList.add("hidden");
    planAssignWrap.classList.remove("hidden");
    planSelect.value = "";
  }

  nurseFollowupModal.classList.remove("hidden");
  if (window.lucide) window.lucide.createIcons();
};

// Close buttons
[document.getElementById("closeNurseFollowupModalBtn"), document.getElementById("cancelNurseFollowupBtn")].forEach(btn => {
  btn?.addEventListener("click", () => nurseFollowupModal.classList.add("hidden"));
});

// Form Submission
nurseFollowupForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("saveNurseFollowupBtn");
  const origHtml = btn.innerHTML;

  btn.disabled = true;
  btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Scheduling...`;
  if (window.lucide) window.lucide.createIcons();

  try {
    let finalNotes = document.getElementById("nurseFollowupNotes").value.trim();
    const planSelect = document.getElementById("nurseFollowupPlanSelect");
    if (planSelect && planSelect.value) {
      finalNotes += ` [PLAN:${planSelect.value}]`;
    }

    const payload = {
      patient_name: document.getElementById("nurseFollowupPatientName").value,
      doctor_name: document.getElementById("nurseFollowupDoctorName").value,
      appointment_date: document.getElementById("nurseFollowupDate").value,
      appointment_time: document.getElementById("nurseFollowupTime").value,
      patient_condition: finalNotes,
      status: "scheduled",
      appointment_type: "followups",
      duration_minutes: 30,
      created_at: new Date().toISOString()
    };

    const { error } = await sb.from("appointments").insert([payload]);
    if (error) throw error;

    showNurseToast("Follow-up appointment scheduled!", "success");
    nurseFollowupModal.classList.add("hidden");
    await loadAppointments();
  } catch (err) {
    console.error("Follow-up error:", err);
    showNurseToast("Scheduling failed: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHtml;
    if (window.lucide) window.lucide.createIcons();
  }
});

// =============================================
// SCHEDULE (Timetable view)
// =============================================
// =============================================
// CLINICAL TIMETABLE SCHEDULE
// =============================================
function initNurseSchedule() {
  const dateInput = document.getElementById("nurseScheduleDate");
  const docSelect = document.getElementById("nurseScheduleDoctor");
  const rangeSelect = document.getElementById("nurseScheduleRange");

  if (dateInput) {
    dateInput.value = getTodayStr();
    dateInput.addEventListener("change", loadSchedule);
    setupTodayButton("nurseScheduleDate");
  }
  if (docSelect) {
    docSelect.addEventListener("change", loadSchedule);
  }
  if (rangeSelect) {
    rangeSelect.addEventListener("change", loadSchedule);
  }
  
  loadSchedule();
}

function setupTodayButton(dateInputId) {
  const dateInput = document.getElementById(dateInputId);
  if (!dateInput) return;

  // Check if button already exists
  if (dateInput.nextElementSibling && dateInput.nextElementSibling.classList.contains('today-btn')) return;

  // Wrap the date input if it's not already wrapped in a flex container
  const wrapper = document.createElement("div");
  wrapper.className = "flex items-center gap-1.5 shrink-0";

  dateInput.parentNode.insertBefore(wrapper, dateInput);
  wrapper.appendChild(dateInput);

  const todayBtn = document.createElement("button");
  todayBtn.type = "button";
  todayBtn.className = "today-btn text-[9px] font-black text-indigo-600 bg-indigo-50 hover:bg-indigo-100 focus:ring-2 focus:ring-indigo-300 rounded-full px-2 py-1 transition-all border border-indigo-200 uppercase tracking-wide shrink-0 shadow-sm active:scale-95";
  todayBtn.textContent = "Today";

  todayBtn.addEventListener("click", () => {
    dateInput.value = getTodayStr();
    loadSchedule();
  });

  wrapper.appendChild(todayBtn);
}

async function fetchNursePatients() {
  try {
    const { data, error } = await sb.from("patients").select("*");
    if (!error) {
        nursePatients = data || [];
        console.log("fetchNursePatients success. Loaded:", nursePatients.length);
    } else {
        throw error;
    }
  } catch(e) {
    console.error("Error fetching patients:", e);
  }
}

async function fetchNurseStaffData() {
  try {
    const { data, error } = await sb.from("clinic_staff").select("*").order("name", { ascending: true });
    if (!error) allStaffData = data || [];
  } catch(e) {}
}

async function loadSchedule() {
  const dateInput = document.getElementById("nurseScheduleDate");
  const container = document.getElementById("nurseScheduleContainer");
  if (!container) return;

  const rangeInput = document.getElementById("nurseScheduleRange");
  const range = rangeInput ? rangeInput.value : "daily";
  const targetDate = dateInput.value || getTodayStr();

  container.innerHTML = `
        <div class="py-12 text-center text-sm text-slate-400 flex flex-col items-center">
            <i data-lucide="loader-2" class="w-8 h-8 text-indigo-500 mb-2 animate-spin"></i>
            <span class="font-medium animate-pulse">Syncing ${range} schedule...</span>
        </div>
    `;
  if (window.lucide) window.lucide.createIcons();

  let query = sb
    .from("appointments")
    .select("*")
    .order("appointment_date", { ascending: true })
    .order("appointment_time", { ascending: true });

  if (range === "daily") {
    query = query.eq("appointment_date", targetDate);
  } else if (range === "weekly") {
    const d = new Date(targetDate);
    const day = d.getDay();
    const diff = d.getDate() - day;
    const start = new Date(new Date(targetDate).setDate(diff)).toISOString().split('T')[0];
    const end = new Date(new Date(targetDate).setDate(diff + 6)).toISOString().split('T')[0];
    query = query.gte("appointment_date", start).lte("appointment_date", end);
  } else if (range === "monthly") {
    const parts = targetDate.split('-');
    const start = `${parts[0]}-${parts[1]}-01`;
    const lastDay = new Date(parts[0], parts[1], 0).getDate();
    const end = `${parts[0]}-${parts[1]}-${lastDay}`;
    query = query.gte("appointment_date", start).lte("appointment_date", end);
  } else if (range === "yearly") {
    const year = targetDate.split('-')[0];
    query = query.gte("appointment_date", `${year}-01-01`).lte("appointment_date", `${year}-12-31`);
  }

  const { data: appointments, error } = await query;

  if (error) {
    container.innerHTML = `<div class="py-6 text-center text-sm font-semibold text-red-500 bg-red-50 rounded-xl border border-red-100 flex items-center justify-center gap-2"><i data-lucide="alert-triangle" class="w-4 h-4"></i> Failed to sync timetable.</div>`;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  // Filter out inactive ones
  const activeAppts = (appointments || []).filter(a => !["declined", "cancelled", "no_show"].includes(a.status?.toLowerCase()));

  // Update metric cards
  updateNurseTimetableMetrics(activeAppts);

  // Adaptive Column Logic
  let columns = [];
  const grouped = {};

  if (range === "daily") {
    // Columns are Doctors
    if (allStaffData && allStaffData.length > 0) {
        allStaffData.forEach(staff => {
            if (staff.role === 'doctor' || staff.role === 'nurse') {
                columns.push({ id: staff.name, label: staff.name, sublabel: "Staff" });
                grouped[staff.name] = [];
            }
        });
    }
    if (columns.length === 0) {
        columns = [{ id: "Orthodontist", label: "Orthodontist", sublabel: "Staff" }];
        grouped["Orthodontist"] = [];
    }
    activeAppts.forEach(appt => {
        const key = appt.doctor_name || "Unassigned";
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(appt);
    });
  } else if (range === "weekly") {
    // Columns are Days
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    days.forEach((day, i) => {
        columns.push({ id: i, label: day, sublabel: "Weekly Day" });
        grouped[i] = [];
    });
    activeAppts.forEach(appt => {
        if (!appt.appointment_date) return;
        const day = new Date(appt.appointment_date).getDay();
        grouped[day].push(appt);
    });
  } else if (range === "monthly") {
    // Columns are Weeks
    for (let i = 1; i <= 5; i++) {
        columns.push({ id: i, label: `Week ${i}`, sublabel: "Monthly Week" });
        grouped[i] = [];
    }
    activeAppts.forEach(appt => {
        if (!appt.appointment_date) return;
        const date = new Date(appt.appointment_date).getDate();
        const week = Math.ceil(date / 7);
        const key = Math.min(week, 5);
        grouped[key].push(appt);
    });
  } else if (range === "yearly") {
    // Columns are Months
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    months.forEach((m, i) => {
        columns.push({ id: i, label: m, sublabel: "Yearly Month" });
        grouped[i] = [];
    });
    activeAppts.forEach(appt => {
        if (!appt.appointment_date) return;
        const month = new Date(appt.appointment_date).getMonth();
        grouped[month].push(appt);
    });
  }

  // Filter columns by doctor if selected
  const doctorSelect = document.getElementById("nurseScheduleDoctor");
  let targetDoctor = doctorSelect ? doctorSelect.value : "";
  
  // Update Doctor Select options if not daily
  if (doctorSelect && range !== 'daily') {
      let docNames = new Set(activeAppts.map(a => a.doctor_name).filter(Boolean));
      if (allStaffData) {
          allStaffData.forEach(s => { if(s.role==='doctor' || s.role==='nurse') docNames.add(s.name); });
      }
      let selectHtml = `<option value="">All Staff</option>`;
      Array.from(docNames).sort().forEach(dn => {
          selectHtml += `<option value="${dn}" ${targetDoctor === dn ? 'selected' : ''}>${escapeHtml(dn)}</option>`;
      });
      doctorSelect.innerHTML = selectHtml;
  }

  let filteredGrouped = {};
  Object.keys(grouped).forEach(k => {
      if (targetDoctor) {
          filteredGrouped[k] = grouped[k].filter(a => a.doctor_name === targetDoctor);
      } else {
          filteredGrouped[k] = grouped[k];
      }
  });

  let headerDateStr = "SCHEDULE";
  if (range === "daily") {
    const parts = targetDate.split('-');
    const dObj = new Date(parts[0], parseInt(parts[1]) - 1, parts[2]);
    headerDateStr = dObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
  } else if (range === "weekly") {
    headerDateStr = "WEEKLY MATRIX";
  } else if (range === "monthly") {
    headerDateStr = "MONTHLY MATRIX";
  } else if (range === "yearly") {
    headerDateStr = "YEARLY MATRIX";
  }

  const colorStyles = [
    { header: "from-blue-600 to-blue-500", accent: "bg-blue-500", border: 'border-l-[3px] border-l-blue-500', text: 'text-blue-600', bg: 'bg-blue-50', dot: 'bg-blue-500', fadeBg: 'bg-slate-50/50' },
    { header: "from-emerald-600 to-emerald-500", accent: "bg-emerald-500", border: 'border-l-[3px] border-l-emerald-500', text: 'text-emerald-600', bg: 'bg-emerald-50', dot: 'bg-emerald-500', fadeBg: 'bg-slate-50/50' },
    { header: "from-amber-600 to-amber-500", accent: "bg-amber-500", border: 'border-l-[3px] border-l-amber-500', text: 'text-amber-600', bg: 'bg-amber-50', dot: 'bg-amber-500', fadeBg: 'bg-slate-50/50' },
    { header: "from-violet-600 to-violet-500", accent: "bg-violet-500", border: 'border-l-[3px] border-l-violet-500', text: 'text-violet-600', bg: 'bg-violet-50', dot: 'bg-violet-500', fadeBg: 'bg-slate-50/50' },
    { header: "from-rose-600 to-rose-500", accent: "bg-rose-500", border: 'border-l-[3px] border-l-rose-500', text: 'text-rose-600', bg: 'bg-rose-50', dot: 'bg-rose-500', fadeBg: 'bg-slate-50/50' }
  ];

  const todayIso = getTodayStr();
  const isToday = targetDate === todayIso || !targetDate;

  // DYNAMIC HOURS CALCULATION
  let startHour = 8;
  let endHour = 18;

  activeAppts.forEach(appt => {
      if (appt.appointment_time) {
          const h = parseInt(appt.appointment_time.split(":")[0]);
          if (h < startHour) startHour = h;
          if (h > endHour) endHour = h;
      }
  });

  const hoursArray = [];
  for (let h = startHour; h <= endHour; h++) {
      hoursArray.push(h);
  }

  let html = `
    <div id="timetableExportCaptureContainer" class="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col">
        <!-- Header Bar -->
        <div class="bg-slate-900 text-white flex flex-col sm:flex-row justify-between items-center px-4 py-2">
            <div class="flex items-center gap-2">
                <div class="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center border border-white/10">
                    <i data-lucide="calendar-range" class="w-4 h-4 text-indigo-400"></i>
                </div>
                <div>
                    <h2 class="text-xs font-black tracking-wide">Clinical Schedule</h2>
                    <p class="text-[8px] text-slate-400 font-medium tracking-widest uppercase">${headerDateStr}</p>
                </div>
            </div>
            <div class="flex items-center gap-2 mt-2 sm:mt-0">
                ${isToday ? `<span class="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-[9px] font-bold uppercase tracking-widest border border-indigo-500/30 flex items-center gap-1"><span class="w-1 h-1 rounded-full bg-indigo-400"></span> Live</span>` : ''}
            </div>
        </div>
        
        <div class="w-full">
            <div class="w-full">
                <div class="w-full">
                    <!-- Columns Header -->
                    <div class="flex border-b border-slate-200 bg-slate-50">
                        <div class="w-[60px] shrink-0 border-r border-slate-200 flex items-center justify-center p-1.5">
                            <span class="text-[9px] font-black uppercase tracking-widest text-slate-400">Time</span>
                        </div>
                        ${columns.map((col, idx) => {
    const style = colorStyles[idx % colorStyles.length];
    const apptCount = filteredGrouped[col.id]?.length || 0;
    return `
                        <div class="flex-1 min-w-0 border-r border-slate-200 last:border-r-0">
                            <div class="bg-gradient-to-r ${style.header} text-white px-3 py-1.5 flex items-center gap-2">
                                <div class="w-6 h-6 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
                                    <i data-lucide="${range==='daily'?'user':'calendar'}" class="w-3.5 h-3.5"></i>
                                </div>
                                <div class="min-w-0 flex-1">
                                    <h3 class="font-bold text-[11px] leading-tight truncate">${escapeHtml(col.label)}</h3>
                                    <p class="text-[8px] text-white/70 font-medium">${apptCount} slot${apptCount !== 1 ? 's' : ''}</p>
                                </div>
                            </div>
                        </div>
                        `;
  }).join("")}
                    </div>

                    <!-- Hours Rows -->
                    ${hoursArray.map(h => {
    if (h === 12) {
      return `
                        <div class="flex bg-slate-50 border-b border-slate-200">
                            <div class="w-[60px] shrink-0 border-r border-slate-200 flex items-center justify-center p-1">
                                <span class="text-[9px] font-bold text-slate-300">12:00 PM</span>
                            </div>
                            <div class="flex-1 flex items-center justify-center gap-1.5 py-1.5">
                                <i data-lucide="coffee" class="w-3 h-3 text-slate-300"></i>
                                <span class="text-[9px] font-bold text-slate-300 tracking-widest uppercase">Break</span>
                            </div>
                        </div>
                        `;
    }

    let ampm = h >= 12 ? 'PM' : 'AM';
    let dHour = h % 12 || 12;
    const isEven = h % 2 === 0;

    return `
                    <div class="flex border-b border-slate-100 min-h-[60px] ${isEven ? 'bg-white' : 'bg-slate-50/20'}">
                        <div class="w-[60px] shrink-0 border-r border-slate-200 p-2 flex flex-col items-center justify-start pt-2">
                            <span class="text-[11px] font-black text-slate-600">${dHour}:00</span>
                            <span class="text-[8px] font-bold text-slate-400 uppercase">${ampm}</span>
                        </div>
                        ${columns.map((col, idx) => {
      const style = colorStyles[idx % colorStyles.length];
      let apptsNow = filteredGrouped[col.id].filter(a => {
        if (!a.appointment_time) return false;
        let hPart = parseInt(a.appointment_time.split(':')[0]);
        return hPart === h;
      });

      return `
                            <div class="flex-1 min-w-0 border-r border-slate-100 last:border-r-0 p-1 flex flex-col gap-1">
                                ${apptsNow.length === 0 ? '' : apptsNow.map(appt => {
        let isDone = appt.status?.toLowerCase() === 'done';
        let isPending = appt.status?.toLowerCase() === 'pending';
        let statusBg = isDone ? 'bg-emerald-50 text-emerald-600' : (isPending ? 'bg-amber-50 text-amber-600' : 'bg-indigo-50 text-indigo-600');
        let statusDot = isDone ? 'bg-emerald-500' : (isPending ? 'bg-amber-500' : 'bg-indigo-500');

        let docTag = "";
        if (range !== 'daily' && !targetDoctor) {
            docTag = `<span class="text-[7px] font-black bg-indigo-50 text-indigo-500 px-1 py-0.5 rounded ml-1 uppercase tracking-tighter">${escapeHtml(appt.doctor_name || 'Staff')}</span>`;
        }

        let dateTag = "";
        if (range === 'monthly' || range === 'yearly') {
          const d = new Date(appt.appointment_date);
          dateTag = `<span class="text-[7px] font-black bg-slate-100 text-slate-500 px-1 py-0.5 rounded ml-1 uppercase tracking-tighter">${d.toLocaleDateString('en-US', {month:'short', day:'numeric'})}</span>`;
        } else if (range === 'weekly') {
            const d = new Date(appt.appointment_date);
            dateTag = `<span class="text-[7px] font-black bg-slate-100 text-slate-500 px-1 py-0.5 rounded ml-1 uppercase tracking-tighter">${d.toLocaleDateString('en-US', {day:'numeric'})}</span>`;
        }

        function getApptIcon(notes) {
          let n = (notes || "").toLowerCase();
          if (n.includes("clean")) return "sparkles";
          if (n.includes("consult")) return "clipboard-list";
          return "activity";
        }
        let iconName = getApptIcon(appt.patient_condition);
        let timeStr = appt.appointment_time ? appt.appointment_time.substring(0, 5) : '';

        return `
                                    <div onclick="openNurseApptDetail('${appt.id}')" class="rounded-lg ${style.border} bg-white border border-slate-200 p-1.5 shadow-sm hover:shadow transition-all cursor-pointer group">
                                         <div class="flex gap-2 relative z-10">
                                             <div class="w-7 h-7 rounded-lg ${style.bg} shrink-0 flex items-center justify-center ${style.text}">
                                                 <i data-lucide="${iconName}" class="w-3.5 h-3.5"></i>
                                             </div>
                                             <div class="flex-1 min-w-0">
                                                 <div class="flex justify-between items-start">
                                                     <h4 class="font-bold text-slate-800 text-[10px] leading-tight truncate flex items-center gap-1 flex-wrap">${escapeHtml(appt.patient_name || 'Patient')} ${dateTag} ${docTag}</h4>
                                                 </div>
                                                 <p class="text-[9px] text-slate-400 leading-tight truncate mt-0.5">${escapeHtml(appt.patient_condition || 'Routine')}</p>
                                                 <div class="mt-1 flex items-center justify-between">
                                                     <span class="text-[8px] font-bold text-slate-400 flex items-center gap-0.5"><i data-lucide="clock" class="w-2.5 h-2.5"></i>${formatTime12h(appt.appointment_time)}</span>
                                                     <span class="inline-flex items-center gap-1 text-[8px] uppercase font-black px-1.5 py-0.5 rounded ${statusBg} border border-current/10"><span class="w-1 h-1 rounded-full ${statusDot}"></span>${appt.status}</span>
                                                 </div>
                                             </div>
                                         </div>
                                    </div>
                                    `;
      }).join("")}
                            </div>
                            `;
    }).join("")}
                    </div>
                    `;
  }).join("")}
            </div>
        </div>
    </div>
    `;
  container.innerHTML = html;
  if (window.lucide) window.lucide.createIcons();
}

function updateNurseTimetableMetrics(appointments) {
  const todayStr = getTodayStr();
  const todayCount = appointments.filter(a => a.appointment_date === todayStr).length;

  const now = new Date();
  const weekEnd = new Date(now);
  weekEnd.setDate(now.getDate() + 7);
  const weekCount = appointments.filter(a => {
    if (!a.appointment_date) return false;
    const d = new Date(a.appointment_date);
    return d >= now && d <= weekEnd;
  }).length;

  const docCount = new Set(appointments.map(a => a.doctor_name).filter(Boolean)).size;

  setEl("nurseTtMetricToday", todayCount);
  setEl("nurseTtMetricActive", weekCount);
  setEl("nurseTtMetricStaff", docCount);
}

// Global Export Function for Table
window.exportTimetablePDF = function (elementId = "timetableExportCaptureContainer") {
  const element = document.getElementById(elementId);
  if (!element) return;

  // Check if html2pdf is successfully loaded from CDN
  if (typeof html2pdf === "undefined") {
    showNurseToast("PDF library is still loading...", "info");
    return;
  }

  // Get exact dimensions of the timetable
  const clientWidth = element.scrollWidth;
  const clientHeight = element.scrollHeight;
  const padding = 20;

  const opt = {
    margin: padding,
    filename: `clinic-schedule-${getTodayStr()}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: {
      unit: 'px',
      format: [clientHeight + padding * 2, clientWidth + padding * 2],
      orientation: 'landscape'
    }
  };

  html2pdf().set(opt).from(element).save();
};

// =============================================
// TREATMENT PROGRESS
// =============================================
// =============================================
// TREATMENT PROGRESS (Advanced Interface)
// =============================================
let allProgressPatients = []; // Unified patient list derived from appointments

async function loadTreatmentProgress() {
  const patientList = document.getElementById("nurseProgressPatientList");
  if (!patientList) return;

  try {
    // 1. Fetch all appointments to derive progress data
    const { data: appts, error } = await sb
      .from("appointments")
      .select("*")
      .order("appointment_date", { ascending: false });

    if (error) throw error;
    const allAppts = appts || [];

    // 2. Identify unique patients and their plan status
    const patientMap = {};
    allAppts.forEach(a => {
      const pName = a.patient_name || "Unknown Patient";
      if (!patientMap[pName]) {
        patientMap[pName] = {
          name: pName,
          lastDate: a.appointment_date,
          activePlan: null,
          appointments: [],
          attendance: { done: 0, noShow: 0 }
        };
      }
      patientMap[pName].appointments.push(a);
      if (a.status === 'done') patientMap[pName].attendance.done++;
      if (a.status === 'no_show') patientMap[pName].attendance.noShow++;
      
      // Detect active plan tag [PLAN:Braces]
      if (a.patient_condition && a.patient_condition.includes("[PLAN:")) {
        const match = a.patient_condition.match(/\[PLAN:(.*?)\]/);
        if (match && !patientMap[pName].activePlan) patientMap[pName].activePlan = match[1];
      }
    });

    allProgressPatients = Object.values(patientMap).sort((a, b) => new Date(b.lastDate) - new Date(a.lastDate));
    
    // 3. Update Statistics
    updateTreatmentStats(allProgressPatients);

    // 4. Register Listeners (Once)
    if (!window._nurseProgressArmed) {
      document.getElementById("nurseSearchProgressPatient")?.addEventListener("input", filterProgressPatients);
      document.getElementById("nurseProgressFilterStatus")?.addEventListener("change", filterProgressPatients);
      document.getElementById("nurseRefreshProgressBtn")?.addEventListener("click", () => {
        const btn = document.getElementById("nurseRefreshProgressBtn");
        btn.classList.add("rotate-180");
        setTimeout(() => btn.classList.remove("rotate-180"), 500);
        loadTreatmentProgress();
      });
      
      // New Ported Listeners
      document.getElementById("nurseOpenPlanBuilderBtn")?.addEventListener("click", openNursePlanBuilder);
      document.getElementById("nurseAddPhaseInputBtn")?.addEventListener("click", addNursePlanPhase);
      document.getElementById("nurseSaveCustomPlanBtn")?.addEventListener("click", saveNurseCustomPlan);
      document.getElementById("nurseClosePlanBuilderBtn")?.addEventListener("click", () => document.getElementById("nursePlanBuilderModal").classList.add("hidden"));
      document.getElementById("nurseCancelPlanBuilderBtn")?.addEventListener("click", () => document.getElementById("nursePlanBuilderModal").classList.add("hidden"));
      document.getElementById("nurseAssignPlanBtn")?.addEventListener("click", saveNurseProgressPlan);
      document.getElementById("nurseSavePhotosBtn")?.addEventListener("click", saveNurseClinicalPhotos);
      document.getElementById("nurseChangePlanBtn")?.addEventListener("click", () => {
         selectedNursePlan = null;
         showPatientProgressDetail(activeProgressPatient.name, true);
      });

      document.getElementById("nurseBeforePhotoInput")?.addEventListener("change", (e) => handleNursePhotoUpload(e.target, "nurseBeforeImgTag", "nurseBeforeImgOverlay"));
      document.getElementById("nurseAfterPhotoInput")?.addEventListener("change", (e) => handleNursePhotoUpload(e.target, "nurseAfterImgTag", "nurseAfterImgOverlay"));

      window._nurseProgressArmed = true;
    }

    renderProgressPatientList(allProgressPatients);
    
    // Re-select active patient if any
    if (activeProgressPatient) {
      showPatientProgressDetail(activeProgressPatient.name);
    }

  } catch (err) {
    console.error("Progress Load Error:", err);
    if (patientList) patientList.innerHTML = `<p class="text-xs text-red-500 p-4">Error loading data: ${err.message}</p>`;
  }
}

function updateTreatmentStats(patients) {
  const total = patients.length;
  let activePlans = 0;
  let totalComp = 0;
  let patientsWithPlans = 0;
  const planUsedSet = new Set();

  patients.forEach(p => {
    if (p.activePlan) {
      activePlans++;
      planUsedSet.add(p.activePlan);
      const phases = treatmentJourneys[p.activePlan];
      if (phases) {
        const allText = p.appointments.map(a => `${a.patient_condition || ""} ${a.appointment_type}`).join(" ").toLowerCase();
        let done = 0;
        phases.forEach(ph => {
          if (allText.includes(`[accomplished: ${ph.title.toLowerCase()} - ${ph.keywords[0].toLowerCase()}]`)) done++;
        });
        totalComp += Math.round((done / phases.length) * 100);
        patientsWithPlans++;
      }
    }
  });

  setEl("nurseStatTotalPatients", total);
  setEl("nurseStatActivePlans", activePlans);
  setEl("nurseStatPlanTypes", planUsedSet.size || Object.keys(treatmentJourneys).length);
  setEl("nurseStatCompletionRate", patientsWithPlans > 0 ? Math.round(totalComp / patientsWithPlans) + "%" : "0%");
}

function filterProgressPatients() {
  const term = document.getElementById("nurseSearchProgressPatient")?.value.toLowerCase() || "";
  const status = document.getElementById("nurseProgressFilterStatus")?.value || "all";

  const filtered = allProgressPatients.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(term);
    const hasPlan = !!p.activePlan;
    
    if (status === "active") return matchesSearch && hasPlan;
    if (status === "unassigned") return matchesSearch && !hasPlan;
    // Note: 'completed' logic can be added later
    return matchesSearch;
  });

  renderProgressPatientList(filtered);
}

function renderProgressPatientList(patients) {
  const listEl = document.getElementById("nurseProgressPatientList");
  if (!listEl) return;
  if (patients.length === 0) {
    listEl.innerHTML = `<div class="p-8 text-center bg-slate-50 rounded-2xl border border-slate-100"><p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">No patients found</p></div>`;
    return;
  }
  listEl.innerHTML = patients.map(p => {
    const isActive = activeProgressPatient && activeProgressPatient.name === p.name;
    const initials = p.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
    
    // Reliability Badge Logic
    const att = p.attendance || { done: 0, noShow: 0 };
    const totalCount = att.done + att.noShow;
    const reliability = totalCount > 0 ? (att.done / totalCount) * 100 : 100;
    const badgeColor = reliability >= 80 ? 'bg-emerald-500' : reliability >= 50 ? 'bg-amber-500' : 'bg-rose-500';
    const badgeTitle = reliability >= 80 ? 'Trusted' : reliability >= 50 ? 'Occasional No-show' : 'High Risk';

    return `
      <div onclick="showPatientProgressDetail('${escapeHtml(p.name)}')" 
           class="group p-4 rounded-2xl border transition-all cursor-pointer ${isActive ? 'bg-gradient-to-r from-emerald-600 to-teal-600 border-emerald-500 shadow-lg text-white' : 'bg-white border-slate-100 hover:border-emerald-200 hover:shadow-sm'}">
        <div class="flex items-center gap-3">
          <div class="relative shrink-0">
            <div class="w-10 h-10 rounded-xl ${isActive ? 'bg-white/20' : 'bg-slate-100 text-slate-500'} flex items-center justify-center font-black text-[11px]">${initials}</div>
            <div class="absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 ${isActive ? 'border-emerald-600' : 'border-white'} ${badgeColor}" title="${badgeTitle} (Reliability: ${Math.round(reliability)}%)"></div>
          </div>
          <div class="flex-1 min-w-0">
             <h4 class="text-[13px] font-black truncate">${escapeHtml(p.name)}</h4>
             <p class="text-[10px] font-bold ${isActive ? 'text-white/60' : 'text-slate-400'} uppercase tracking-tight truncate">${p.activePlan || 'No Active Plan'}</p>
          </div>
          <i data-lucide="chevron-right" class="w-4 h-4 ${isActive ? 'text-white/60' : 'text-slate-300'} transition-all"></i>
        </div>
      </div>
    `;
  }).join("");
  if (window.lucide) window.lucide.createIcons({ root: listEl });
}

async function showPatientProgressDetail(patientName, forceChange = false) {
  const patient = allProgressPatients.find(p => p.name === patientName);
  if (!patient) return;
  activeProgressPatient = patient;

  // Refresh list to show selection state
  renderProgressPatientList(document.getElementById("nurseSearchProgressPatient")?.value ? 
    allProgressPatients.filter(p => p.name.toLowerCase().includes(document.getElementById("nurseSearchProgressPatient").value.toLowerCase())) 
    : allProgressPatients
  );

  const emptyState = document.getElementById("nurseEmptyProgressState");
  const activePanel = document.getElementById("nurseActiveProgressPanel");
  
  if (emptyState) emptyState.classList.add("hidden");
  if (activePanel) activePanel.classList.remove("hidden");

  setEl("nurseProgressActiveName", patient.name);
  const initials = patient.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
  setEl("nurseProgressActiveAvatar", initials);

  const curPlan = forceChange ? null : patient.activePlan;
  
  if (curPlan) {
    document.getElementById("nurseNoPlanDisplay")?.classList.add("hidden");
    document.getElementById("nurseActiveJourneyTracking")?.classList.remove("hidden");
    document.getElementById("nurseJourneyPreviewSection")?.classList.add("hidden");
    document.getElementById("nurseTreatmentActivityLog")?.classList.remove("hidden");
    document.getElementById("nurseAssignPlanBtn")?.classList.add("hidden");
    
    setEl("nurseProgressActivePlan", `
      <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> 
      Current: ${curPlan} Journey
    `);
    
    renderNurseTrackingPhases(patient);
    renderNurseActivityLog(patient);
  } else {
    document.getElementById("nurseNoPlanDisplay")?.classList.remove("hidden");
    document.getElementById("nurseActiveJourneyTracking")?.classList.add("hidden");
    document.getElementById("nurseJourneyPreviewSection")?.classList.remove("hidden");
    document.getElementById("nurseTreatmentActivityLog")?.classList.add("hidden");
    document.getElementById("nurseAssignPlanBtn")?.classList.remove("hidden");
    
    setEl("nurseProgressActivePlan", `<span class="w-1.5 h-1.5 rounded-full bg-slate-300"></span> Select Journey`);
    renderNursePlanSelection();
    updateNurseProgressRing(0);
  }

  loadNurseClinicalPhotos(patient.name);
  if (window.lucide) window.lucide.createIcons();
}

function renderNurseTrackingPhases(patient) {
  const container = document.getElementById("nurseTrackingPhasesList");
  if (!container || !patient.activePlan) return;

  const phases = treatmentJourneys[patient.activePlan] || [];
  const notes = patient.appointments.map(a => (a.patient_condition || "")).join(" ").toLowerCase();

  let doneCount = 0;
  phases.forEach(ph => {
    const tag = `[accomplished: ${ph.title.toLowerCase()} - ${ph.keywords[0].toLowerCase()}]`;
    if (notes.includes(tag)) doneCount++;
  });

  container.innerHTML = phases.map((ph, idx) => {
    const tag = `[accomplished: ${ph.title.toLowerCase()} - ${ph.keywords[0].toLowerCase()}]`;
    const isDone = notes.includes(tag);
    
    return `
      <div class="p-3.5 rounded-2xl border transition-all flex items-center justify-between ${isDone ? 'bg-emerald-50 border-emerald-100' : 'bg-white border-slate-100'}">
        <div class="flex items-center gap-3 overflow-hidden">
          <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isDone ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-50 text-slate-300'}">
            <i data-lucide="${isDone ? 'check-circle-2' : 'circle'}" class="w-4 h-4"></i>
          </div>
          <div class="min-w-0">
            <p class="text-[12px] font-black ${isDone ? 'text-slate-800' : 'text-slate-500'} tracking-tight truncate">${ph.title}</p>
            <p class="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5 truncate">${ph.desc || ph.keywords[0]}</p>
          </div>
        </div>
        <div>
          ${isDone ? `
            <button onclick="handleNursePhaseToggle('${patient.name}', '${ph.keywords[0]}', '${ph.title}', false)" class="px-3 py-1 text-[9px] font-black text-rose-500 uppercase tracking-widest hover:bg-rose-50 rounded-lg transition-all">Undo</button>
          ` : `
            <button onclick="handleNursePhaseToggle('${patient.name}', '${ph.keywords[0]}', '${ph.title}', true)" class="px-3 py-1 text-[9px] font-black text-teal-600 uppercase tracking-widest hover:bg-teal-50 rounded-lg transition-all">Done</button>
          `}
        </div>
      </div>
    `;
  }).join("");

  const pct = Math.round((doneCount / phases.length) * 100);
  updateNurseProgressRing(pct);
  setEl("nurseProgressPhasesInfo", `${doneCount}/${phases.length} Phases`);

  if (window.lucide) window.lucide.createIcons();
}

window.handleNursePhaseToggle = async function(patientName, kw, title, shouldMark) {
  if (shouldMark) {
    await markNursePhaseAccomplished(patientName, kw, title);
  } else {
    await unmarkNursePhaseAccomplished(patientName, kw, title);
  }
  // Refresh data and UI
  await loadTreatmentProgress();
  showPatientProgressDetail(patientName);
};

function updateNurseProgressRing(percent) {
  const circle = document.getElementById("nurseMiniProgressRingCircle");
  if (!circle) return;
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  circle.style.strokeDashoffset = offset;
  setEl("nurseMiniProgressPercent", percent + "%");
}

function renderNurseActivityLog(patient) {
  const container = document.getElementById("nurseActivityLogList");
  if (!container) return;
  
  const history = patient.appointments
    .filter(a => a.status === "done" || (a.patient_condition || "").includes("[PLAN:"))
    .sort((a,b) => new Date(b.appointment_date) - new Date(a.appointment_date));
  
  container.innerHTML = history.map(a => `
    <div class="p-4 rounded-2xl bg-slate-50 border border-slate-100 transition-all flex items-center justify-between group">
       <div class="flex items-center gap-3 text-left">
          <div class="w-9 h-9 rounded-xl bg-white border border-slate-100 flex items-center justify-center text-slate-400 group-hover:text-teal-500 transition-colors">
             <i data-lucide="calendar" class="w-4.5 h-4.5"></i>
          </div>
          <div class="min-w-0">
             <p class="text-xs font-black text-slate-800 truncate">${escapeHtml(a.appointment_type || "Session")}</p>
             <p class="text-[10px] font-medium text-slate-400">${new Date(a.appointment_date).toLocaleDateString()}</p>
          </div>
       </div>
       <div class="text-right shrink-0">
          <p class="text-[10px] font-black text-emerald-500 uppercase">${a.status || 'Done'}</p>
          <p class="text-[9px] font-bold text-slate-400">${escapeHtml(a.doctor_name || 'Dr. Clinic')}</p>
       </div>
    </div>
  `).join("") || `<p class="text-[10px] text-slate-400 text-center py-8">No history recorded</p>`;
  if (window.lucide) window.lucide.createIcons({ root: container });
}

// =============================================
// NEW PORTED LOGIC (MIRRORED FROM ADMIN)
// =============================================
let selectedNursePlan = null;
let nurseCustomPhases = [];

function renderNursePlanSelection() {
  const container = document.getElementById("nursePlanSelectionSection");
  if (!container) return;
  
  const plans = Object.keys(treatmentJourneys);
  container.innerHTML = plans.map(p => `
    <button onclick="setNurseSelectedPlan('${p}')" class="p-4 rounded-2xl border text-left transition-all hover:scale-[1.02] ${selectedNursePlan === p ? 'bg-emerald-50 border-emerald-500 ring-2 ring-emerald-500/20' : 'bg-white border-slate-100 hover:border-emerald-200'}">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-lg ${selectedNursePlan === p ? 'bg-emerald-500 text-white' : 'bg-slate-50 text-slate-400'} flex items-center justify-center"><i data-lucide="clipboard-list" class="w-4 h-4"></i></div>
        <div>
          <p class="text-xs font-black text-slate-800">${p}</p>
          <p class="text-[9px] font-bold text-slate-400 uppercase tracking-widest">${treatmentJourneys[p].length} Phases</p>
        </div>
      </div>
    </button>
  `).join("");
  
  if (window.lucide) window.lucide.createIcons({ root: container });
  renderNurseJourneyPreview();
}

window.setNurseSelectedPlan = function(p) {
  selectedNursePlan = p;
  renderNursePlanSelection();
  const assignBtn = document.getElementById("nurseAssignPlanBtn");
  if (assignBtn) assignBtn.disabled = false;
};

function renderNurseJourneyPreview() {
  const preview = document.getElementById("nurseJourneyPhasePreview");
  if (!preview) return;
  if (!selectedNursePlan) {
    preview.innerHTML = `<p class="text-[11px] text-slate-400 text-center font-bold uppercase py-4">Select a plan above to preview</p>`;
    return;
  }
  const phases = treatmentJourneys[selectedNursePlan];
  preview.innerHTML = phases.map((ph, idx) => `
    <div class="flex gap-4 items-start group">
      <div class="flex flex-col items-center">
        <div class="w-6 h-6 rounded-full bg-emerald-100 text-emerald-600 text-[10px] font-black flex items-center justify-center">${idx + 1}</div>
        ${idx < phases.length - 1 ? '<div class="w-px h-6 bg-slate-100 my-1"></div>' : ''}
      </div>
      <div>
        <p class="text-[11px] font-black text-slate-700">${ph.title}</p>
        <p class="text-[9px] font-medium text-slate-400">${ph.desc}</p>
      </div>
    </div>
  `).join("");
}

async function saveNurseProgressPlan() {
  if (!activeProgressPatient || !selectedNursePlan) return;
  const btn = document.getElementById("nurseAssignPlanBtn");
  if (!btn) return;
  btn.disabled = true;
  const origText = btn.innerHTML;
  btn.innerHTML = `<i data-lucide="refresh-cw" class="w-3.5 h-3.5 animate-spin"></i> Assigning...`;
  
  try {
    const targetAppt = activeProgressPatient.appointments[0];
    if (!targetAppt) throw new Error("No appointment found");
    
    let notesVal = targetAppt.patient_condition || "";
    notesVal = notesVal.replace(/\[PLAN:.*?\]/g, "").trim();
    notesVal += ` [PLAN:${selectedNursePlan}]`;
    
    const { error } = await sb.from("appointments").update({ patient_condition: notesVal }).eq("id", targetAppt.id);
    if (error) throw error;
    
    await loadTreatmentProgress();
    showPatientProgressDetail(activeProgressPatient.name);
    
  } catch (err) {
    console.error("Save Plan Error:", err);
    alert("Failed to assign plan.");
  } finally {
    btn.disabled = false;
    btn.innerHTML = origText;
    if (window.lucide) window.lucide.createIcons();
  }
}

async function loadNurseClinicalPhotos(patientName) {
  const patient = allProgressPatients.find(p => p.name === patientName);
  if (!patient) return;
  const beforeImg = document.getElementById("nurseBeforeImgTag");
  const afterImg = document.getElementById("nurseAfterImgTag");
  if (!beforeImg || !afterImg) return;
  
  beforeImg.src = ""; beforeImg.classList.add("hidden");
  afterImg.src = ""; afterImg.classList.add("hidden");
  
  const photoAppt = patient.appointments.find(a => (a.patient_condition || "").includes("[BEFORE_JPG:") || (a.patient_condition || "").includes("[AFTER_JPG:"));
  if (photoAppt) {
    const beforeMatch = photoAppt.patient_condition.match(/\[BEFORE_JPG:(.*?)\]/);
    const afterMatch = photoAppt.patient_condition.match(/\[AFTER_JPG:(.*?)\]/);
    if (beforeMatch) { beforeImg.src = beforeMatch[1]; beforeImg.classList.remove("hidden"); }
    if (afterMatch) { afterImg.src = afterMatch[1]; afterImg.classList.remove("hidden"); }
  }
}

async function handleNursePhotoUpload(input, imgId, overlayId) {
  const file = input.files[0];
  if (!file) return;
  const overlay = document.getElementById(overlayId);
  overlay?.classList.remove("hidden");
  
  // Use existing compressImage function from global scope
  if (typeof compressImage === 'function') {
    compressImage(file, (base64) => {
      const img = document.getElementById(imgId);
      if (img) {
         img.src = base64; 
         img.classList.remove("hidden");
      }
      overlay?.classList.add("hidden");
    });
  } else {
    // Fallback if compressImage is not available (though it should be in index.js/nurse.js)
    const reader = new FileReader();
    reader.onload = (e) => {
       const img = document.getElementById(imgId);
       if (img) {
          img.src = e.target.result;
          img.classList.remove("hidden");
       }
       overlay?.classList.add("hidden");
    };
    reader.readAsDataURL(file);
  }
}

async function saveNurseClinicalPhotos() {
  if (!activeProgressPatient) return;
  const btn = document.getElementById("nurseSavePhotosBtn");
  const msg = document.getElementById("nurseSavePhotosMsg");
  if (!btn) return;
  btn.disabled = true;
  const origText = btn.innerText;
  btn.innerText = "Saving...";
  
  try {
    const before = document.getElementById("nurseBeforeImgTag")?.src || "";
    const after = document.getElementById("nurseAfterImgTag")?.src || "";
    const targetAppt = activeProgressPatient.appointments[0];
    if (!targetAppt) throw new Error("No primary appointment to save data to");

    let notesVal = (targetAppt.patient_condition || "").replace(/\[BEFORE_JPG:.*?\]/g, "").replace(/\[AFTER_JPG:.*?\]/g, "").trim();
    
    if (before.startsWith("data:image")) notesVal += ` [BEFORE_JPG:${before}]`;
    if (after.startsWith("data:image")) notesVal += ` [AFTER_JPG:${after}]`;
    
    const { error } = await sb.from("appointments").update({ patient_condition: notesVal }).eq("id", targetAppt.id);
    if (error) throw error;

    msg?.classList.remove("hidden");
    setTimeout(() => msg?.classList.add("hidden"), 3000);
  } catch (err) {
    console.error("Save Photos Error:", err);
    alert("Failed to save media: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerText = origText;
    if (window.lucide) window.lucide.createIcons();
  }
}

function openNursePlanBuilder() {
  const modal = document.getElementById("nursePlanBuilderModal");
  if (!modal) return;
  modal.classList.remove("hidden");
  nurseCustomPhases = [];
  renderNurseCustomPhaseInputs();
}

function addNursePlanPhase() {
  nurseCustomPhases.push({ title: "", desc: "", keywords: [""] });
  renderNurseCustomPhaseInputs();
}

function renderNurseCustomPhaseInputs() {
  const container = document.getElementById("nurseCustomPhasesContainer");
  if (!container) return;
  container.innerHTML = nurseCustomPhases.map((ph, i) => `
    <div class="p-5 rounded-[24px] bg-slate-50 border border-slate-100 space-y-3">
      <div class="flex items-center justify-between">
        <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Phase #${i+1}</p>
        <button onclick="removeNursePlanPhase(${i})" class="text-rose-500"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
      </div>
      <input type="text" placeholder="Phase Title" oninput="updateNursePhaseVal(${i}, 'title', this.value)" value="${ph.title}" class="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-xs font-bold" />
      <input type="text" placeholder="Phase Description" oninput="updateNursePhaseVal(${i}, 'desc', this.value)" value="${ph.desc}" class="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-xs font-medium" />
      <input type="text" placeholder="Keyword (comma separated)" oninput="updateNursePhaseVal(${i}, 'keywords', this.value.split(','))" value="${ph.keywords.join(',')}" class="w-full bg-white border border-slate-200 rounded-xl px-4 py-1.5 text-[10px] font-bold" />
    </div>
  `).join("") || `<p class="text-center text-[10px] text-slate-400 py-4 italic">No phases added yet. Click 'Add Step' to begin.</p>`;
  if (window.lucide) window.lucide.createIcons({ root: container });
}

window.removeNursePlanPhase = function(i) {
  nurseCustomPhases.splice(i, 1);
  renderNurseCustomPhaseInputs();
};

window.updateNursePhaseVal = function(i, field, val) {
  nurseCustomPhases[i][field] = val;
};

async function saveNurseCustomPlan() {
  const name = document.getElementById("nurseCustomPlanName")?.value;
  if (!name || nurseCustomPhases.length === 0) { alert("Please enter name and phases"); return; }
  
  treatmentJourneys[name] = nurseCustomPhases.map(ph => ({
    title: ph.title,
    desc: ph.desc,
    keywords: Array.isArray(ph.keywords) ? ph.keywords.map(k => k.trim()) : [ph.keywords.trim()]
  }));
  
  document.getElementById("nursePlanBuilderModal").classList.add("hidden");
  renderNursePlanSelection();
}


// =============================================
// CLINICAL PHOTOS (Before & After)
// =============================================
function handleNursePhotoUpload(input, imgId, overlayId) {
  const file = input.files[0];
  if (!file) return;

  const overlay = document.getElementById(overlayId);
  if (overlay) overlay.classList.remove("hidden");

  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      // Professional Compression (500px max width, 0.6 quality)
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const maxWidth = 500;
      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = (maxWidth / width) * height;
        width = maxWidth;
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      const compressedBase64 = canvas.toDataURL("image/jpeg", 0.6);
      const imgTag = document.getElementById(imgId);
      if (imgTag) {
        imgTag.src = compressedBase64;
        imgTag.classList.remove("hidden");
      }
      if (overlay) overlay.classList.add("hidden");
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function saveNurseClinicalPhotos() {
  if (!activeProgressPatient) return;
  const btn = document.getElementById("nurseSavePhotosBtn");
  const msg = document.getElementById("nurseSavePhotosMsg");
  if (!btn) return;

  const originalBtnText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i data-lucide="refresh-cw" class="w-3.5 h-3.5 animate-spin"></i> Finalizing...`;

  const beforeSrc = document.getElementById("nurseBeforeImgTag")?.src || "";
  const afterSrc = document.getElementById("nurseAfterImgTag")?.src || "";

  // Target the latest appointment or the one with the PLAN tag
  let targetAppt = activeProgressPatient.appointments.find(a => (a.patient_condition || "").includes("[PLAN:"));
  if (!targetAppt && activeProgressPatient.appointments.length > 0) targetAppt = activeProgressPatient.appointments[0];

  if (!targetAppt) {
    showNurseToast("No appointment found to attach media.", "error");
    btn.disabled = false;
    btn.innerHTML = originalBtnText;
    return;
  }

  try {
    let notesVal = targetAppt.patient_condition || "";
    // Clear legacy tags
    notesVal = notesVal.replace(/\[BEFORE_JPG:.*?\]/g, "").replace(/\[AFTER_JPG:.*?\]/g, "").trim();

    if (beforeSrc.startsWith("data:image")) notesVal += ` [BEFORE_JPG:${beforeSrc}]`;
    if (afterSrc.startsWith("data:image")) notesVal += ` [AFTER_JPG:${afterSrc}]`;

    const { error } = await sb.from("appointments").update({ patient_condition: notesVal }).eq("id", targetAppt.id);
    if (error) throw error;

    showNurseToast("Case media saved successfully!", "success");
    if (msg) {
      msg.classList.remove("hidden");
      setTimeout(() => msg.classList.add("hidden"), 3000);
    }
    
    // Refresh local data
    await loadTreatmentProgress();

  } catch (err) {
    console.error("Clinical Photo Save Error:", err);
    showNurseToast("Failed to save media records.", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalBtnText;
    if (window.lucide) window.lucide.createIcons();
  }
}

function loadNurseClinicalPhotos(patientName) {
  const patient = allProgressPatients.find(p => p.name === patientName);
  if (!patient) return;

  const beforeImg = document.getElementById("nurseBeforeImgTag");
  const afterImg = document.getElementById("nurseAfterImgTag");

  // Reset previews
  if (beforeImg) { beforeImg.src = ""; beforeImg.classList.add("hidden"); }
  if (afterImg) { afterImg.src = ""; afterImg.classList.add("hidden"); }

  // Search all appointment notes for photo tags
  const combinedNotes = patient.appointments.map(a => a.patient_condition || "").join(" ");

  const beforeMatch = combinedNotes.match(/\[BEFORE_JPG:(.*?)\]/);
  if (beforeMatch && beforeImg) {
    beforeImg.src = beforeMatch[1];
    beforeImg.classList.remove("hidden");
  }

  const afterMatch = combinedNotes.match(/\[AFTER_JPG:(.*?)\]/);
  if (afterMatch && afterImg) {
    afterImg.src = afterMatch[1];
    afterImg.classList.remove("hidden");
  }
}


// =============================================
// MESSAGES (Filtered by assigned patients)
// =============================================
async function loadNurseConversations(filter = "") {
  if (!window._nurseOptionsBound) {
    document.addEventListener("click", (e) => {
      if (!e.target.closest('.nurse-card-options-btn')) {
        document.querySelectorAll('.nurse-card-options-menu').forEach(m => m.classList.add('hidden'));
      }
    });
    window._nurseOptionsBound = true;
  }
  const convList = document.getElementById("nurseConversationList");
  if (!convList) return;

  const highlightText = (text, query) => {
    if (!query || typeof text !== 'string') return text;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, "gi");
    return text.replace(regex, '<span class="bg-rose-200/60 text-rose-900 rounded-sm px-0.5 shadow-sm">$1</span>');
  };

  // Fetch messages AND states from Supabase
  const [messagesRes, statesRes] = await Promise.all([
    sb.from('messages').select('session_id, sender_fullname, sender_avatar_base64, content, created_at, sender_type').order('created_at', { ascending: false }),
    sb.from('admin_chat_states').select('*')
  ]);

  const rawMessages = messagesRes.data;
  const states = statesRes.data;

  const sessionClaimMap = {}; // sid -> staffEmail

  // Sync Global Sets with DB
  if (states) {
    nursePrioritySessions.clear();
    nurseMutedSessions.clear();
    nurseArchivedSessions.clear();
    nurseBlockedSessions.clear();
    nurseDeletedSessions.clear();
    states.forEach(s => {
      if (s.is_priority) nursePrioritySessions.add(s.session_id);
      if (s.is_muted) nurseMutedSessions.add(s.session_id);
      if (s.is_archived) nurseArchivedSessions.add(s.session_id);
      if (s.is_blocked) nurseBlockedSessions.add(s.session_id);
      if (s.is_deleted) nurseDeletedSessions.add(s.session_id);
      if (s.claimed_by) sessionClaimMap[s.session_id] = s.claimed_by;
    });
  }

  // Group by session
  const sessionMap = {};
  if (rawMessages) {
    rawMessages.forEach(m => {
      const sid = m.session_id;
      if (!sid) return;
      if (!sessionMap[sid]) {
        sessionMap[sid] = {
            id: sid,
            messages: [],
            last_message: m.content,
            created_at: m.created_at,
            sender_fullname: m.sender_fullname,
            sender_avatar_base64: m.sender_avatar_base64
        };
      }
      sessionMap[sid].messages.push(m);
    });
  }

  const sessions = [];
  Object.values(sessionMap).forEach(s => {
    const patientMsg = s.messages.find(msg => msg.sender_type !== 'staff' && msg.sender_fullname !== 'OrthoConnect Clinic');
    const patientName = patientMsg ? patientMsg.sender_fullname : s.sender_fullname;
    if (patientName === 'OrthoConnect Clinic') return;
    
    s.sender_fullname = patientName;
    const claimantEmail = sessionClaimMap[s.id];
    s.claimed_by = claimantEmail;
    s.is_unclaimed = !claimantEmail;
    
    const myEmail = (currentNurse ? currentNurse.email : "").toLowerCase().trim();
    const claimEmail = (claimantEmail || "").toLowerCase().trim();
    s.is_claimed_by_me = (claimEmail === myEmail && myEmail !== "");
    
    sessions.push(s);
  });

  allNurseSessions = sessions;

  // Filter and Sort
  const displaySessions = sessions.filter(s => {
    if (nurseDeletedSessions.has(s.id)) return false;
    if (nurseBlockedSessions.has(s.id)) return false;
    if (nurseArchivedSessions.has(s.id)) return false;
    
    // EXCLUSIVITY: Removed so all staff can see and respond
    // Greeting logic still works on tap for first response
    
    if (filter && !s.sender_fullname.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  }).sort((a, b) => {
    const aPrio = nursePrioritySessions.has(a.id);
    const bPrio = nursePrioritySessions.has(b.id);
    if (aPrio && !bPrio) return -1;
    if (!aPrio && bPrio) return 1;
    return new Date(b.created_at) - new Date(a.created_at);
  });

  document.getElementById("nurseChatTotalCount").textContent = displaySessions.length;
  convList.innerHTML = "";

  if (displaySessions.length === 0) {
    convList.innerHTML = `<div class="p-8 text-center text-slate-400 text-[10px] font-black uppercase tracking-widest leading-relaxed">No conversations found</div>`;
    return;
  }

  displaySessions.forEach(session => {
    let name = session.sender_fullname || `Patient ${session.id.slice(0, 5)}`;
    let avatarB64 = session.sender_avatar_base64;
    const isActive = session.id === activeNurseSessionId;
    const isRead = nurseReadSessions.has(session.id);

    const item = document.createElement("div");
    item.className = `p-4 mb-1 rounded-2xl border transition-all cursor-pointer flex items-center gap-4 relative group ${isActive ? 'bg-rose-50/80 border-rose-100 shadow-sm' : 'bg-transparent border-transparent hover:bg-slate-50'}`;

    const avatarHtml = avatarB64
      ? `<img src="${avatarB64}" class="w-12 h-12 rounded-[18px] object-cover ring-2 ring-white shadow-sm group-hover:scale-105 transition-transform">`
      : `<div class="w-12 h-12 rounded-[18px] bg-gradient-to-br from-rose-500 to-orange-600 flex items-center justify-center text-white font-bold text-xs shadow-sm ring-2 ring-white group-hover:scale-105 transition-transform">${name.slice(0, 2).toUpperCase()}</div>`;

    const timeLabel = new Date(session.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let previewText = session.last_message || "";
    if (previewText.startsWith("data:image/")) {
      previewText = '<span class="flex items-center gap-1"><i data-lucide="image" class="w-3 h-3"></i> Sent an image</span>';
    }

    const highlightedName = highlightText(name, filter);
    const highlightedPreview = (previewText && typeof previewText === 'string' && !previewText.includes('<i'))
      ? highlightText(previewText, filter)
      : previewText;

    const statusDot = !isRead 
      ? '<span class="absolute -top-1 -right-1 w-4 h-4 bg-red-500 border-2 border-white rounded-full shadow-sm animate-pulse"></span>' 
      : '<span class="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-500 border-2 border-white rounded-full shadow-sm"></span>';

    const unclaimedBadge = ''; // Badges removed since claiming is removed

    item.innerHTML = `
        <div class="relative self-start mt-0.5">
          ${avatarHtml}
          ${statusDot}
        </div>
        <div class="flex-1 min-w-0 flex justify-between h-full relative">
          ${unclaimedBadge}
          <div class="min-w-0 flex-1 pt-0.5">
            <p class="text-[13px] font-extrabold truncate ${isActive ? 'text-rose-900' : 'text-slate-800'} ${!isRead ? 'text-rose-600' : ''}">
                ${nursePrioritySessions.has(session.id) ? '<i data-lucide="star" class="w-3.5 h-3.5 inline text-amber-500 fill-amber-500 -mt-0.5 mr-1"></i>' : ''}
                ${highlightedName}
                ${nurseMutedSessions.has(session.id) ? '<i data-lucide="bell-off" class="w-3 h-3 inline text-slate-400 ml-1"></i>' : ''}
            </p>
            <p class="text-[11px] font-medium mt-1 ${isActive ? 'text-rose-600/80' : 'text-slate-500'} ${!isRead ? 'text-slate-900 font-bold' : ''} truncate min-w-0">${highlightedPreview}</p>
          </div>
          <div class="flex flex-col items-end justify-between ml-3 shrink-0 relative">
            <span class="text-[9px] font-black text-slate-400 uppercase tabular-nums mt-0.5">${timeLabel}</span>
            <button type="button" class="nurse-card-options-btn text-slate-300 hover:text-rose-600 transition-colors p-1 rounded-lg hover:bg-rose-50 mt-1 active:scale-95"><i data-lucide="more-horizontal" class="w-4 h-4 pointer-events-none"></i></button>
            <div class="nurse-card-options-menu hidden absolute top-full right-0 mt-1.5 w-52 bg-white/95 backdrop-blur-xl border border-slate-200/60 shadow-2xl shadow-rose-900/10 rounded-[18px] p-2 z-[60] origin-top-right transform transition-all duration-200">
                <button class="w-full text-left px-3 py-2.5 text-[11px] font-extrabold text-slate-600 hover:bg-slate-100 hover:text-rose-600 rounded-xl transition-all flex items-center gap-2.5 mb-0.5"><i data-lucide="star" class="w-3.5 h-3.5"></i> Priority</button>
                <button class="w-full text-left px-3 py-2.5 text-[11px] font-extrabold text-slate-600 hover:bg-slate-100 hover:text-amber-600 rounded-xl transition-all flex items-center gap-2.5 mb-1"><i data-lucide="bell-off" class="w-3.5 h-3.5"></i> Mute messages</button>
                <div class="h-[1px] bg-slate-100 my-1 mx-2"></div>
                <button class="w-full text-left px-3 py-2.5 text-[11px] font-extrabold text-slate-600 hover:bg-slate-100 hover:text-emerald-600 rounded-xl transition-all flex items-center gap-2.5 mt-1"><i data-lucide="archive" class="w-3.5 h-3.5"></i> Archive conversation</button>
                <div class="h-[1px] bg-slate-100 my-1 mx-2"></div>
                <button class="w-full text-left px-3 py-2.5 text-[11px] font-extrabold text-red-500 hover:bg-red-50 hover:text-red-700 rounded-xl transition-all flex items-center gap-2.5 mb-0.5 mt-1"><i data-lucide="ban" class="w-3.5 h-3.5"></i> Block</button>
                <button class="w-full text-left px-3 py-2.5 text-[11px] font-extrabold text-red-500 hover:bg-red-50 hover:text-red-700 rounded-xl transition-all flex items-center gap-2.5"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i> Delete conversation</button>
            </div>
          </div>
        </div>
        ${isActive ? '<div class="absolute left-1.5 top-3 bottom-3 w-1 bg-rose-500 rounded-full shadow-[0_0_8px_rgba(244,63,94,0.4)]"></div>' : ''}
      `;

    const optsBtn = item.querySelector('.nurse-card-options-btn');
    const optsMenu = item.querySelector('.nurse-card-options-menu');

    optsBtn.onclick = (e) => {
      e.stopPropagation();
      document.querySelectorAll('.nurse-card-options-menu').forEach(m => {
        if (m !== optsMenu) m.classList.add('hidden');
      });
      optsMenu.classList.toggle('hidden');
      if (!optsMenu.classList.contains('hidden') && window.lucide) {
        window.lucide.createIcons({ root: optsMenu });
      }
    };

    optsMenu.querySelectorAll('button').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const action = btn.textContent.trim();
        optsMenu.classList.add('hidden');

        if (action === "Delete conversation") {
          if (!confirm("Move this conversation to Recently Deleted?")) return;
          nurseDeletedSessions.add(session.id);
          nurseArchivedSessions.delete(session.id);
          nurseBlockedSessions.delete(session.id);
          nursePrioritySessions.delete(session.id);
          nurseMutedSessions.delete(session.id);
        } else if (action === "Archive conversation") {
          nurseArchivedSessions.add(session.id);
          if (activeNurseSessionId === session.id) activeNurseSessionId = null;
        } else if (action === "Block") {
          if (!confirm("Blocking will hide all messages from this patient. Continue?")) return;
          nurseBlockedSessions.add(session.id);
          if (activeNurseSessionId === session.id) activeNurseSessionId = null;
        } else if (action === "Priority") {
          if (nursePrioritySessions.has(session.id)) nursePrioritySessions.delete(session.id);
          else nursePrioritySessions.add(session.id);
        } else if (action === "Mute messages") {
          if (nurseMutedSessions.has(session.id)) nurseMutedSessions.delete(session.id);
          else nurseMutedSessions.add(session.id);
        }

        const stateObj = {
          is_archived: nurseArchivedSessions.has(session.id),
          is_blocked: nurseBlockedSessions.has(session.id),
          is_priority: nursePrioritySessions.has(session.id),
          is_muted: nurseMutedSessions.has(session.id),
          is_deleted: nurseDeletedSessions.has(session.id)
        };

        if (stateObj.is_deleted || stateObj.is_archived || stateObj.is_blocked) {
          if (activeNurseSessionId === session.id) {
            activeNurseSessionId = null;
            document.getElementById("nurseChatHeaderContainer")?.classList.add("hidden");
            document.getElementById("nurseChatInputContainer")?.classList.add("hidden");
            if (document.getElementById("nurseChatMessagesContainer")) document.getElementById("nurseChatMessagesContainer").innerHTML = '';
          }
        }

        await saveNurseChatState(session.id, stateObj);
        loadNurseConversations(filter);
      };
    });

    item.onclick = async () => {
      if (activeNurseSessionId === session.id) {
        const sidebar = document.getElementById("nurseMessengerSidebar");
        if (sidebar && window.innerWidth < 768) {
          sidebar.classList.add("-translate-x-full");
        }
        return;
      }
      activeNurseSessionId = session.id;

      const sidebar = document.getElementById("nurseMessengerSidebar");
      if (sidebar && window.innerWidth < 768) {
        sidebar.classList.add("-translate-x-full");
      }

      // Show Chat UI components
      const header = document.getElementById("nurseChatHeaderContainer");
      const inputCont = document.getElementById("nurseChatInputContainer");
      const msgsCont = document.getElementById("nurseChatMessagesContainer");
      const claimBtn = document.getElementById("nurseClaimBtn");

      if (header) header.classList.remove("hidden");
      if (inputCont) inputCont.classList.remove("hidden");
      if (msgsCont) msgsCont.classList.remove("hidden");

      // Auto-claim and Welcome Message on selection
      if (session.is_unclaimed) {
        activeNurseSessionId = session.id;
        await claimNurseActiveSession(true);
      }

      // Mark as read
      if (!nurseReadSessions.has(session.id)) {
        nurseReadSessions.add(session.id);
        localStorage.setItem("nurseReadSessions", JSON.stringify(Array.from(nurseReadSessions)));
      }

      document.getElementById("nurseChatHeaderName").textContent = name;
      document.getElementById("nurseActiveChatAvatar").innerHTML = avatarHtml + `<span class="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-emerald-500 border-2 border-white rounded-full shadow-sm"></span>`;

      loadNurseConversations(filter); // Refresh list for active state
      loadNurseMessagesForActiveSession();
    };
    convList.appendChild(item);
  });
  if (window.lucide) window.lucide.createIcons();
}

async function loadNurseMessagesForActiveSession() {
  const container = document.getElementById("nurseChatMessagesContainer");
  if (!container || !activeNurseSessionId) return;

  container.innerHTML = `
      <div class="flex flex-col items-center justify-center h-full py-12">
        <div class="w-10 h-10 border-4 border-slate-100 border-t-rose-500 rounded-full animate-spin"></div>
        <p class="mt-4 text-[10px] font-black text-slate-400 uppercase tracking-widest animate-pulse">Syncing History</p>
      </div>`;

  const { data: messages } = await sb.from('messages').select('*').eq('session_id', activeNurseSessionId).order('created_at', { ascending: true });
  container.innerHTML = "";

  if (messages && messages.length > 0) {
    messages.forEach(m => appendNurseMessage(m.content, m.sender_type === 'staff', m.created_at, m.sender_avatar_base64, m.sender_fullname, m.is_seen, m.id));
    // Mark patient messages as seen
    sb.from('messages').update({ is_seen: true }).eq('session_id', activeNurseSessionId).eq('sender_type', 'patient').then();
  } else {
    container.innerHTML = `<div class="flex flex-col items-center justify-center h-full p-8 opacity-50"><i data-lucide="message-square-dashed" class="w-12 h-12 text-slate-300 mb-4"></i><p class="text-xs font-bold text-slate-400 uppercase tracking-widest">No messages yet</p></div>`;
    if (window.lucide) window.lucide.createIcons();
  }
}

async function sendNurseMessage() {
  const input = document.getElementById("nurseChatInput");
  const hasText = input && input.value.trim();
  const hasImages = nurseStagedImages && nurseStagedImages.length > 0;

  if (!activeNurseSessionId || (!hasText && !hasImages)) return;

  // Auto-claim
  const currentSess = allNurseSessions.find(s => s.id === activeNurseSessionId);
  if (currentSess && currentSess.is_unclaimed) {
      await claimNurseActiveSession();
  }

  if (hasText) {
    const msg = input.value.trim();
    input.value = "";
    try {
      const { data } = await sb.from('messages').insert([{
        session_id: activeNurseSessionId,
        content: msg,
        sender_type: 'staff',
        sender_fullname: currentNurse ? currentNurse.name : 'Nurse Portal',
        message_type: 'text'
      }]).select();
      if (data && data[0]) appendNurseMessage(data[0].content, true, data[0].created_at, null, "NP", data[0].is_seen, data[0].id);
    } catch(e) {}
  }
  // Image sending logic removed for brevity but can be mirrored too
}

async function claimNurseActiveSession(sendWelcome = false) {
  if (!activeNurseSessionId || !currentNurse) return;
  if (nurseClaimingMap.has(activeNurseSessionId)) return;
  
  nurseClaimingMap.add(activeNurseSessionId);

  try {
    const existingRes = await sb.from('admin_chat_states').select('session_id, claimed_by').eq('session_id', activeNurseSessionId).maybeSingle();
    const existing = existingRes.data;

    // If chat already has an engaged admin/nurse, do not trigger auto welcome
    if (existing && existing.claimed_by) {
      nurseClaimingMap.delete(activeNurseSessionId);
      return;
    }

    const shouldSendWelcome = sendWelcome;

    let dbRes;
    if (existing) {
      dbRes = await sb.from('admin_chat_states').update({ claimed_by: currentNurse.email }).eq('session_id', activeNurseSessionId);
    } else {
      dbRes = await sb.from('admin_chat_states').insert([{ session_id: activeNurseSessionId, claimed_by: currentNurse.email }]);
    }
    
    document.getElementById("nurseClaimBtn")?.classList.add("hidden");

    if (shouldSendWelcome) {
      const welcomeMsg = `Hello! I am ${currentNurse.name}, and I will be assisting you today. How can I help you?`;
      await sb.from('messages').insert([{
        session_id: activeNurseSessionId,
        content: welcomeMsg,
        sender_type: 'staff',
        sender_fullname: currentNurse.name,
        message_type: 'text'
      }]);
      appendNurseMessage(welcomeMsg, true, new Date().toISOString(), null, currentNurse.name);
    }

  } catch(e) {
    console.error("Critical error in auto-greeting:", e);
  } finally {
    nurseClaimingMap.delete(activeNurseSessionId);
  }
}

function appendNurseMessage(content, isMe, time, avatar, name, isSeen, msgId) {
  const container = document.getElementById("nurseChatMessagesContainer");
  if (!container) return;
  
  const msgDiv = document.createElement("div");
  msgDiv.className = `flex ${isMe ? 'justify-end' : 'justify-start'} mb-4 anim-fade-in`;
  
  const formattedTime = time ? new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Just Now";
  const isImage = content && content.startsWith("data:image/");

  msgDiv.innerHTML = `
    <div class="max-w-[80%] flex flex-col ${isMe ? 'items-end' : 'items-start'}">
      <div class="px-4 py-2.5 rounded-2xl text-[13px] leading-relaxed shadow-sm ${isMe ? 'bg-rose-600 text-white rounded-tr-none marker:shadow-rose-500/20' : 'bg-slate-100 text-slate-800 rounded-tl-none'}">
        ${isImage ? `<img src="${content}" class="rounded-xl max-w-full cursor-pointer hover:opacity-90 transition-opacity" onclick="window.open('${content}', '_blank')">` : escapeHtml(content)}
      </div>
      <div class="flex items-center gap-1.5 mt-1 px-1">
        <span class="text-[9px] font-black text-slate-400 uppercase tracking-tighter tabular-nums">${formattedTime}</span>
        ${isMe ? `<i data-lucide="${isSeen ? 'check-check' : 'check'}" class="w-3 h-3 ${isSeen ? 'text-blue-500' : 'text-slate-300'}"></i>` : ''}
      </div>
    </div>
  `;
  container.appendChild(msgDiv);
  if (window.lucide) window.lucide.createIcons({ root: msgDiv });
  container.scrollTop = container.scrollHeight;
}

function setupNurseMessagingListeners() {
  const input = document.getElementById("nurseChatInput");
  const sendBtn = document.getElementById("nurseChatSendBtn");
  const claimBtn = document.getElementById("nurseClaimBtn");
  const search = document.getElementById("nurseConvSearch");
  const backBtn = document.getElementById("nurseBackToChats");

  if (backBtn) {
    backBtn.onclick = () => {
      const sidebar = document.getElementById("nurseMessengerSidebar");
      if (sidebar) sidebar.classList.remove("-translate-x-full");
    };
  }

  // New Buttons
  const archiveBtn = document.getElementById("nurseChatArchiveBtn");
  const settingsBtn = document.getElementById("nurseChatSettingsBtn");
  const closeArchive = document.getElementById("closeNurseArchivePanel");
  const closeSettings = document.getElementById("closeNurseChatSettingsPanel");
  const tabDeleted = document.getElementById("tabNurseSoftDeleted");
  const tabBlocked = document.getElementById("tabNurseBlocked");

  if (sendBtn) sendBtn.addEventListener("click", () => sendNurseMessage());
  if (claimBtn) claimBtn.addEventListener("click", () => claimNurseActiveSession());
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendNurseMessage();
      }
    });
  }
  if (search) {
    search.addEventListener("input", (e) => {
      loadNurseConversations(e.target.value);
    });
  }

  // Panel Handlers
  if (archiveBtn) archiveBtn.onclick = () => {
    document.getElementById("nurseArchivePanel").classList.remove("hidden");
    renderNurseArchivedConversations();
  };
  if (settingsBtn) settingsBtn.onclick = () => {
    document.getElementById("nurseChatSettingsPanel").classList.remove("hidden");
    renderNurseSettings("deleted");
  };
  if (closeArchive) closeArchive.onclick = () => document.getElementById("nurseArchivePanel").classList.add("hidden");
  if (closeSettings) closeSettings.onclick = () => document.getElementById("nurseChatSettingsPanel").classList.add("hidden");

  if (tabDeleted) tabDeleted.onclick = () => renderNurseSettings("deleted");
  if (tabBlocked) tabBlocked.onclick = () => renderNurseSettings("blocked");
}

// =============================================
// INVENTORY
// =============================================
async function loadInventory() {
  const container = document.getElementById("nurseInventoryContent");
  if (!container) return;

  try {
    const { data, error } = await sb
      .from("inventory")
      .select("*")
      .order("name", { ascending: true });
    if (error) throw error;
    nurseInventory = data || [];

    if (nurseInventory.length === 0) {
      container.innerHTML = `<div class="text-center py-16"><div class="w-16 h-16 rounded-[24px] bg-amber-50 flex items-center justify-center mx-auto mb-3"><i data-lucide="package" class="w-8 h-8 text-amber-300"></i></div><p class="text-sm font-black text-slate-600">No inventory items</p></div>`;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    container.innerHTML = `
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        ${nurseInventory.map((item, idx) => {
          const stockColor = (item.quantity || 0) <= (item.min_stock || 5) ? "text-red-600 bg-red-50" : "text-emerald-600 bg-emerald-50";
          return `
            <div class="p-4 rounded-2xl border border-slate-100 bg-white hover:shadow-md transition-all" style="animation: nurseFadeIn 0.3s ease ${idx * 40}ms both;">
              <div class="flex items-center justify-between mb-2">
                <h4 class="text-[13px] font-black text-slate-800">${escapeHtml(item.name || "Unknown")}</h4>
                <span class="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${stockColor}">${item.quantity || 0} in stock</span>
              </div>
              <p class="text-[11px] text-slate-400 font-medium">${escapeHtml(item.category || "General")} • ${escapeHtml(item.unit || "pcs")}</p>
            </div>`;
        }).join("")}
      </div>`;
  } catch (err) {
    console.error("Inventory fetch error:", err);
    container.innerHTML = `<p class="text-sm text-red-400 text-center py-8">Failed to load inventory</p>`;
  }
}

// =============================================
// SETTINGS
// =============================================
async function loadSettings() {
  const container = document.getElementById("nurseSettingsInfo");
  if (!container) return;

  try {
    const { data } = await sb.from("clinics").select("*").limit(1);
    const settings = (data && data.length > 0) ? data[0] : {};

    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const opDays = settings.operating_days || [1, 2, 3, 4, 5];
    const opDaysText = opDays.map(d => dayNames[parseInt(d, 10)]?.slice(0,3)).join(', ') || "Mon-Fri";
    
    // Utilize the live clinic global status check if available, or fallback
    const trulyOpen = (typeof isClinicOpenNow === 'function') ? isClinicOpenNow() : (settings.is_open !== false);

    container.innerHTML = `
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div class="p-3 rounded-xl bg-slate-50 border border-slate-100">
          <p class="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Clinic Name</p>
          <p class="text-[13px] font-bold text-slate-700 leading-tight">${escapeHtml(settings.clinic_name || "OrthoConnect Dental Clinic")}</p>
        </div>
        <div class="p-3 rounded-xl bg-slate-50 border border-slate-100">
          <p class="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1">Clinic Status</p>
          <p class="text-[12px] font-bold ${trulyOpen ? 'text-emerald-600' : 'text-red-500'} leading-none">${trulyOpen ? '✓ Open' : '✗ Closed'}</p>
        </div>
        <div class="p-3 rounded-xl bg-slate-50 border border-slate-100">
          <p class="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Operating Days</p>
          <p class="text-[13px] font-bold text-slate-700 leading-tight">${escapeHtml(opDaysText)}</p>
        </div>
        <div class="p-3 rounded-xl bg-slate-50 border border-slate-100">
          <p class="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Operating Hours</p>
          <p class="text-[13px] font-bold text-slate-700 leading-tight">${formatTime12h(settings.opening_time)} — ${formatTime12h(settings.closing_time)}</p>
        </div>
        <div class="p-3 rounded-xl bg-slate-50 border border-slate-100">
          <p class="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Grace Period</p>
          <p class="text-[13px] font-bold text-slate-700 leading-tight">${settings.grace_period || CLINIC_CONFIG.graceMinutes} min</p>
        </div>
        <div class="p-3 rounded-xl bg-slate-50 border border-slate-100">
          <p class="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">System Version</p>
          <p class="text-[13px] font-bold text-slate-700 leading-tight">v2.0 — Nurse Portal</p>
        </div>
      </div>
    `;

    setupSecuritySettings();

  } catch (err) {
    container.innerHTML = `
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="p-4 rounded-2xl bg-slate-50 border border-slate-100">
          <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Operating Hours</p>
          <p class="text-sm font-bold text-slate-700">${CLINIC_CONFIG.openingTime} — ${CLINIC_CONFIG.closingTime}</p>
        </div>
        <div class="p-4 rounded-2xl bg-slate-50 border border-slate-100">
          <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Max Leave / Month</p>
          <p class="text-sm font-bold text-slate-700">${CLINIC_CONFIG.maxLeavePerMonth} days</p>
        </div>
      </div>
    `;
    setupSecuritySettings();
  }
}

function setupSecuritySettings() {
  const form = document.getElementById("nurseChangePasswordForm");
  if (!form) return;

  form.onsubmit = async (e) => {
    e.preventDefault();
    const currentPass = document.getElementById("currentNursePassword")?.value;
    const newPass = document.getElementById("newNursePassword")?.value;
    const confirmPass = document.getElementById("confirmNursePassword")?.value;

    if (!currentPass || !newPass) return;
    
    if (newPass.length < 6) {
      return showNurseToast("New password must be at least 6 characters.", "error");
    }

    if (newPass === currentPass) {
       return showNurseToast("New password cannot be the same as your current one.", "error");
    }

    if (newPass !== confirmPass) {
      return showNurseToast("New passwords do not match!", "error");
    }

    const btn = form.querySelector('button');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Authenticating...`;
    if (window.lucide) window.lucide.createIcons();

    try {
      // 1. Verify Current Password First (Professional Security Practice)
      const userEmail = currentNurse.email;
      const { error: verifyErr } = await sb.auth.signInWithPassword({ 
        email: userEmail, 
        password: currentPass 
      });

      if (verifyErr) {
        throw new Error("Verification failed: Current password is incorrect.");
      }

      // 2. Perform the Update
      btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Securing Account...`;
      const { error } = await sb.auth.updateUser({ password: newPass });
      if (error) throw error;

      showNurseToast("Credentials updated successfully!", "success");
      form.reset();
    } catch (err) {
      console.error("Security update error:", err);
      showNurseToast(err.message || "Security update failed.", "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
      if (window.lucide) window.lucide.createIcons();
    }
  };
}

// =============================================
// UTILITY FUNCTIONS
// =============================================
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function getTodayStr() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function formatTime12h(time24) {
  if (!time24) return "—";
  const [h, m] = time24.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${m} ${ampm}`;
}

function formatAptTimeRange(time24, durationMins) {
  if (!time24 || time24 === "—") return "—";
  const parts = time24.split(":");
  if (parts.length < 2) return time24;
  
  const hour = parseInt(parts[0], 10);
  const min = parseInt(parts[1], 10);

  const format12 = (h, m) => {
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${h12.toString().padStart(2, '0')}:${String(m).padStart(2, "0")} ${ampm}`;
  };

  const startStr = format12(hour, min);
  const duration = parseInt(durationMins, 10);
  
  if (!duration || duration <= 0) return startStr;

  const totalMins = hour * 60 + min + duration;
  const endHour = Math.floor(totalMins / 60) % 24;
  const endMin = totalMins % 60;
  const endStr = format12(endHour, endMin);

  return `${startStr} - ${endStr}`;
}

function calcHours(clockIn, clockOut) {
  if (!clockIn || !clockOut) return "—";
  const [h1, m1] = clockIn.split(":").map(Number);
  const [h2, m2] = clockOut.split(":").map(Number);
  const mins = (h2 * 60 + m2) - (h1 * 60 + m1);
  const hours = Math.max(0, mins / 60);
  return hours.toFixed(1) + "h";
}

function statusPill(status) {
  const map = {
    present: { label: "Present", class: "text-emerald-700 bg-emerald-50 border-emerald-200" },
    late: { label: "Late", class: "text-amber-700 bg-amber-50 border-amber-200" },
    absent: { label: "Absent", class: "text-red-700 bg-red-50 border-red-200" },
    "half-day": { label: "Half Day", class: "text-blue-700 bg-blue-50 border-blue-200" },
    "on-leave": { label: "On Leave", class: "text-violet-700 bg-violet-50 border-violet-200" }
  };
  const s = map[status] || { label: status || "—", class: "text-slate-500 bg-slate-50 border-slate-200" };
  return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${s.class}"><span class="w-1.5 h-1.5 rounded-full bg-current"></span>${s.label}</span>`;
}

function showNurseToast(message, type = "info") {
  let container = document.getElementById("nurseToastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "nurseToastContainer";
    container.className = "nurse-toast-container";
    document.body.appendChild(container);
  }

  const icons = {
    success: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
    error: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    warning: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    info: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`
  };

  const toast = document.createElement("div");
  toast.className = `nurse-toast nurse-toast-${type}`;
  toast.innerHTML = `${icons[type] || icons.info}<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(40px)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Periodic pooling for clinic status updates has been removed to prevent unexpected background activity.

// =============================================
// PDF EXPORT HANDLERS
// =============================================
document.addEventListener("DOMContentLoaded", () => {
    setupPdfExporters();
});

function setupPdfExporters() {
    const btnAtt = document.getElementById("nurseExportAttBtn");
    if (btnAtt) {
        btnAtt.addEventListener("click", () => {
            const tableClone = document.getElementById("myAttBody").innerHTML;
            if (!nurseAttendance || nurseAttendance.length === 0) return showNurseToast("No attendance records to export.", "warning");
            
            const btnOriginal = btnAtt.innerHTML;
            btnAtt.innerHTML = '<i class="lucide-loader-2 w-3.5 h-3.5 animate-spin"></i> Exporting';
            
            const content = document.createElement("div");
            content.style.padding = "40px";
            content.style.fontFamily = "'Inter', sans-serif";
            
            let rowsHtml = nurseAttendance.map(r => {
                const clockIn = r.clock_in ? formatTime12h(r.clock_in) : "—";
                const clockOut = r.clock_out ? formatTime12h(r.clock_out) : "—";
                const hrs = calcHours(r.clock_in, r.clock_out);
                return `<tr>
                    <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${r.date}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${clockIn}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${clockOut}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; font-weight: bold;">${hrs}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-transform: uppercase;">${r.status}</td>
                </tr>`;
            }).join("");

            content.innerHTML = `
                <div style="text-align: center; margin-bottom: 30px;">
                    <h1 style="color: #0f766e; margin: 0; font-size: 22px;">OrthoConnect Clinic</h1>
                    <p style="color: #64748b; margin: 5px 0 0 0; font-size: 12px; font-weight: bold; text-transform: uppercase;">Attendance Log</p>
                </div>
                <div style="margin-bottom: 20px;">
                    <p style="margin: 0; font-size: 12px; color: #475569;"><strong>Staff Name:</strong> ${currentNurse.name}</p>
                    <p style="margin: 0; font-size: 12px; color: #475569;"><strong>Generated On:</strong> ${new Date().toLocaleDateString()}</p>
                </div>
                <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
                    <thead>
                        <tr style="background-color: #f8fafc;">
                            <th style="padding: 10px; text-align: left; font-size: 10px; color: #64748b; border-bottom: 2px solid #cbd5e1; text-transform: uppercase;">Date</th>
                            <th style="padding: 10px; text-align: left; font-size: 10px; color: #64748b; border-bottom: 2px solid #cbd5e1; text-transform: uppercase;">Clock In</th>
                            <th style="padding: 10px; text-align: left; font-size: 10px; color: #64748b; border-bottom: 2px solid #cbd5e1; text-transform: uppercase;">Clock Out</th>
                            <th style="padding: 10px; text-align: left; font-size: 10px; color: #64748b; border-bottom: 2px solid #cbd5e1; text-transform: uppercase;">Hours</th>
                            <th style="padding: 10px; text-align: left; font-size: 10px; color: #64748b; border-bottom: 2px solid #cbd5e1; text-transform: uppercase;">Status</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            `;

            html2pdf().set({
                margin: 10,
                filename: `Attendance_${currentNurse.name.replace(/\s+/g, '_')}_${getTodayStr()}.pdf`,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2 },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
            }).from(content).save().then(() => {
                btnAtt.innerHTML = btnOriginal;
            });
        });
    }

    const btnPay = document.getElementById("nurseExportPayBtn");
    if (btnPay) {
        btnPay.addEventListener("click", () => {
            if (!nursePayroll || nursePayroll.length === 0) return showNurseToast("No payroll records to export.", "warning");
            
            const btnOriginal = btnPay.innerHTML;
            btnPay.innerHTML = '<i class="lucide-loader-2 w-3.5 h-3.5 animate-spin"></i> Exporting';

            const content = document.createElement("div");
            content.style.padding = "40px";
            content.style.fontFamily = "'Inter', sans-serif";

            let rowsHtml = nursePayroll.map(r => {
                const net = (r.base_salary || 0) + (r.bonus || 0) - (r.deductions || 0); // simplified net 
                return `<tr>
                    <td style="padding: 12px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${r.pay_period}</td>
                    <td style="padding: 12px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">PHP ${(r.base_salary||0).toFixed(2)}</td>
                    <td style="padding: 12px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; color: #ef4444;">-PHP ${(r.deductions||0).toFixed(2)}</td>
                    <td style="padding: 12px 10px; border-bottom: 1px solid #e2e8f0; font-size: 12px; font-weight: bold; color: #4f46e5;">PHP ${net.toFixed(2)}</td>
                    <td style="padding: 12px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-transform: uppercase;">${r.status}</td>
                </tr>`;
            }).join("");

            content.innerHTML = `
                <div style="text-align: center; margin-bottom: 30px;">
                    <h1 style="color: #6d28d9; margin: 0; font-size: 22px;">OrthoConnect Clinic</h1>
                    <p style="color: #64748b; margin: 5px 0 0 0; font-size: 12px; font-weight: bold; text-transform: uppercase;">Full Payroll History</p>
                </div>
                <div style="margin-bottom: 20px;">
                    <p style="margin: 0; font-size: 12px; color: #475569;"><strong>Staff Name:</strong> ${currentNurse.name}</p>
                    <p style="margin: 0; font-size: 12px; color: #475569;"><strong>Generated On:</strong> ${new Date().toLocaleDateString()}</p>
                </div>
                <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
                    <thead>
                        <tr style="background-color: #f8fafc;">
                            <th style="padding: 10px; text-align: left; font-size: 10px; color: #64748b; border-bottom: 2px solid #cbd5e1; text-transform: uppercase;">Period</th>
                            <th style="padding: 10px; text-align: left; font-size: 10px; color: #64748b; border-bottom: 2px solid #cbd5e1; text-transform: uppercase;">Base Pay</th>
                            <th style="padding: 10px; text-align: left; font-size: 10px; color: #64748b; border-bottom: 2px solid #cbd5e1; text-transform: uppercase;">Deductions</th>
                            <th style="padding: 10px; text-align: left; font-size: 10px; color: #64748b; border-bottom: 2px solid #cbd5e1; text-transform: uppercase;">Net Pay</th>
                            <th style="padding: 10px; text-align: left; font-size: 10px; color: #64748b; border-bottom: 2px solid #cbd5e1; text-transform: uppercase;">Status</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            `;

            html2pdf().set({
                margin: 10,
                filename: `PayrollHistory_${currentNurse.name.replace(/\s+/g, '_')}_${getTodayStr()}.pdf`,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2 },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
            }).from(content).save().then(() => {
                btnPay.innerHTML = btnOriginal;
            });
        });
    }
}

window.closeNurseVerificationModal = function() {
  const vModal = document.getElementById("nurseVerificationModal");
  const vInner = document.getElementById("nurseVerificationModalInner");
  if (vModal) {
    vModal.classList.add("opacity-0");
    vInner?.classList.remove("scale-100");
    vInner?.classList.add("scale-95");
    setTimeout(() => vModal.classList.add("hidden"), 300);
  }
};

// =============================================
// NURSE NOTIFICATIONS
// =============================================
let nurseNotifications = [];

function setupNurseNotifications() {
  const bellBtn = document.getElementById("nurseNotifBellBtn");
  const dropdown = document.getElementById("nurseNotifDropdown");
  const markBtn = document.getElementById("nurseMarkAllReadBtn");

  if (!bellBtn || !dropdown) {
    console.warn("Nurse Notification elements not found:", { bellBtn, dropdown });
    return;
  }

  // Improved Toggle logic for Nurse notifications
  bellBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Check current state
    const isCurrentlyHidden = dropdown.classList.contains("hidden");
    
    if (isCurrentlyHidden) {
      console.log("Nurse Notification Dropdown: Opening");
      dropdown.classList.remove("hidden");
      dropdown.classList.add("flex"); // Ensure flex layout is active
      fetchNurseNotifications();
    } else {
      console.log("Nurse Notification Dropdown: Closing");
      dropdown.classList.add("hidden");
      dropdown.classList.remove("flex");
    }
  });

  // Close dropdown when clicking outside
  document.addEventListener("click", (e) => {
    if (!dropdown.classList.contains("hidden")) {
      const isClickInsideBell = bellBtn.contains(e.target);
      const isClickInsideDropdown = dropdown.contains(e.target);
      
      if (!isClickInsideBell && !isClickInsideDropdown) {
        console.log("Nurse Notification Dropdown: Closing (click outside)");
        dropdown.classList.add("hidden");
        dropdown.classList.remove("flex");
      }
    }
  });

  if (markBtn) {
    markBtn.addEventListener("click", async () => {
      console.log("Nurse Notifications: Marking all read");
      await markNurseNotificationsRead();
      renderNurseNotifications();
    });
  }
}

async function fetchNurseNotifications() {
  if (!currentNurse) return;
  try {
    let newNotifications = [];

    // 1. Fetch Appointments
    const today = new Date().toISOString().split("T")[0];
    const { data: appointments, error: apptError } = await sb
      .from("appointments")
      .select("*")
      .eq("doctor_name", currentNurse.name)
      .eq("status", "scheduled")
      .gte("appointment_date", today)
      .order("appointment_date", { ascending: true })
      .order("appointment_time", { ascending: true })
      .limit(5);

    if (!apptError && appointments) {
      appointments.forEach(a => {
        newNotifications.push({
          id: a.id,
          title: "Appointment: " + a.patient_name,
          description: `${a.appointment_date} at ${a.appointment_time}`,
          icon: "calendar",
          iconColor: "text-teal-600",
          iconBg: "bg-teal-100"
        });
      });
    }

    // 2. Fetch Pending Payroll
    const { data: payrolls, error: payError } = await sb
      .from("payroll")
      .select("*")
      .eq("staff_name", currentNurse.name)
      .eq("status", "pending")
      .order("pay_period", { ascending: false })
      .limit(2);
      
    if (!payError && payrolls) {
      payrolls.forEach(p => {
        newNotifications.push({
          id: "pay_" + p.id,
          title: "Payroll Notification",
          description: `Salary for ${p.pay_period} is pending/processing.`,
          icon: "banknote",
          iconColor: "text-violet-600",
          iconBg: "bg-violet-100"
        });
      });
    }

    // 3. Fetch Low Stock Inventory
    const { data: inventory, error: invError } = await sb
      .from("inventory")
      .select("*");
      
    if (!invError && inventory) {
      const lowStockItems = inventory.filter(i => i.quantity <= (i.min_quantity || 5) && i.quantity > 0);
      const outOfStockItems = inventory.filter(i => i.quantity <= 0);
      
      outOfStockItems.slice(0, 3).forEach(i => {
        newNotifications.push({
          id: "inv_out_" + i.id,
          title: "Out of Stock: " + i.name,
          description: "Item needs immediate restock.",
          icon: "alert-triangle",
          iconColor: "text-red-600",
          iconBg: "bg-red-100"
        });
      });

      lowStockItems.slice(0, 3).forEach(i => {
        newNotifications.push({
          id: "inv_low_" + i.id,
          title: "Low Stock: " + i.name,
          description: `Only ${i.quantity} left in stock (Min: ${i.min_quantity || 5}).`,
          icon: "package-minus",
          iconColor: "text-amber-600",
          iconBg: "bg-amber-100"
        });
      });
    }

    nurseNotifications = newNotifications;

    renderNurseNotifications();
    updateNurseNotifBadge();
  } catch (err) {
    console.error("Error fetching nurse notifications:", err);
  }
}

function renderNurseNotifications() {
  const container = document.getElementById("nurseNotifList");
  if (!container) return;

  if (nurseNotifications.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8">
        <div class="w-10 h-10 bg-slate-50 rounded-xl mx-auto flex items-center justify-center mb-2">
          <i data-lucide="bell-off" class="w-5 h-5 text-slate-300"></i>
        </div>
        <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">No new notifications</p>
      </div>`;
    return;
  }

  container.innerHTML = nurseNotifications.map(n => `
    <div class="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-start gap-3 hover:bg-slate-100/50 transition-colors">
      <div class="w-8 h-8 rounded-lg ${n.iconBg || 'bg-teal-100'} flex items-center justify-center shrink-0">
        <i data-lucide="${n.icon || 'bell'}" class="w-4 h-4 ${n.iconColor || 'text-teal-600'}"></i>
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-[11px] font-bold text-slate-800 truncate">${n.title}</p>
        <p class="text-[10px] text-slate-500 mt-0.5">${n.description}</p>
      </div>
    </div>
  `).join("");
  
  if (window.lucide) window.lucide.createIcons();
}

function updateNurseNotifBadge() {
  const badge = document.getElementById("nurseNotifBadge");
  if (!badge) return;
  if (nurseNotifications.length > 0) {
    badge.textContent = nurseNotifications.length;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

async function markNurseNotificationsRead() {
  nurseNotifications = [];
  updateNurseNotifBadge();
}

// =============================================
// APPOINTMENT STATUS HANDLERS (No-Show & Arrived)
// =============================================
window.handleNurseNoShow = async function(apptId, patientName) {
  if (!confirm(`Mark ${patientName} as No-Show? This will send an automated recapture message.`)) return;

  try {
    const { error } = await sb
      .from("appointments")
      .update({ status: "no_show" })
      .eq("id", apptId);
    if (error) throw error;

    // Send automated "Missed You" Chat Message
    await sendAutomatedChatRecapture(patientName);

    showNurseToast(`Marked ${patientName} as No-Show. Recapture message sent.`, "info");
    loadSchedule();
    loadTreatmentProgress();
  } catch (err) {
    console.error("No-Show handled error:", err);
    showNurseToast("Failed to update status", "error");
  }
};

window.handleNurseDone = async function(apptId, patientName) {
  try {
    const { error } = await sb
      .from("appointments")
      .update({ status: "done" })
      .eq("id", apptId);
    if (error) throw error;

    showNurseToast(`${patientName} has arrived. Appointment marked as Done.`, "success");
    loadSchedule();
    loadTreatmentProgress();
  } catch (err) {
    console.error("Check-in error:", err);
    showNurseToast("Failed to update status", "error");
  }
};

async function sendAutomatedChatRecapture(patientName) {
  try {
    const { data: messages } = await sb
      .from("messages")
      .select("session_id")
      .eq("sender_fullname", patientName)
      .limit(1);
    
    const sessionId = (messages && messages.length > 0) ? messages[0].session_id : `session_${patientName.replace(/\s+/g, '_')}`;
    const content = `Hi ${patientName}! We missed you at the clinic today. We noticed you couldn't make it to your appointment. Whenever you're ready, you can reschedule through the app! - OrthoConnect Team`;

    await sb.from("messages").insert([{
      session_id: sessionId,
      sender_fullname: "OrthoConnect Clinic",
      content: content,
      created_at: new Date().toISOString()
    }]);
  } catch (err) {
    console.warn("Automated chat recapture failed:", err);
  }
}

// =============================================
// AUTOMATED EMAIL REMINDERS (Flask Integration)
// =============================================
async function runAutomatedReminders() {
    console.log("OrthoConnect: Checking for appointments needing email reminders...");
    try {
        const today = getTodayStr();
        const { data: appts } = await sb
            .from("appointments")
            .select("*")
            .eq("appointment_date", today)
            .eq("status", "scheduled");

        if (!appts) return;

        for (const a of appts) {
            const reminderKey = `reminded_${a.id}_${today}`;
            if (localStorage.getItem(reminderKey)) continue;

            const { data: patients } = await sb
                .from("patients")
                .select("email")
                .eq("full_name", a.patient_name)
                .limit(1);

            if (patients && patients.length > 0 && patients[0].email) {
                const email = patients[0].email;
                const resp = await fetch("/api/appointment/reminder", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        email: email,
                        patient_name: a.patient_name,
                        time: formatTime12h(a.appointment_time),
                        date: today,
                        location: "OrthoConnect Dental Clinic (Main)"
                    })
                });
                
                if (resp.ok) {
                    console.log(`Auto-reminder sent to ${a.patient_name}`);
                    localStorage.setItem(reminderKey, "true");
                }
            }
        }
    } catch (err) {
        console.error("Auto-reminder routine error:", err);
    }
}

// Start auto-checking if the portal is open
setInterval(runAutomatedReminders, 600000); 
setTimeout(runAutomatedReminders, 5000);

// =============================================
// ARCHIVED & SETTINGS RENDERING
// =============================================
function renderNurseArchivedConversations() {
  const archiveList = document.getElementById("nurseArchiveList");
  if (!archiveList) return;

  const archived = allNurseSessions.filter(s => nurseArchivedSessions.has(s.id));

  if (archived.length === 0) {
    archiveList.innerHTML = `
            <div class="max-w-3xl mx-auto py-12 text-center space-y-4">
                <div class="w-20 h-20 bg-slate-50 rounded-[28px] mx-auto flex items-center justify-center mb-6">
                    <i data-lucide="inbox" class="w-10 h-10 text-slate-300"></i>
                </div>
                <h4 class="text-xl font-black text-slate-800">No Archived Chats</h4>
                <p class="text-slate-500 font-medium max-w-sm mx-auto">Archived conversations will appear here.</p>
            </div>
        `;
    if (window.lucide) window.lucide.createIcons({ root: archiveList });
    return;
  }

  archiveList.innerHTML = "";
  archived.forEach(session => {
    const item = document.createElement("div");
    let name = session.sender_fullname || `Patient ${session.id.slice(0, 5)}`;
    let avatarB64 = session.sender_avatar_base64;
    const timeLabel = new Date(session.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const avatarHtml = avatarB64
      ? `<img src="${avatarB64}" class="w-14 h-14 rounded-2xl object-cover ring-2 ring-white shadow-sm">`
      : `<div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-rose-500 to-orange-600 flex items-center justify-center text-white font-bold text-sm shadow-sm ring-2 ring-white">${name.slice(0, 2).toUpperCase()}</div>`;

    item.innerHTML = `
            <div class="p-4 bg-white rounded-3xl border border-slate-200 hover:border-slate-300 transition-colors hover:shadow-lg hover:shadow-rose-200/50 flex items-center gap-4 relative mx-auto max-w-3xl mb-3">
                ${avatarHtml}
                <div class="flex-1 min-w-0 flex flex-col">
                    <div class="flex justify-between items-end mb-1">
                        <p class="text-[14px] font-black text-slate-800 leading-none">${name}</p>
                        <span class="text-[10px] font-black text-slate-400 uppercase tabular-nums leading-none">${timeLabel}</span>
                    </div>
                    <p class="text-[12px] font-semibold text-slate-500 truncate max-w-sm">${session.last_message || ''}</p>
                </div>
                <div class="flex flex-col gap-1.5 shrink-0 ml-1">
                    <button class="unarchive-btn w-full px-4 py-2 bg-rose-50 text-rose-600 font-black text-[10px] uppercase tracking-wider rounded-xl transition-all hover:bg-rose-600 hover:text-white" data-id="${session.id}">
                        Unarchive
                    </button>
                    <button class="delete-btn w-full px-4 py-2 bg-red-50 text-red-600 font-black text-[10px] uppercase tracking-wider rounded-xl transition-all hover:bg-red-600 hover:text-white" data-id="${session.id}">
                        Delete
                    </button>
                </div>
            </div>
        `;
    archiveList.appendChild(item);
  });

  if (window.lucide) window.lucide.createIcons({ root: archiveList });

  archiveList.querySelectorAll('.unarchive-btn').forEach(btn => {
    btn.onclick = async () => {
      const sid = btn.dataset.id;
      nurseArchivedSessions.delete(sid);
      await saveNurseChatState(sid, { is_archived: false });
      loadNurseConversations();
      renderNurseArchivedConversations();
    };
  });

  archiveList.querySelectorAll('.delete-btn').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("Move to Recently Deleted?")) return;
      const sid = btn.dataset.id;
      nurseDeletedSessions.add(sid);
      nurseArchivedSessions.delete(sid);
      await saveNurseChatState(sid, { is_deleted: true, is_archived: false });
      loadNurseConversations();
      renderNurseArchivedConversations();
    };
  });
}

function renderNurseSettings(activeTab = "deleted") {
  const list = document.getElementById("nurseChatSettingsList");
  if (!list) return;

  const tabDeleted = document.getElementById("tabNurseSoftDeleted");
  const tabBlocked = document.getElementById("tabNurseBlocked");
  
  if (activeTab === "deleted") {
    tabDeleted.className = "py-4 text-sm font-black text-rose-600 border-b-2 border-rose-600 transition-colors";
    tabBlocked.className = "py-4 text-sm font-black text-slate-400 hover:text-slate-600 border-b-2 border-transparent transition-colors";
  } else {
    tabBlocked.className = "py-4 text-sm font-black text-rose-600 border-b-2 border-rose-600 transition-colors";
    tabDeleted.className = "py-4 text-sm font-black text-slate-400 hover:text-slate-600 border-b-2 border-transparent transition-colors";
  }

  let itemsToRender = [];
  if (activeTab === "deleted") {
    itemsToRender = allNurseSessions.filter(s => nurseDeletedSessions.has(s.id));
  } else {
    itemsToRender = allNurseSessions.filter(s => nurseBlockedSessions.has(s.id));
  }

  if (itemsToRender.length === 0) {
    list.innerHTML = `
            <div class="max-w-3xl mx-auto py-12 text-center space-y-4">
                <div class="w-20 h-20 bg-slate-50 rounded-[28px] mx-auto flex items-center justify-center mb-6">
                    <i data-lucide="${activeTab === 'deleted' ? 'trash' : 'ban'}" class="w-10 h-10 text-slate-300"></i>
                </div>
                <h4 class="text-xl font-black text-slate-800">No ${activeTab === 'deleted' ? 'Deleted' : 'Blocked'} Accounts</h4>
                <p class="text-slate-500 font-medium max-w-sm mx-auto">List is currently empty.</p>
            </div>
        `;
    if (window.lucide) window.lucide.createIcons({ root: list });
    return;
  }

  list.innerHTML = "";
  itemsToRender.forEach(session => {
    const item = document.createElement("div");
    let name = session.sender_fullname || `Patient ${session.id.slice(0, 5)}`;
    let avatarB64 = session.sender_avatar_base64;

    const avatarHtml = avatarB64
      ? `<img src="${avatarB64}" class="w-12 h-12 rounded-xl object-cover ring-2 ring-white">`
      : `<div class="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 font-bold text-xs">${name.slice(0, 2).toUpperCase()}</div>`;

    item.innerHTML = `
            <div class="p-4 bg-white rounded-3xl border border-slate-200 flex items-center gap-4 mx-auto max-w-3xl mb-3">
                ${avatarHtml}
                <div class="flex-1">
                    <p class="text-sm font-black text-slate-800">${name}</p>
                    <p class="text-[11px] text-slate-400 font-bold uppercase tracking-tight">${activeTab === 'deleted' ? 'Deleted conversation' : 'Blocked patient'}</p>
                </div>
                <button class="restore-btn px-4 py-2 bg-rose-50 text-rose-600 font-black text-[10px] uppercase tracking-wider rounded-xl transition-all hover:bg-rose-600 hover:text-white" data-id="${session.id}">
                    Restore
                </button>
            </div>
        `;
    list.appendChild(item);
  });

  list.querySelectorAll('.restore-btn').forEach(btn => {
    btn.onclick = async () => {
      const sid = btn.dataset.id;
      if (activeTab === "deleted") nurseDeletedSessions.delete(sid);
      else nurseBlockedSessions.delete(sid);
      
      await saveNurseChatState(sid, { is_deleted: false, is_blocked: false });
      loadNurseConversations();
      renderNurseSettings(activeTab);
    };
  });

  if (window.lucide) window.lucide.createIcons({ root: list });
}

async function saveNurseChatState(sessionId, states) {
  try {
    const payload = { 
      session_id: sessionId,
      ...states,
      updated_at: new Date().toISOString()
    };
    
    // Using upsert with onConflict to avoid 400/409 errors
    await sb.from('admin_chat_states').upsert(payload, { onConflict: 'session_id' });
  } catch(err) {
    console.error("Error saving chat state:", err);
  }
}

// Collapsible Sidebar Toggle
window.toggleSidebarCollapse = function() {
  const sidebar = document.getElementById("nurseSidebar");
  if (!sidebar) return;
  sidebar.classList.toggle("collapsed");
  if (window.lucide) window.lucide.createIcons();
};

window.toggleNurseSubMenu = function(menuId, iconId) {
  const menu = document.getElementById(menuId);
  const icon = document.getElementById(iconId);
  if (!menu || !icon) return;
  
  if (menu.classList.contains("hidden")) {
    menu.classList.remove("hidden");
    icon.classList.add("rotate-180");
  } else {
    menu.classList.add("hidden");
    icon.classList.remove("rotate-180");
  }
};


function getPatientContact(appt) { 
    console.log("getPatientContact for:", appt.patient_name, appt);
    console.log("nursePatients count:", nursePatients.length);

    // 1. Direct from appointment
    const direct = appt.patient_phone || appt.phone || appt.contact || appt.mobile || appt.patient_contact;
    if (direct) return direct;

    // 2. Lookup by ID (Most reliable)
    if (appt.patient_id && nursePatients.length > 0) {
        const match = nursePatients.find(p => String(p.id) === String(appt.patient_id));
        if (match && match.contact_no) return match.contact_no;
        if (match && match.phone) return match.phone;
    }

    // 3. Lookup by email
    const email = appt.patient_email || appt.email;
    if (email && nursePatients.length > 0) {
        const match = nursePatients.find(p => (p.email || "").toLowerCase() === email.toLowerCase());
        if (match && match.contact_no) return match.contact_no;
        if (match && match.phone) return match.phone;
    }

    // 4. Lookup by name
    if (appt.patient_name && nursePatients.length > 0) {
        const apptName = appt.patient_name.trim().toLowerCase();
        const match = nursePatients.find(p => (p.full_name || "").trim().toLowerCase() === apptName);
        if (match && match.contact_no) return match.contact_no;
        if (match && match.phone) return match.phone;
    }

    return "No Contact"; 
}

function getPatientEmail(appt) { 
    if (appt.patient_email) return appt.patient_email;
    if (appt.email) return appt.email;

    // 1. Lookup by ID
    if (appt.patient_id && nursePatients.length > 0) {
        const match = nursePatients.find(p => String(p.id) === String(appt.patient_id));
        if (match && match.email) return match.email;
    }

    // 2. Lookup by name
    if (appt.patient_name && nursePatients.length > 0) {
        const apptName = appt.patient_name.trim().toLowerCase();
        const match = nursePatients.find(p => (p.full_name || "").trim().toLowerCase() === apptName);
        if (match && match.email) return match.email;
    }

    return "No Email"; 
}
