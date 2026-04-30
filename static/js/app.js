// ============================
// CONFIGURE SUPABASE HERE
// ============================
// 1. In Supabase: Project Settings → API.
// 2. Copy the "Project URL" and "anon public" key.
// 3. Paste them below.

const SUPABASE_URL = "https://ctoybxukmkcnwdeueorm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0b3lieHVrbWtjbndkZXVlb3JtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3ODg3NzAsImV4cCI6MjA4ODM2NDc3MH0.hLDzyCvNzWbrXW-5Z1NsE6eH2sF_3S5L33htZYjEiH0";

// Simple front-end access code (for demo only, NOT real security).
// Change this to any string you like.
const ADMIN_ACCESS_CODE = "1234567890";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: window.sessionStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
});

// Global state for patient lookup
let allPatients = [];
let currentAdminStaff = null; // Holds the currently logged-in admin's profile
let claimingLocalMap = new Set(); // To prevent double greeting

// ============================
// NOTIFICATION SYSTEM GLOBALS
// ============================
let allPendingAppointmentNotifs = [];
let allLeaveNotifications = [];
let allPendingAccounts = [];
let notificationUIInitialized = false;
let leaveReviewRecordId = null;
let currentNotifTab = "appointments"; // appointments | leaves | accounts
let notifSearchQuery = "";
const APPT_NOTIF_READ_KEY = "apptNotifReadIds";

// --- Treatment Plan Helper ---
function getTreatmentPlanKey(a) {
  if (!a || !a.treatment_plan) return null;
  if (Array.isArray(a.treatment_plan) && a.treatment_plan.length > 0) {
    return a.treatment_plan[0].plan_key;
  }
  if (typeof a.treatment_plan === 'string') return a.treatment_plan;
  if (a.treatment_plan.plan_key) return a.treatment_plan.plan_key;
  return null;
}

// --- Search Highlighting Helper ---
function highlightText(text, term) {
  if (!term || !text) return escapeHtml(text);
  const escapedText = escapeHtml(text);
  // Escape regex special chars in term
  const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedTerm})`, 'gi');
  return escapedText.replace(regex, '<mark class="bg-yellow-200 text-slate-900 rounded-sm px-0.5">$1</mark>');
}

// --- Search Utilities ---
function debounce(func, timeout = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => { func.apply(this, args); }, timeout);
  };
}

function updateClearBtnVisibility(inputId, btnId) {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if (!input || !btn) return;
  if (input.value.length > 0) {
    btn.classList.remove('opacity-0', 'pointer-events-none', 'scale-75');
    btn.classList.add('opacity-100', 'pointer-events-auto', 'scale-100');
  } else {
    btn.classList.add('opacity-0', 'pointer-events-none', 'scale-75');
    btn.classList.remove('opacity-100', 'pointer-events-auto', 'scale-100');
  }
}

// --- Phone Formatting Logic ---
function formatPHPhone(input) {
  let val = input.value;
  if (!val.startsWith("63+ ")) {
    val = "63+ " + val.replace(/^63\+\s?/, "").replace(/\D/g, "");
  }
  let digits = val.substring(4).replace(/\D/g, "");
  let formatted = "63+ ";
  if (digits.length > 0) formatted += digits.substring(0, 3);
  if (digits.length > 3) formatted += " " + digits.substring(3, 6);
  if (digits.length > 6) formatted += " " + digits.substring(6, 10);
  input.value = formatted;
}

function handlePhoneBackspace(e, input) {
  if (e.key === "Backspace" && input.value.length <= 4) e.preventDefault();
}

// DOM elements
const mainContent = document.getElementById("mainContent");
const logoutBtn = document.getElementById("logoutBtn");
const sidebarLogoutBtn = document.getElementById("sidebarLogoutBtn");
const adminFooter = document.getElementById("adminFooter");

function updateAdminIdentity() {
  if (!currentAdminStaff) return;

  const sidebarName = document.querySelector(".sidebar-user-name"); // I should add these classes to index.html
  const sidebarEmail = document.querySelector(".sidebar-user-email");
  const sidebarInitials = document.querySelector(".sidebar-initials-badge");

  if (sidebarName) sidebarName.textContent = currentAdminStaff.name;
  if (sidebarEmail) sidebarEmail.textContent = currentAdminStaff.email;
  if (sidebarInitials) {
    const initials = currentAdminStaff.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
    sidebarInitials.textContent = initials;
  }
}

// Sidebar navigation
const navButtons = document.querySelectorAll("[data-nav-page]");
const pageCalendar = document.getElementById("page-calendar");
const pageAppointments = document.getElementById("page-appointments");
const pageFollowups = document.getElementById("page-followups");
const pageConsultation = document.getElementById("page-consultation");
const pageSchedule = document.getElementById("page-schedule");
const pageInventory = document.getElementById("page-inventory");
const pagePayroll = document.getElementById("page-payroll");
const pageAccounts = document.getElementById("page-accounts");
const pageStaff = document.getElementById("page-staff");
const pageMessages = document.getElementById("page-messages");
const pageSettings = document.getElementById("page-settings");
const pageAttendance = document.getElementById("page-attendance");

// Settings DOM
const clinicStatusForm = document.getElementById("clinicStatusForm");
const clinicIsOpen = document.getElementById("clinicIsOpen");
const clinicOpeningTime = document.getElementById("clinicOpeningTime");
const clinicClosingTime = document.getElementById("clinicClosingTime");
const clinicClosedNote = document.getElementById("clinicClosedNote");
const clinicClosedNoteCounter = document.getElementById("clinicClosedNoteCounter");
const clinicOperatingDays = document.querySelectorAll("#clinicOperatingDays input[type=checkbox]");
const clinicStatusMsg = document.getElementById("clinicStatusMsg");

if (clinicClosedNote && clinicClosedNoteCounter) {
  clinicClosedNote.addEventListener("input", () => {
    clinicClosedNoteCounter.textContent = clinicClosedNote.value.length;
  });
}

const newApptBtn = document.getElementById("newApptBtn");
const filterDate = document.getElementById("filterDate");
const filterStatus = document.getElementById("filterStatus");
const searchInput = document.getElementById("searchInput");
const apptCount = document.getElementById("apptCount");
const appointmentsBody = document.getElementById("appointmentsBody");

const apptModal = document.getElementById("apptModal");
const modalTitle = document.getElementById("modalTitle");
const closeModalBtn = document.getElementById("closeModalBtn");
const cancelBtn = document.getElementById("cancelBtn");
const apptForm = document.getElementById("apptForm");
const apptIdInput = document.getElementById("apptId");
const patientNameInput = document.getElementById("patientName");
const patientPhoneInput = document.getElementById("patientPhone");
const patientEmailInput = document.getElementById("patientEmail");
const doctorNameInput = document.getElementById("doctorName");
const apptDateInput = document.getElementById("apptDate");
const apptTimeInput = document.getElementById("apptTime");
const durationInput = document.getElementById("duration");
const statusInput = document.getElementById("status");
const notesInput = document.getElementById("notes");
const formError = document.getElementById("formError");
const appointmentTypeInput = document.getElementById("appointmentType");

let allAppointments = [];
let currentCalendarDate = new Date();
let currentCalDayDate = null; // Tracked date for the Day Modal
let currentStaffId = null;
let currentApptTab = "schedule"; // schedule | followups | consultation

// Settings DOM -> now Accounts DOM
const staffForm = document.getElementById("staffForm");
const staffImageInput = document.getElementById("staffImage");
const staffImagePreview = document.getElementById("staffImagePreview");
const imagePreviewContainer = document.getElementById("imagePreviewContainer");
const staffSaveMsg = document.getElementById("staffSaveMsg");
const staffListContainer = document.getElementById("staffListContainer");

// Edit Staff Modal DOM
const staffModal = document.getElementById("staffModal");
const editStaffForm = document.getElementById("editStaffForm");
const editStaffId = document.getElementById("editStaffId");
const editStaffName = document.getElementById("editStaffName");
const editStaffRole = document.getElementById("editStaffRole");
const editStaffEmail = document.getElementById("editStaffEmail");
const editStaffPhone = document.getElementById("editStaffPhone");
const editStaffSpecialty = document.getElementById("editStaffSpecialty");
const editStaffHourlyRate = document.getElementById("editStaffHourlyRate");
const editStaffAvailability = document.getElementById("editStaffAvailability");
const editStaffImage = document.getElementById("editStaffImage");
const editStaffImagePreview = document.getElementById("editStaffImagePreview");
const editImagePreviewContainer = document.getElementById("editImagePreviewContainer");
const closeStaffModalBtn = document.getElementById("closeStaffModalBtn");
const cancelStaffModalBtn = document.getElementById("cancelStaffModalBtn");

// Add Staff Modal DOM
const addStaffModal = document.getElementById("addStaffModal");
const staffNameInput = document.getElementById("staffName");
const staffRoleInput = document.getElementById("staffRole");
const staffEmailInput = document.getElementById("staffEmail");
const staffPhoneInput = document.getElementById("staffPhone");
const staffSpecialtyInput = document.getElementById("staffSpecialty");
const staffHourlyRateInput = document.getElementById("staffHourlyRate");
const staffAvailabilityInput = document.getElementById("staffAvailability");
const addStaffFab = document.getElementById("addStaffFab");
const closeAddStaffModalBtn = document.getElementById("closeAddStaffModalBtn");
const cancelAddStaffModalBtn = document.getElementById("cancelAddStaffModalBtn");

let currentStaffBase64 = null;
let currentEditStaffBase64 = null;
let allStaffData = []; // To cache records for edit

logoutBtn.addEventListener("click", async () => {
  await sb.auth.signOut();
  localStorage.removeItem("isAdminLoggedIn");
  window.location.href = "/";
});

if (sidebarLogoutBtn) {
  sidebarLogoutBtn.addEventListener("click", async () => {
    await sb.auth.signOut();
    localStorage.removeItem("isAdminLoggedIn");
    window.location.href = "/";
  });
}

// Session Initialization
sb.auth.getSession().then(({ data: { session } }) => {
  if (session && localStorage.getItem("isAdminLoggedIn") === "true") {
    // Session exists. Verify role again for security.
    sb.from("clinic_staff").select("*").eq("email", session.user.email).single()
      .then(({ data: staff }) => {
        const role = (staff?.role || "").toLowerCase();
        if (staff && (role === "doctor" || role === "administrator" || role === "staff")) {
          currentAdminStaff = staff;
          updateAdminIdentity();

          if (mainContent) mainContent.classList.remove("hidden");
          if (adminFooter) adminFooter.classList.remove("hidden");
          initApp();
        } else {
          // Unauthorized role or no staff record
          console.error("Unauthorized session access attempt blocked.");
          sb.auth.signOut();
          localStorage.removeItem("isAdminLoggedIn");
          window.location.href = "/";
        }
      });
  } else {
    // No session or flag not set
    localStorage.removeItem("isAdminLoggedIn");
    window.location.href = "/";
  }
});

// ============================
// SIDEBAR PAGE SWITCHING
// ============================

const pages = {
  calendar: pageCalendar,
  appointments: pageAppointments,
  followups: pageFollowups,
  consultation: pageConsultation,
  schedule: pageSchedule,
  inventory: pageInventory,
  payroll: pagePayroll,
  accounts: pageAccounts,
  staff: pageStaff,
  messages: pageMessages,
  settings: pageSettings,
  attendance: pageAttendance,
  "treatment-progress": document.getElementById("page-treatment-progress"),
  "application-form": document.getElementById("page-application-form"),
  "application-records": document.getElementById("page-application-records"),
  "reports": document.getElementById("page-reports"),
  "audit-log": document.getElementById("page-audit-log"),
  "recycle-bin": document.getElementById("page-recycle-bin"),
  "pending-patients": document.getElementById("page-pending-patients")
};

function setActivePage(pageKey) {
  // Save to localStorage for persistence
  localStorage.setItem("activePage", pageKey);

  // Reset content scroll position to top
  const cw = document.getElementById("contentWrapper");
  if (cw) cw.scrollTo({ top: 0, behavior: 'instant' });

  // Sync currentApptTab if we're switching to an appointment-related page
  if (pageKey === "appointments" && currentApptTab !== "all") setActiveApptTab("all");
  if (pageKey === "followups" && currentApptTab !== "followups") setActiveApptTab("followups");
  if (pageKey === "consultation" && currentApptTab !== "consultation") setActiveApptTab("consultation");

  Object.entries(pages).forEach(([key, section]) => {
    if (!section) return;
    if (key === pageKey) {
      section.classList.remove("hidden");
      section.classList.add("animate-in", "fade-in", "slide-in-from-bottom-4", "duration-300");
    } else {
      section.classList.add("hidden");
      section.classList.remove("animate-in", "fade-in", "slide-in-from-bottom-4", "duration-300");
    }
  });

  navButtons.forEach((btn) => {
    const target = btn.getAttribute("data-nav-page");
    if (target === pageKey) {
      btn.classList.add("active", "bg-white", "text-blue-600", "shadow-sm", "shadow-blue-900/5");
      btn.classList.remove("text-slate-500", "hover:bg-white/80", "hover:text-blue-600");
    } else {
      btn.classList.remove("active", "bg-white", "text-blue-600", "shadow-sm", "shadow-blue-900/5");
      btn.classList.add("text-slate-500", "hover:bg-white/80", "hover:text-blue-600");
    }
  });

  if (pageKey === "calendar") {
    renderCalendar();
  }

  // Reset Admin Messenger if navigating to messages
  const floatingContainer = document.getElementById("floatingChatContainer");
  const contentWrapper = document.getElementById("contentWrapper");
  if (pageKey === "messages") {
    if (floatingContainer) floatingContainer.classList.add("hidden");
    if (contentWrapper) {
      contentWrapper.classList.add("no-scrollbar", "overflow-hidden");
      contentWrapper.classList.remove("overflow-y-auto");
    }
    if (typeof resetAdminMessenger === "function") {
      resetAdminMessenger();
    }
  } else {
    if (floatingContainer) floatingContainer.classList.remove("hidden");
    if (contentWrapper) {
      contentWrapper.classList.remove("no-scrollbar", "overflow-hidden");
      contentWrapper.classList.add("overflow-y-auto");
    }
  }

  // Re-run lucide icons to ensure any new content has icons
  if (window.lucide) {
    window.lucide.createIcons();
  }

  // Show Accounts FAB only on the Staff page
  if (addStaffFab) {
    if (pageKey === "staff") {
      addStaffFab.classList.remove("hidden");
    } else {
      addStaffFab.classList.add("hidden");
    }
  }

  // Show Chat FAB only on Appointments-related pages
  const chatFabEl = document.getElementById("chatFab");
  if (chatFabEl) {
    const apptPages = ["appointments", "followups", "consultation"];
    if (apptPages.includes(pageKey)) {
      chatFabEl.classList.remove("hidden");
    } else {
      chatFabEl.classList.add("hidden");
      // Also close the panel if open
      const panel = document.getElementById("chatPanel");
      if (panel && (!panel.classList.contains("hidden") || panel.style.display === "flex")) {
        panel.classList.add("hidden");
        panel.style.display = "none";
        chatFabEl.classList.remove("chat-fab-open");
      }
    }
  }
}

navButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.getAttribute("data-nav-page");
    if (!target) return;
    setActivePage(target);

    // If we switched to an appointment page, fetch immediately
    if (["appointments", "followups", "consultation"].includes(target)) {
      fetchAppointments();
    } else if (target === "schedule") {
      fetchScheduleTimetable();
    } else if (target === "treatment-progress") {
      loadProgressPatients();
      initTreatmentProgress();
    } else if (target === "attendance") {
      initAttendancePage();
    } else if (target === "reports") {
      initReportsPage();
    } else if (target === "audit-log") {
      initAuditTrailPage();
    } else if (target === "recycle-bin") {
      initRecycleBin();
    } else if (target === "pending-patients") {
      fetchPendingPatients();
    }
  });
});

// ============================
// APPOINTMENTS TAB BAR (UI ONLY)
// ============================

const apptTabs = document.querySelectorAll("[data-appt-tab]");
const apptViewSchedule = document.getElementById("appt-view-schedule");
const apptViewFollowups = document.getElementById("appt-view-followups");
const apptViewConsultation = document.getElementById("appt-view-consultation");

function setActiveApptTab(tabKey) {
  if (currentApptTab === tabKey && document.querySelector(`[data-appt-tab="${tabKey}"].bg-blue-50`)) return;
  currentApptTab = tabKey;

  const targetPage = (tabKey === "schedule" || tabKey === "all") ? "appointments" : tabKey;

  // Only switch page if we are not already on the target page
  const targetSection = pages[targetPage];
  if (targetSection && targetSection.classList.contains("hidden")) {
    setActivePage(targetPage);
  }

  // Update tab buttons active state across all pages
  const allTabBtns = document.querySelectorAll("[data-appt-tab]");
  allTabBtns.forEach(btn => {
    const key = btn.getAttribute("data-appt-tab");
    if (key === tabKey) {
      btn.classList.add("border-blue-500", "bg-blue-50", "text-blue-700");
      btn.classList.remove("border-transparent", "bg-slate-50", "bg-slate-100", "text-slate-500", "text-slate-600");
    } else {
      btn.classList.remove("border-blue-500", "bg-blue-50", "text-blue-700");
      btn.classList.add("border-transparent", "bg-slate-50", "text-slate-500");
    }
  });
}

apptTabs.forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.getAttribute("data-appt-tab");
    if (!target) return;
    setActiveApptTab(target);
    fetchAppointments();
  });
});

// ============================
// CALENDAR GRID LOGIC
// ============================

function renderCalendar() {
  const calendarMonthTitle = document.getElementById("calendarMonthTitle");
  const calendarDaysGrid = document.getElementById("calendarDaysGrid");
  if (!calendarMonthTitle || !calendarDaysGrid) return;

  const year = currentCalendarDate.getFullYear();
  const month = currentCalendarDate.getMonth();

  // Set Title (e.g., April 2026)
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  calendarMonthTitle.textContent = `${monthNames[month]} ${year}`;

  calendarDaysGrid.innerHTML = "";

  // Get first day of month (0 = Sunday)
  const firstDay = new Date(year, month, 1).getDay();
  // Get days in current month
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Get days in previous month
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const today = new Date();
  const todayStr = today.toLocaleDateString('en-CA'); // YYYY-MM-DD format

  // Update Insights Sidebar
  updateCalendarInsights();

  const searchVal = document.getElementById("calendarSearchInput")?.value.toLowerCase() || "";

  // 1. Previous Month Days
  for (let i = firstDay - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    const dateObj = new Date(year, month - 1, day);
    const dateStr = dateObj.toLocaleDateString('en-CA');
    appendCalendarDay(day, "prev", dateStr, false, searchVal);
  }

  // 2. Current Month Days
  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(year, month, d);
    const dateStr = dateObj.toLocaleDateString('en-CA');
    const isToday = dateStr === todayStr;
    appendCalendarDay(d, "current", dateStr, isToday, searchVal);
  }

  // 3. Next Month Days (fill the rest of the 7x6 grid = 42 cells)
  const totalCells = 42;
  const usedCells = firstDay + daysInMonth;
  for (let i = 1; i <= (totalCells - usedCells); i++) {
    const dateObj = new Date(year, month + 1, i);
    const dateStr = dateObj.toLocaleDateString('en-CA');
    appendCalendarDay(i, "next", dateStr, false, searchVal);
  }

  // Staggered Animation for grid
  const days = calendarDaysGrid.querySelectorAll(".calendar-day");
  days.forEach((day, idx) => {
    day.style.opacity = "0";
    day.style.transform = "translateY(10px)";
    setTimeout(() => {
      day.style.transition = "all 0.4s cubic-bezier(0.16, 1, 0.3, 1)";
      day.style.opacity = "1";
      day.style.transform = "translateY(0)";
    }, idx * 10);
  });

  if (window.lucide) window.lucide.createIcons();
}

function updateCalendarInsights() {
  const todayStr = new Date().toLocaleDateString('en-CA');
  const todayAppts = allAppointments.filter(a => a.appointment_date === todayStr);

  const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };

  el("calStatTodayTotal", todayAppts.length);
  el("calStatTodayPending", todayAppts.filter(a => (a.status || "").toLowerCase() === "pending").length);
  el("calStatTodayDone", todayAppts.filter(a => ["done", "completed"].includes((a.status || "").toLowerCase())).length);

  // Monthly Goal
  const month = currentCalendarDate.getMonth();
  const year = currentCalendarDate.getFullYear();
  const monthAppts = allAppointments.filter(a => {
    if (!a.appointment_date) return false;
    const d = new Date(a.appointment_date);
    return d.getMonth() === month && d.getFullYear() === year;
  });

  const completed = monthAppts.filter(a => ["done", "completed"].includes((a.status || "").toLowerCase())).length;
  const total = monthAppts.length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  const percentEl = document.getElementById("calMonthCompletionPercent");
  if (percentEl) percentEl.textContent = `${percent}%`;

  const barEl = document.getElementById("calMonthProgressBar");
  if (barEl) barEl.style.width = `${percent}%`;

  // New sidebar elements
  el("calMonthCompletedCount", completed);
  el("calMonthTotalLabel", `${total} total`);
  const scheduled = monthAppts.filter(a => ["scheduled", "accepted"].includes((a.status || "").toLowerCase())).length;
  el("calMonthScheduledLabel", `${scheduled} scheduled`);

  // Header stat badges
  el("calHeaderMonthCount", total);
  el("calHeaderTodayCount", todayAppts.length);

  // Live clock
  const clockEl = document.getElementById("calHeaderClock");
  if (clockEl) {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
  }

  // Upcoming appointments (next 5 from today onwards)
  const upList = document.getElementById("calUpcomingList");
  if (upList) {
    const upcoming = allAppointments
      .filter(a => a.appointment_date >= todayStr && !["done", "completed", "cancelled"].includes((a.status || "").toLowerCase()))
      .sort((a, b) => (a.appointment_date + (a.appointment_time || "")).localeCompare(b.appointment_date + (b.appointment_time || "")))
      .slice(0, 5);

    if (upcoming.length === 0) {
      upList.innerHTML = '<div class="text-center py-6 text-[10px] font-bold text-slate-300">No upcoming appointments</div>';
    } else {
      upList.innerHTML = upcoming.map(a => {
        const isToday = a.appointment_date === todayStr;
        return `
          <div onclick="openCalendarTimetableModal('${a.appointment_date}')" class="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-100 hover:bg-blue-50 hover:border-blue-100 cursor-pointer transition-all group">
            <div class="w-9 h-9 rounded-xl ${isToday ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-400'} flex items-center justify-center text-[9px] font-black shrink-0 group-hover:bg-blue-100 group-hover:text-blue-600 transition-colors">
              ${formatTime12h(a.appointment_time).replace(' ', '<br>')}
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-[11px] font-black text-slate-700 truncate">${a.patient_name || 'Patient'}</div>
              <div class="text-[9px] font-bold text-slate-400 truncate">${isToday ? 'Today' : a.appointment_date} • Clinic Staff</div>
            </div>
          </div>`;
      }).join('');
    }
  }

  // Update Holidays This Month sidebar
  updateCalendarHolidays(month, year);
}

function updateCalendarHolidays(month, year) {
  const listEl = document.getElementById("calHolidaysList");
  if (!listEl) return;

  // Filter holidays for the current month/year
  const monthHolidays = Object.entries(PH_HOLIDAYS || {}).filter(([dateStr]) => {
    const d = new Date(dateStr + "T00:00:00");
    return d.getMonth() === month && d.getFullYear() === year;
  }).sort(([a], [b]) => a.localeCompare(b));

  if (monthHolidays.length === 0) {
    listEl.innerHTML = '<div class="text-center py-4 text-[10px] font-bold text-slate-300">No holidays this month</div>';
    return;
  }

  listEl.innerHTML = monthHolidays.map(([dateStr, h]) => {
    const d = new Date(dateStr + "T00:00:00");
    const dayNum = d.getDate();
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });

    let colors, icon, typeLabel;
    if (h.type === "regular") {
      colors = "bg-red-50 border-red-200 text-red-700";
      icon = "calendar-off";
      typeLabel = "Regular Holiday";
    } else if (h.type === "special_working") {
      colors = "bg-amber-50 border-amber-200 text-amber-700";
      icon = "briefcase";
      typeLabel = "Special Working Day";
    } else {
      colors = "bg-blue-50 border-blue-200 text-blue-700";
      icon = "star";
      typeLabel = "Special Non-Working";
    }

    return `
      <div class="flex items-center gap-3 p-3 rounded-2xl ${colors} border transition-all hover:shadow-sm">
        <div class="w-10 h-10 rounded-xl ${h.type === 'regular' ? 'bg-red-100' : h.type === 'special_working' ? 'bg-amber-100' : 'bg-blue-100'} flex flex-col items-center justify-center shrink-0">
          <span class="text-[8px] font-black uppercase leading-none">${dayName}</span>
          <span class="text-sm font-black leading-tight">${dayNum}</span>
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-[11px] font-black truncate">${h.name}</div>
          <div class="flex items-center gap-1 mt-0.5">
            <i data-lucide="${icon}" class="w-2.5 h-2.5 opacity-70"></i>
            <span class="text-[8px] font-bold uppercase tracking-wider opacity-70">${typeLabel}</span>
          </div>
        </div>
      </div>`;
  }).join('');

  if (window.lucide) window.lucide.createIcons({ root: listEl });
}

// Live clock interval for calendar header
setInterval(() => {
  const clockEl = document.getElementById("calHeaderClock");
  if (clockEl) {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
  }
}, 1000);

// ============================
// PHILIPPINE HOLIDAYS
// ============================
const PH_HOLIDAYS = {
  // ==========================================
  // 2025 — Proclamation No. 727
  // ==========================================
  // Regular Holidays
  "2025-01-01": { name: "New Year's Day", type: "regular" },
  "2025-04-09": { name: "Araw ng Kagitingan", type: "regular" },
  "2025-04-17": { name: "Maundy Thursday", type: "regular" },
  "2025-04-18": { name: "Good Friday", type: "regular" },
  "2025-05-01": { name: "Labor Day", type: "regular" },
  "2025-06-12": { name: "Independence Day", type: "regular" },
  "2025-08-25": { name: "National Heroes Day", type: "regular" },
  "2025-11-30": { name: "Bonifacio Day", type: "regular" },
  "2025-12-25": { name: "Christmas Day", type: "regular" },
  "2025-12-30": { name: "Rizal Day", type: "regular" },
  // Special (Non-Working) Days
  "2025-01-29": { name: "Chinese New Year", type: "special" },
  "2025-02-25": { name: "EDSA People Power Anniversary", type: "special" },
  "2025-04-19": { name: "Black Saturday", type: "special" },
  "2025-08-21": { name: "Ninoy Aquino Day", type: "special" },
  "2025-10-31": { name: "Special Non-Working Day", type: "special" },
  "2025-11-01": { name: "All Saints' Day", type: "special" },
  "2025-12-08": { name: "Immaculate Conception", type: "special" },
  "2025-12-24": { name: "Christmas Eve", type: "special" },
  "2025-12-31": { name: "Last Day of the Year", type: "special" },
  // Islamic Holidays 2025 (approximate)
  "2025-03-30": { name: "Eid'l Fitr", type: "regular" },
  "2025-06-06": { name: "Eid'l Adha", type: "regular" },

  // ==========================================
  // 2026 — Proclamation No. 1006
  // ==========================================
  // Regular Holidays
  "2026-01-01": { name: "New Year's Day", type: "regular" },
  "2026-04-02": { name: "Maundy Thursday", type: "regular" },
  "2026-04-03": { name: "Good Friday", type: "regular" },
  "2026-04-09": { name: "Araw ng Kagitingan", type: "regular" },
  "2026-05-01": { name: "Labor Day", type: "regular" },
  "2026-06-12": { name: "Independence Day", type: "regular" },
  "2026-08-31": { name: "National Heroes Day", type: "regular" },
  "2026-11-30": { name: "Bonifacio Day", type: "regular" },
  "2026-12-25": { name: "Christmas Day", type: "regular" },
  "2026-12-30": { name: "Rizal Day", type: "regular" },
  // Special (Non-Working) Days
  "2026-02-17": { name: "Chinese New Year", type: "special" },
  "2026-04-04": { name: "Black Saturday", type: "special" },
  "2026-08-21": { name: "Ninoy Aquino Day", type: "special" },
  "2026-11-01": { name: "All Saints' Day", type: "special" },
  "2026-11-02": { name: "All Souls' Day", type: "special" },
  "2026-12-08": { name: "Immaculate Conception", type: "special" },
  "2026-12-24": { name: "Christmas Eve", type: "special" },
  "2026-12-31": { name: "Last Day of the Year", type: "special" },
  // Special (Working) Day
  "2026-02-25": { name: "EDSA People Power Anniversary", type: "special_working" },
  // Islamic Holidays 2026 (approximate)
  "2026-03-20": { name: "Eid'l Fitr", type: "regular" },
  "2026-05-27": { name: "Eid'l Adha", type: "regular" },

  // ==========================================
  // 2027 (Projected based on RA 9492 & RA 9849)
  // ==========================================
  // Regular Holidays
  "2027-01-01": { name: "New Year's Day", type: "regular" },
  "2027-03-25": { name: "Maundy Thursday", type: "regular" },
  "2027-03-26": { name: "Good Friday", type: "regular" },
  "2027-04-09": { name: "Araw ng Kagitingan", type: "regular" },
  "2027-05-01": { name: "Labor Day", type: "regular" },
  "2027-06-12": { name: "Independence Day", type: "regular" },
  "2027-08-30": { name: "National Heroes Day", type: "regular" },
  "2027-11-30": { name: "Bonifacio Day", type: "regular" },
  "2027-12-25": { name: "Christmas Day", type: "regular" },
  "2027-12-30": { name: "Rizal Day", type: "regular" },
  // Special (Non-Working) Days
  "2027-02-06": { name: "Chinese New Year", type: "special" },
  "2027-02-25": { name: "EDSA People Power Anniversary", type: "special" },
  "2027-03-27": { name: "Black Saturday", type: "special" },
  "2027-08-21": { name: "Ninoy Aquino Day", type: "special" },
  "2027-11-01": { name: "All Saints' Day", type: "special" },
  "2027-11-02": { name: "All Souls' Day", type: "special" },
  "2027-12-08": { name: "Immaculate Conception", type: "special" },
  "2027-12-24": { name: "Christmas Eve", type: "special" },
  "2027-12-31": { name: "Last Day of the Year", type: "special" },
  // Islamic Holidays 2027 (approximate)
  "2027-03-10": { name: "Eid'l Fitr", type: "regular" },
  "2027-05-16": { name: "Eid'l Adha", type: "regular" },
};

function appendCalendarDay(day, type, dateStr, isToday = false, searchVal = "") {
  const grid = document.getElementById("calendarDaysGrid");
  const cell = document.createElement("div");

  // Find appointments for this day
  const appts = allAppointments.filter(a => a.appointment_date === dateStr);

  // Check for holiday
  const holiday = PH_HOLIDAYS[dateStr] || null;

  // Check search match
  const isSearchMatch = searchVal && appts.some(a => (a.patient_name || "").toLowerCase().includes(searchVal));

  // Base classes
  cell.className = `calendar-day group min-h-[110px] p-2 border-r border-b border-slate-100 transition-all hover:bg-slate-50/80 cursor-pointer flex flex-col relative`;

  if (type !== 'current') {
    cell.classList.add("bg-slate-50/50", "text-slate-300");
  } else if (holiday && holiday.type === "regular") {
    cell.classList.add("bg-red-50/60", "text-slate-700");
  } else if (holiday && holiday.type === "special") {
    cell.classList.add("bg-blue-50/40", "text-slate-700");
  } else if (holiday && holiday.type === "special_working") {
    cell.classList.add("bg-amber-50/40", "text-slate-700");
  } else {
    cell.classList.add("bg-white", "text-slate-700");
  }

  if (isSearchMatch) {
    cell.classList.add("ring-2", "ring-inset", "ring-blue-500", "bg-blue-50/30");
  }

  // Holiday badge HTML
  let holidayHtml = "";
  if (holiday && type === "current") {
    const hColors = holiday.type === "regular"
      ? "bg-red-100 text-red-700 border-red-200"
      : holiday.type === "special_working"
        ? "bg-amber-100 text-amber-700 border-amber-200"
        : "bg-blue-100 text-blue-700 border-blue-200";
    const hIcon = holiday.type === "regular" ? "calendar-off" : holiday.type === "special_working" ? "briefcase" : "star";
    const hTitle = holiday.type === "regular" ? "Regular Holiday" : holiday.type === "special_working" ? "Special Working Day" : "Special Non-Working Holiday";
    holidayHtml = `
      <div class="flex items-center gap-1 px-1.5 py-0.5 rounded-md ${hColors} border mb-1" title="${holiday.name} (${hTitle})">
        <i data-lucide="${hIcon}" class="w-2.5 h-2.5"></i>
        <span class="text-[8px] font-black uppercase tracking-wider truncate">${holiday.name}</span>
      </div>`;
  }

  cell.innerHTML = `
    <div class="flex items-center justify-between mb-1">
      <span class="w-7 h-7 flex items-center justify-center rounded-full text-[11px] font-black ${isToday ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30' : ''} ${holiday && type === 'current' && holiday.type === 'regular' ? 'text-red-600' : ''} ${holiday && type === 'current' && holiday.type === 'special' ? 'text-blue-600' : ''} ${holiday && type === 'current' && holiday.type === 'special_working' ? 'text-amber-600' : ''}">
        ${day}
      </span>
      ${appts.length > 0 ? `<span class="text-[9px] font-black text-slate-400 group-hover:text-blue-500 transition-colors">${appts.length} Appt${appts.length > 1 ? 's' : ''}</span>` : ''}
    </div>
    ${holidayHtml}
    <div class="space-y-1 flex-1 overflow-y-auto no-scrollbar">
      ${appts.slice(0, holiday ? 2 : 3).map(a => {
    const status = (a.status || "pending").toLowerCase();
    let dotColor = "bg-amber-400";
    if (status === "done" || status === "completed") dotColor = "bg-emerald-500";
    if (status === "cancelled") dotColor = "bg-rose-500";
    if (status === "scheduled" || status === "accepted") dotColor = "bg-blue-500";

    return `
          <div class="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white border border-slate-100 shadow-sm group-hover:border-slate-200 transition-all">
            <div class="w-1.5 h-1.5 rounded-full ${dotColor} shrink-0"></div>
            <span class="text-[10px] font-bold text-slate-600 truncate">${a.patient_name}</span>
          </div>
        `;
  }).join('')}
      ${appts.length > (holiday ? 2 : 3) ? `<p class="text-[9px] font-black text-slate-400 pl-2">+ ${appts.length - (holiday ? 2 : 3)} more</p>` : ''}
    </div>
  `;

  cell.onclick = () => {
    openCalendarTimetableModal(dateStr);
  };

  grid.appendChild(cell);
}

// Add Search Listener
document.addEventListener("DOMContentLoaded", () => {
  const calSearch = document.getElementById("calendarSearchInput");
  if (calSearch) {
    calSearch.addEventListener("input", debounce(() => {
      renderCalendar();
    }, 300));
  }
});

function prevMonth() {
  currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
  renderCalendar();
}

function nextMonth() {
  currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
  renderCalendar();
}

function goToToday() {
  currentCalendarDate = new Date();
  renderCalendar();
}

// Navigate to Schedule matrix for a specific date
function navigateToScheduleForDate(dateStr) {
  // Set the schedule date filter
  const dateInput = document.getElementById("scheduleTimetableDate");
  if (dateInput) dateInput.value = dateStr;

  // Force daily view so only that day's appointments show
  const rangeInput = document.getElementById("scheduleTimetableRange");
  if (rangeInput) rangeInput.value = "daily";

  // Navigate to the schedule page
  setActivePage("schedule");

  // Fetch and render the timetable for that date
  if (typeof fetchScheduleTimetable === "function") {
    fetchScheduleTimetable();
  }
}

// Open visually appealing daily timetable modal matching Schedule Matrix
window.openCalendarTimetableModal = function(dateStr) {
  const modal = document.getElementById("calendarTimetableModal");
  if (!modal) return;

  const dateObj = new Date(dateStr);
  const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
  const dateFull = dateObj.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  document.getElementById("calModalDayName").textContent = dayName;
  document.getElementById("calModalDateStr").textContent = dateFull;

  // Clinic Hours
  let startHour = 8;
  let endHour = 17;
  const openTimeVal = document.getElementById("clinicOpeningTime")?.value;
  const closeTimeVal = document.getElementById("clinicClosingTime")?.value;
  if (openTimeVal) startHour = parseInt(openTimeVal.split(":")[0]);
  if (closeTimeVal) endHour = parseInt(closeTimeVal.split(":")[0]);

  document.getElementById("calModalClinicHours").textContent = `${formatTime12h(openTimeVal || "08:00")} - ${formatTime12h(closeTimeVal || "17:00")}`;

  // Appointments for this specific day
  const dayAppts = allAppointments.filter(a => a.appointment_date === dateStr);
  
  // Dynamic Hour range adjustment to fit all appointments
  dayAppts.forEach(a => {
      if (a.appointment_time) {
          const h = parseInt(a.appointment_time.split(":")[0]);
          if (h < startHour) startHour = h;
          if (h > endHour) endHour = h;
      }
  });

  const hoursArray = [];
  for (let h = startHour; h <= endHour; h++) {
    hoursArray.push(h);
  }

  const grid = document.getElementById("calModalGrid");
  
  // Matrix Layout logic
  let gridHtml = `
    <div class="flex flex-col w-full bg-white">
      <!-- Grid Header -->
      <div class="flex border-b border-slate-200 bg-slate-100 sticky top-0 z-10">
        <div class="w-[70px] shrink-0 border-r border-slate-200 flex items-center justify-center py-3">
          <span class="text-[9px] font-black uppercase tracking-widest text-slate-400">Time</span>
        </div>
        <div class="flex-1 px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex items-center gap-2">
          <i data-lucide="users" class="w-3.5 h-3.5 opacity-70"></i>
          <span class="text-[11px] font-black uppercase tracking-widest">Clinic Schedule</span>
        </div>
      </div>

      <!-- Grid Rows -->
      ${hoursArray.map(h => {
          const ampm = h >= 12 ? 'PM' : 'AM';
          const dHour = h % 12 || 12;
          const isLunch = h === 12;
          const rowBg = isLunch ? 'bg-slate-50/80' : (h % 2 === 0 ? 'bg-white' : 'bg-slate-50/30');

          const apptsInHour = dayAppts.filter(a => parseInt((a.appointment_time || "").split(":")[0]) === h)
                                     .sort((a,b) => (a.appointment_time || "").localeCompare(b.appointment_time || ""));

          return `
            <div class="flex border-b border-slate-100 min-h-[60px] ${rowBg}">
              <div class="w-[60px] shrink-0 border-r border-slate-200 p-2 flex flex-col items-center justify-start">
                <span class="text-[11px] font-black text-slate-700">${dHour}:00</span>
                <span class="text-[8px] font-bold text-slate-400 uppercase tracking-tighter">${ampm}</span>
              </div>
              <div class="flex-1 p-1.5 flex flex-col gap-1.5">
                ${isLunch ? `
                  <div class="flex items-center justify-center gap-2 py-2 opacity-30">
                    <i data-lucide="coffee" class="w-3 h-3"></i>
                    <span class="text-[9px] font-black uppercase tracking-[3px]">Lunch Break</span>
                  </div>
                ` : ''}
                ${apptsInHour.length === 0 && !isLunch ? `
                   <div class="h-full flex items-center justify-center border border-dashed border-slate-100 rounded-[16px] py-2 group hover:border-slate-200 transition-all">
                      <span class="text-[7px] font-bold text-slate-200 uppercase tracking-widest group-hover:text-slate-300 transition-colors">Available</span>
                   </div>
                ` : apptsInHour.map(a => {
                    const status = (a.status || "pending").toLowerCase();
                    let accentBorder = "border-l-blue-500";
                    let accentBg = "bg-blue-50";
                    let accentText = "text-blue-600";
                    let dotColor = "bg-blue-500";
                    
                    if (status === "done" || status === "completed") {
                        accentBorder = "border-l-emerald-500";
                        accentBg = "bg-emerald-50";
                        accentText = "text-emerald-600";
                        dotColor = "bg-emerald-500";
                    } else if (status === "cancelled" || status === "declined") {
                        accentBorder = "border-l-rose-500";
                        accentBg = "bg-rose-50";
                        accentText = "text-rose-600";
                        dotColor = "bg-rose-500";
                    } else if (status === "pending") {
                        accentBorder = "border-l-amber-500";
                        accentBg = "bg-amber-50";
                        accentText = "text-amber-600";
                        dotColor = "bg-amber-500";
                    }

                    return `
                      <div onclick="navigateToAppointmentsForDate('${a.appointment_date}')" class="group relative bg-white border border-slate-200 rounded-[18px] p-2.5 shadow-sm hover:shadow-md hover:border-blue-200 transition-all cursor-pointer overflow-hidden border-l-[3px] ${accentBorder}">
                        <div class="flex items-center justify-between mb-1.5">
                          <div class="flex items-center gap-2">
                            <span class="text-[9px] font-black ${accentText} ${accentBg} px-1.5 py-0.5 rounded-md">${formatTime12h(a.appointment_time)}</span>
                            <span class="text-[7px] font-bold text-slate-400 uppercase tracking-widest">${a.appointment_type || 'Schedule'}</span>
                          </div>
                          <span class="w-1 h-1 rounded-full ${dotColor}"></span>
                        </div>
                        <p class="text-[12px] font-black text-slate-800 truncate mb-0.5 group-hover:text-blue-600 transition-colors">${a.patient_name}</p>
                        <div class="flex items-center gap-1.5 mt-0.5">
                           <span class="text-[8px] font-bold text-slate-400 uppercase tracking-tight">${a.doctor_name || 'Clinic Staff'}</span>
                           <span class="w-0.5 h-0.5 rounded-full bg-slate-200"></span>
                           <span class="text-[8px] font-black ${accentText.replace('600', '500')} uppercase tracking-tighter">${status}</span>
                        </div>
                      </div>
                    `;
                }).join('')}
              </div>
            </div>
          `;
      }).join('')}
    </div>
  `;

  grid.innerHTML = gridHtml;
  
  modal.classList.remove("hidden");
  if (window.lucide) window.lucide.createIcons();
};

window.closeCalendarTimetableModal = function() {
  const modal = document.getElementById("calendarTimetableModal");
  if (modal) modal.classList.add("hidden");
};

// Navigate to Appointments page filtered by a specific date
window.navigateToAppointmentsForDate = function(dateStr) {
  // Set the date filter in appointments page
  const dateInput = document.getElementById("filterDate");
  if (dateInput) {
    dateInput.value = dateStr;
  }
  
  // Set status filter to All
  const statusFilter = document.getElementById("filterStatus");
  if (statusFilter) {
    statusFilter.value = ""; 
  }

  // Switch to appointments page
  setActivePage("appointments");
  
  // Set tab to 'all' and update tab UI
  currentApptTab = "all"; 
  document.querySelectorAll('[data-appt-tab]').forEach(btn => {
    if (btn.getAttribute('data-appt-tab') === 'all') {
      btn.className = "inline-flex items-center rounded-full border border-blue-500 bg-blue-50 px-2.5 py-0.5 text-[10px] font-bold text-blue-700";
    } else {
      btn.className = "inline-flex items-center rounded-full border border-transparent bg-slate-50 px-2.5 py-0.5 text-[10px] font-bold text-slate-500 hover:bg-slate-100";
    }
  });

  // Re-render the appointment table
  if (typeof renderAppointments === "function") {
    renderAppointments();
  }
  
  // Close the timetable modal
  closeCalendarTimetableModal();
};

// --- Calendar Day Modal Logic ---
function openCalDayModal(dateStr, appts) {
  currentCalDayDate = dateStr;
  const modal = document.getElementById("calDayModal");
  const card = document.getElementById("calDayCard");
  const title = document.getElementById("calDayModalDate");
  const count = document.getElementById("calDayModalCount");
  const content = document.getElementById("calDayModalContent");

  if (!modal || !card) return;

  const d = new Date(dateStr);
  const options = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
  title.textContent = d.toLocaleDateString('en-US', options);
  count.textContent = `${appts.length} Appointment${appts.length !== 1 ? 's' : ''}`;

  content.innerHTML = "";
  if (appts.length === 0) {
    content.innerHTML = `
      <div class="flex flex-col items-center justify-center py-10 text-center">
        <div class="w-16 h-16 rounded-[24px] bg-slate-50 flex items-center justify-center mb-4 border border-slate-100">
           <i data-lucide="calendar-plus" class="w-8 h-8 text-slate-300"></i>
        </div>
        <p class="text-xs font-black text-slate-400 uppercase tracking-widest">No plans yet</p>
        <p class="text-[10px] font-bold text-slate-300 mt-1">Tap 'Add New' to schedule someone.</p>
      </div>
    `;
  } else {
    appts.forEach(a => {
      const status = (a.status || "pending").toLowerCase();
      let dotColor = "bg-blue-500";
      if (status === "pending") dotColor = "bg-amber-500";
      if (status === "done" || status === "completed") dotColor = "bg-emerald-500";
      if (status === "cancelled") dotColor = "bg-rose-500";

      const item = document.createElement("div");
      item.className = "flex items-center gap-4 p-4 rounded-[22px] bg-white border border-slate-100 hover:border-blue-100 hover:shadow-md transition-all mb-2 cursor-pointer group";
      item.innerHTML = `
        <div class="w-10 h-10 rounded-2xl bg-slate-50 flex items-center justify-center text-[10px] font-black text-slate-400 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
          ${formatTime12h(a.appointment_time)}
        </div>
        <div class="flex-1 min-w-0">
          <h4 class="text-sm font-black text-slate-800 truncate">${a.patient_name}</h4>
          <p class="text-[10px] font-bold text-slate-400 truncate">Clinic Staff • ${a.patient_condition || 'Routine'}</p>
        </div>
        <div class="w-2 h-2 rounded-full ${dotColor} shadow-sm"></div>
      `;
      item.onclick = () => {
        closeCalDayModal();
        openModal("edit", a);
      };
      content.appendChild(item);
    });
  }

  modal.classList.remove("hidden");
  modal.classList.add("flex");
  setTimeout(() => {
    card.classList.remove("scale-95", "opacity-0");
    card.classList.add("scale-100", "opacity-100");
  }, 10);

  if (window.lucide) window.lucide.createIcons({ root: content });
}

function closeCalDayModal() {
  const modal = document.getElementById("calDayModal");
  const card = document.getElementById("calDayCard");
  if (!modal || !card) return;

  card.classList.add("scale-95", "opacity-0");
  card.classList.remove("scale-100", "opacity-100");
  setTimeout(() => {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }, 300);
}

function openNewApptFromCal() {
  if (!currentCalDayDate) return;
  closeCalDayModal();
  const fd = document.getElementById("filterDate");
  if (fd) fd.value = currentCalDayDate;
  openModal('new');
}

function viewAllDayAppts() {
  if (!currentCalDayDate) return;
  closeCalDayModal();
  navigateToScheduleForDate(currentCalDayDate);
}

// ============================
// SUPABASE HELPERS
// ============================

let lastAppointmentsHash = "";

async function fetchAppointments(quiet = false) {
  if (!quiet) showGlobalLoader();
  try {
  let query = sb
    .from("appointments")
    .select("*, treatment_plan(*)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(0, 9999);

  // Get filter values based on active tab
  let dateVal = "";
  let statusVal = "";

  if (currentApptTab === "schedule" || currentApptTab === "all") {
    dateVal = filterDate ? filterDate.value : "";
    statusVal = filterStatus ? filterStatus.value : "";
  } else if (currentApptTab === "followups") {
    const fd = document.getElementById("filterDateFollowups");
    const fs = document.getElementById("filterStatusFollowups");
    if (fd) dateVal = fd.value;
    if (fs) statusVal = fs.value;
  } else if (currentApptTab === "consultation") {
    const fd = document.getElementById("filterDateConsultation");
    const fs = document.getElementById("filterStatusConsultation");
    if (fd) dateVal = fd.value;
    if (fs) statusVal = fs.value;
  }

  if (dateVal) {
    query = query.eq("appointment_date", dateVal);
  }

  if (statusVal) {
    query = query.eq("status", statusVal);
  }

  const { data, error, count } = await query;

  if (error) {
    console.error("Error fetching appointments:", error);
    renderErrorRow("Error loading appointments from Supabase.");
    return;
  }

  console.log(`[Admin] Fetched ${(data || []).length} appointments (DB total: ${count}). Tab: ${currentApptTab}, DateFilter: "${dateVal}", StatusFilter: "${statusVal}"`);

  const currentHash = JSON.stringify(data);
  if (currentHash === lastAppointmentsHash) {
    // Even if same hash, we might need to re-render to switch targets
    renderAppointments();
    return;
  }
  lastAppointmentsHash = currentHash;

  allAppointments = data || [];
  renderAppointments();

  // Also refresh calendar if active
    if (document.getElementById("page-calendar") && !document.getElementById("page-calendar").classList.contains("hidden")) {
      renderCalendar();
    }
  } catch (err) {
    console.error("Error in fetchAppointments:", err);
  } finally {
    if (!quiet) hideGlobalLoader();
  }
}

// Fetch all patients for contact lookup and accounts list
async function fetchPatients() {
  showGlobalLoader();
  try {
    // Fetch ALL patients (regardless of account_status) so that
    // contact/email lookup works for every appointment row & detail modal.
    const { data, error } = await sb
      .from("patients")
      .select("*");

    if (error) {
      console.error("[fetchPatients] Supabase error:", error);
      throw error;
    }
    allPatients = data || [];
    renderPatientAccounts();
  } catch (err) {
    console.error("Error fetching patients:", err);
  } finally {
    hideGlobalLoader();
  }
}

function renderPatientAccounts(filter = "") {
  const list = document.getElementById("patientAccountsList");
  const countSpan = document.getElementById("patientAccountsCount");
  if (!list || !countSpan) return;

  let filtered = allPatients.filter(p => !p.account_status || p.account_status === 'approved');

  // Filter to only show approved patients in the accounts directory

  if (filter.trim()) {
    const q = filter.toLowerCase();
    filtered = filtered.filter(p =>
      (p.full_name && p.full_name.toLowerCase().includes(q)) ||
      (p.email && p.email.toLowerCase().includes(q))
    );
  }

  countSpan.textContent = filtered.length;
  list.innerHTML = "";

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="col-span-full py-16 flex flex-col items-center justify-center bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl">
        <i data-lucide="users" class="w-10 h-10 text-slate-300 mb-3"></i>
        <p class="text-sm font-black tracking-tight text-slate-600">No patients found</p>
        <p class="text-[11px] font-semibold text-slate-400 mt-1">Try a different search term</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  filtered.forEach((p, index) => {
    const name = p.full_name || "Unknown Patient";
    const initials = name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
    const email = p.email || "No email provided";
    const phone = p.contact_no || p.phone || "No contact info";
    // Automatic Age Calculation from Birth Date
    let displayAge = "N/A";
    if (p.birth_date || p.dob || p.birthday) {
      const bday = p.birth_date || p.dob || p.birthday;
      displayAge = `${calculatePatientAge(bday)} yrs`;
    } else if (p.age) {
      displayAge = `${p.age} yrs`;
    }

    // Status text logic (checking if they have appointments)
    const pAppts = allAppointments.filter(a => a.patient_name === name);
    const status = pAppts.length > 0 ? "Active Patient" : "Registered";
    const statusColor = pAppts.length > 0 ? "emerald" : "blue";

    const card = document.createElement("div");
    card.className = "group p-5 bg-white border border-slate-100/80 rounded-3xl hover:shadow-xl hover:shadow-indigo-500/10 hover:border-indigo-100 transition-all cursor-pointer relative overflow-hidden";
    card.style.animation = `fadeInUp 0.4s ease ${index * 50}ms both`;

    card.innerHTML = `
      <div class="absolute -right-4 -top-4 w-16 h-16 bg-${statusColor}-50/50 rounded-full group-hover:scale-[2] transition-transform duration-500 z-0"></div>
      <div class="relative z-10 flex items-start gap-4">
        <div class="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-100/50 flex items-center justify-center shrink-0 group-hover:from-indigo-500 group-hover:to-purple-500 transition-colors duration-300">
          <span class="text-sm font-black text-indigo-600 group-hover:text-white transition-colors duration-300">${initials}</span>
        </div>
        <div class="flex-1 min-w-0 pt-0.5">
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-sm font-black text-slate-800 truncate">${name}</h3>
            <span class="text-[8px] font-black uppercase tracking-widest text-${statusColor}-600 bg-${statusColor}-50 px-2 py-0.5 rounded-full shrink-0">${status}</span>
          </div>
          <div class="mt-2 space-y-1.5">
            <p class="text-[10px] font-bold text-slate-500 flex items-center gap-1.5 truncate">
              <i data-lucide="mail" class="w-3.5 h-3.5 text-slate-400 shrink-0"></i>
              <span class="truncate">${email}</span>
            </p>
            <p class="text-[10px] font-bold text-slate-500 flex items-center gap-1.5 truncate">
              <i data-lucide="phone" class="w-3.5 h-3.5 text-slate-400 shrink-0"></i>
              <span>${phone}</span>
            </p>
          </div>
        </div>
      </div>
      <div class="relative z-10 mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="text-[10px] font-bold text-slate-400"><span class="text-slate-700 font-black">${pAppts.length}</span> visits</div>
          <div class="w-1 h-1 rounded-full bg-slate-200"></div>
          <div class="text-[10px] font-bold text-slate-400">Age: <span class="text-slate-700">${displayAge}</span></div>
        </div>
        <div class="flex items-center gap-2">
          <button class="patient-delete-btn w-7 h-7 flex items-center justify-center rounded-xl bg-rose-50 text-rose-400 hover:bg-rose-500 hover:text-white transition-all" title="Delete Account">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
          <button class="w-7 h-7 flex items-center justify-center rounded-xl bg-slate-50 text-slate-400 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors" title="View Progress">
            <i data-lucide="chevron-right" class="w-4 h-4"></i>
          </button>
        </div>
      </div>
    `;

    // Hook up delete button on card
    card.querySelector(".patient-delete-btn").onclick = (e) => {
      e.stopPropagation();
      deletePatientAccount(p);
    };

    card.onclick = () => {
      openPatientDetails(p);
    };

    list.appendChild(card);
  });

  if (window.lucide) window.lucide.createIcons({ root: list });
}

// ---- Patient Details Modal Logic ----
function openPatientDetails(patient) {
  const modal = document.getElementById("patientDetailsModal");
  const card = document.getElementById("patientDetailsCard");
  if (!modal || !card) return;

  // Prevent background scrolling
  document.body.style.overflow = "hidden";

  const name = patient.full_name || "Unknown Patient";
  const initials = name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  const pAppts = allAppointments.filter(a => a.patient_name === name);

  // Fill Content
  document.getElementById("pdInitials").textContent = initials;
  document.getElementById("pdFullName").textContent = name;
  document.getElementById("pdEmail").textContent = patient.email || "No email";
  document.getElementById("pdPhone").textContent = patient.contact_no || patient.phone || "No phone";

  // Hook up delete button in modal
  const deleteBtn = document.getElementById("pdDeleteBtn");
  if (deleteBtn) {
    deleteBtn.onclick = () => {
      deletePatientAccount(patient);
    };
  }

  // Age Calculation
  let ageVal = "N/A";
  const bday = patient.birth_date || patient.dob || patient.birthday;
  if (bday) {
    ageVal = `${calculatePatientAge(bday)} yrs`;
  } else if (patient.age) {
    ageVal = `${patient.age} yrs`;
  }
  document.getElementById("pdAge").textContent = ageVal;
  document.getElementById("pdVisits").textContent = pAppts.length;

  const statusBadge = document.getElementById("pdStatusBadge");
  if (pAppts.length > 0) {
    statusBadge.textContent = "Active Patient";
    statusBadge.className = "px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-[10px] font-black uppercase tracking-widest border border-white/20";
  } else {
    statusBadge.textContent = "Registered";
    statusBadge.className = "px-3 py-1 bg-white/10 ml-2 backdrop-blur-md rounded-full text-[10px] font-black uppercase tracking-widest border border-white/10";
  }

  // Clinical Progress Logic: Align with Treatment Journey phases
  const progressPct = document.getElementById("pdProgressPct");
  const progressBar = document.getElementById("pdProgressBar");
  const latestDiagnosis = document.getElementById("pdLatestDiagnosis");

  // Detect plan from joined table or legacy field
  let planKey = getTreatmentPlanKey(pAppts.find(a => getTreatmentPlanKey(a)));


  let finalPct = 0;
  if (planKey && treatmentJourneys[planKey]) {
    const phases = treatmentJourneys[planKey];
    const allText = pAppts.map(a => `${a.patient_condition || ""} ${a.appointment_type}`).join(" ").toLowerCase();
    let doneCount = 0;
    phases.forEach(p => {
      if (allText.includes(`[accomplished: ${p.title.toLowerCase()} - ${p.keywords[0].toLowerCase()}]`)) doneCount++;
    });
    finalPct = phases.length > 0 ? Math.round((doneCount / phases.length) * 100) : 0;
  } else {
    // Fallback to simple appointment ratio if no journey plan is found
    const completed = pAppts.filter(a => a.status === "done").length;
    finalPct = pAppts.length > 0 ? Math.round((completed / pAppts.length) * 100) : 0;
  }

  progressPct.textContent = `${finalPct}% Completed`;
  progressBar.style.width = `${finalPct}%`;

  // Find latest diagnosis from notes
  const diagAppt = [...pAppts]
    .filter(a => a.patient_condition && (a.patient_condition.includes("Diagnosed:") || a.patient_condition.includes("Diagnosis:")))
    .sort((a, b) => new Date(b.appointment_date) - new Date(a.appointment_date))[0];

  if (diagAppt) {
    const trigger = diagAppt.patient_condition.includes("Diagnosed:") ? "Diagnosed:" : "Diagnosis:";
    const diagText = diagAppt.patient_condition.split(trigger)[1].split("[")[0].trim();
    latestDiagnosis.textContent = `"${diagText}"`;
  } else {
    latestDiagnosis.textContent = "No formal diagnosis recorded yet.";
  }

  // Setup Actions
  const viewBtn = document.getElementById("pdViewTreatmentBtn");
  viewBtn.onclick = () => {
    closePatientDetails();
    setActivePage("treatment-progress");
    const searchBox = document.getElementById("searchProgressPatient");
    if (searchBox) searchBox.value = name;
    if (typeof selectProgressPatient === "function") {
      selectProgressPatient(name);
    }
  };

  const historyBtn = document.getElementById("pdHistoryBtn");
  historyBtn.onclick = togglePatientHistory;

  // Open UI
  modal.classList.remove("hidden");
  modal.classList.add("flex");

  // Ensure history panel is hidden when opening new patient
  const historyPanel = document.getElementById("pdHistoryPanel");
  if (historyPanel) {
    historyPanel.classList.add("hidden");
    historyPanel.classList.remove("flex", "translate-x-0", "opacity-100");
    historyPanel.classList.add("translate-x-4", "opacity-0");
  }

  setTimeout(() => {
    card.classList.remove("scale-95", "opacity-0");
    card.classList.add("scale-100", "opacity-100");
  }, 10);

  if (window.lucide) window.lucide.createIcons({ root: modal });
}

async function deletePatientAccount(patient) {
  const pName = patient.full_name || "this patient";
  
  const confirmed = await showConfirm(
    "Move to Recycle Bin?",
    `Move ${pName}'s account to the Recycle Bin? You can restore it later if needed.`
  );
  
  if (!confirmed) return;

  try {
    // 1. Move to Recycle Bin using the standard helper
    await moveToRecycleBin('patient', patient);

    // 2. Delete the patient record from main table
    const { error: delErr } = await sb.from("patients").delete().eq("id", patient.id);
    if (delErr) throw delErr;

    // Close modal if open
    closePatientDetails();
    
    // Refresh lists
    await fetchPatients();
    await fetchAppointments();
    
  } catch (err) {
    console.error("Error deleting patient account:", err);
    alert("Failed to move account to Recycle Bin. Please try again.");
  }
}

function togglePatientHistory() {
  const panel = document.getElementById("pdHistoryPanel");
  if (!panel) return;

  const isHidden = panel.classList.contains("hidden");
  if (isHidden) {
    panel.classList.remove("hidden");
    panel.classList.add("flex");
    setTimeout(() => {
      panel.classList.remove("translate-x-4", "opacity-0");
      panel.classList.add("translate-x-0", "opacity-100");
    }, 10);
    renderPatientHistoryData(); // uses defaults for pd
  } else {
    panel.classList.add("translate-x-4", "opacity-0");
    panel.classList.remove("translate-x-0", "opacity-100");
    setTimeout(() => {
      panel.classList.add("hidden");
      panel.classList.remove("flex");
    }, 500);
  }
}

function toggleApptDetailHistory(patientName) {
  const panel = document.getElementById("apptDetailHistoryPanel");
  if (!panel) return;

  const isHidden = panel.classList.contains("hidden");
  if (isHidden) {
    panel.classList.remove("hidden");
    panel.classList.add("flex");
    setTimeout(() => {
      panel.classList.remove("translate-x-4", "opacity-0");
      panel.classList.add("translate-x-0", "opacity-100");
    }, 10);
    renderPatientHistoryData(patientName, "apptDetailHistoryList", "apptDetailHistoryPlaceholder");
  } else {
    panel.classList.add("translate-x-4", "opacity-0");
    panel.classList.remove("translate-x-0", "opacity-100");
    setTimeout(() => {
      panel.classList.add("hidden");
      panel.classList.remove("flex");
    }, 500);
  }
}

function renderPatientHistoryData(targetPatientName = null, listId = "pdHistoryList", placeholderId = "pdHistoryPlaceholder") {
  const list = document.getElementById(listId);
  const placeholder = document.getElementById(placeholderId);
  const currentPatientName = targetPatientName || (document.getElementById("pdFullName") ? document.getElementById("pdFullName").textContent : "");

  if (!list || !placeholder) return;

  // Filter appointments for this patient
  const history = allAppointments.filter(a => a.patient_name === currentPatientName)
    .sort((a, b) => new Date(b.appointment_date) - new Date(a.appointment_date));

  // Clear existing items but keep placeholder
  const items = list.querySelectorAll('.pd-history-item');
  items.forEach(i => i.remove());

  if (history.length === 0) {
    placeholder.classList.remove("hidden");
    return;
  }

  placeholder.classList.add("hidden");

  history.forEach((appt, idx) => {
    const item = document.createElement("div");
    item.className = "pd-history-item relative pl-8 pb-8 group last:pb-0";
    item.style.animation = `fadeInRight 0.4s ease ${idx * 50}ms both`;

    let statusColor = "amber";
    if (appt.status === "done") statusColor = "emerald";
    if (appt.status === "cancelled") statusColor = "red";
    if (appt.status === "scheduled") statusColor = "blue";

    // Parse notes for images and clean text
    let notesText = appt.patient_condition || "No notes provided";
    let beforeImg = null;
    let afterImg = null;
    let specialTags = [];

    // Extract BEFORE_JPG
    const beforeMatch = notesText.match(/\[BEFORE_JPG:(.*?)\]/);
    if (beforeMatch) {
      beforeImg = beforeMatch[1];
      notesText = notesText.replace(/\[BEFORE_JPG:(.*?)\]/g, "");
    }

    // Extract AFTER_JPG
    const afterMatch = notesText.match(/\[AFTER_JPG:(.*?)\]/);
    if (afterMatch) {
      afterImg = afterMatch[1];
      notesText = notesText.replace(/\[AFTER_JPG:(.*?)\]/g, "");
    }

    // Extract other tags for clean display
    const tagRegex = /\[(PLAN|ReminderSent|Accomplished)(?:\s*\(.*?\))?:\s*([\s\S]*?)\]/gi;
    let match;
    const rawNotes = appt.patient_condition || "";
    while ((match = tagRegex.exec(rawNotes)) !== null) {
      specialTags.push({ type: match[1].toUpperCase(), val: match[2] });
    }
    notesText = rawNotes.replace(tagRegex, "").replace(/\[(BEFORE|AFTER)_JPG:.*?\]/gi, "").replace(/\[\d+[DMH]_REMINDER_SENT\]/gi, "").trim();

    const imageHtml = (beforeImg || afterImg) ? `
      <div class="grid grid-cols-2 gap-2 mt-3 overflow-hidden rounded-xl">
        ${beforeImg ? `
          <div class="space-y-1">
            <p class="text-[8px] font-black text-rose-400 uppercase tracking-widest pl-1">Before treatment</p>
            <div class="aspect-square bg-slate-100 rounded-lg overflow-hidden border border-slate-200">
              <img src="${beforeImg}" class="w-full h-full object-cover cursor-zoom-in hover:scale-110 transition-transform duration-500" onclick="window.openFullImage('${beforeImg}')" />
            </div>
          </div>
        ` : ""}
        ${afterImg ? `
          <div class="space-y-1">
            <p class="text-[8px] font-black text-emerald-400 uppercase tracking-widest pl-1">After treatment</p>
            <div class="aspect-square bg-slate-100 rounded-lg overflow-hidden border border-slate-200">
              <img src="${afterImg}" class="w-full h-full object-cover cursor-zoom-in hover:scale-110 transition-transform duration-500" onclick="window.openFullImage('${afterImg}')" />
            </div>
          </div>
        ` : ""}
      </div>
    ` : "";

    const nonReminderTags = specialTags.filter(t => t.type !== "REMINDERSENT");
    const tagsHtml = nonReminderTags.length > 0 ? `
      <div class="flex flex-wrap gap-1 mt-2">
        ${nonReminderTags.map(t => {
      let bg = "bg-slate-100 text-slate-500";
      if (t.type === "PLAN") bg = "bg-indigo-50 text-indigo-600 border-indigo-100";
      if (t.type === "ACCOMPLISHED") bg = "bg-emerald-50 text-emerald-600 border-emerald-100";
      return `<span class="px-2 py-0.5 rounded-md text-[8px] font-bold border ${bg} uppercase tracking-tighter">${t.type}: ${t.val}</span>`;
    }).join("")}
      </div>
    ` : "";

    const reminderTag = specialTags.find(t => t.type === "REMINDERSENT");
    const reminderHtml = reminderTag ? `
      <div class="mt-3 p-3 rounded-2xl bg-amber-50/50 border border-amber-100/50">
        <p class="text-[8px] font-black text-amber-600 uppercase tracking-widest flex items-center gap-1.5 mb-1">
          <i data-lucide="bell-ring" class="w-3 h-3"></i> Patient Instructions Sent
        </p>
        <p class="text-[10px] font-bold text-slate-600 leading-relaxed break-words italic">${escapeHtml(reminderTag.val)}</p>
      </div>` : "";

    item.innerHTML = `
      <!-- Timeline Line -->
      <div class="absolute left-3 top-0 bottom-0 w-px bg-slate-100 group-last:bg-transparent"></div>
      
      <!-- Timeline Dot -->
      <div class="absolute left-0 top-1.5 w-6 h-6 rounded-full border-4 border-white bg-${statusColor}-500 shadow-sm z-10 group-hover:scale-125 transition-transform"></div>
      
      <div class="bg-slate-50 border border-slate-100 p-4 rounded-2xl group-hover:border-${statusColor}-100 transition-colors min-w-0 overflow-hidden">
        <div class="flex items-center justify-between mb-1">
          <p class="text-[12px] font-black text-slate-700">${appt.appointment_date}</p>
          <span class="text-[9px] font-black uppercase tracking-widest text-${statusColor}-600 bg-${statusColor}-50 px-2 py-0.5 rounded-full">${appt.status}</span>
        </div>
        <p class="text-[11px] font-bold text-slate-500 mb-1.5">${formatAptTimeRange(appt.appointment_time, appt.duration_minutes || appt.duration)} • ${appt.appointment_type || 'General'}</p>
        <p class="text-[11px] text-slate-400 font-medium italic leading-relaxed break-words">${escapeHtml(notesText || (nonReminderTags.length > 0 || beforeImg || afterImg ? "" : "No clinical notes"))}</p>
        ${tagsHtml}
        ${reminderHtml}
        ${imageHtml}
      </div>
    `;
    list.appendChild(item);
  });

  if (window.lucide) window.lucide.createIcons({ root: list });
}

// ----- History Imaging: Open Full Lightbox -----
window.openFullImage = function (src) {
  const overlay = document.createElement("div");
  overlay.className = "fixed inset-0 z-[200] bg-slate-900/90 backdrop-blur-xl flex items-center justify-center p-8 cursor-zoom-out animate-in fade-in duration-300";
  overlay.innerHTML = `
    <div class="relative max-w-5xl w-full h-full flex flex-col items-center justify-center">
      <img src="${src}" class="max-w-full max-h-[85vh] rounded-3xl shadow-2xl border border-white/10 object-contain anim-zoom-in">
      <p class="text-white/50 text-[10px] font-black uppercase tracking-[4px] mt-6">Clinical Record • Click anywhere to close</p>
    </div>
  `;
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
};

function closePatientDetails() {
  const modal = document.getElementById("patientDetailsModal");
  const card = document.getElementById("patientDetailsCard");
  if (!modal || !card) return;

  card.classList.add("scale-95", "opacity-0");
  card.classList.remove("scale-100", "opacity-100");
  // Restore background scrolling
  document.body.style.overflow = "";

  setTimeout(() => {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }, 300);
}

// ---- Utility: Calculate Age from Date String ----
function calculatePatientAge(birthDateStr) {
  if (!birthDateStr) return 0;
  const birthDate = new Date(birthDateStr);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

// Global listners for Patient Details
document.addEventListener("DOMContentLoaded", () => {
  const closeBtn = document.getElementById("closePatientDetailsModal");
  const modal = document.getElementById("patientDetailsModal");
  const closeHist = document.getElementById("closePdHistory");

  if (closeBtn) closeBtn.onclick = closePatientDetails;
  if (closeHist) closeHist.onclick = togglePatientHistory;

  if (modal) {
    modal.onclick = (e) => {
      if (e.target === modal) closePatientDetails();
    };
  }

  const accSearch = document.getElementById("patientAccountsSearch");
  if (accSearch) {
    accSearch.addEventListener("input", (e) => {
      renderPatientAccounts(e.target.value);
    });
  }

  // Admin Messenger Back Button Logic
  const adminChatBackBtn = document.getElementById("adminChatBackBtn");
  if (adminChatBackBtn) {
    adminChatBackBtn.onclick = () => {
      const sidebar = document.getElementById("adminChatSidebar");
      if (sidebar) sidebar.classList.remove("hidden");
      adminChatBackBtn.classList.add("hidden");
    };
  }

  // Admin Messenger Filter Dropdown
  const filterBtn = document.getElementById("adminChatFilterBtn");
  const filterDropdown = document.getElementById("adminChatFilterDropdown");
  if (filterBtn && filterDropdown) {
    filterBtn.onclick = (e) => {
      e.stopPropagation();
      filterDropdown.classList.toggle("hidden");
    };
    document.addEventListener("click", () => filterDropdown.classList.add("hidden"));
    filterDropdown.onclick = (e) => e.stopPropagation();
  }
});

// Helper: normalize a name for comparison (trim, collapse spaces, lowercase)
function normalizeName(n) {
  return (n || "").trim().replace(/\s+/g, " ").toLowerCase();
}

// Helper: find patient record by name from allPatients array
function findPatientByName(patientName) {
  if (!patientName || allPatients.length === 0) return null;
  const norm = normalizeName(patientName);

  // 1. Exact match
  let match = allPatients.find(p => normalizeName(p.full_name) === norm);
  if (match) return match;

  // 2. Substring match (one contains the other)
  match = allPatients.find(p => {
    const pn = normalizeName(p.full_name);
    return pn.includes(norm) || norm.includes(pn);
  });
  if (match) return match;

  // 3. Word-overlap scoring (handles different name orders like
  //    appointment: "Enriquez Eugene Dela Cruz" vs patients: "Eugene Dela Cruz Enriquez")
  const nameWords = norm.split(/\s+/).filter(w => w.length >= 3);
  if (nameWords.length === 0) return null;

  let bestMatch = null;
  let bestScore = 0;

  allPatients.forEach(p => {
    const pWords = normalizeName(p.full_name).split(/\s+/);
    let score = 0;
    for (const nw of nameWords) {
      if (pWords.some(pw => pw === nw || pw.includes(nw) || nw.includes(pw))) {
        score++;
      }
    }
    if (score > bestScore && score >= 2) {
      bestScore = score;
      bestMatch = p;
    }
  });

  return bestMatch;
}

// Find patient contact info by appointment data
function getPatientContact(appt) {
  // 1. Direct phone from appointment
  const directPhone = appt.patient_phone || appt.phone || appt.contact || appt.mobile;
  if (directPhone) return directPhone;

  // 2. Lookup by email
  const email = appt.patient_email || appt.email;
  if (email) {
    const match = allPatients.find(p => p.email && p.email.toLowerCase().trim() === email.toLowerCase().trim());
    if (match && match.contact_no) return match.contact_no;
  }

  // 3. Lookup by name
  const match = findPatientByName(appt.patient_name);
  if (match && match.contact_no) return match.contact_no;

  return "";
}

// Find patient email by appointment data
function getPatientEmail(appt) {
  const directEmail = appt.patient_email || appt.email;
  if (directEmail) return directEmail;

  const match = findPatientByName(appt.patient_name);
  if (match && match.email) return match.email;
  return "";
}

// Refresh everything
async function refreshAll() {
  await fetchPatients();
  await fetchAppointments();
}

async function createAppointment(payload) {
  const { data, error } = await sb
    .from("appointments")
    .insert(payload)
    .select()
    .single();

  if (error) {
    throw error;
  }
  return data;
}

async function updateAppointment(id, payload) {
  const { data, error } = await sb
    .from("appointments")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  // Mark notification as read if modified from dashboard
  addReadAppointmentNotifId(String(id));
  fetchNotifications(); // Refresh entire logic

  // Create notification for patient if status changes to something relevant
  if (payload.status === "scheduled" || payload.status === "declined") {
    const isAccepted = payload.status === "scheduled";
    const title = isAccepted ? "Appointment Accepted" : "Appointment Declined";
    const message = isAccepted
      ? `Your appointment for ${data.patient_condition || 'consultation'} on ${data.appointment_date} has been accepted and scheduled.`
      : `Sorry, your appointment for ${data.patient_condition || 'consultation'} on ${data.appointment_date} was declined. Please try another time.`;

    await sb.from("notifications").insert([{
      patient_name: data.patient_name,
      title: title,
      message: message,
      appt_id: data.id,
      is_read: false
    }]);
  }

  return data;
}

async function deleteAppointment(id) {
  try {
    // Non-blocking recycle bin attempt
    try {
      const { data: apptData } = await sb.from("appointments").select("*").eq("id", id).single();
      if (apptData) await moveToRecycleBin('appointment', apptData);
    } catch (binErr) {
      console.warn("Recycle bin move failed for appointment:", binErr);
    }

    const { error } = await sb.from("appointments").delete().eq("id", id);
    if (error) throw error;

    fetchAppointments();
    fetchNotifications();
  } catch (err) {
    console.error("Error in deleteAppointment:", err);
  }
}

// ============================
// RENDERING
// ============================

function renderErrorRow(message, isSearch = false) {
  const targetBody = getActiveApptBody();
  const targetCount = getActiveApptCount();

  if (targetBody) {
    if (isSearch) {
      targetBody.innerHTML = `
          <tr>
            <td colspan="12" class="py-16 px-4">
              <div class="flex flex-col items-center justify-center text-center">
                <div class="w-16 h-16 rounded-[24px] bg-slate-50 flex items-center justify-center mb-4 border border-slate-100 shadow-inner group">
                  <i data-lucide="search-x" class="w-8 h-8 text-slate-300 group-hover:scale-110 transition-transform"></i>
                </div>
                <h3 class="text-xs font-black text-slate-800 uppercase tracking-widest">No Matches Found</h3>
                <p class="text-[10px] font-bold text-slate-400 mt-1 max-w-[240px] leading-relaxed">We couldn't find any appointments matching your current search criteria.</p>
                <button onclick="const s = document.getElementById('searchInput'); if(s) { s.value=''; s.dispatchEvent(new Event('input')); }" class="mt-4 px-4 py-1.5 rounded-full bg-slate-100 text-[9px] font-black text-slate-600 uppercase tracking-widest hover:bg-slate-200 transition-all active:scale-95">Clear Search</button>
              </div>
            </td>
          </tr>
        `;
    } else {
      targetBody.innerHTML = `
          <tr>
            <td colspan="12" class="py-16 px-4">
              <div class="flex flex-col items-center justify-center text-center">
                <div class="w-16 h-16 rounded-[24px] bg-slate-50 flex items-center justify-center mb-4 border border-slate-100 shadow-inner">
                  <i data-lucide="calendar-off" class="w-8 h-8 text-slate-300"></i>
                </div>
                <h3 class="text-xs font-black text-slate-800 uppercase tracking-widest">No Appointments</h3>
                <p class="text-[10px] font-bold text-slate-400 mt-1 max-w-[240px] leading-relaxed">There are currently no records available for this section or filter.</p>
              </div>
            </td>
          </tr>
        `;
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
  if (targetCount) targetCount.textContent = "0";
}

function getActiveApptBody() {
  if (currentApptTab === "schedule" || currentApptTab === "all") return appointmentsBody;
  if (currentApptTab === "followups") return document.getElementById("appointmentsBodyFollowups");
  if (currentApptTab === "consultation") return document.getElementById("appointmentsBodyConsultation");
  return appointmentsBody;
}

function getActiveApptCount() {
  if (currentApptTab === "schedule" || currentApptTab === "all") return apptCount;
  if (currentApptTab === "followups") return document.getElementById("apptCountFollowups");
  if (currentApptTab === "consultation") return document.getElementById("apptCountConsultation");
  return apptCount;
}

function renderAppointments() {
  let searchEl = searchInput;
  if (currentApptTab === "followups") searchEl = document.getElementById("searchInputFollowups");
  if (currentApptTab === "consultation") searchEl = document.getElementById("searchInputConsultation");

  const term = searchEl ? searchEl.value.trim().toLowerCase() : "";

  // Check if a specific status filter is active (from the dropdown)
  let activeStatusFilter = "";
  if (currentApptTab === "schedule" || currentApptTab === "all") {
    activeStatusFilter = filterStatus ? filterStatus.value : "";
  } else if (currentApptTab === "followups") {
    const fs = document.getElementById("filterStatusFollowups");
    activeStatusFilter = fs ? fs.value : "";
  } else if (currentApptTab === "consultation") {
    const fs = document.getElementById("filterStatusConsultation");
    activeStatusFilter = fs ? fs.value : "";
  }

  const filtered = allAppointments.filter((appt) => {
    // If a specific status filter is active, skip type filtering — show ALL appointments with that status
    if (!activeStatusFilter) {
      // Filter by appointment type tab (front-end only) — only when no status filter
      const type = appt.appointment_type || "schedule";

      let typeMatches = false;
      if (currentApptTab === "all") {
        typeMatches = true;
      } else if (currentApptTab === "followups") {
        typeMatches = (type === "followups");
      } else if (currentApptTab === "consultation") {
        typeMatches = (type === "consultation");
      } else {
        // "schedule" tab shows both schedule and items with no type yet
        typeMatches = (type === "schedule");
      }

      if (!typeMatches) return false;
    }

    if (!term) return true;
    const haystack = [
      appt.patient_name,
      appt.patient_phone,
      appt.patient_email,
      appt.condition,
      appt.patient_reminder,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(term);
  });
  console.log(`[Admin Render] Total in memory: ${allAppointments.length}, After tab filter (${currentApptTab}): ${filtered.length}, Search: "${term}"`);

  if (filtered.length === 0) {
    renderErrorRow(null, term.length > 0);
    return;
  }

  const targetCount = getActiveApptCount();
  if (targetCount) targetCount.textContent = filtered.length.toString();

  // Priority-based sorting: Pending > Scheduled > Done > Everything else
  const sortedFiltered = [...filtered].sort((a, b) => {
    const priorityMap = {
      "pending": 1,
      "scheduled": 2,
      "accepted": 2,
      "done": 3,
      "completed": 3
    };

    const aStatus = (a.status || "").toLowerCase();
    const bStatus = (b.status || "").toLowerCase();
    const aType = (a.appointment_type || "").toLowerCase();
    const bType = (b.appointment_type || "").toLowerCase();

    const aPri = priorityMap[aStatus] || 4;
    const bPri = priorityMap[bStatus] || 4;

    if (aPri !== bPri) return aPri - bPri;

    // If same priority, check if it's a follow-up (move to end of group)
    if (aType === "followups" && bType !== "followups") return 1;
    if (aType !== "followups" && bType === "followups") return -1;

    // Finally, sort by created_at (Newest to Oldest) within the same group
    const aTime = new Date(a.created_at || 0).getTime();
    const bTime = new Date(b.created_at || 0).getTime();
    return bTime - aTime;
  });

  // --- End of Render Preparation ---

  // Format helpers ...
  function formatTimeFrame12H(time24, durationMins) {
    if (!time24) return "—";
    const parts = time24.split(":");
    if (parts.length < 2) return time24;
    const hour = parseInt(parts[0], 10);
    const min = parseInt(parts[1], 10);

    const ampmStart = hour >= 12 ? "PM" : "AM";
    const displayHourStart = hour % 12 === 0 ? 12 : hour % 12;
    const startStr = `${displayHourStart.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')} ${ampmStart}`;

    if (!durationMins || durationMins <= 0) return startStr;

    const totalMins = hour * 60 + min + durationMins;
    const endHour24 = Math.floor(totalMins / 60) % 24;
    const endMin = totalMins % 60;

    const ampmEnd = endHour24 >= 12 ? "PM" : "AM";
    const displayHourEnd = endHour24 % 12 === 0 ? 12 : endHour24 % 12;
    const endStr = `${displayHourEnd.toString().padStart(2, '0')}:${endMin.toString().padStart(2, '0')} ${ampmEnd}`;

    return `${startStr} - ${endStr}`;
  }
const rowsHtml = sortedFiltered
    .map((appt) => {
      const date = appt.appointment_date || "—";
      const rawTime = appt.appointment_time || appt.time || appt.scheduled_time || "—";
      const time = formatAptTimeRange(rawTime, appt.duration_minutes || appt.duration);
      const statusClass = `status-${appt.status}`;

      // Extract tags or data if needed (using dedicated columns now)
      const isConsultation =
        (appt.appointment_type || appt.service_type || appt.type || "")
          .toLowerCase() === "consultation";
          
      let extractedDiagnosis = appt.service || appt.condition || appt.patient_condition || appt.service_type || appt.appointment_type || "—";
      
      // Strict Cleaning of Tracking Tags from display string
      if (typeof extractedDiagnosis === 'string' && extractedDiagnosis.includes("[")) {
          extractedDiagnosis = extractedDiagnosis
            .replace(/\[(PLAN|Accomplished|CareReminder|ReminderSent|BEFORE_JPG|AFTER_JPG)(?:\s*\(.*?\))?:[\s\S]*?\]/gi, "")
            .replace(/\[\d+[DMH]_REMINDER_SENT\]/gi, "")
            .trim();
      }

      if (!extractedDiagnosis || extractedDiagnosis === "...") {
          extractedDiagnosis = "—";
      }

      const rowClass = "border-b border-slate-50 bg-white hover:bg-slate-50 hover:shadow-[0_2px_10px_-3px_rgba(6,81,237,0.05)] transition-all duration-300 group cursor-pointer relative";
      const trStyle = "transform: scale(1); transform-origin: center;";

      const initials = (appt.patient_name || "??").split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);

      const bookedDate = appt.created_at ? new Date(appt.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
      const bookedTime = appt.created_at ? new Date(appt.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—';

      const displayAge = appt.patient_age || "—";
      const displayGender = appt.patient_gender || "—";

      const consultationStatus = (appt.status || "").toLowerCase();
      const canShowConsultationNotes = isConsultation && (consultationStatus === "accepted" || consultationStatus === "scheduled");
      const hasProgress = false; // Progress tracking logic needs update for non-notes system
      const hasDiagnosis = false; // Diagnosis tracking logic needs update for non-notes system


      return `
      <tr data-id="${appt.id}" class="${rowClass}" style="${trStyle}">
        <td data-label="Booked At" class="px-1 py-2 whitespace-nowrap">
          <div class="flex flex-col">
            <span class="text-[10px] text-slate-600 font-bold tracking-tight">${bookedDate}</span>
            <span class="text-[8px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">${bookedTime}</span>
          </div>
        </td>
        <td data-label="Date" class="px-1 py-2 whitespace-nowrap text-[11px] text-slate-800 font-black tracking-tight">${date}</td>
        <td data-label="Time" class="px-1 py-2 whitespace-nowrap">
            <div class="inline-flex items-center gap-1 px-1 py-0.5 rounded-md bg-slate-100/80 text-slate-700 text-[10px] font-black border border-slate-200/50">
                <i data-lucide="clock" class="w-3 h-3 text-slate-400"></i> ${time}
            </div>
        </td>
        <td data-label="Patient" class="px-1 py-2 min-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap">
          <div class="flex items-center gap-2">
            <div class="relative flex-shrink-0 w-7 h-7 rounded-xl bg-gradient-to-tr from-indigo-50 to-blue-50 border border-indigo-100/80 flex items-center justify-center shadow-inner pt-0.5 group-hover:scale-105 transition-transform duration-300">
                <span class="text-[9px] font-black text-indigo-600 tracking-tight">${initials}</span>
            </div>
            <div class="flex flex-col min-w-0">
              <span class="text-[11px] font-black text-slate-800 tracking-tight group-hover:text-indigo-600 transition-colors truncate">${highlightText(appt.patient_name || "Unknown", term)}</span>
              <div class="flex items-center gap-1.5 mt-0.5">
                <span class="flex items-center gap-1 text-[8px] font-bold text-slate-400">
                  <i data-lucide="user" class="w-2.5 h-2.5"></i> Patient
                </span>
              </div>
            </div>
          </div>
        </td>
        <td data-label="Age" class="px-2 py-2 whitespace-nowrap text-[11px] font-black text-slate-700 tabular-nums">
          ${highlightText(displayAge.toString(), term)}
        </td>
        <td data-label="Gender" class="px-2 py-2 whitespace-nowrap text-[10px] font-black text-slate-600 uppercase tracking-tight">
          ${highlightText(displayGender, term)}
        </td>
        <td data-label="Condition" class="px-2 py-2 whitespace-nowrap">
          ${extractedDiagnosis === "—" || !extractedDiagnosis
            ? `<span class="text-slate-400 font-bold">—</span>`
            : `<span class="inline-flex items-center px-1.5 py-0.5 rounded-md bg-slate-50 text-slate-700 text-[10px] font-black border border-slate-200/50 uppercase tracking-tight">
                ${highlightText(extractedDiagnosis, term)}
              </span>`
          }
        </td>
        <td data-label="Booked By" class="px-2 py-2 whitespace-nowrap">
          <div class="flex items-center gap-1.5">
            <div class="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200">
               <i data-lucide="user-check" class="w-2.5 h-2.5 text-slate-400"></i>
            </div>
            <span class="text-[10px] font-bold text-slate-600 truncate max-w-[80px]">
              ${highlightText(appt.created_by_name || "Self", term)}
            </span>
          </div>
        </td>
        <td data-label="Type" class="px-2 py-2 whitespace-nowrap">
          <span class="inline-flex items-center px-1.5 py-0.5 rounded-[4px] text-[8px] font-black uppercase tracking-widest border shadow-sm ${appt.appointment_type === 'consultation' ? 'bg-gradient-to-br from-amber-50 to-orange-50 text-amber-700 border-amber-200' :
          appt.appointment_type === 'followups' ? 'bg-gradient-to-br from-teal-50 to-emerald-50 text-teal-700 border-teal-200' :
            'bg-gradient-to-br from-blue-50 to-cyan-50 text-blue-700 border-blue-200'
        }">
            ${highlightText(appt.appointment_type || 'Schedule', term)}
          </span>
        </td>
        <td data-label="Status" class="px-2 py-2 whitespace-nowrap">
          <span class="status-pill ${statusClass} shadow-sm border border-black/5">
            ${formatStatusLabel(appt.status)}
          </span>
        </td>

        <td data-label="Actions" class="px-2 py-2 whitespace-nowrap text-right text-xs font-medium">
          <div class="flex items-center gap-1.5 justify-end">
        ${canShowConsultationNotes
          ? `<button class="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-gradient-to-br hover:from-emerald-500 hover:to-teal-500 hover:text-white hover:shadow-md hover:shadow-emerald-500/20 transition-all duration-300 border border-emerald-200/50 text-[9px] font-black group/btn" data-action="consultationNotes">
               <i data-lucide="file-pen-line" class="w-2.5 h-2.5 group-hover/btn:scale-110 transition-transform"></i> Diagnosis
             </button>`
          : ""}
        ${appt.status?.toLowerCase() === "done" ? `
            <div class="flex items-center gap-1.5">
              ${hasProgress ? '<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-violet-50 text-violet-600 border border-violet-200/50 text-[7px] font-black uppercase tracking-widest"><i data-lucide="check-circle-2" class="w-2 h-2"></i> Updated</span>' : ''}
              <button class="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors text-[9px] font-black shadow-md shadow-slate-900/10 group/btn" data-action="setFollowup">
                <i data-lucide="repeat" class="w-2.5 h-2.5 group-hover/btn:rotate-180 transition-transform duration-500"></i> Follow up
              </button>
            </div>
        ` : ""}
            ${appt.status?.toLowerCase() === "pending"
          ? `
              <button class="w-6 h-6 rounded-md bg-emerald-50 text-emerald-600 hover:bg-emerald-500 hover:text-white border border-emerald-200/50 flex items-center justify-center transition-all shadow-sm hover:shadow-md hover:shadow-emerald-500/20 group/btn" data-action="accept" title="Accept">
                  <i data-lucide="check" class="w-3 h-3 group-hover/btn:scale-110 transition-transform"></i>
              </button>
              <button class="w-6 h-6 rounded-md bg-red-50 text-red-600 hover:bg-red-500 hover:text-white border border-red-200/50 flex items-center justify-center transition-all shadow-sm hover:shadow-md hover:shadow-red-500/20 group/btn" data-action="decline" title="Decline">
                  <i data-lucide="x" class="w-3 h-3 group-hover/btn:scale-110 transition-transform"></i>
              </button>
              `
          : (appt.status?.toLowerCase() === "scheduled" || appt.status?.toLowerCase() === "accepted")
            ? (isConsultation && !hasDiagnosis)
              ? ""
              : `<button class="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white hover:from-blue-600 hover:to-indigo-700 transition-all duration-300 text-[9px] font-black shadow-md shadow-blue-500/20 hover:shadow-lg group/btn" data-action="done">
                    <i data-lucide="check-square" class="w-2.5 h-2.5 group-hover/btn:scale-110 transition-transform"></i> Mark Done
                 </button>`
            : ""
        }
          </div>
        </td>
      </tr>
    `;
    })
    .join("");
  const targetBody = getActiveApptBody();
  if (targetBody) {
    targetBody.innerHTML = rowsHtml;
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatStatusLabel(status) {
  switch (status?.toLowerCase()) {
    case "scheduled":
      return "Scheduled";
    case "pending":
      return "Pending";
    case "accepted":
      return "Accepted";
    case "declined":
      return "Declined";
    case "completed":
      return "Completed";
    case "done":
      return "Done";
    case "cancelled":
      return "Cancelled";

    default:
      return status;
  }
}

// ============================
// MODAL HANDLING
// ============================

function openModal(mode, appointment) {
  // Prevent background scrolling
  document.body.style.overflow = "hidden";
  formError.textContent = "";

  // Always populate the doctor/nurse dropdown first
  populateDoctorDropdown();

  if (mode === "new") {
    modalTitle.textContent = "New Appointment";
    apptIdInput.value = "";
    patientNameInput.value = "";
    patientPhoneInput.value = "63+ ";
    patientEmailInput.value = "";
    if (doctorNameInput) doctorNameInput.value = "";
    apptDateInput.value = filterDate.value || "";
    apptTimeInput.value = "";
    durationInput.value = "30";
    statusInput.value = (currentApptTab === "consultation") ? "pending" : "scheduled";
    notesInput.value = "";
    if (appointmentTypeInput) {
      appointmentTypeInput.value = currentApptTab || "schedule";
    }
    
    const accomplishedSect = document.getElementById("apptAccomplishedSection");
    if (accomplishedSect) accomplishedSect.classList.add("hidden");
  } else if (mode === "edit" && appointment) {
    modalTitle.textContent = "Edit Appointment";
    apptIdInput.value = appointment.id;
    patientNameInput.value = appointment.patient_name || "";
    patientPhoneInput.value = appointment.patient_phone || "";
    patientEmailInput.value = appointment.patient_email || "";
    if (doctorNameInput) doctorNameInput.value = "Clinic Staff";
    apptDateInput.value = appointment.appointment_date || "";
    apptTimeInput.value = appointment.appointment_time
      ? appointment.appointment_time.slice(0, 5)
      : "";
    durationInput.value = appointment.duration_minutes || 30;
    statusInput.value = appointment.status || "scheduled";
    const notes = appointment.patient_condition || "";
    notesInput.value = notes.replace(/\[(PLAN|ReminderSent|Accomplished|CareReminder|BEFORE_JPG|AFTER_JPG)(?:\s*\(.*?\))?:[\s\S]*?\]/gi, "").replace(/\[\d+[DMH]_REMINDER_SENT\]/gi, "").trim();
    
    if (appointmentTypeInput) {
      appointmentTypeInput.value = appointment.appointment_type || "schedule";
    }

    // Populate Accomplished Phases section
    const accomplishedSect = document.getElementById("apptAccomplishedSection");
    const accomplishedList = document.getElementById("apptAccomplishedList");
    const accomplishedCount = document.getElementById("apptAccomplishedCount");

    if (accomplishedSect && accomplishedList) {
      const tags = [];
      const tagRegex = /\[Accomplished:\s*(.*?)\s*-\s*(.*?)\]/gi;
      let match;
      while ((match = tagRegex.exec(notes)) !== null) {
          tags.push(match[1]); // match[1] is the title
      }

      if (tags.length > 0) {
          accomplishedSect.classList.remove("hidden");
          accomplishedCount.textContent = tags.length;
          accomplishedList.innerHTML = tags.map(t => `
              <span class="inline-flex items-center px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-700 text-[9px] font-black uppercase border border-emerald-200">
                ${t}
              </span>
          `).join("");
      } else {
          accomplishedSect.classList.add("hidden");
          accomplishedList.innerHTML = "";
      }
    }
  }
  apptModal.classList.remove("hidden");
  apptModal.classList.add("flex");

  // Re-run lucide to render icons in the new modal structure
  if (window.lucide) window.lucide.createIcons({ root: apptModal });

  // Update calculated time slot preview
  updateApptTimePreview();
}

// Populate the Doctor/Nurse dropdown from clinic_staff
function populateDoctorDropdown() {
  const select = document.getElementById("doctorName");
  if (!select) return;

  // Preserve current value if editing
  const currentVal = select.value;

  // Clear existing options
  select.innerHTML = '<option value="" disabled selected>Select Doctor / Nurse</option>';

  // Filter staff who are doctors or nurses
  const staffList = (allStaffData || []).filter(s => {
    const role = (s.role || "").toLowerCase();
    return role === "doctor" || role === "nurse";
  });

  // Group by role
  const doctors = staffList.filter(s => (s.role || "").toLowerCase() === "doctor");
  const nurses = staffList.filter(s => (s.role || "").toLowerCase() === "nurse");

  if (doctors.length > 0) {
    const grp = document.createElement("optgroup");
    grp.label = "Doctors";
    doctors.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.name;
      opt.textContent = `Dr. ${s.name}`;
      grp.appendChild(opt);
    });
    select.appendChild(grp);
  }

  if (nurses.length > 0) {
    const grp = document.createElement("optgroup");
    grp.label = "Nurses";
    nurses.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.name;
      opt.textContent = s.name;
      grp.appendChild(opt);
    });
    select.appendChild(grp);
  }

  // Restore the value if it existed
  if (currentVal) {
    select.value = currentVal;
  }
}

function closeModal() {
  if (apptModal) {
    apptModal.classList.add("hidden");
    apptModal.classList.remove("flex");
    // Restore background scrolling
    document.body.style.overflow = "";
  }
}

function updateApptTimePreview() {
  const timeVal = apptTimeInput.value;
  const durationVal = parseInt(durationInput.value, 10);
  const previewEl = document.getElementById("apptTimePreview");
  const displayEl = document.getElementById("timeRangeDisplay");

  if (!timeVal || isNaN(durationVal)) {
    if (previewEl) previewEl.classList.add("hidden");
    return;
  }

  const [h, m] = timeVal.split(":").map(Number);
  const start = new Date();
  start.setHours(h, m, 0, 0);

  const end = new Date(start.getTime() + durationVal * 60000);

  const formatTime = (date) => {
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    return `${hours}:${minutes} ${ampm}`;
  };

  const startStr = formatTime(start);
  const endStr = formatTime(end);

  if (displayEl) displayEl.textContent = `${startStr} - ${endStr}`;
  if (previewEl) {
    previewEl.classList.remove("hidden");
    previewEl.classList.add("flex");
  }
}

// Event listeners for real-time calculation
if (apptTimeInput) apptTimeInput.addEventListener("input", updateApptTimePreview);
if (durationInput) durationInput.addEventListener("input", updateApptTimePreview);

newApptBtn.addEventListener("click", () => openModal("new"));
closeModalBtn.addEventListener("click", closeModal);
cancelBtn.addEventListener("click", closeModal);

apptModal.addEventListener("click", (e) => {
  if (e.target === apptModal || e.target === apptModal.querySelector(".modal-backdrop")) {
    closeModal();
  }
});

// Accept Modal binding
const acceptModal = document.getElementById("acceptModal");
const acceptForm = document.getElementById("acceptForm");
const closeAcceptModalBtn = document.getElementById("closeAcceptModalBtn");
const cancelAcceptBtn = document.getElementById("cancelAcceptBtn");

function closeAcceptModal() {
  if (acceptModal) {
    acceptModal.classList.add("hidden");
    acceptModal.classList.remove("flex");
  }
}

if (closeAcceptModalBtn) closeAcceptModalBtn.addEventListener("click", closeAcceptModal);
if (cancelAcceptBtn) cancelAcceptBtn.addEventListener("click", closeAcceptModal);

if (acceptModal) {
  acceptModal.addEventListener("click", (e) => {
    if (e.target === acceptModal || e.target === acceptModal.querySelector(".modal-backdrop")) {
      closeAcceptModal();
    }
  });

  // Toggle Teeth Count
  const acceptService = document.getElementById("acceptService");
  const teethCountWrap = document.getElementById("acceptTeethCountWrap");
  if (acceptService && teethCountWrap) {
    acceptService.addEventListener("change", () => {
      const val = acceptService.value.toLowerCase();
      if (val === "dentures" || val === "pasta") {
        teethCountWrap.classList.remove("hidden");
      } else {
        teethCountWrap.classList.add("hidden");
      }
    });
  }
}

if (acceptForm) {
  acceptForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("acceptApptId").value;
    const duration = document.getElementById("acceptDuration").value;
    const date = document.getElementById("acceptDate").value;
    const time = document.getElementById("acceptTime").value;
    const price = document.getElementById("acceptPrice").value;
    const apptType = document.getElementById("acceptApptType").value;
    const service = document.getElementById("acceptService").value;
    
    if (!id || !date || !time) return;

    // Ensure time has seconds for database compatibility (HH:mm:ss)
    const formattedTime = time.includes(":") && time.split(":").length === 2 ? `${time}:00` : time;

    try {
      // Update appointment status
      await updateAppointment(id, {
        status: "accepted",
        appointment_date: date,
        appointment_time: formattedTime,
        price: Number(price) || 0,
        duration_minutes: Number(duration) || 30,
        appointment_type: apptType,
        patient_condition: service // Use correct column name
      });

      closeAcceptModal();
      await fetchAppointments();
    } catch (err) {
      console.error("Error accepting appointment:", err);
      const errorMsg = err.message || err.details || "Unknown database error";
      alert("Failed to accept appointment: " + errorMsg);
    }
  });
}

// ============================
// FORM SUBMIT
// ============================

apptForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  formError.textContent = "";

  const id = apptIdInput.value || null;
  const patient_name = patientNameInput.value.trim();

  const appointment_date = apptDateInput.value;
  const appointment_time = apptTimeInput.value;
  const duration_minutes = Number(durationInput.value) || 0;
  const status = statusInput.value;

  const patient_phone = patientPhoneInput.value.trim() || null;
  const patient_email = patientEmailInput.value.trim() || null;
  const appointment_type = appointmentTypeInput
    ? appointmentTypeInput.value
    : "schedule";

  if (!patient_name || !appointment_date || !appointment_time) {
    formError.textContent = "Please fill in all required fields (name, date, time).";
    return;
  }

  const payload = {
    patient_name,
    appointment_date,
    appointment_time,
    duration_minutes,
    status,
    patient_phone,
    patient_email,
    appointment_type,
  };

  try {
    if (id) {
      // If status is changed to "done", we require a reminder/precaution setup.
      // Redirect to precaution modal if it's not already done.
      const originalAppt = allAppointments.find(a => a.id == id);
      if (status === "done" && (!originalAppt || originalAppt.status !== "done")) {
        // Save other changes first, but keep the old status (or scheduled)
        const transitionPayload = { ...payload, status: (originalAppt ? originalAppt.status : "scheduled") };
        const updated = await updateAppointment(id, transitionPayload);
        closeModal();
        // Now force them to the precaution modal to finish the "Done" status
        openPrecautionModal(updated);
        return;
      }
      await updateAppointment(id, payload);
    } else {
      if (status === "done") {
        alert("To mark an appointment as Done, please create it as Scheduled first, then use the 'Done' button in the list to send required patient reminders.");
        return;
      }
      await createAppointment(payload);
    }
    closeModal();
    await fetchAppointments();
  } catch (err) {
    console.error("Error saving appointment:", err);
    formError.textContent =
      "Error saving appointment. Please check your Supabase configuration.";
  }
});

// ============================
// TABLE ACTIONS (EDIT / DELETE)
// ============================

// Consolidating all table click handling into handleTableClick
// (The previous redundant listener here was removed to ensure reminders are required for 'Done' status)

// ============================
// FILTERS
// ============================

filterDate.addEventListener("change", fetchAppointments);
filterStatus.addEventListener("change", fetchAppointments);
searchInput.addEventListener("input", debounce(() => {
  updateClearBtnVisibility("searchInput", "clearSearchBtn");
  renderAppointments();
}, 250));

const clearSearchBtn = document.getElementById("clearSearchBtn");
if (clearSearchBtn) {
  clearSearchBtn.addEventListener("click", () => {
    searchInput.value = "";
    updateClearBtnVisibility("searchInput", "clearSearchBtn");
    renderAppointments();
    searchInput.focus();
  });
}

// Add listeners for new page filters
const filterDateFollowups = document.getElementById("filterDateFollowups");
const filterStatusFollowups = document.getElementById("filterStatusFollowups");
const searchInputFollowups = document.getElementById("searchInputFollowups");
const newApptBtnFollowups = document.getElementById("newApptBtnFollowups");

if (filterDateFollowups) filterDateFollowups.addEventListener("change", fetchAppointments);
if (filterStatusFollowups) filterStatusFollowups.addEventListener("change", fetchAppointments);
if (searchInputFollowups) {
  searchInputFollowups.addEventListener("input", debounce(() => {
    updateClearBtnVisibility("searchInputFollowups", "clearSearchBtnFollowups");
    renderAppointments();
  }, 250));
}
const clearSearchBtnFollowups = document.getElementById("clearSearchBtnFollowups");
if (clearSearchBtnFollowups) {
  clearSearchBtnFollowups.addEventListener("click", () => {
    searchInputFollowups.value = "";
    updateClearBtnVisibility("searchInputFollowups", "clearSearchBtnFollowups");
    renderAppointments();
    searchInputFollowups.focus();
  });
}
if (newApptBtnFollowups) newApptBtnFollowups.addEventListener("click", () => openModal("new"));

const filterDateConsultation = document.getElementById("filterDateConsultation");
const filterStatusConsultation = document.getElementById("filterStatusConsultation");
const searchInputConsultation = document.getElementById("searchInputConsultation");
const newApptBtnConsultation = document.getElementById("newApptBtnConsultation");

if (filterDateConsultation) filterDateConsultation.addEventListener("change", fetchAppointments);
if (filterStatusConsultation) filterStatusConsultation.addEventListener("change", fetchAppointments);
if (searchInputConsultation) {
  searchInputConsultation.addEventListener("input", debounce(() => {
    updateClearBtnVisibility("searchInputConsultation", "clearSearchBtnConsultation");
    renderAppointments();
  }, 250));
}
const clearSearchBtnConsultation = document.getElementById("clearSearchBtnConsultation");
if (clearSearchBtnConsultation) {
  clearSearchBtnConsultation.addEventListener("click", () => {
    searchInputConsultation.value = "";
    updateClearBtnVisibility("searchInputConsultation", "clearSearchBtnConsultation");
    renderAppointments();
    searchInputConsultation.focus();
  });
}
if (newApptBtnConsultation) newApptBtnConsultation.addEventListener("click", () => openModal("new"));

// Add click listeners for all appointment bodies
const bodies = [
  appointmentsBody,
  document.getElementById("appointmentsBodyFollowups"),
  document.getElementById("appointmentsBodyConsultation")
];

bodies.forEach(body => {
  if (body && body !== appointmentsBody) {
    // Re-use the same listener logic for other bodies
    body.addEventListener("click", handleTableClick);
  }
});

// Extract table click logic to a function
async function handleTableClick(e) {
  const btn = e.target.closest("button");

  // If click was NOT on a button, open the detail modal for the row
  if (!btn) {
    const row = e.target.closest("tr");
    const id = row?.dataset.id;
    if (!id) return;
    const appointment = allAppointments.find((a) => a.id == id);
    if (appointment) openApptDetailModal(appointment);
    return;
  }

  const action = btn.dataset.action;
  if (!action) return;

  const row = btn.closest("tr");
  const id = row?.dataset.id;
  if (!id) return;

  const appointment = allAppointments.find((a) => a.id == id);
  if (!appointment) return;

  if (action === "edit") {
    openModal("edit", appointment);
  } else if (action === "accept") {
    const acceptModalEl = document.getElementById("acceptModal");
    const acceptApptIdEl = document.getElementById("acceptApptId");
    const acceptDurationEl = document.getElementById("acceptDuration");
    const acceptDateEl = document.getElementById("acceptDate");
    const acceptTimeEl = document.getElementById("acceptTime");
    const acceptPriceEl = document.getElementById("acceptPrice");
    const acceptApptTypeEl = document.getElementById("acceptApptType");
    const acceptServiceEl = document.getElementById("acceptService");
    
    if (acceptModalEl && acceptApptIdEl) {
      acceptApptIdEl.value = id;
      
      // Populate Summary
      const nameEl = document.getElementById("acceptPatientName");
      
      if (nameEl) nameEl.textContent = appointment.patient_name || "Unknown Patient";
      
      // Set clinical fields from specific Supabase columns
      const apptType = (appointment.appointment_type || "schedule").toLowerCase();
      const typeDisplay = document.getElementById("acceptApptTypeDisplay");
      const typeHidden = document.getElementById("acceptApptType");
      
      if (typeDisplay) {
          const typeMap = { "schedule": "Regular Schedule", "consultation": "Consultation", "followups": "Follow-up" };
          typeDisplay.textContent = typeMap[apptType] || apptType;
      }
      if (typeHidden) typeHidden.value = apptType;
      
      // Prioritize patient_condition column as requested
      const apptService = appointment.patient_condition || appointment.service || appointment.condition || "General Consultation";
      const serviceDisplay = document.getElementById("acceptServiceDisplay");
      const serviceHidden = document.getElementById("acceptService");
      
      if (serviceDisplay) serviceDisplay.textContent = apptService;
      if (serviceHidden) serviceHidden.value = apptService;



      if (acceptDurationEl) acceptDurationEl.value = appointment.duration_minutes || appointment.duration || 30;
      if (acceptDateEl) {
        const today = new Date();
        const formatDate = (d) => {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          return `${y}-${m}-${day}`;
        };
        
        const minDate = formatDate(today);
        const nextWeek = new Date(today);
        nextWeek.setDate(today.getDate() + 7);
        const maxDate = formatDate(nextWeek);
        
        acceptDateEl.min = minDate;
        acceptDateEl.max = maxDate;
        acceptDateEl.value = appointment.appointment_date || minDate;
      }
      if (acceptTimeEl) {
        const t = appointment.appointment_time || "";
        // Clear placeholder 12:00 AM / 00:00:00 from app
        acceptTimeEl.value = (t === "00:00:00" || t === "00:00") ? "" : t;
      }
      
      if (acceptPriceEl) {
        const type = (appointment.appointment_type || "").toLowerCase();
        if (appointment.price) {
          acceptPriceEl.value = appointment.price;
        } else if (type === "consultation") {
          acceptPriceEl.value = "500";
        } else {
          acceptPriceEl.value = "";
        }
      }
      
      acceptModalEl.classList.remove("hidden");
      acceptModalEl.classList.add("flex");
      if (window.lucide) window.lucide.createIcons({ root: acceptModalEl });
    }
  } else if (action === "decline") {
    try {
      await updateAppointment(id, { status: "declined" });
      await fetchAppointments();
    } catch (err) {
      console.error(err);
    }
  } else if (action === "done") {
    openPrecautionModal(appointment);
  } else if (action === "setFollowup") {
    openFollowupModal(appointment);
  } else if (action === "consultationNotes") {
    openConsultationModal(appointment);
  } else if (action === "precaution") {
    openPrecautionModal(appointment);
  } else if (action === "viewPrecaution") {
    alert("Patient Reminder Sent:\n\n" + btn.dataset.msg);
  } else if (action === "delete") {
    const ok = window.confirm("Delete this appointment?");
    if (!ok) return;

    try {
      await deleteAppointment(id);
      await fetchAppointments();
    } catch (err) {
      console.error("Error deleting:", err);
    }
  }
}

// Update the original listener to use the shared function
appointmentsBody.removeEventListener("click", appointmentsBody.onclick); // Not needed but for clarity
appointmentsBody.addEventListener("click", handleTableClick);

// ============================
// PROGRESS MODAL HANDLING
// ============================

const progressModal = document.getElementById("progressModal");
const closeProgressModalBtn = document.getElementById("closeProgressModalBtn");
const cancelProgressModalBtn = document.getElementById("cancelProgressModalBtn");
const progressForm = document.getElementById("progressForm");
const progressApptId = document.getElementById("progressApptId");
const progressTitle = document.getElementById("progressTitle");
const progressImage = document.getElementById("progressImage");
const progressImagePreviewContainer = document.getElementById("progressImagePreviewContainer");
const progressImagePreview = document.getElementById("progressImagePreview");
const clearProgressImageBtn = document.getElementById("clearProgressImageBtn");
const progressNotes = document.getElementById("progressNotes");
const progressSafety = document.getElementById("progressSafety");
const progressSaveMsg = document.getElementById("progressSaveMsg");
const consultationModal = document.getElementById("consultationModal");
const closeConsultationModalBtn = document.getElementById("closeConsultationModalBtn");
const cancelConsultationBtn = document.getElementById("cancelConsultationBtn");
const consultationForm = document.getElementById("consultationForm");
const consultationApptId = document.getElementById("consultationApptId");
const consultationDiagnosed = document.getElementById("consultationDiagnosed");
const consultationSpecifyWrap = document.getElementById("consultationSpecifyWrap");
const consultationSpecifyDiagnosis = document.getElementById("consultationSpecifyDiagnosis");
const consultationSaveMsg = document.getElementById("consultationSaveMsg");

let currentProgressBase64 = null;

function parseConsultationDataFromNotes(rawNotes) {
  const text = String(rawNotes || "");
  // Supports both old and new labels for backward compatibility.
  const resultMatch =
    text.match(/Diagnosed:\s*(.+)/i) ||
    text.match(/Consultation Result:\s*(.+)/i);
  const notesMatch =
    text.match(/Advice\/Recommendation:\s*([\s\S]*)/i) ||
    text.match(/Consultation Notes:\s*([\s\S]*)/i);
  return {
    result: resultMatch ? resultMatch[1].trim() : "",
    notes: notesMatch ? notesMatch[1].trim() : text,
  };
}

function parseDiagnosedForDisplay(rawNotes) {
  const text = String(rawNotes || "");
  const match = text.match(/Diagnosed:\s*(.+)/i);
  if (!match) return text;
  return match[1].trim();
}

// ---------------------------
// APPOINTMENT DETAIL MODAL
// ---------------------------
const apptDetailModal = document.getElementById("apptDetailModal");
const closeApptDetailBtn = document.getElementById("closeApptDetailBtn");

async function openApptDetailModal(appt) {
  if (!apptDetailModal) return;

  const card = document.getElementById("apptDetailCard");
  const historyPanel = document.getElementById("apptDetailHistoryPanel");

  // ... (rest of reset logic)
  if (card) {
    card.classList.remove("scale-100", "opacity-100");
    card.classList.add("scale-95", "opacity-0");
  }
  if (historyPanel) {
    historyPanel.classList.add("hidden");
    historyPanel.classList.remove("flex", "translate-x-0", "opacity-100");
    historyPanel.classList.add("translate-x-4", "opacity-0");
  }

  // Prevent background scrolling
  document.body.style.overflow = "hidden";

  const type = (appt.appointment_type || appt.service_type || "schedule").toLowerCase();
  const typeLabel = type === "consultation" ? "Consultation" : type === "followups" ? "Follow-Up" : "Schedule";

  // ... (header background logic)
  const headerEl = document.getElementById("apptDetailHeader");
  if (type === "consultation") {
    headerEl.style.background = "linear-gradient(135deg, #f59e0b, #d97706)";
  } else if (type === "followups") {
    headerEl.style.background = "linear-gradient(135deg, #14b8a6, #0d9488)";
  } else {
    headerEl.style.background = "linear-gradient(135deg, #3b82f6, #2563eb)";
  }

  document.getElementById("apptDetailType").textContent = typeLabel;

  // Status badge
  const statusEl = document.getElementById("apptDetailStatus");
  const status = (appt.status || "pending").toLowerCase();
  const statusColors = {
    pending: { bg: "#fef3c7", color: "#d97706" },
    accepted: { bg: "#d1fae5", color: "#059669" },
    scheduled: { bg: "#dbeafe", color: "#2563eb" },
    done: { bg: "#ede9fe", color: "#7c3aed" },
    declined: { bg: "#fee2e2", color: "#dc2626" },
  };
  const sc = statusColors[status] || statusColors.pending;
  statusEl.style.background = sc.bg;
  statusEl.style.color = sc.color;
  statusEl.textContent = formatStatusLabel(appt.status);

  document.getElementById("apptDetailId").textContent = `ID: ${appt.id || "—"}`;
  document.getElementById("apptDetailPatient").textContent = appt.patient_name || "—";
  
  // Robust Age Fetching
  let ageVal = appt.patient_age || "N/A";
  if (!appt.patient_age || appt.patient_age === "N/A" || appt.patient_age === 0) {
      const patientMatch = findPatientByName(appt.patient_name);
      if (patientMatch) {
          const bday = patientMatch.birth_date || patientMatch.dob || patientMatch.birthday;
          if (bday) {
              ageVal = calculatePatientAge(bday);
          } else if (patientMatch.age) {
              ageVal = patientMatch.age;
          }
      }
  }
  document.getElementById("apptDetailAge").textContent = ageVal;
  document.getElementById("apptDetailGender").textContent = appt.patient_gender || "—";
  document.getElementById("apptDetailCreator").textContent = appt.created_by_name || "Self (Patient Account)";

  // Teeth Count
  const teethRow = document.getElementById("apptDetailTeethRow");
  const teethEl = document.getElementById("apptDetailTeeth");
  if (teethRow && teethEl) {
    if (appt.teeth_count) {
      teethRow.classList.remove("hidden");
      teethEl.textContent = appt.teeth_count;
    } else {
      teethRow.classList.add("hidden");
    }
  }

  document.getElementById("apptDetailDate").textContent = appt.appointment_date || "—";

  // Time
  const rawTimeDetail = appt.appointment_time || appt.time || appt.scheduled_time || "—";
  document.getElementById("apptDetailTime").textContent = formatAptTimeRange(rawTimeDetail, appt.duration_minutes || appt.duration);

  // Duration
  if (document.getElementById("apptDetailDuration")) {
    document.getElementById("apptDetailDuration").textContent = appt.duration_minutes || appt.duration || "—";
  }
  
  // Price
  if (document.getElementById("apptDetailPrice")) {
    document.getElementById("apptDetailPrice").textContent = appt.price ? `₱${appt.price}` : "—";
  }

  // Remove Doctor from detail modal display if exists
  const doctorEl = document.getElementById("apptDetailDoctor");
  if (doctorEl) {
    doctorEl.textContent = "Clinic Staff";
    doctorEl.parentElement.classList.add("hidden");
  }

  const historySection = document.getElementById("apptDetailHistorySection");
  const medHistoryEl = document.getElementById("apptDetailMedHistory");
  const firstVisitEl = document.getElementById("apptDetailFirstVisit");
  const ftVal = appt.first_time_visit || "No";
  const mhVal = appt.medical_history || "None Recorded";
  
  if (medHistoryEl) medHistoryEl.textContent = mhVal;
  if (firstVisitEl) firstVisitEl.textContent = ftVal;
  
  const isConsult = (appt.appointment_type || "").toLowerCase() === "consultation";
  if (historySection) {
      if (mhVal !== "None Recorded" || ftVal !== "No" || isConsult) {
          historySection.classList.remove("hidden");
      } else {
          historySection.classList.add("hidden");
      }
  }

  const conditionEl = document.getElementById("apptDetailCondition");
  const journeyEl = document.getElementById("apptDetailJourney");
  const tagsEl = document.getElementById("apptDetailTags");
  const imgsEl = document.getElementById("apptDetailImages");
  const mediaWrap = document.getElementById("apptDetailMediaWrap");

  if (tagsEl) tagsEl.innerHTML = "";
  if (imgsEl) imgsEl.innerHTML = "";

  // Restore definitions for media logic
  let specialTags = [];
  let beforeImg = null;
  let afterImg = null;

  // Extract from patient_condition or notes if needed
  const conditionText = appt.patient_condition || "";
  const tagRegex = /\[(PLAN|ReminderSent|Accomplished):(.*?)\]/gi;
  let m;
  while ((m = tagRegex.exec(conditionText)) !== null) {
    specialTags.push({ type: m[1], val: m[2] });
  }

  let displayCondition = appt.patient_condition || appt.service_type || appt.appointment_type || "General Consultation / Inquiry";
  
  // Clean tags from displayCondition
  if (typeof displayCondition === 'string') {
      displayCondition = displayCondition
        .replace(/\[(PLAN|Accomplished|CareReminder|ReminderSent|BEFORE_JPG|AFTER_JPG)(?:\s*\(.*?\))?:[\s\S]*?\]/gi, "")
        .replace(/\[\d+[DMH]_REMINDER_SENT\]/gi, "")
        .trim();
  }

  if (displayCondition.toLowerCase() === "schedule" || displayCondition.toLowerCase() === "consultation" || displayCondition.toLowerCase() === "followups" || !displayCondition) {
    const typeLower = (appt.appointment_type || "").toLowerCase();
    displayCondition = (typeLower === "consultation") ? "General Consultation / Inquiry" : (typeLower === "followups" ? "Follow-up Treatment" : "General Treatment");
  }
  if (conditionEl) conditionEl.textContent = displayCondition;

  // Handle Accomplished Section for detail modal
  const accomplishedWrap = document.getElementById("apptDetailAccomplishedWrap");
  const accomplishedList = document.getElementById("apptDetailAccomplishedList");
  if (accomplishedWrap && accomplishedList) {
      const accTags = specialTags.filter(t => t.type.toUpperCase() === "ACCOMPLISHED");
      if (accTags.length > 0) {
          accomplishedWrap.classList.remove("hidden");
          accomplishedList.innerHTML = accTags.map(t => {
              const display = t.val.includes(" - ") ? t.val.split(" - ")[0].trim() : t.val.trim();
              return `<span class="inline-flex items-center px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-[10px] font-black uppercase border border-emerald-100 shadow-sm transition-all hover:scale-105">${display}</span>`;
          }).join("");
      } else {
          accomplishedWrap.classList.add("hidden");
      }
  }

  // Handle Treatment Journey Display (Try appointment column first)
  if (journeyEl) {
      journeyEl.textContent = appt.treatment_plan || "—";
      
      // Attempt separate table fetch only as a supplement
      try {
          const { data, error } = await sb.from("treatment_plan")
            .select("plan_key")
            .eq("appointment_id", appt.id)
            .maybeSingle();
          
          if (!error && data) {
              journeyEl.textContent = data.plan_key;
          }
      } catch (err) {
          // Silently fail if table doesn't exist (404)
      }
  }

  // Handle Patient Reminders (New Column)
  const reminderRow = document.getElementById("apptDetailReminderWrap");
  const reminderEl = document.getElementById("apptDetailReminder");
  if (reminderRow && reminderEl) {
    const reminderText = appt.patient_reminder || "";
    if (reminderText.trim()) {
      reminderRow.classList.remove("hidden");
      reminderEl.textContent = reminderText;
    } else {
      reminderRow.classList.add("hidden");
      reminderEl.textContent = "";
    }
  }

  // Show media wrap only if tags or images exist
  if (mediaWrap) {
      if (specialTags.length > 0 || beforeImg || afterImg) {
          mediaWrap.classList.remove("hidden");
      } else {
          mediaWrap.classList.add("hidden");
      }
  }

  if (specialTags.length > 0 || beforeImg || afterImg) {

    // Render Tags
    if (tagsEl) {
      specialTags.forEach(t => {
        let bg = "bg-slate-100 text-slate-500";
        const typeU = t.type.toUpperCase();
        if (typeU === "PLAN") bg = "bg-indigo-50 text-indigo-600 border-indigo-100";
        if (typeU === "ACCOMPLISHED") bg = "bg-emerald-50 text-emerald-600 border-emerald-100";
        if (typeU === "REMINDERSENT") bg = "bg-amber-50 text-amber-600 border-amber-100";

        const span = document.createElement("span");
        span.className = `px-2 py-0.5 rounded-md text-[9px] font-bold border ${bg} uppercase tracking-tighter`;
        span.textContent = `${t.type}: ${t.val}`;
        tagsEl.appendChild(span);
      });
    }

    // Render Images
    if (imgsEl) {
      if (beforeImg) {
        imgsEl.innerHTML += `
          <div class="space-y-1">
            <p class="text-[8px] font-black text-rose-400 uppercase tracking-widest pl-1">Before treatment</p>
            <div class="aspect-square bg-slate-100 rounded-lg overflow-hidden border border-slate-200">
              <img src="${beforeImg}" class="w-full h-full object-cover cursor-zoom-in hover:scale-110 transition-transform duration-500" onclick="window.openFullImage('${beforeImg}')" />
            </div>
          </div>`;
      }
      if (afterImg) {
        imgsEl.innerHTML += `
          <div class="space-y-1">
            <p class="text-[8px] font-black text-emerald-400 uppercase tracking-widest pl-1">After treatment</p>
            <div class="aspect-square bg-slate-100 rounded-lg overflow-hidden border border-slate-200">
              <img src="${afterImg}" class="w-full h-full object-cover cursor-zoom-in hover:scale-110 transition-transform duration-500" onclick="window.openFullImage('${afterImg}')" />
            </div>
          </div>`;
      }
    }
  }

  // Footer Actions
  const historyBtn = document.getElementById("apptDetailHistoryBtn");
  if (historyBtn) {
    historyBtn.onclick = () => toggleApptDetailHistory(appt.patient_name);
  }

  // Open UI
  apptDetailModal.classList.remove("hidden");
  apptDetailModal.classList.add("flex");

  setTimeout(() => {
    if (card) {
      card.classList.remove("scale-95", "opacity-0");
      card.classList.add("scale-100", "opacity-100");
    }
  }, 10);

  if (window.lucide) window.lucide.createIcons({ root: apptDetailModal });
}

function closeApptDetailModal() {
  const card = document.getElementById("apptDetailCard");
  const historyPanel = document.getElementById("apptDetailHistoryPanel");

  if (card) {
    card.classList.add("scale-95", "opacity-0");
    card.classList.remove("scale-100", "opacity-100");
  }
  if (historyPanel) {
    historyPanel.classList.add("translate-x-4", "opacity-0");
    historyPanel.classList.remove("translate-x-0", "opacity-100");
  }

  setTimeout(() => {
    apptDetailModal.classList.add("hidden");
    apptDetailModal.classList.remove("flex");
    document.body.style.overflow = "";
    if (historyPanel) {
      historyPanel.classList.add("hidden");
      historyPanel.classList.remove("flex");
    }
  }, 300);
}

if (closeApptDetailBtn) closeApptDetailBtn.addEventListener("click", closeApptDetailModal);

const closeApptDetailHistory = document.getElementById("closeApptDetailHistory");
if (closeApptDetailHistory) {
  closeApptDetailHistory.onclick = () => toggleApptDetailHistory();
}

if (apptDetailModal) {
  apptDetailModal.addEventListener("click", (e) => {
    if (e.target === apptDetailModal) closeApptDetailModal();
  });
}

function updateConsultationSpecifyFieldVisibility() {
  if (!consultationDiagnosed || !consultationSpecifyWrap || !consultationSpecifyDiagnosis) return;
  const isOther = consultationDiagnosed.value === "other";
  consultationSpecifyWrap.classList.toggle("hidden", !isOther);
  consultationSpecifyDiagnosis.required = isOther;
  if (!isOther) consultationSpecifyDiagnosis.value = "";
}

function openConsultationModal(appointment) {
  // Prevent background scrolling
  document.body.style.overflow = "hidden";

  if (!consultationModal || !appointment) return;
  consultationApptId.value = appointment.id || "";

  const parsed = parseConsultationDataFromNotes(appointment.patient_condition);
  if (consultationDiagnosed) {
    const diagnosedValue = parsed.result || "";
    if (diagnosedValue.toLowerCase().startsWith("other")) {
      consultationDiagnosed.value = "other";
      if (consultationSpecifyDiagnosis) {
        consultationSpecifyDiagnosis.value = diagnosedValue.replace(/^other\s*:?\s*/i, "").trim();
      }
    } else {
      consultationDiagnosed.value = diagnosedValue;
      if (consultationSpecifyDiagnosis) consultationSpecifyDiagnosis.value = "";
    }
  }
  updateConsultationSpecifyFieldVisibility();
  consultationSaveMsg.classList.add("hidden");

  // Render inline phases for quick tracking
  const phasesList = document.getElementById("consultationPhasesList");
  const progressSection = document.getElementById("consultationProgressSection");

  if (phasesList && progressSection) {
    const patientName = appointment.patient_name;
    const lastAppt = allAppointments.find(a => a.patient_name === patientName);
    if (lastAppt) {
      currentPlanKey = getTreatmentPlanKey(lastAppt);
    }


    if (currentPlanKey) {
      progressSection.classList.remove("hidden");
      const phases = treatmentJourneys[currentPlanKey];
      const patientAppts = allAppointments.filter(a => a.patient_name === patientName);
      const allText = patientAppts.map(a => `${a.patient_condition || ""} ${a.appointment_type}`).join(" ").toLowerCase();

      phasesList.innerHTML = "";
      phases.forEach((p, i) => {
        const isDone = allText.includes(`[accomplished: ${p.title.toLowerCase()} - ${p.keywords[0].toLowerCase()}]`);
        const div = document.createElement("div");
        div.className = `flex items-center justify-between p-2.5 rounded-xl border ${isDone ? 'bg-emerald-50 border-emerald-100' : 'bg-slate-50 border-slate-100'}`;
        div.innerHTML = `
                <div class="flex items-center gap-3">
                   <div class="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black ${isDone ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-400'}">
                       ${isDone ? '<i data-lucide="check" class="w-3.5 h-3.5"></i>' : (i + 1)}
                   </div>
                   <span class="text-[11px] font-bold ${isDone ? 'text-emerald-700' : 'text-slate-600'}">${p.title}</span>
                </div>
                ${isDone ? `
                    <button type="button" class="unmark-done-consult-btn text-[9px] font-black text-red-600 uppercase hover:underline" data-keyword="${p.keywords[0]}" data-title="${p.title}">Unmark</button>
                ` : `
                    <button type="button" class="mark-done-consult-btn text-[9px] font-black text-blue-600 uppercase hover:underline" data-keyword="${p.keywords[0]}" data-title="${p.title}">Mark Done</button>
                `}
              `;

        const mBtn = div.querySelector(".mark-done-consult-btn");
        if (mBtn) {
          mBtn.onclick = async () => {
            const kw = mBtn.getAttribute("data-keyword");
            const title = mBtn.getAttribute("data-title");
            await markPhaseAccomplished(patientName, kw, title);
            openConsultationModal(appointment); // Refresh modal view
          };
        }

        const uBtn = div.querySelector(".unmark-done-consult-btn");
        if (uBtn) {
          uBtn.onclick = async () => {
            const kw = uBtn.getAttribute("data-keyword");
            const title = uBtn.getAttribute("data-title");
            await unmarkPhaseAccomplished(patientName, kw, title);
            openConsultationModal(appointment); // Refresh modal view
          };
        }
        phasesList.appendChild(div);
      });
      if (window.lucide) window.lucide.createIcons({ root: phasesList });
    } else {
      progressSection.classList.add("hidden");
    }
  }

  consultationModal.classList.remove("hidden");
}

function closeConsultationModal() {
  if (!consultationModal) return;
  consultationModal.classList.add("hidden");
  // Restore background scrolling
  document.body.style.overflow = "";
}

function openProgressModal(apptId) {
  if (!progressModal) return;
  progressApptId.value = apptId;
  progressTitle.value = "";
  progressImage.value = "";
  currentProgressBase64 = null;
  progressImagePreviewContainer.classList.add("hidden");
  clearProgressImageBtn.classList.add("hidden");
  progressNotes.value = "";
  progressSafety.value = "";
  progressSaveMsg.classList.add("hidden");

  progressModal.classList.remove("hidden");
}

function closeProgressModal() {
  progressModal.classList.add("hidden");
}

if (closeProgressModalBtn) closeProgressModalBtn.addEventListener("click", closeProgressModal);
if (cancelProgressModalBtn) cancelProgressModalBtn.addEventListener("click", closeProgressModal);
if (progressModal) {
  progressModal.addEventListener("click", (e) => {
    if (e.target === progressModal) closeProgressModal();
  });
}

// ----------------------
// PRECAUTION MODAL LOGIC
// ----------------------
const precautionModal = document.getElementById("precautionModal");
const closePrecautionBtn = document.getElementById("closePrecautionBtn");
const cancelPrecautionBtn = document.getElementById("cancelPrecautionBtn");
const precautionForm = document.getElementById("precautionForm");
const precautionTemplate = document.getElementById("precautionTemplate");
const precautionMessage = document.getElementById("precautionMessage");
const precautionApptId = document.getElementById("precautionApptId");
const precautionPatientName = document.getElementById("precautionPatientName");

const precautionTemplates = {
  extraction: "Please rest for the remainder of the day. Do not rinse your mouth, spit forcefully, or drink through a straw for 24 hours. Apply an ice pack to the affected area to minimize swelling. Take prescribed pain medication as directed. Stick to soft, cool foods like yogurt or pudding.",
  braces: "You may experience soreness for the next few days. Stick to soft foods, avoid sticky or hard foods (no chewing gum, hard candies, or nuts). Rinse with warm saltwater if you have sores on your cheeks, and use orthodontic wax on the brackets that rub against your mouth.",
  cleaning: "Avoid acidic or heavily colored foods and beverages (like coffee, tea, and soda) for the next few hours to prevent staining. You can resume your normal brushing and flossing routine. Call us if you experience prolonged sensitivity."
};

function openPrecautionModal(appointment) {
  if (!precautionModal) return;
  precautionApptId.value = appointment.id;
  precautionPatientName.textContent = appointment.patient_name || "Unknown Patient";
  precautionTemplate.value = "";
  precautionMessage.value = "";
  precautionModal.classList.remove("hidden");
}

function closePrecautionModal() {
  if (!precautionModal) return;
  precautionModal.classList.add("hidden");
}

if (closePrecautionBtn) closePrecautionBtn.addEventListener("click", closePrecautionModal);
if (cancelPrecautionBtn) cancelPrecautionBtn.addEventListener("click", closePrecautionModal);
if (precautionModal) {
  precautionModal.addEventListener("click", (e) => {
    if (e.target === precautionModal) closePrecautionModal();
  });
}

if (precautionTemplate) {
  precautionTemplate.addEventListener("change", (e) => {
    const val = e.target.value;
    if (val && precautionTemplates[val]) {
      precautionMessage.value = precautionTemplates[val];
    } else {
      precautionMessage.value = "";
    }
  });
}

if (precautionForm) {
  precautionForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const apptId = precautionApptId.value;
    const msg = precautionMessage.value.trim();
    if (!apptId || !msg) return;

    try {
      const patientName = precautionPatientName.textContent;
      // Send notification to the patient
      await sb.from("notifications").insert([{
        patient_name: patientName,
        title: "Care Instructions & Precautions",
        message: msg,
        appt_id: apptId,
        is_read: false
      }]);

      const appt = allAppointments.find((a) => a.id == apptId);
      if (appt) {
        const templateSelect = document.getElementById("precautionTemplate");
        const templateVal = templateSelect ? templateSelect.value : "";
        const templateName = templateSelect && templateVal ? templateSelect.options[templateSelect.selectedIndex].text : "General Instructions";

        const existingReminders = appt.patient_reminder || "";
        const newReminder = `[Care Instruction (${templateName})]: ${msg}`;
        const combinedReminders = existingReminders ? (existingReminders + "\n" + newReminder) : newReminder;
        
        await updateAppointment(apptId, { 
          patient_reminder: combinedReminders, 
          status: "done" 
        });
      }

      alert("Appointment marked as Done and Reminder sent successfully!");
      closePrecautionModal();
      await fetchAppointments(); // Refresh the table status immediately
      await fetchNotifications();
    } catch (err) {
      console.error(err);
      alert("Failed to send reminder. Error: " + err.message);
    }
  });
}

if (consultationModal) {
  consultationModal.addEventListener("click", (e) => {
    if (e.target === consultationModal) closeConsultationModal();
  });
}

if (closeConsultationModalBtn) {
  closeConsultationModalBtn.addEventListener("click", closeConsultationModal);
}

if (cancelConsultationBtn) {
  cancelConsultationBtn.addEventListener("click", closeConsultationModal);
}

if (consultationForm) {
  consultationForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const apptId = consultationApptId.value;
    if (!apptId) return;

    const resultVal = consultationDiagnosed ? consultationDiagnosed.value.trim() : "";
    const specifyVal = consultationSpecifyDiagnosis ? consultationSpecifyDiagnosis.value.trim() : "";

    if (!resultVal) return;
    if (resultVal === "other" && !specifyVal) {
      alert("Please specify the diagnosis.");
      return;
    }

    const diagnosedText = resultVal === "other" ? `other: ${specifyVal}` : resultVal;
    
    try {
      const appt = allAppointments.find((a) => a.id == apptId);
      let newCondition = `Diagnosed: ${diagnosedText}`;
      
      if (appt && appt.condition) {
          // If it already had a condition, append it if it's different
          if (!appt.condition.includes(diagnosedText)) {
              newCondition = appt.condition + " | " + newCondition;
          }
      }

      await updateAppointment(apptId, { condition: newCondition });

      if (appt && appt.patient_name) {
        // Send a notification to the patient app about the diagnosis
        await sb.from("notifications").insert([{
          patient_name: appt.patient_name,
          title: "Diagnosis Updated",
          message: `Your consultation diagnosis has been recorded: ${diagnosedText.toUpperCase()}`,
          appt_id: apptId,
          is_read: false
        }]);
        await fetchNotifications(); // Refresh admin notification bell
      }

      consultationSaveMsg.classList.remove("hidden");
      await fetchAppointments();
      setTimeout(() => {
        closeConsultationModal();
      }, 600);
    } catch (err) {
      console.error("Failed to save consultation notes:", err);
      alert("Failed to save consultation notes.");
    }
  });
}

if (consultationDiagnosed) {
  consultationDiagnosed.addEventListener("change", updateConsultationSpecifyFieldVisibility);
}

// Handle Image Change
if (progressImage) {
  progressImage.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (readerEvent) => {
        currentProgressBase64 = readerEvent.target.result;
        progressImagePreview.src = currentProgressBase64;
        progressImagePreviewContainer.classList.remove("hidden");
        clearProgressImageBtn.classList.remove("hidden");
      };
      reader.readAsDataURL(file);
    } else {
      currentProgressBase64 = null;
      progressImagePreviewContainer.classList.add("hidden");
      clearProgressImageBtn.classList.add("hidden");
    }
  });
}

// Handle clear image
if (clearProgressImageBtn) {
  clearProgressImageBtn.addEventListener("click", () => {
    progressImage.value = "";
    currentProgressBase64 = null;
    progressImagePreviewContainer.classList.add("hidden");
    clearProgressImageBtn.classList.add("hidden");
  });
}

// Handle submit
if (progressForm) {
  progressForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const apptId = progressApptId.value;
    if (!apptId) return;

    const payload = {
      appt_id: apptId,
      title: progressTitle.value.trim(),
      picture_base64: currentProgressBase64,
      notes: progressNotes.value.trim(),
      safety_precautions: progressSafety.value.trim(),
      created_at: new Date().toISOString()
    };

    const saveBtn = document.getElementById("saveProgressBtn");
    const origText = saveBtn.innerHTML;
    saveBtn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Saving...';
    saveBtn.disabled = true;

    try {
      // Option 1: Insert into appointment_progress table if it exists
      const { error: insertError } = await sb.from("appointment_progress").insert([payload]);
      if (insertError) {
        console.warn("Attempted to insert into appointment_progress contextually.", insertError);
      }

      const appointment = allAppointments.find((a) => a.id == apptId);
      if (appointment) {
        // Progress update: We will store this in the condition column instead of patient_reminder 
        // as per the request to decouple reminders from clinical notes/progress.
        const progressEntry = `Progress [${payload.title}]: ${payload.patient_condition || payload.notes} | Safety: ${payload.safety_precautions}`;
        const combinedCondition = appointment.condition ? (appointment.condition + " | " + progressEntry) : progressEntry;
        
        await updateAppointment(apptId, { condition: combinedCondition });
      }

      progressSaveMsg.classList.remove("hidden");
      setTimeout(() => {
        closeProgressModal();
        fetchAppointments(); // Refresh to show updated notes
      }, 1000);

    } catch (err) {
      console.error("Error saving progress:", err);
      alert("An error occurred while saving progress.");
    } finally {
      saveBtn.innerHTML = origText;
      saveBtn.disabled = false;
      if (window.lucide) window.lucide.createIcons();
    }
  });
}

// ============================
// FOLLOW-UP MODAL HANDLING
// ============================

const followupModal = document.getElementById("followupModal");
const followupForm = document.getElementById("followupForm");
const closeFollowupModalBtn = document.getElementById("closeFollowupModalBtn");
const cancelFollowupBtn = document.getElementById("cancelFollowupBtn");

function openFollowupModal(appointment) {
  if (!followupModal) return;
  document.getElementById("followupPatientName").value = appointment.patient_name || "";
  document.getElementById("followupPatientPhone").value = (appointment.patient_phone || appointment.phone || appointment.contact || appointment.mobile || "");
  document.getElementById("followupPatientEmail").value = (appointment.patient_email || appointment.email || "");

  document.getElementById("followupPatientLabel").innerText = appointment.patient_name || "Unknown Patient";

  document.getElementById("followupDate").value = "";
  document.getElementById("followupTime").value = "";
  document.getElementById("followupNotes").value = "Follow-up visit for " + (appointment.patient_condition || "previous treatment");

  // Integration: Render phases or plan assigner
  const phasesList = document.getElementById("followupPhasesList");
  const phasesWrap = document.getElementById("followupPhasesWrap");
  const planAssignWrap = document.getElementById("followupPlanAssignWrap");
  const planSelect = document.getElementById("followupPlanSelect");

  if (phasesList && phasesWrap && planAssignWrap) {
    const patientName = appointment.patient_name;
    const lastAppt = allAppointments.find(a => a.patient_name === patientName);
    let currentPlanKey = null;

    if (lastAppt) {
      currentPlanKey = getTreatmentPlanKey(lastAppt);
    }


    if (currentPlanKey) {
      phasesWrap.classList.remove("hidden");
      planAssignWrap.classList.add("hidden");
      const phases = treatmentJourneys[currentPlanKey];
      const patientAppts = allAppointments.filter(a => a.patient_name === patientName);
      const allText = patientAppts.map(a => `${a.patient_condition || ""} ${a.appointment_type}`).join(" ").toLowerCase();

      phasesList.innerHTML = "";
      phases.forEach((p, i) => {
        const isDone = allText.includes(`[accomplished: ${p.title.toLowerCase()} - ${p.keywords[0].toLowerCase()}]`);
        const div = document.createElement("div");
        div.className = `flex items-center justify-between p-2 rounded-lg border ${isDone ? 'bg-teal-50 border-teal-100' : 'bg-slate-50 border-slate-100'}`;
        div.innerHTML = `
                <div class="flex items-center gap-2">
                   <div class="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black ${isDone ? 'bg-teal-500 text-white' : 'bg-slate-200 text-slate-400'}">
                       ${isDone ? '<i data-lucide="check" class="w-3 h-3"></i>' : (i + 1)}
                   </div>
                   <span class="text-[10px] font-bold ${isDone ? 'text-teal-700' : 'text-slate-600'}">${p.title}</span>
                </div>
                ${isDone ? `
                   <button type="button" class="unmark-done-followup-btn text-[8px] font-black text-red-500 uppercase" data-keyword="${p.keywords[0]}" data-title="${p.title}">Unmark</button>
                ` : `
                   <button type="button" class="mark-done-followup-btn text-[8px] font-black text-teal-600 uppercase" data-keyword="${p.keywords[0]}" data-title="${p.title}">Mark Done</button>
                `}
              `;

        const mBtn = div.querySelector(".mark-done-followup-btn");
        if (mBtn) {
          mBtn.onclick = async () => {
            const kw = mBtn.getAttribute("data-keyword");
            const title = mBtn.getAttribute("data-title");
            await markPhaseAccomplished(patientName, kw, title);
            openFollowupModal(appointment); // Refresh modal view
          };
        }

        const uBtn = div.querySelector(".unmark-done-followup-btn");
        if (uBtn) {
          uBtn.onclick = async () => {
            const kw = uBtn.getAttribute("data-keyword");
            const title = uBtn.getAttribute("data-title");
            await unmarkPhaseAccomplished(patientName, kw, title);
            openFollowupModal(appointment); // Refresh modal view
          };
        }
        phasesList.appendChild(div);
      });
      if (window.lucide) window.lucide.createIcons({ root: phasesList });

      const addFollowupPlanBtn = document.getElementById("addFollowupPlanBtn");
      if (addFollowupPlanBtn) {
        addFollowupPlanBtn.onclick = () => {
          if (phasesWrap) phasesWrap.classList.add("hidden");
          if (planAssignWrap) planAssignWrap.classList.remove("hidden");
          const pbBtn = document.getElementById("openPlanBuilderBtn");
          if (pbBtn) pbBtn.click();
        };
      }

      const addFollowupPhaseBtn = document.getElementById("addFollowupPhaseBtn");
      const customPhaseModal = document.getElementById("addCustomPhaseModal");
      const customPhaseInput = document.getElementById("customPhaseNameInput");
      const btnCancel = document.getElementById("cancelAddCustomPhaseBtn");
      const btnClose = document.getElementById("closeAddCustomPhaseBtn");
      const btnConfirm = document.getElementById("confirmAddCustomPhaseBtn");

      if (addFollowupPhaseBtn && customPhaseModal) {
        addFollowupPhaseBtn.onclick = () => {
          customPhaseInput.value = "";
          customPhaseModal.classList.remove("hidden");

          const hideModal = () => customPhaseModal.classList.add("hidden");

          if (btnCancel) btnCancel.onclick = hideModal;
          if (btnClose) btnClose.onclick = hideModal;

          if (btnConfirm) {
            btnConfirm.onclick = () => {
              const newPhaseTitle = customPhaseInput.value;
              if (newPhaseTitle && newPhaseTitle.trim() !== "") {
                const title = newPhaseTitle.trim();
                const kw = title.toLowerCase();
                treatmentJourneys[currentPlanKey].push({ title: title, keywords: [kw] });
                hideModal();
                openFollowupModal(appointment); // Refresh modal view
              }
            };
          }
        };
      }
    } else {
      phasesWrap.classList.add("hidden");
      planAssignWrap.classList.remove("hidden");
      if (planSelect) planSelect.value = "";
    }
  }

  followupModal.classList.remove("hidden");
  if (window.lucide) window.lucide.createIcons();
}

function closeFollowupModal() {
  followupModal.classList.add("hidden");
}

if (closeFollowupModalBtn) closeFollowupModalBtn.addEventListener("click", closeFollowupModal);
if (cancelFollowupBtn) cancelFollowupBtn.addEventListener("click", closeFollowupModal);

if (followupForm) {
  followupForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    let finalNotes = document.getElementById("followupNotes").value.trim();
    const planSelect = document.getElementById("followupPlanSelect");

    // If a plan was selected in this modal, apply the tag
    if (planSelect && planSelect.value) {
      finalNotes += ` [PLAN:${planSelect.value}]`;
    }

    const payload = {
      patient_name: document.getElementById("followupPatientName").value,
      patient_phone: document.getElementById("followupPatientPhone").value,
      patient_email: document.getElementById("followupPatientEmail").value,

      appointment_date: document.getElementById("followupDate").value,
      appointment_time: document.getElementById("followupTime").value,
      status: "scheduled",
      appointment_type: "followups",
      duration_minutes: 30
    };

    const saveBtn = document.getElementById("saveFollowupBtn");
    const origText = saveBtn.innerHTML;
    saveBtn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Setting...';
    saveBtn.disabled = true;

    try {
      await createAppointment(payload);
      closeFollowupModal();
      fetchAppointments(); // Refresh lists

      // Navigate to followups tab to see it
      setActiveApptTab("followups");

    } catch (err) {
      console.error("Error scheduling follow-up:", err);
      alert("Failed to schedule follow-up.");
    } finally {
      saveBtn.innerHTML = origText;
      saveBtn.disabled = false;
      if (window.lucide) window.lucide.createIcons();
    }
  });
}

// ============================
// SETTINGS / STAFF MANAGEMENT 
// ============================

// Convert File to Base64 with Compression
function compressImage(file, callback, errorCallback) {
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = function (event) {
    const img = new Image();
    img.src = event.target.result;
    img.onload = function () {
      // REQUIREMENT: Only Portrait Photos Accepted
      if (img.width >= img.height) {
        if (errorCallback) errorCallback("Only PORTRAIT photos are accepted. Please upload an image that is taller than it is wide (e.g., standard phone camera portrait).");
        return;
      }

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      const MAX_WIDTH = 800;
      const MAX_HEIGHT = 800;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > MAX_WIDTH) {
          height *= MAX_WIDTH / width;
          width = MAX_WIDTH;
        }
      } else {
        if (height > MAX_HEIGHT) {
          width *= MAX_HEIGHT / height;
          height = MAX_HEIGHT;
        }
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      // Preserve transparency if they upload a background-removed image (PNG/WebP)
      let mimeType = "image/jpeg";
      let quality = 0.7;
      if (file.type.includes("png") || file.type.includes("webp") || file.type.includes("gif")) {
        mimeType = "image/png"; // PNG safely preserves transparent backgrounds!
        quality = undefined;
      }

      const compressedBase64 = canvas.toDataURL(mimeType, quality);
      callback(compressedBase64);
    };
  };
}

staffImageInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) {
    currentStaffBase64 = null;
    imagePreviewContainer.classList.add("hidden");
    return;
  }
  compressImage(file, (compressedBase64) => {
    currentStaffBase64 = compressedBase64;
    staffImagePreview.src = currentStaffBase64;
    imagePreviewContainer.classList.remove("hidden");
  }, (errMsg) => {
    alert(errMsg);
    staffImageInput.value = "";
    currentStaffBase64 = null;
    imagePreviewContainer.classList.add("hidden");
  });
});

// ============================
// ADD STAFF MODAL HANDLING
// ============================

function openAddStaffModal() {
  if (!addStaffModal) return;
  staffForm.reset();
  currentStaffBase64 = null;
  if (imagePreviewContainer) imagePreviewContainer.classList.add("hidden");
  if (staffSaveMsg) staffSaveMsg.classList.add("hidden");
  addStaffModal.classList.remove("hidden");
  addStaffModal.classList.add("flex");
}

function closeAddStaffModal() {
  if (!addStaffModal) return;
  addStaffModal.classList.add("hidden");
  addStaffModal.classList.remove("flex");
}

if (addStaffFab) {
  addStaffFab.addEventListener("click", openAddStaffModal);
}
if (closeAddStaffModalBtn) {
  closeAddStaffModalBtn.addEventListener("click", closeAddStaffModal);
}
if (cancelAddStaffModalBtn) {
  cancelAddStaffModalBtn.addEventListener("click", closeAddStaffModal);
}
if (addStaffModal) {
  addStaffModal.addEventListener("click", (e) => {
    if (e.target === addStaffModal || e.target.classList.contains("backdrop-blur-sm")) {
      closeAddStaffModal();
    }
  });
}

staffForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const name = staffNameInput.value.trim();
  const role = staffRoleInput.value;
  const email = staffEmailInput.value.trim();
  const phone = staffPhoneInput.value.trim();
  const specialty = staffSpecialtyInput.value.trim();
  const hourly_rate = parseFloat(staffHourlyRateInput.value) || 0;
  const is_available = staffAvailabilityInput.value === "true";

  if (!name || !role) return;

  const payload = {
    name,
    role,
    email,
    phone,
    specialty,
    hourly_rate,
    is_available,
    image_base64: currentStaffBase64
  };

  try {
    const { error } = await sb.from("clinic_staff").insert(payload);
    if (error) throw error;

    // Clear, close modal, and refresh
    staffForm.reset();
    currentStaffBase64 = null;
    if (imagePreviewContainer) imagePreviewContainer.classList.add("hidden");
    closeAddStaffModal();

    await fetchStaff();
  } catch (err) {
    console.error("Error saving staff:", err);
    alert("Failed to save staff. Error: " + err.message);
  }
});

let lastStaffHash = "";

async function fetchStaff() {
  showGlobalLoader();
  try {
    const { data, error } = await sb.from("clinic_staff").select("*").order("name", { ascending: true });
  if (error) {
    console.error("Error fetching staff:", error);
    return;
  }

  const currentHash = JSON.stringify(data);
  if (currentHash === lastStaffHash) return;
  lastStaffHash = currentHash;

  allStaffData = data || [];

  if (allStaffData.length === 0) {
    staffListContainer.innerHTML = `<p class="col-span-full py-6 text-center text-sm text-slate-400">No staff found.</p>`;
    return;
  }

  staffListContainer.innerHTML = allStaffData.map((staff, idx) => {
    let formattedName = escapeHtml(staff.name);

    const hasImage = !!staff.image_base64;
    const imgTag = hasImage
      ? `<img src="${staff.image_base64}" class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />`
      : `<div class="w-full h-full bg-gradient-to-br from-teal-500 to-blue-600 flex items-center justify-center text-white text-6xl font-black">
           ${(staff.name || "?").charAt(0).toUpperCase()}
         </div>`;

    const statusColor = staff.is_available ? "bg-emerald-500" : "bg-slate-400";
    const statusText = staff.is_available ? "Available" : "Away";
    const joinYear = staff.created_at ? new Date(staff.created_at).getFullYear() : 2024;

    return `
      <div class="specialist-card group" style="min-height: 400px; perspective: 2000px;" onclick="toggleStaffFlip(this, event)">
        <div class="staff-flip-inner shadow-xl rounded-[32px]" style="position:relative; width:100%; height:100%; min-height:400px; transition: transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1); transform-style: preserve-3d;">
          
          <!-- ===== FRONT: SPECIALIST PORTRAIT ===== -->
          <div class="staff-flip-front" style="position:absolute; inset:0; backface-visibility:hidden; -webkit-backface-visibility:hidden; border-radius:32px; overflow:hidden; background:white; z-index: 2; pointer-events: auto;">
            <!-- Portrait Container -->
            <div class="relative h-full w-full overflow-hidden">
               ${imgTag}
               <!-- Overlay Gradient -->
               <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"></div>
               
               <!-- Name & Title Info -->
               <div class="absolute bottom-0 left-0 right-0 p-8 text-white">
                  <div class="flex items-center gap-2 mb-2">
                     <span class="px-2 py-0.5 bg-teal-500 rounded text-[9px] font-black uppercase tracking-widest">Specialist</span>
                     <div class="flex items-center gap-1.5 px-2 py-0.5 bg-white/10 backdrop-blur-md rounded border border-white/10">
                        <span class="w-1.5 h-1.5 rounded-full ${statusColor} animate-pulse"></span>
                        <span class="text-[9px] font-bold uppercase tracking-widest">${statusText}</span>
                     </div>
                  </div>
                  <h4 class="text-2xl font-black tracking-tight leading-tight">${formattedName}</h4>
                  <div class="mt-4 flex items-center gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
                    <i data-lucide="info" class="w-3.5 h-3.5"></i>
                    <span class="text-[10px] font-bold uppercase tracking-[2px]">Tap to view details</span>
                  </div>
               </div>
            </div>
          </div>

          <!-- ===== BACK: SPECIALIST DOSSIER ===== -->
          <div class="staff-flip-back" style="position:absolute; inset:0; backface-visibility:hidden; -webkit-backface-visibility:hidden; transform:rotateY(180deg); border-radius:32px; overflow:hidden; background: #f8fafc; border:1px solid #e2e8f0; z-index: 1; pointer-events: none;">
            <div class="p-6 h-full flex flex-col relative">
               <!-- Compact Header -->
               <div class="flex items-center gap-3 mb-4 border-b border-slate-200 pb-4">
                  <div class="w-10 h-10 rounded-xl bg-teal-500 flex items-center justify-center text-white font-black shadow-lg shadow-teal-500/20 text-sm">
                    ${(staff.name || "?").charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h5 class="text-sm font-black text-slate-800 leading-none">${formattedName}</h5>
                    <p class="text-[9px] font-bold text-teal-600 uppercase tracking-widest mt-1">Lead Specialist</p>
                  </div>
               </div>

               <!-- Compact Information Grid -->
               <div class="grid grid-cols-1 gap-3 flex-1 overflow-y-auto no-scrollbar">
                  <div class="flex items-center gap-3 group/item">
                    <div class="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center shadow-sm text-slate-400 group-hover/item:text-teal-500 transition-colors">
                      <i data-lucide="mail" class="w-3.5 h-3.5"></i>
                    </div>
                    <div class="min-w-0">
                      <p class="text-[8px] font-black text-slate-400 uppercase tracking-widest">Email</p>
                      <p class="text-[10px] font-bold text-slate-700 truncate">${staff.email || 'N/A'}</p>
                    </div>
                  </div>

                  <div class="flex items-center gap-3 group/item">
                    <div class="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center shadow-sm text-slate-400 group-hover/item:text-blue-500 transition-colors">
                      <i data-lucide="phone" class="w-3.5 h-3.5"></i>
                    </div>
                    <div>
                      <p class="text-[8px] font-black text-slate-400 uppercase tracking-widest">Phone</p>
                      <p class="text-[10px] font-bold text-slate-700">${staff.phone || 'N/A'}</p>
                    </div>
                  </div>

                  <div class="flex items-center gap-3 group/item">
                    <div class="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center shadow-sm text-slate-400 group-hover/item:text-violet-500 transition-colors">
                      <i data-lucide="briefcase" class="w-3.5 h-3.5"></i>
                    </div>
                    <div>
                      <p class="text-[8px] font-black text-slate-400 uppercase tracking-widest">Dept.</p>
                      <p class="text-[10px] font-bold text-slate-700">${staff.specialty ? escapeHtml(staff.specialty) : 'Orthodontics'}</p>
                    </div>
                  </div>

                  <div class="flex items-center gap-3 group/item">
                    <div class="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center shadow-sm text-slate-400 group-hover/item:text-amber-500 transition-colors">
                      <i data-lucide="calendar" class="w-3.5 h-3.5"></i>
                    </div>
                    <div>
                      <p class="text-[8px] font-black text-slate-400 uppercase tracking-widest">Joined</p>
                      <p class="text-[10px] font-bold text-slate-700">${joinYear}</p>
                    </div>
                  </div>
               </div>

               <!-- Bottom Actions -->
               <div class="pt-4 border-t border-slate-200 mt-4 grid grid-cols-2 gap-2">
                  <button onclick="event.stopPropagation(); editStaff('${staff.id}')"
                    class="flex items-center justify-center gap-2 py-2.5 bg-slate-800 hover:bg-slate-900 rounded-xl text-[9px] font-black text-white uppercase tracking-widest transition-all">
                    <i data-lucide="user-cog" class="w-3 h-3"></i> Edit
                  </button>
                  <button onclick="event.stopPropagation(); deleteStaff('${staff.id}')"
                    class="flex items-center justify-center gap-2 py-2.5 bg-white border border-slate-200 hover:bg-rose-50 hover:text-rose-600 rounded-xl text-[9px] font-black text-slate-600 uppercase tracking-widest transition-all">
                    <i data-lucide="trash-2" class="w-3 h-3"></i> Remove
                  </button>
               </div>
               
               <button class="mt-3 w-full text-[8px] font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest transition-colors flex items-center justify-center gap-1">
                  <i data-lucide="undo-2" class="w-2.5 h-2.5"></i> Tap to flip back
               </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join("");

  // Re-create lucide icons for the new content
  if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    console.error("Error in fetchStaff:", err);
  } finally {
    hideGlobalLoader();
  }
}

// ---- Staff Card Flip Toggle ----
window.toggleStaffFlip = function (cardEl, event) {
  // Don't flip if clicking buttons
  if (event && (event.target.closest('button') || event.target.closest('a'))) return;

  const inner = cardEl.querySelector('.staff-flip-inner');
  const front = cardEl.querySelector('.staff-flip-front');
  const back = cardEl.querySelector('.staff-flip-back');
  if (!inner) return;

  const isCurrentlyFlipped = inner.style.transform === 'rotateY(180deg)';

  if (isCurrentlyFlipped) {
    // Unflipping to front
    inner.style.transform = 'rotateY(0deg)';
    if (front) {
      front.style.pointerEvents = 'auto';
      front.style.zIndex = '2';
      front.querySelectorAll('button').forEach(btn => btn.disabled = false);
    }
    if (back) {
      back.style.pointerEvents = 'none';
      back.style.zIndex = '1';
      back.querySelectorAll('button').forEach(btn => btn.disabled = true);
    }
  } else {
    // Flipping to back
    inner.style.transform = 'rotateY(180deg)';
    if (front) {
      front.style.pointerEvents = 'none';
      front.style.zIndex = '1';
      front.querySelectorAll('button').forEach(btn => btn.disabled = true);
    }
    if (back) {
      back.style.pointerEvents = 'auto';
      back.style.zIndex = '2';
      back.querySelectorAll('button').forEach(btn => btn.disabled = false);
    }
  }
};

// ---- Download Staff QR ----
window.downloadStaffQR = function (staffId, name) {
  const container = document.getElementById(`staff-qr-${staffId}`);
  if (!container) return;

  const canvas = container.querySelector("canvas");
  if (!canvas) return;

  const link = document.createElement("a");
  link.download = `QR_${name.replace(/\s+/g, "_")}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
};

// ---- Print Staff QR Badge ----
window.printStaffQR = function (staffId, name) {
  const container = document.getElementById(`staff-qr-${staffId}`);
  if (!container) return;

  const canvas = container.querySelector("canvas");
  if (!canvas) return;

  const printWindow = window.open("", "_blank");
  printWindow.document.write(`
    <html>
    <head><title>QR Badge - ${name}</title>
    <style>
      body { font-family: 'Inter', Arial, sans-serif; text-align: center; padding: 40px; }
      .badge { border: 2px solid #e2e8f0; border-radius: 24px; padding: 32px; display: inline-block; }
      .badge h2 { font-size: 20px; margin: 16px 0 4px; color: #1e293b; }
      .badge p { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 2px; font-weight: 700; }
      .header { font-size: 14px; font-weight: 900; color: #0891b2; letter-spacing: 3px; text-transform: uppercase; margin-bottom: 8px; }
      img { margin: 16px 0; }
    </style>
    </head>
    <body>
      <div class="badge">
        <p class="header">OrthoConnect Staff Badge</p>
        <img src="${canvas.toDataURL("image/png")}" width="200" height="200" />
        <h2>${name}</h2>
        <p>Scan to record attendance</p>
      </div>
      <script>window.onload = function() { window.print(); }<\/script>
</body>
    </html>
  `);
  printWindow.document.close();
};

// Edit Staff UI Methods
window.editStaff = function (id) {
  const staff = allStaffData.find(s => s.id === id);
  if (!staff) return;

  editStaffId.value = staff.id;
  editStaffName.value = staff.name || "";
  editStaffRole.value = staff.role || "doctor";
  editStaffEmail.value = staff.email || "";
  editStaffPhone.value = staff.phone || "";
  editStaffSpecialty.value = staff.specialty || "";
  editStaffHourlyRate.value = staff.hourly_rate || "";
  editStaffAvailability.value = staff.is_available ? "true" : "false";

  currentEditStaffBase64 = staff.image_base64 || null;
  editStaffImage.value = ""; // clear file input

  if (currentEditStaffBase64) {
    editStaffImagePreview.src = currentEditStaffBase64;
    editStaffImagePreview.classList.remove("hidden");
  } else {
    editStaffImagePreview.src = "";
    editStaffImagePreview.classList.add("hidden");
  }

  staffModal.classList.remove("hidden");
  staffModal.classList.add("flex");
};

function closeStaffModal() {
  staffModal.classList.add("hidden");
  staffModal.classList.remove("flex");
  editStaffForm.reset();
  currentEditStaffBase64 = null;
}

closeStaffModalBtn.addEventListener("click", closeStaffModal);
cancelStaffModalBtn.addEventListener("click", closeStaffModal);
staffModal.addEventListener("click", (e) => {
  if (e.target === staffModal || e.target.classList.contains("backdrop-blur-sm")) {
    closeStaffModal();
  }
});

editStaffImage.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) {
    return;
  }
  compressImage(file, (compressedBase64) => {
    currentEditStaffBase64 = compressedBase64;
    editStaffImagePreview.src = currentEditStaffBase64;
    editStaffImagePreview.classList.remove("hidden");
  }, (errMsg) => {
    alert(errMsg);
    editStaffImage.value = "";
  });
});

editStaffForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const id = editStaffId.value;
  const name = editStaffName.value.trim();
  const role = editStaffRole.value;
  const email = editStaffEmail.value.trim();
  const phone = editStaffPhone.value.trim();
  const specialty = editStaffSpecialty.value.trim();
  const hourly_rate = parseFloat(editStaffHourlyRate.value) || 0;
  const is_available = editStaffAvailability.value === "true";

  if (!id || !name || !role) return;

  const payload = {
    name,
    role,
    email,
    phone,
    specialty,
    hourly_rate,
    is_available,
    image_base64: currentEditStaffBase64
  };

  try {
    const { error } = await sb.from("clinic_staff").update(payload).eq("id", id);
    if (error) throw error;

    closeStaffModal();
    await fetchStaff();
  } catch (err) {
    console.error("Error updating staff:", err);
    alert("Failed to update staff. Error: " + err.message);
  }
});

window.deleteStaff = async function (id) {
  const { data: staffData } = await sb.from("clinic_staff").select("*").eq("id", id).single();
  const staffName = staffData?.full_name || staffData?.name || "this staff member";

  const confirmed = await showConfirm(
    "Move to Recycle Bin?",
    `Move ${staffName}'s account to the Recycle Bin? You can restore it later if needed.`
  );

  if (!confirmed) return;

  try {
    if (staffData) await moveToRecycleBin('staff', staffData);
    await sb.from("clinic_staff").delete().eq("id", id);
    await fetchStaff();
  } catch (err) {
    console.error("Error deleting staff:", err);
  }
};


// ============================
// RECYCLE BIN SYSTEM
// ============================
let allRecycleBinItems = [];

async function initRecycleBin() {
  const grid = document.getElementById("recycleBinGrid");
  const emptyState = document.getElementById("recycleBinEmpty");
  const countEl = document.getElementById("recycleTotalCount");

  if (!grid || !emptyState) return;

  try {
    const { data, error } = await sb.from('recycle_bin').select('*').order('deleted_at', { ascending: false });
    if (error) throw error;

    allRecycleBinItems = data || [];
    const badge = document.getElementById("sidebarRecycleBadge");
    if (badge) {
      const count = allRecycleBinItems.length;
      badge.textContent = count;
      badge.classList.toggle("hidden", count === 0);
    }
    renderRecycleBin();
  } catch (err) {
    console.error("Error fetching recycle bin:", err);
    grid.innerHTML = `<div class="col-span-full text-center py-10 text-rose-500 font-bold">Failed to load recycle bin items. Make sure the 'recycle_bin' table exists.</div>`;
  }
}

function renderRecycleBin() {
  const grid = document.getElementById("recycleBinGrid");
  const emptyState = document.getElementById("recycleBinEmpty");
  const countEl = document.getElementById("recycleTotalCount");
  const searchVal = document.getElementById("recycleSearchInput")?.value.toLowerCase() || "";
  const typeFilter = document.getElementById("recycleTypeFilter")?.value || "all";

  if (!grid || !emptyState) return;

  let filtered = allRecycleBinItems.filter(item => {
    const matchesSearch = JSON.stringify(item.data).toLowerCase().includes(searchVal);
    const matchesType = typeFilter === "all" || item.entity_type === typeFilter;
    return matchesSearch && matchesType;
  });

  if (countEl) countEl.textContent = filtered.length;

  if (filtered.length === 0) {
    grid.innerHTML = "";
    emptyState.classList.remove("hidden");
    return;
  }

  emptyState.classList.add("hidden");
  grid.innerHTML = filtered.map(item => {
    const d = item.data;
    const date = new Date(item.deleted_at).toLocaleString();
    let title = "Deleted Item";
    let sub = "System Record";
    let icon = "database";
    let color = "bg-slate-100 text-slate-600";

    if (item.entity_type === "appointment") {
      title = d.patient_name || "Unknown Patient";
      sub = `Appointment • ${d.appointment_date} ${d.appointment_time || ''}`;
      icon = "calendar";
      color = "bg-blue-50 text-blue-600";
    } else if (item.entity_type === "staff") {
      title = d.name || "Unknown Specialist";
      sub = `Specialist Account • ${d.role || 'Member'}`;
      icon = "users";
      color = "bg-amber-50 text-amber-600";
    } else if (item.entity_type === "inventory") {
      title = d.item_name || "Unknown Item";
      sub = `Inventory Item • ${d.category || 'Supplies'}`;
      icon = "package";
      color = "bg-emerald-50 text-emerald-600";
    } else if (item.entity_type === "payroll") {
      title = d.staff_name || "Payroll Record";
      sub = `Payroll System • ${d.pay_period || 'Record'}`;
      icon = "banknote";
      color = "bg-violet-50 text-violet-600";
    } else if (item.entity_type === "attendance") {
      title = d.staff_name || "Attendance Log";
      sub = `Attendance Record • ${d.date || 'Record'}`;
      icon = "clock";
      color = "bg-indigo-50 text-indigo-600";
    } else if (item.entity_type === "applicant") {
      title = d.full_name || "Unknown Applicant";
      sub = `Application Data • ${d.position || 'Position'}`;
      icon = "file-text";
      color = "bg-rose-50 text-rose-600";
    } else if (item.entity_type === "patient") {
      title = d.full_name || "Unknown Patient";
      sub = `Patient Account • ${d.email || 'No email'}`;
      icon = "folder-open";
      color = "bg-purple-50 text-purple-600";
    }

    return `
      <div class="rounded-[28px] border border-slate-100 bg-white p-5 shadow-sm hover:shadow-md transition-all group relative overflow-hidden">
        <div class="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
            <div class="flex gap-2">
                <button onclick="restoreItem('${item.id}')" title="Restore" class="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center hover:bg-blue-600 hover:text-white transition-all">
                    <i data-lucide="rotate-ccw" class="w-4 h-4"></i>
                </button>
                <button onclick="permanentDelete('${item.id}')" title="Delete Permanently" class="w-8 h-8 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center hover:bg-rose-600 hover:text-white transition-all">
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
            </div>
        </div>
        <div class="flex items-start gap-4">
            <div class="w-12 h-12 rounded-2xl ${color} flex items-center justify-center shrink-0 shadow-sm">
                <i data-lucide="${icon}" class="w-6 h-6"></i>
            </div>
            <div class="flex-1 min-w-0">
                <h4 class="text-sm font-black text-slate-800 truncate">${title}</h4>
                <p class="text-[10px] font-bold text-slate-400 mt-0.5">${sub}</p>
                <div class="mt-4 pt-4 border-t border-slate-50 flex items-center justify-between">
                    <div class="flex flex-col">
                        <span class="text-[8px] font-black text-slate-300 uppercase tracking-widest">Deleted At</span>
                        <span class="text-[10px] font-bold text-slate-500">${date}</span>
                    </div>
                    <div class="flex flex-col text-right">
                        <span class="text-[8px] font-black text-slate-300 uppercase tracking-widest">By</span>
                        <span class="text-[10px] font-bold text-slate-500">${item.deleted_by || 'Admin'}</span>
                    </div>
                </div>
            </div>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons({ root: grid });
}

// Global functions for recycle bin
window.restoreItem = async function (id) {
  const item = allRecycleBinItems.find(i => i.id === id);
  if (!item) return;

  if (!confirm(`Restore this ${item.entity_type}?`)) return;

  try {
    const table = item.entity_type === "appointment" ? "appointments"
      : item.entity_type === "staff" ? "clinic_staff"
        : item.entity_type === "inventory" ? "inventory"
          : item.entity_type === "payroll" ? "payroll"
            : item.entity_type === "attendance" ? "attendance"
              : item.entity_type === "applicant" ? "applicants_records" 
                : item.entity_type === "patient" ? "patients" : null;

    if (!table) throw new Error("Unknown table for " + item.entity_type);

    // Insert back to original table
    const { error: insErr } = await sb.from(table).insert(item.data);
    if (insErr) throw insErr;

    // Delete from recycle bin
    const { error: delErr } = await sb.from('recycle_bin').delete().eq('id', id);
    if (delErr) throw delErr;

    initRecycleBin();
    // Refresh original pages
    if (table === "appointments") fetchAppointments();
    if (table === "clinic_staff") fetchStaff();
    if (table === "inventory") if (typeof fetchInventory === "function") fetchInventory();
    if (table === "payroll") if (typeof fetchPayroll === "function") fetchPayroll();
    if (table === "attendance") if (typeof initAttendancePage === "function") initAttendancePage();
    if (table === "applicants_records") if (typeof loadApplicationRecords === "function") loadApplicationRecords();
    if (table === "patients") fetchPatients();
  } catch (err) {
    console.error("Restore error:", err);
    alert("Failed to restore item: " + err.message);
  }
};

window.permanentDelete = async function (id) {
  if (!confirm("Delete this item permanently? This cannot be undone.")) return;
  try {
    const { error } = await sb.from('recycle_bin').delete().eq('id', id);
    if (error) throw error;
    initRecycleBin();
  } catch (err) {
    console.error("Permanent delete error:", err);
    alert("Failed to delete item.");
  }
};

window.emptyRecycleBin = async function () {
  if (!confirm("Are you sure you want to PERMANENTLY delete all items in the Recycle Bin?")) return;
  try {
    const { data, error } = await sb.from('recycle_bin').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) throw error;
    initRecycleBin();
  } catch (err) {
    console.error("Empty bin error:", err);
    alert("Failed to empty recycle bin.");
  }
};

async function moveToRecycleBin(type, data) {
  if (!data) return;
  try {
    const { error } = await sb.from('recycle_bin').insert({
      entity_type: type,
      entity_id: String(data.id || data.session_id || Date.now()),
      data: data,
      deleted_by: currentAdminStaff?.name || 'Administrator'
    });
    if (error) console.error("Move to Recycle Bin failed:", error);
  } catch (e) {
    console.error("Recycle Bin insert catch:", e);
  }
}

// Add event listeners for filters
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById("recycleSearchInput")?.addEventListener("input", debounce(() => renderRecycleBin()));
  document.getElementById("recycleTypeFilter")?.addEventListener("change", () => renderRecycleBin());
});


// ============================
// INITIALIZATION
// ============================

let appInitInterval = null;
async function initApp() {
  await fetchTreatmentJourneys();
  // Default filter to empty completely so all appointments are shown
  if (filterDate) filterDate.value = "";
  refreshAll();
  fetchStaff();

  // Polling for live UI updates
  setInterval(() => {
    fetchAppointments(true);
    fetchNotifications();
  }, 10000);

  // Default appointments tab
  setActiveApptTab("schedule");

  // Restore last active page from localStorage
  const lastPage = localStorage.getItem("activePage") || "calendar";
  setActivePage(lastPage);

  // Load clinic status settings
  fetchClinicStatus();

  // Load notifications
  fetchNotifications();
  setupNotificationUI();
  initRealtimeNotifications();

  // Initialize icons
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// ============================
// CLINIC STATUS (SETTINGS)
// ============================
async function fetchClinicStatus() {
  try {
    const { data, error } = await sb.from("clinics").select("*").limit(1);
    if (error) {
      console.error("Error fetching clinic status:", error);
      return;
    }
    if (data && data.length > 0) {
      const status = data[0];
      clinicIsOpen.value = status.is_open ? "true" : "false";
      clinicOpeningTime.value = status.opening_time || "";
      clinicClosingTime.value = status.closing_time || "";
      if (clinicClosedNote) {
        clinicClosedNote.value = status.closed_note || "";
        if (clinicClosedNoteCounter) clinicClosedNoteCounter.textContent = clinicClosedNote.value.length;
      }

      const operatingDays = status.operating_days || [];
      clinicOperatingDays.forEach(cb => {
        cb.checked = operatingDays.includes(cb.value) || operatingDays.includes(parseInt(cb.value, 10));
      });
    }
  } catch (err) {
    console.error("Exception fetching clinic status:", err);
  }
}

if (clinicStatusForm) {
  clinicStatusForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const isOpen = clinicIsOpen.value === "true";
    const openingTime = clinicOpeningTime.value || null;
    const closingTime = clinicClosingTime.value || null;
    const closedNote = clinicClosedNote ? clinicClosedNote.value.trim() : "";
    const operatingDays = Array.from(clinicOperatingDays)
      .filter(cb => cb.checked)
      .map(cb => parseInt(cb.value, 10));

    try {
      // Find the first row ID to update:
      const { data: existData, error: fetchErr } = await sb.from("clinics").select("id").limit(1);
      if (fetchErr) throw fetchErr;

      let payload = {
        is_open: isOpen,
        opening_time: openingTime,
        closing_time: closingTime,
        operating_days: operatingDays,
        closed_note: closedNote
      };

      let res;
      if (existData && existData.length > 0) {
        res = await sb.from("clinics").update(payload).eq("id", existData[0].id);
      } else {
        // Create new row if not exists
        res = await sb.from("clinics").insert([payload]);
      }

      if (res.error) throw res.error;

      // Premium Success Feedback
      clinicStatusMsg.innerText = "✓ Clinic status updated successfully!";
      clinicStatusMsg.classList.remove("hidden", "text-red-500");
      clinicStatusMsg.classList.add("text-emerald-600", "animate-bounce");

      setTimeout(() => {
        clinicStatusMsg.classList.add("hidden");
        clinicStatusMsg.classList.remove("animate-bounce");
      }, 3000);

      // Refresh schedule matrix if it's currently open
      if (typeof fetchScheduleTimetable === "function") {
        fetchScheduleTimetable();
      }

    } catch (err) {
      console.error("Error updating clinic status:", err);
      clinicStatusMsg.innerText = "✕ Error: " + (err.message || "Forbidden (Check RLS)");
      clinicStatusMsg.classList.remove("hidden", "text-emerald-600");
      clinicStatusMsg.classList.add("text-red-500");
      alert("Failed to update clinic status. Reason: " + (err.message || "Table permissions denied."));
    }
  });
}



// Initial icons call
if (window.lucide) {
  window.lucide.createIcons();
}

// ============================
// ADMIN DASHBOARD CHAT LOGIC
// ============================
let activeAdminSessionId = null;
let allAdminSessions = []; // Store for filtering
let activeAdminChatFilterType = 'all'; // Current filter type: all, unclaimed, my, archived
let readSessions = new Set(JSON.parse(localStorage.getItem("adminReadSessions") || "[]"));
let adminPrioritySessions = new Set();
let adminMutedSessions = new Set();
let adminArchivedSessions = new Set();
let adminBlockedSessions = new Set();
let adminDeletedSessions = new Set();
let editingMessageId = null; // Track message being edited in-line
let adminStagedImages = []; // Global staging queue for images

const adminChatMessagesContainer = document.getElementById("adminChatMessagesContainer");
const adminChatInput = document.getElementById("adminChatInput");
const adminChatSendBtn = document.getElementById("adminChatSendBtn");
const adminConvSearch = document.getElementById("adminConvSearch");
const adminChatTotalCount = document.getElementById("adminChatTotalCount");

function updateAdminBadge() {
  if (!adminChatTotalCount) return;
  // Count sessions that ARE NOT in readSessions
  const unreadCount = allAdminSessions.filter(s => !readSessions.has(s.id)).length;
  adminChatTotalCount.innerText = unreadCount;
  adminChatTotalCount.style.display = unreadCount > 0 ? "inline-block" : "none";
}

function appendAdminMessage(text, isStaff, timestamp = new Date(), avatarB64 = null, name = "OC", isSeen = false, msgId = null, isDeleted = false, isEdited = false) {
  if (!adminChatMessagesContainer || isDeleted) return;
  const placeholder = adminChatMessagesContainer.querySelector(".flex-col.items-center.justify-center");
  if (placeholder) placeholder.remove();

  const timeStr = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const bubbleRow = document.createElement("div");
  bubbleRow.className = "flex w-full mt-4 animate-in fade-in slide-in-from-bottom-2 duration-500 gap-3 " + (isStaff ? "flex-row-reverse" : "flex-row");

  // Avatar
  const avatarWrapper = document.createElement("div");
  avatarWrapper.className = "shrink-0 mt-1";
  const initials = (name || "OC").slice(0, 2).toUpperCase();

  if (isStaff) {
    avatarWrapper.innerHTML = `<div class="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center text-[10px] font-black text-white shadow-sm ring-2 ring-white">OC</div>`;
  } else {
    avatarWrapper.innerHTML = avatarB64
      ? `<img src="${avatarB64}" class="w-8 h-8 rounded-xl object-cover shadow-sm ring-2 ring-white">`
      : `<div class="w-8 h-8 rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center text-[10px] font-black text-slate-500 shadow-sm ring-2 ring-white">${initials}</div>`;
  }

  const bubbleWrapper = document.createElement("div");
  bubbleWrapper.id = msgId ? `admin-msg-wrapper-${msgId}` : "";
  bubbleWrapper.className = "flex flex-col relative group " + (isStaff ? "items-end" : "items-start");
  bubbleWrapper.style.maxWidth = "70%";

  if (isEdited) {
    const editedLabel = document.createElement("span");
    editedLabel.className = "text-[9px] font-black text-blue-500 uppercase tracking-widest mb-1 ml-1 px-1";
    editedLabel.textContent = "Edited Message";
    bubbleWrapper.appendChild(editedLabel);
  }

  const bubbleContent = document.createElement("div");
  bubbleContent.id = msgId ? `admin-msg-content-${msgId}` : "";
  const isImage = text && text.startsWith("data:image/");

  if (!isImage) {
    bubbleContent.classList.add("text-[13px]", "font-medium", "shadow-sm", "leading-relaxed", "tracking-tight", "rounded-[28px]");
    if (isStaff) {
      bubbleContent.classList.add("bg-gradient-to-br", "from-blue-600", "to-blue-700", "text-white", "rounded-tr-sm", "shadow-blue-500/10", "p-3.5");
    } else {
      bubbleContent.classList.add("bg-white", "border", "border-slate-100", "text-slate-700", "rounded-tl-sm", "shadow-slate-200/50", "p-4");
    }
  } else {
    bubbleContent.classList.add("overflow-hidden");
  }

  if (isImage) {
    bubbleContent.innerHTML = `<img src="${text}" class="max-w-[280px] md:max-w-md rounded-2xl cursor-pointer hover:scale-[1.01] transition-transform duration-300 shadow-md" onclick="openLightbox('${text}')">`;
  } else {
    bubbleContent.innerText = text;
  }

  const meta = document.createElement("div");
  meta.className = "flex items-center gap-1.5 mt-1.5 px-1";

  const timeSpan = document.createElement("span");
  timeSpan.className = "text-[9px] font-bold text-slate-400 uppercase tracking-tighter";
  timeSpan.textContent = timeStr;
  meta.appendChild(timeSpan);

  if (isStaff) {
    const statusContainer = document.createElement("span");
    statusContainer.className = "flex items-center";
    statusContainer.id = msgId ? `admin-msg-status-${msgId}` : "";

    if (isSeen) {
      statusContainer.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="text-blue-500 mr-1"><path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/></svg>
        <span class="text-[10px] font-black text-blue-600 uppercase tracking-widest bg-blue-50/50 px-1.5 py-0.5 rounded-md border border-blue-100">Seen</span>
      `;
    } else {
      statusContainer.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-slate-300 opacity-60"><path d="M20 6 9 17l-5-5"/></svg>
      `;
    }
    meta.appendChild(statusContainer);
  }

  bubbleWrapper.appendChild(bubbleContent);
  bubbleWrapper.appendChild(meta);

  // 3-Dots Menu for Admin - ONLY show for own (staff) messages
  if (msgId && isStaff) {
    const optionsBtn = document.createElement("button");
    optionsBtn.className = "absolute top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-blue-600 z-10 " + (isStaff ? "-left-10" : "-right-10");
    optionsBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>`;

    optionsBtn.onclick = (e) => {
      e.stopPropagation();
      const menu = document.createElement("div");
      menu.className = "fixed bg-white border border-slate-200 shadow-xl rounded-2xl p-1 z-[9999] min-w-[120px] scale-in-center";
      menu.style.top = `${e.clientY}px`;
      menu.style.left = `${e.clientX}px`;

      const createdTime = new Date(timestamp).getTime();
      const diffMin = (Date.now() - createdTime) / (1000 * 60);
      const canEdit = diffMin <= 15;

      if (canEdit) {
        const editBtn = document.createElement("button");
        editBtn.className = "w-full text-left px-3 py-2 text-[11px] font-bold text-slate-600 hover:bg-blue-50 hover:text-blue-600 rounded-xl transition-colors flex items-center gap-2";
        editBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg> Edit`;
        editBtn.onclick = () => {
          menu.remove();
          const currentText = document.getElementById(`admin-msg-content-${msgId}`)?.innerText || text;
          
          // Enter Edit Mode
          editingMessageId = msgId;
          adminChatInput.value = currentText;
          adminChatInput.focus();
          
          // Update UI
          const indicator = document.getElementById("adminEditModeIndicator");
          if (indicator) indicator.classList.remove("hidden");
          
          const sendBtn = document.getElementById("adminChatSendBtn");
          if (sendBtn) {
              sendBtn.innerHTML = `<i data-lucide="check" class="w-5 h-5 transition-transform"></i>`;
              if (window.lucide) window.lucide.createIcons({ root: sendBtn });
          }

          // Auto-adjust height
          adminChatInput.style.height = 'auto';
          adminChatInput.style.height = (adminChatInput.scrollHeight) + 'px';
        };
        menu.appendChild(editBtn);
      }

      const delBtn = document.createElement("button");
      delBtn.className = "w-full text-left px-3 py-2 text-[11px] font-bold text-red-500 hover:bg-red-50 rounded-xl transition-colors flex items-center gap-2";
      delBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg> Delete`;
      delBtn.onclick = async () => {
        menu.remove();
        const confirmed = await showConfirm(
          "Delete Message?",
          "Are you sure you want to delete this message? It will be hidden from everyone.",
          "danger"
        );
        if (confirmed) {
          sb.from('messages').update({ is_deleted: true }).eq('id', msgId).then(() => {
            const row = optionsBtn.closest('.flex.w-full');
            if (row) row.remove();
          });
        }
      };

      menu.appendChild(delBtn);
      document.body.appendChild(menu);

      const closeMenu = () => {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      };
      setTimeout(() => document.addEventListener('click', closeMenu), 10);
    };
    bubbleWrapper.appendChild(optionsBtn);
  }

  bubbleRow.appendChild(avatarWrapper);
  bubbleRow.appendChild(bubbleWrapper);

  adminChatMessagesContainer.appendChild(bubbleRow);
  adminChatMessagesContainer.scrollTop = adminChatMessagesContainer.scrollHeight;
}

async function sendAdminMessage() {
  const hasText = adminChatInput && adminChatInput.value.trim();
  const hasImages = adminStagedImages && adminStagedImages.length > 0;

  if (!activeAdminSessionId || (!hasText && !hasImages)) return;

  // Auto-claim conversation if not already claimed
  const currentSess = allAdminSessions.find(s => s.id === activeAdminSessionId);
  if (currentSess && currentSess.is_unclaimed) {
    await claimActiveSession();
  }

  // 1. Update existing message if in edit mode
  if (editingMessageId && hasText) {
    const newContent = adminChatInput.value.trim();
    adminChatInput.value = "";
    adminChatInput.style.height = 'auto';
    
    const oldId = editingMessageId;
    editingMessageId = null;
    exitEditModeUI();

    try {
      await sb.from('messages').update({ content: newContent, is_edited: true }).eq('id', oldId);
      // Realtime listener handles UI update
    } catch (err) {
      console.error("Update error:", err);
    }
    return;
  }

  // 1. Send Text
  if (hasText) {
    const msg = adminChatInput.value.trim();
    adminChatInput.value = "";
    adminChatInput.style.height = 'auto';

    if (sb) {
      try {
        const { data, error } = await sb.from('messages').insert([{
          session_id: activeAdminSessionId,
          content: msg,
          sender_type: 'staff',
          sender_fullname: currentAdminStaff ? currentAdminStaff.name : 'OrthoConnect Clinic',
          message_type: 'text'
        }]).select();

        if (data && data[0]) {
          appendAdminMessage(data[0].content, true, data[0].created_at, null, "OC", data[0].is_seen, data[0].id, data[0].is_deleted, data[0].is_edited);
        } else {
          appendAdminMessage(msg, true);
        }
      } catch (e) {
        console.warn("Error sending message:", e);
        appendAdminMessage("Error: Failed to send", true);
      }
    }
  }

  // 2. Send Images
  if (hasImages) {
    for (const img of adminStagedImages) {
      appendAdminMessage(img, true);
      if (sb) {
        try {
          await sb.from('messages').insert([{
            session_id: activeAdminSessionId,
            content: img,
            sender_type: 'staff',
            sender_fullname: currentAdminStaff ? currentAdminStaff.name : 'OrthoConnect Clinic',
            message_type: 'image'
          }]);
        } catch (err) {
          console.error("Image send error:", err);
        }
      }
    }
    adminStagedImages = [];
    if (typeof renderAdminPreviews === "function") renderAdminPreviews();
  }
}

async function saveAdminChatState(sid, stateObj) {
  if (!sid || !sb) return;
  try {
    const { data: existing } = await sb.from('admin_chat_states').select('session_id').eq('session_id', sid).maybeSingle();
    if (existing) {
      return await sb.from('admin_chat_states').update(stateObj).eq('session_id', sid);
    } else {
      return await sb.from('admin_chat_states').insert([{ session_id: sid, ...stateObj }]);
    }
  } catch (err) {
    console.error("Save state error:", err);
  }
}

async function claimActiveSession() {
  if (!activeAdminSessionId || !currentAdminStaff || !currentAdminStaff.email) return;
  if (claimingLocalMap.has(activeAdminSessionId)) return; // Prevent double trigger

  claimingLocalMap.add(activeAdminSessionId);

  try {
    const existingRes = await sb.from('admin_chat_states').select('session_id, claimed_by').eq('session_id', activeAdminSessionId).maybeSingle();
    const existing = existingRes.data;

    // If already engaged by someone, don't claim again
    if (existing && existing.claimed_by) {
      claimingLocalMap.delete(activeAdminSessionId);
      return;
    }

    let dbRes;
    if (existing) {
      dbRes = await sb.from('admin_chat_states').update({ claimed_by: currentAdminStaff.email }).eq('session_id', activeAdminSessionId);
    } else {
      dbRes = await sb.from('admin_chat_states').insert([{ session_id: activeAdminSessionId, claimed_by: currentAdminStaff.email }]);
    }

    document.getElementById("adminClaimBtn")?.classList.add("hidden");

  } catch (e) {
    console.error("Critical error in claim:", e);
  } finally {
    claimingLocalMap.delete(activeAdminSessionId);
  }
}

function resetAdminMessenger() {
  activeAdminSessionId = null;
  const header = document.getElementById("adminChatHeaderContainer");
  const input = document.getElementById("adminChatInputContainer");
  const container = document.getElementById("adminChatMessagesContainer");

  if (header) header.classList.add("hidden");
  if (input) input.classList.add("hidden");

  if (container) {
    container.innerHTML = `
      <!-- Welcome State (Informative Guide) -->
      <div class="flex flex-col items-center justify-center h-full text-center max-w-lg mx-auto py-10 scale-in-center animate-in duration-700">
        <div class="relative mb-10">
          <div class="w-28 h-28 bg-blue-50/50 rounded-[40px] flex items-center justify-center animate-pulse">
            <i data-lucide="layout-dashboard" class="w-12 h-12 text-blue-500/40"></i>
          </div>
          <div class="absolute -top-2 -right-2 w-10 h-10 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-blue-500/20 rotate-12">
            <i data-lucide="mouse-pointer-2" class="w-4 h-4"></i>
          </div>
        </div>

        <h3 class="text-2xl font-black text-slate-800 tracking-tight mb-2">Welcome to Clinic Messenger</h3>
        <p class="text-[11px] text-slate-400 font-bold uppercase tracking-[0.2em] mb-10">Getting Started Guide</p>

        <div class="grid grid-cols-1 gap-5 text-left w-full">
          <div class="flex gap-4 group p-4 rounded-3xl hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-100">
            <div class="w-10 h-10 rounded-2xl bg-white shadow-sm border border-slate-100 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
              <i data-lucide="users" class="w-5 h-5 text-indigo-500"></i>
            </div>
            <div>
              <h4 class="text-sm font-black text-slate-800">Select a Conversation</h4>
              <p class="text-[11px] font-medium text-slate-500 mt-0.5 leading-relaxed opacity-80">Choose a patient from the sidebar to load their full interaction history and profile.</p>
            </div>
          </div>

          <div class="flex gap-4 group p-4 rounded-3xl hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-100">
            <div class="w-10 h-10 rounded-2xl bg-white shadow-sm border border-slate-100 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
              <i data-lucide="zap" class="w-5 h-5 text-amber-500"></i>
            </div>
            <div>
              <h4 class="text-sm font-black text-slate-800">Real-time Responses</h4>
              <p class="text-[11px] font-medium text-slate-500 mt-0.5 leading-relaxed opacity-80">Reply instantly to patient inquiries. Your clinic responses are encrypted and secure.</p>
            </div>
          </div>

          <div class="flex gap-4 group p-4 rounded-3xl hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-100">
            <div class="w-10 h-10 rounded-2xl bg-white shadow-sm border border-slate-100 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
              <i data-lucide="clipboard-list" class="w-5 h-5 text-emerald-500"></i>
            </div>
            <div>
              <h4 class="text-sm font-black text-slate-800">Clinical Oversight</h4>
              <p class="text-[11px] font-medium text-slate-500 mt-0.5 leading-relaxed opacity-80">Use the Profile icons to view appointment schedules and shared clinical media.</p>
            </div>
          </div>
        </div>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
  }
}

// Admin Messenger Filter Application
window.applyAdminChatFilter = (type, btn) => {
  activeAdminChatFilterType = type;

  // Update UI active state
  const dropdown = document.getElementById("adminChatFilterDropdown");
  if (dropdown) {
    dropdown.querySelectorAll("button").forEach(b => b.classList.remove("active"));
    if (btn) btn.classList.add("active");
    dropdown.classList.add("hidden");
  }

  loadAdminConversations();
};

async function loadAdminConversations(filter = "") {
  if (!window._optionsClickOutsideBound) {
    document.addEventListener("click", (e) => {
      if (!e.target.closest('.card-options-btn')) {
        document.querySelectorAll('.card-options-menu').forEach(m => m.classList.add('hidden'));
      }
    });
    window._optionsClickOutsideBound = true;
  }

  const convList = document.getElementById("adminConversationList");
  if (!convList) return;

  const highlightText = (text, query) => {
    if (!query || typeof text !== 'string') return text;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, "gi");
    return text.replace(regex, '<span class="bg-blue-200/60 text-blue-900 rounded-sm px-0.5 shadow-sm">$1</span>');
  };

  // Fetch messages AND states from Supabase
  const [messagesRes, statesRes] = await Promise.all([
    sb.from('messages').select('session_id, sender_fullname, sender_avatar_base64, content, created_at, sender_type, is_seen, is_deleted, is_edited').eq('is_deleted', false).order('created_at', { ascending: false }),
    sb.from('admin_chat_states').select('*')
  ]);

  const rawMessages = messagesRes.data;
  const states = statesRes.data;

  const sessionClaimMap = {}; // sid -> staffEmail

  // Sync Global Sets with DB
  if (states) {
    adminPrioritySessions.clear();
    adminMutedSessions.clear();
    adminArchivedSessions.clear();
    adminBlockedSessions.clear();
    adminDeletedSessions.clear();
    states.forEach(s => {
      const sess = allAdminSessions.find(as => as.id === s.session_id);
      if (sess) {
        sess.deleted_at = s.deleted_at;
      }

      if (s.is_priority) adminPrioritySessions.add(s.session_id);
      if (s.is_muted) adminMutedSessions.add(s.session_id);
      if (s.is_archived) adminArchivedSessions.add(s.session_id);
      if (s.is_blocked) adminBlockedSessions.add(s.session_id);
      if (s.is_deleted) adminDeletedSessions.add(s.session_id);
      if (s.claimed_by) sessionClaimMap[s.session_id] = s.claimed_by;
    });

    const chatBadge = document.getElementById("chatDeletedBadge");
    if (chatBadge) {
      const deletedCount = adminDeletedSessions.size;
      chatBadge.textContent = deletedCount;
      chatBadge.classList.toggle("hidden", deletedCount === 0);
    }
  }

  // Update floating badge and show notifications if necessary
  if (rawMessages) checkUnreadMessageChange(rawMessages);

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
          last_message_sender: m.sender_type,
          last_message_seen: m.is_seen,
          last_message_edited: m.is_edited,
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

    const myEmail = (currentAdminStaff ? currentAdminStaff.email : "").toLowerCase().trim();
    const claimEmail = (claimantEmail || "").toLowerCase().trim();
    s.is_claimed_by_me = (claimEmail === myEmail && myEmail !== "");

    sessions.push(s);
  });

  allAdminSessions = sessions;

  // Filter and Sort: Priority chats first, then Recency
  const displaySessions = sessions.filter(s => {
    // Apply Type Filter
    const type = activeAdminChatFilterType;

    // Explicit views for states that are normally hidden
    if (type === 'blocked') {
      if (!adminBlockedSessions.has(s.id)) return false;
      if (filter && !s.sender_fullname.toLowerCase().includes(filter.toLowerCase())) return false;
      return true;
    }
    if (type === 'archived') {
      if (!adminArchivedSessions.has(s.id)) return false;
      if (filter && !s.sender_fullname.toLowerCase().includes(filter.toLowerCase())) return false;
      return true;
    }

    // By default, hide deleted, blocked, and archived
    if (adminDeletedSessions.has(s.id)) return false;
    if (adminBlockedSessions.has(s.id)) return false;
    if (adminArchivedSessions.has(s.id)) return false;

    // Apply specific category filters
    if (type === 'priority' && !adminPrioritySessions.has(s.id)) return false;
    if (type === 'unread' && readSessions.has(s.id)) return false;
    if (type === 'muted' && !adminMutedSessions.has(s.id)) return false;

    if (filter && !s.sender_fullname.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  }).sort((a, b) => {
    const aPrio = adminPrioritySessions.has(a.id);
    const bPrio = adminPrioritySessions.has(b.id);
    if (aPrio && !bPrio) return -1;
    if (!aPrio && bPrio) return 1;
    return new Date(b.created_at) - new Date(a.created_at);
  });

  updateAdminBadge();
  convList.innerHTML = "";

  if (displaySessions.length === 0) {
    convList.innerHTML = `<div class="p-8 text-center text-slate-400 text-xs font-bold uppercase tracking-widest leading-relaxed">No conversations found</div>`;
    renderArchivedConversations();
    return;
  }

  renderArchivedConversations();

  displaySessions.forEach(session => {
    let name = session.sender_fullname || `Patient ${session.id.slice(0, 5)}`;
    let avatarB64 = session.sender_avatar_base64;
    const isActive = session.id === activeAdminSessionId;
    const isRead = readSessions.has(session.id);

    const item = document.createElement("div");
    item.className = `p-4 mb-1 rounded-2xl border transition-all cursor-pointer flex items-center gap-4 relative group ${isActive ? 'bg-blue-50/80 border-blue-100 shadow-sm' : 'bg-transparent border-transparent hover:bg-slate-50'}`;

    const avatarHtml = avatarB64
      ? `<img src="${avatarB64}" class="w-12 h-12 rounded-[18px] object-cover ring-2 ring-white shadow-sm group-hover:scale-105 transition-transform">`
      : `<div class="w-12 h-12 rounded-[18px] bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center text-white font-bold text-xs shadow-sm ring-2 ring-white group-hover:scale-105 transition-transform">${name.slice(0, 2).toUpperCase()}</div>`;

    const timeLabel = new Date(session.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let previewText = session.last_message || "";
    if (previewText.startsWith("data:image/")) {
      previewText = '<span class="flex items-center gap-1"><i data-lucide="image" class="w-3 h-3"></i> Sent an image</span>';
    }

    const highlightedName = highlightText(name, filter);
    let highlightedPreview = (previewText && typeof previewText === 'string' && !previewText.includes('<i'))
      ? highlightText(previewText, filter)
      : previewText;

    if (session.last_message_edited) {
      highlightedPreview = `<span class="flex items-center gap-1">${highlightedPreview}<span class="text-[8px] font-black text-slate-300 uppercase ml-1 italic">(Edited)</span></span>`;
    }

    if (session.last_message_sender === 'staff') {
      const seenStatus = session.last_message_seen
        ? '<span class="text-[9px] font-black text-blue-500 uppercase ml-1">Seen</span>'
        : '<span class="text-[9px] font-black text-slate-300 uppercase ml-1">✓</span>';
      highlightedPreview = `<span class="flex items-center gap-1">${highlightedPreview}${seenStatus}</span>`;
    }

    const statusDot = !isRead
      ? '<span class="absolute -top-1 -right-1 w-4 h-4 bg-red-500 border-2 border-white rounded-full shadow-sm animate-pulse"></span>'
      : '<span class="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-500 border-2 border-white rounded-full shadow-sm"></span>';

    const unclaimedBadge = ''; // UI claim badges removed

    item.innerHTML = `
        <div class="relative self-start mt-0.5">
          ${avatarHtml}
          ${statusDot}
        </div>
        <div class="flex-1 min-w-0 flex justify-between h-full relative">
          ${unclaimedBadge}
          <div class="min-w-0 flex-1 pt-0.5">
            <p class="text-[13px] font-extrabold truncate ${isActive ? 'text-blue-900' : 'text-slate-800'} ${!isRead ? 'text-blue-600' : ''}">
                ${adminPrioritySessions.has(session.id) ? '<i data-lucide="star" class="w-3.5 h-3.5 inline text-amber-500 fill-amber-500 -mt-0.5 mr-1"></i>' : ''}
                ${highlightedName}
                ${adminMutedSessions.has(session.id) ? '<i data-lucide="bell-off" class="w-3 h-3 inline text-slate-400 ml-1"></i>' : ''}
            </p>
            <p class="text-[11px] font-medium mt-1 ${isActive ? 'text-blue-600/80' : 'text-slate-500'} ${!isRead ? 'text-slate-900 font-bold' : ''} truncate min-w-0">${highlightedPreview}</p>
          </div>
          <div class="flex flex-col items-end justify-between ml-3 shrink-0 relative">
            <span class="text-[9px] font-black text-slate-400 uppercase tabular-nums mt-0.5">${timeLabel}</span>
            <button type="button" class="card-options-btn text-slate-300 hover:text-blue-600 transition-colors p-1 rounded-lg hover:bg-blue-50 mt-1 active:scale-95"><i data-lucide="more-horizontal" class="w-4 h-4 pointer-events-none"></i></button>
            <div class="card-options-menu hidden absolute top-full right-0 mt-1.5 w-52 bg-white/95 backdrop-blur-xl border border-slate-200/60 shadow-2xl shadow-blue-900/10 rounded-[18px] p-2 z-[60] origin-top-right transform transition-all duration-200">
                <button class="w-full text-left px-3 py-2.5 text-[11px] font-extrabold text-slate-600 hover:bg-slate-100 hover:text-blue-600 rounded-xl transition-all flex items-center gap-2.5 mb-0.5"><i data-lucide="star" class="w-3.5 h-3.5"></i> Priority</button>
                <button class="w-full text-left px-3 py-2.5 text-[11px] font-extrabold text-slate-600 hover:bg-slate-100 hover:text-amber-600 rounded-xl transition-all flex items-center gap-2.5 mb-1"><i data-lucide="bell-off" class="w-3.5 h-3.5"></i> Mute messages</button>
                <div class="h-[1px] bg-slate-100 my-1 mx-2"></div>
                ${session.claimed_by ? '' : ''}
                <button class="w-full text-left px-3 py-2.5 text-[11px] font-extrabold text-slate-600 hover:bg-slate-100 hover:text-emerald-600 rounded-xl transition-all flex items-center gap-2.5 mt-1"><i data-lucide="archive" class="w-3.5 h-3.5"></i> Archive conversation</button>
                <div class="h-[1px] bg-slate-100 my-1 mx-2"></div>
                <button class="w-full text-left px-3 py-2.5 text-[11px] font-extrabold text-red-500 hover:bg-red-50 hover:text-red-700 rounded-xl transition-all flex items-center gap-2.5 mb-0.5 mt-1"><i data-lucide="ban" class="w-3.5 h-3.5"></i> Block</button>
                <button class="w-full text-left px-3 py-2.5 text-[11px] font-extrabold text-red-500 hover:bg-red-50 hover:text-red-700 rounded-xl transition-all flex items-center gap-2.5"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i> Delete conversation</button>
            </div>
          </div>
        </div>
        ${isActive ? '<div class="absolute left-1.5 top-3 bottom-3 w-1 bg-blue-500 rounded-full shadow-[0_0_8px_rgba(37,99,235,0.4)]"></div>' : ''}
      `;

    const optsBtn = item.querySelector('.card-options-btn');
    const optsMenu = item.querySelector('.card-options-menu');

    optsBtn.onclick = (e) => {
      e.stopPropagation();
      // Close other open menus
      document.querySelectorAll('.card-options-menu').forEach(m => {
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

        // Unclaim action removed

        if (action === "Delete conversation") {
          if (!confirm("Move this conversation to Recently Deleted?")) return;

          adminDeletedSessions.add(session.id);
          adminArchivedSessions.delete(session.id);
          adminBlockedSessions.delete(session.id);
          adminPrioritySessions.delete(session.id);
          adminMutedSessions.delete(session.id);

          const stateObj = {
            session_id: session.id,
            is_archived: false,
            is_blocked: false,
            is_priority: false,
            is_muted: false,
            is_deleted: true,
            deleted_at: new Date().toISOString()
          };
          await sb.from('admin_chat_states').upsert(stateObj, { onConflict: 'session_id' });

          if (activeAdminSessionId === session.id) {
            activeAdminSessionId = null;
            document.getElementById("adminChatHeaderContainer")?.classList.add("hidden");
            document.getElementById("adminChatInputContainer")?.classList.add("hidden");
            if (adminChatMessagesContainer) adminChatMessagesContainer.innerHTML = '';
          }

          loadAdminConversations(filter);
          return;
        }

        // Updates to States
        if (action === "Archive conversation") {
          adminArchivedSessions.add(session.id);
          if (activeAdminSessionId === session.id) activeAdminSessionId = null;
        }
        else if (action === "Block") {
          if (!confirm("Blocking will hide all messages from this patient. Continue?")) return;
          adminBlockedSessions.add(session.id);
          if (activeAdminSessionId === session.id) activeAdminSessionId = null;
        }
        else if (action === "Priority") {
          if (adminPrioritySessions.has(session.id)) adminPrioritySessions.delete(session.id);
          else adminPrioritySessions.add(session.id);
        }
        else if (action === "Mute messages") {
          if (adminMutedSessions.has(session.id)) adminMutedSessions.delete(session.id);
          else adminMutedSessions.add(session.id);
        }

        // Build object for Supabase
        const stateObj = {
          is_archived: adminArchivedSessions.has(session.id),
          is_blocked: adminBlockedSessions.has(session.id),
          is_priority: adminPrioritySessions.has(session.id),
          is_muted: adminMutedSessions.has(session.id),
          is_deleted: adminDeletedSessions.has(session.id)
        };

        await saveAdminChatState(session.id, stateObj);

        // Re-render
        loadAdminConversations(filter);
      };
    });

    item.onclick = async () => {
      // Hide overlays if open
      if (typeof closeAllChatOverlays === 'function') closeAllChatOverlays();

      // Show Header and Input if hidden
      const chatHeaderCont = document.getElementById("adminChatHeaderContainer");
      const chatInputCont = document.getElementById("adminChatInputContainer");
      const claimBtn = document.getElementById("adminClaimBtn");

      if (chatHeaderCont) chatHeaderCont.classList.remove("hidden");
      if (chatInputCont) chatInputCont.classList.remove("hidden");
      if (adminChatMessagesContainer) adminChatMessagesContainer.classList.remove("hidden");

      // Full screen mode: hide sidebar
      const sidebar = document.getElementById("adminChatSidebar");
      const backBtn = document.getElementById("adminChatBackBtn");
      if (sidebar) sidebar.classList.add("hidden");
      if (backBtn) backBtn.classList.remove("hidden");

      // Auto-claim on selection
      if (session.is_unclaimed) {
        activeAdminSessionId = session.id; // Set ID before claiming
        await claimActiveSession();
      }

      // Mark as read
      if (!readSessions.has(session.id)) {
        readSessions.add(session.id);
        localStorage.setItem("adminReadSessions", JSON.stringify(Array.from(readSessions)));
        updateAdminBadge();
      }

      if (activeAdminSessionId === session.id) {
        loadAdminConversations(filter); // Refresh to clear red dot
        return;
      }
      activeAdminSessionId = session.id;
      adminStagedImages = [];
      if (typeof updateImagePreviewStrip === "function") updateImagePreviewStrip();
      exitEditModeUI();
      adminChatInput.value = "";
      adminChatInput.style.height = 'auto';

      // Update Header UI
      const headerName = document.getElementById("adminChatHeaderName");
      const chatAvatar = document.getElementById("activeChatAvatar");
      if (headerName) headerName.textContent = name;
      if (chatAvatar) {
        chatAvatar.innerHTML = avatarHtml + `<span class="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-emerald-500 border-2 border-white rounded-full shadow-sm"></span>`;
      }

      // Update Profile Panel (if open or for next open)
      const profileAvatar = document.getElementById("profilePanelAvatar");
      const profileName = document.getElementById("profilePanelName");
      if (profileName) profileName.textContent = name;
      if (profileAvatar) {
        profileAvatar.innerHTML = avatarB64
          ? `<img src="${avatarB64}" class="w-full h-full rounded-[32px] object-cover shadow-inner">`
          : name.slice(0, 2).toUpperCase();
      }

      loadAdminConversations(filter); // Re-render sidebar to show active state

      adminChatMessagesContainer.innerHTML = `
          <div class="flex flex-col items-center justify-center h-full py-12">
            <div class="w-10 h-10 border-4 border-slate-100 border-t-blue-500 rounded-full animate-spin"></div>
            <p class="mt-4 text-[10px] font-black text-slate-400 uppercase tracking-widest animate-pulse">Syncing Conversation History</p>
          </div>`;

      const { data: messages } = await sb.from('messages').select('*').eq('session_id', session.id).eq('is_deleted', false).order('created_at', { ascending: true });
      adminChatMessagesContainer.innerHTML = "";

      if (messages && messages.length > 0) {
        messages.forEach(m => appendAdminMessage(m.content, m.sender_type === 'staff', m.created_at, m.sender_avatar_base64, m.sender_fullname, m.is_seen, m.id, m.is_deleted, m.is_edited));
        if (sb) {
          sb.from('messages').update({ is_seen: true }).eq('session_id', session.id).eq('sender_type', 'patient').then(() => {
            if (typeof refreshUnreadCount === 'function') refreshUnreadCount();
          });
        }
      } else {
        adminChatMessagesContainer.innerHTML = `
              <div class="flex flex-col items-center justify-center h-full text-center p-8 opacity-50">
                <i data-lucide="message-square-dashed" class="w-12 h-12 text-slate-300 mb-4"></i>
                <p class="text-xs font-bold text-slate-400 uppercase tracking-widest">Beginning of History</p>
              </div>`;
        if (window.lucide) window.lucide.createIcons();
      }
    };
    convList.appendChild(item);
  });
  if (window.lucide) window.lucide.createIcons();
}

function exitEditModeUI() {
  editingMessageId = null;
  const indicator = document.getElementById("adminEditModeIndicator");
  if (indicator) indicator.classList.add("hidden");
  
  const sendBtn = document.getElementById("adminChatSendBtn");
  if (sendBtn) {
    sendBtn.innerHTML = `<i data-lucide="send" class="w-5 h-5 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform"></i>`;
    if (window.lucide) window.lucide.createIcons({ root: sendBtn });
  }
}

if (adminChatSendBtn) adminChatSendBtn.addEventListener("click", () => sendAdminMessage());
const cancelEditBtn = document.getElementById("cancelEditBtn");
if (cancelEditBtn) {
  cancelEditBtn.onclick = () => {
    adminChatInput.value = "";
    adminChatInput.style.height = 'auto';
    exitEditModeUI();
  };
}
const adminClaimBtn = document.getElementById("adminClaimBtn");
if (adminClaimBtn) adminClaimBtn.addEventListener("click", () => claimActiveSession());

if (adminChatInput) {
  adminChatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendAdminMessage();
    }
  });
  // Auto-expand textarea & Typing Status
  let adminTypingTimeout;
  adminChatInput.addEventListener("input", async function () {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';

    if (activeAdminSessionId && sb) {
      clearTimeout(adminTypingTimeout);
      try {
        const { data: existing } = await sb.from('admin_chat_states').select('session_id').eq('session_id', activeAdminSessionId).maybeSingle();
        if (existing) {
          await sb.from('admin_chat_states').update({ is_typing: true }).eq('session_id', activeAdminSessionId);
        } else {
          await sb.from('admin_chat_states').insert([{ session_id: activeAdminSessionId, is_typing: true }]);
        }

        adminTypingTimeout = setTimeout(async () => {
          await sb.from('admin_chat_states').update({ is_typing: false }).eq('session_id', activeAdminSessionId);
        }, 3000);
      } catch (e) { }
    }
  });

  // ========================
  // IMAGE STAGING QUEUE
  // ========================
  const imagePreviewStrip = document.getElementById("imagePreviewStrip");
  const imagePreviewList = document.getElementById("imagePreviewList");
  const clearAllPreviews = document.getElementById("clearAllPreviews");

  window.renderAdminPreviews = function () {
    if (!imagePreviewList || !imagePreviewStrip) return;
    if (adminStagedImages.length === 0) {
      imagePreviewStrip.classList.add("hidden");
      return;
    }
    imagePreviewStrip.classList.remove("hidden");
    imagePreviewList.innerHTML = "";
    adminStagedImages.forEach((src, i) => {
      const thumb = document.createElement("div");
      thumb.className = "relative shrink-0 animate-in fade-in zoom-in duration-300";
      thumb.style.overflow = "visible";
      thumb.innerHTML = `
                <img src="${src}" class="w-28 h-28 rounded-2xl object-cover border-2 border-white shadow-lg">
                <button data-idx="${i}" class="remove-staged absolute -top-2 -right-2 w-7 h-7 bg-red-500 text-white rounded-full flex items-center justify-center text-sm font-black shadow-lg hover:bg-red-600 transition-colors">&times;</button>
            `;
      imagePreviewList.appendChild(thumb);
    });
    // Bind remove buttons
    imagePreviewList.querySelectorAll(".remove-staged").forEach(btn => {
      btn.onclick = () => {
        adminStagedImages.splice(parseInt(btn.dataset.idx), 1);
        renderAdminPreviews();
      };
    });
  }

  function addToStaging(base64) {
    adminStagedImages.push(base64);
    renderAdminPreviews();
  }

  if (clearAllPreviews) {
    clearAllPreviews.addEventListener("click", () => {
      adminStagedImages = [];
      renderAdminPreviews();
    });
  }

  // Paste → Stage (don't send yet)
  adminChatInput.addEventListener("paste", (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (let index in items) {
      const item = items[index];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        const reader = new FileReader();
        reader.onload = (event) => addToStaging(event.target.result);
        reader.readAsDataURL(blob);
      }
    }
  });

  // File picker → Stage (don't send yet)
  const adminChatAttachBtn = document.getElementById("adminChatAttachBtn");
  const adminChatFileInput = document.getElementById("adminChatFileInput");
  if (adminChatAttachBtn && adminChatFileInput) {
    adminChatAttachBtn.addEventListener("click", () => adminChatFileInput.click());
    adminChatFileInput.addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) {
        const reader = new FileReader();
        reader.onload = (event) => addToStaging(event.target.result);
        reader.readAsDataURL(e.target.files[0]);
        e.target.value = "";
      }
    });
  }

  // ========================
  // FULL EMOJI PICKER
  // ========================
  const emojiBtn = document.getElementById("adminChatEmojiBtn");
  const emojiPickerPanel = document.getElementById("emojiPickerPanel");
  const adminEmojiPicker = document.getElementById("adminEmojiPicker");

  if (emojiBtn && emojiPickerPanel && adminEmojiPicker) {
    // Toggle Picker
    emojiBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      emojiPickerPanel.classList.toggle("hidden");
    });

    // Listen for emoji selection
    adminEmojiPicker.addEventListener("emoji-click", (e) => {
      const emoji = e.detail.unicode;
      adminChatInput.value += emoji;
      // Autoexpand height
      adminChatInput.style.height = 'auto';
      adminChatInput.style.height = (adminChatInput.scrollHeight) + 'px';
      adminChatInput.focus();
    });

    // Close when clicking outside
    document.addEventListener("click", (e) => {
      if (!emojiPickerPanel.contains(e.target) && e.target !== emojiBtn) {
        emojiPickerPanel.classList.add("hidden");
      }
      if (e.target.closest('emoji-picker')) {
        // Internal clicks on the shadow DOM, keep open
        emojiPickerPanel.classList.remove("hidden");
      }
    });
  }
}

if (adminConvSearch) {
  adminConvSearch.addEventListener("input", (e) => {
    loadAdminConversations(e.target.value);
  });
}

// ============================
// PROFILE & ARCHIVE PANEL LOGIC
// ============================
const adminChatProfileBtn = document.getElementById("adminChatProfileBtn");
const adminChatArchiveBtn = document.getElementById("adminChatArchiveBtn");
const adminPatientProfilePanel = document.getElementById("adminPatientProfilePanel");
const adminArchivePanel = document.getElementById("adminArchivePanel");
const closeProfilePanel = document.getElementById("closeProfilePanel");
const closeArchivePanel = document.getElementById("closeArchivePanel");

window.closeAllChatOverlays = function () {
  if (adminArchivePanel) {
    adminArchivePanel.classList.add("hidden");
    adminArchivePanel.classList.remove("flex");
  }
  const adminSettingsPanel = document.getElementById("adminSettingsPanel");
  if (adminSettingsPanel) {
    adminSettingsPanel.classList.add("hidden");
    adminSettingsPanel.classList.remove("flex");
  }
  const adminFilesPanel = document.getElementById("adminFilesPanel");
  if (adminFilesPanel) {
    adminFilesPanel.classList.add("hidden");
    adminFilesPanel.classList.remove("flex");
  }
  // Also close profile slide-out
  if (adminPatientProfilePanel) {
    adminPatientProfilePanel.classList.add("translate-x-full");
  }
}

if (adminChatProfileBtn && adminPatientProfilePanel) {
  adminChatProfileBtn.addEventListener("click", () => {
    // Toggle slide-in
    const isHidden = adminPatientProfilePanel.classList.contains("translate-x-full");
    if (isHidden) {
      // Update profile info based on active chat before showing
      const headerName = document.getElementById("adminChatHeaderName")?.textContent || "Select a patient";
      const profileName = document.getElementById("profilePanelName");
      if (profileName) profileName.textContent = headerName;

      adminPatientProfilePanel.classList.remove("translate-x-full");
    } else {
      adminPatientProfilePanel.classList.add("translate-x-full");
    }
  });
}

if (closeProfilePanel) {
  closeProfilePanel.addEventListener("click", () => {
    adminPatientProfilePanel?.classList.add("translate-x-full");
  });
}

if (adminChatArchiveBtn && adminArchivePanel) {
  adminChatArchiveBtn.addEventListener("click", () => {
    // Close other overlays
    closeAllChatOverlays();

    // Ensure rendering is updated before showing
    if (typeof renderArchivedConversations === 'function') {
      renderArchivedConversations();
    }

    // Hide chat content using reliable IDs
    const chatHeader = document.getElementById("adminChatHeaderContainer");
    const chatInput = document.getElementById("adminChatInputContainer");

    if (chatHeader) chatHeader.classList.add("hidden");
    if (adminChatMessagesContainer) adminChatMessagesContainer.classList.add("hidden");
    if (chatInput) chatInput.classList.add("hidden");

    adminArchivePanel.classList.remove("hidden");
    adminArchivePanel.classList.add("flex");
  });
}

if (closeArchivePanel) {
  closeArchivePanel.addEventListener("click", () => {
    adminArchivePanel.classList.add("hidden");
    adminArchivePanel.classList.remove("flex");

    // Restore chat if there is an active session
    const chatHeader = document.getElementById("adminChatHeaderContainer");
    const chatInput = document.getElementById("adminChatInputContainer");

    if (activeAdminSessionId) {
      if (chatHeader) chatHeader.classList.remove("hidden");
      if (chatInput) chatInput.classList.remove("hidden");
    }
    if (adminChatMessagesContainer) adminChatMessagesContainer.classList.remove("hidden");
  });
}

const profileViewApptBtn = document.getElementById("profileViewApptBtn");
const profileViewFilesBtn = document.getElementById("profileViewFilesBtn");
const patientApptsModal = document.getElementById("patientApptsModal");
const patientApptsList = document.getElementById("patientApptsList");
const patientApptsModalName = document.getElementById("patientApptsModalName");
const closePatientApptsModal = document.getElementById("closePatientApptsModal");
const closePatientApptsModalBtn = document.getElementById("closePatientApptsModalBtn");

if (profileViewApptBtn && patientApptsModal) {
  profileViewApptBtn.addEventListener("click", async () => {
    const name = document.getElementById("profilePanelName")?.textContent || "";
    if (name && name !== "Select a patient") {
      // Setup Modal
      if (patientApptsModalName) patientApptsModalName.textContent = name;
      patientApptsModal.classList.remove("hidden");
      patientApptsModal.classList.add("flex");

      if (patientApptsList) {
        patientApptsList.innerHTML = `
                    <div class="text-center py-12">
                        <div class="w-16 h-16 bg-blue-50 rounded-[24px] mx-auto flex items-center justify-center animate-pulse">
                            <i data-lucide="loader-2" class="w-8 h-8 text-blue-400 animate-spin"></i>
                        </div>
                        <p class="mt-4 text-[11px] font-black text-slate-400 uppercase tracking-widest animate-pulse">Scanning Scheduling Data...</p>
                    </div>`;
        if (window.lucide) window.lucide.createIcons();
      }

      // Fetch specific patient's appointments
      const { data: userAppts, error } = await sb.from("appointments").select("*").ilike("patient_name", `%${name}%`).order("appointment_date", { ascending: false });

      if (patientApptsList) {
        patientApptsList.innerHTML = "";
        if (userAppts && userAppts.length > 0) {
          userAppts.forEach(appt => {
            const row = document.createElement("div");
            row.className = "p-5 rounded-2xl border border-slate-100 bg-white hover:border-blue-200 hover:shadow-lg hover:shadow-blue-500/5 transition-all duration-300 group flex items-center justify-between";

            const statusColors = {
              "scheduled": "bg-emerald-500",
              "pending": "bg-amber-500",
              "done": "bg-slate-400",
              "cancelled": "bg-red-500"
            };
            const statusDot = statusColors[appt.status?.toLowerCase()] || "bg-slate-200";

            row.innerHTML = `
                            <div class="flex items-center gap-4">
                                <div class="w-12 h-12 rounded-xl bg-slate-50 flex flex-col items-center justify-center border border-slate-100">
                                    <span class="text-[10px] font-black text-blue-500 uppercase">${new Date(appt.appointment_date).toLocaleDateString(undefined, { month: 'short' })}</span>
                                    <span class="text-sm font-black text-slate-700 -mt-1">${new Date(appt.appointment_date).getDate()}</span>
                                </div>
                                <div>
                                    <h5 class="text-sm font-extrabold text-slate-800">${appt.doctor_name || "Clinic Staff"}</h5>
                                    <p class="text-[11px] font-bold text-slate-400 uppercase flex items-center gap-1.5">
                                        <i data-lucide="clock" class="w-3 h-3"></i> 
                                        ${(() => {
                if (!appt.appointment_time) return "N/A";
                let [h, m] = appt.appointment_time.split(':');
                let hours = parseInt(h);
                let ampm = hours >= 12 ? 'PM' : 'AM';
                hours = hours % 12 || 12;
                return `${hours}:${m} ${ampm}`;
              })()}
                                    </p>
                                </div>
                            </div>
                            <div class="flex flex-col items-end gap-1.5">
                                <span class="px-3 py-1 ${statusDot} text-white text-[9px] font-black uppercase rounded-full tracking-widest shadow-sm">${appt.status || "Unknown"}</span>
                                <p class="text-[10px] font-bold text-slate-300">#${String(appt.id).slice(0, 8)}</p>
                            </div>
                        `;
            patientApptsList.appendChild(row);
          });
          if (window.lucide) window.lucide.createIcons();
        } else {
          patientApptsList.innerHTML = `
                        <div class="flex flex-col items-center justify-center py-20 text-center animate-in fade-in zoom-in duration-500">
                            <div class="relative w-32 h-32 mb-8">
                                <div class="absolute inset-0 bg-blue-50 rounded-[40px] animate-pulse"></div>
                                <div class="relative flex items-center justify-center h-full">
                                    <i data-lucide="calendar-dashed" class="w-16 h-16 text-blue-300"></i>
                                </div>
                            </div>
                            <div class="space-y-2">
                                <h4 class="text-xl font-black text-slate-800 tracking-tight">No Scheduling History</h4>
                                <p class="text-sm text-slate-500 font-medium max-w-xs mx-auto leading-relaxed">This patient currently has no past or future appointments recorded in our clinic system.</p>
                            </div>
                            <button onclick="setActivePage('appointments'); closeHistoryModal();" class="mt-8 px-8 py-3.5 bg-blue-600 text-white rounded-[20px] text-[12px] font-black uppercase tracking-widest hover:bg-blue-700 shadow-xl shadow-blue-500/20 transition-all active:scale-95">Book First Visit Now</button>
                        </div>`;
          if (window.lucide) window.lucide.createIcons();
        }
      }
    }
  });
}

function closeHistoryModal() {
  patientApptsModal?.classList.add("hidden");
  patientApptsModal?.classList.remove("flex");
}
closePatientApptsModal?.addEventListener("click", closeHistoryModal);
closePatientApptsModalBtn?.addEventListener("click", closeHistoryModal);

const adminFilesPanel = document.getElementById("adminFilesPanel");
const sharedFilesList = document.getElementById("sharedFilesList");
const closeFilesPanel = document.getElementById("closeFilesPanel");

if (profileViewFilesBtn && adminFilesPanel) {
  profileViewFilesBtn.addEventListener("click", () => {
    // Close all other overlays first
    closeAllChatOverlays();

    // Hide chat content (consistent with Archive view)
    const chatHeader = document.getElementById("adminChatHeaderContainer");
    const chatInput = document.getElementById("adminChatInputContainer");

    if (chatHeader) chatHeader.classList.add("hidden");
    if (adminChatMessagesContainer) adminChatMessagesContainer.classList.add("hidden");
    if (chatInput) chatInput.classList.add("hidden");

    adminFilesPanel.classList.remove("hidden");
    adminFilesPanel.classList.add("flex");

    // Scan current chat for images/files
    if (sharedFilesList) {
      const imagesInChat = Array.from(adminChatMessagesContainer.querySelectorAll("img")).map(img => img.src);
      if (imagesInChat.length > 0) {
        sharedFilesList.innerHTML = `<div class="grid grid-cols-2 md:grid-cols-4 gap-4 pb-10 anim-fade-in"></div>`;
        const gallery = sharedFilesList.querySelector("div");
        imagesInChat.forEach(src => {
          const card = document.createElement("div");
          card.className = "group relative aspect-square rounded-2xl overflow-hidden border border-slate-100 shadow-sm hover:shadow-xl transition-all duration-500 cursor-pointer";
          card.innerHTML = `
                        <img src="${src}" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700">
                        <div class="absolute inset-0 bg-gradient-to-t from-slate-900/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
                            <span class="text-[9px] font-black text-white uppercase tracking-widest">Shared Image</span>
                        </div>
                    `;
          gallery.appendChild(card);
        });
      } else {
        // Keep empty state
      }
    }
  });

  closeFilesPanel?.addEventListener("click", () => {
    adminFilesPanel.classList.add("hidden");
    adminFilesPanel.classList.remove("flex");

    // Restore chat if there is an active session
    const chatHeader = document.getElementById("adminChatHeaderContainer");
    const chatInput = document.getElementById("adminChatInputContainer");

    if (activeAdminSessionId) {
      if (chatHeader) chatHeader.classList.remove("hidden");
      if (chatInput) chatInput.classList.remove("hidden");
    }
    if (adminChatMessagesContainer) adminChatMessagesContainer.classList.remove("hidden");
  });
}

function renderArchivedConversations() {
  const archiveList = document.getElementById("adminArchiveList");
  if (!archiveList) return;

  // Filter from global state
  const archived = allAdminSessions.filter(s => adminArchivedSessions.has(s.id));

  if (archived.length === 0) {
    archiveList.innerHTML = `
            <div class="max-w-3xl mx-auto py-12 text-center space-y-4">
                <div class="w-20 h-20 bg-slate-50 rounded-[28px] mx-auto flex items-center justify-center mb-6">
                    <i data-lucide="inbox" class="w-10 h-10 text-slate-300"></i>
                </div>
                <h4 class="text-xl font-black text-slate-800">No Archived Chats</h4>
                <p class="text-slate-500 font-medium max-w-sm mx-auto">Archived conversations will appear here. Archive a chat to keep your inbox clean and organized.</p>
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
      : `<div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm shadow-sm ring-2 ring-white">${name.slice(0, 2).toUpperCase()}</div>`;

    let previewText = session.last_message || "";
    if (previewText.startsWith("data:image/")) previewText = '<span class="flex items-center gap-1"><i data-lucide="image" class="w-3.5 h-3.5"></i> Sent an image</span>';

    item.innerHTML = `
            <div class="p-4 bg-white rounded-3xl border border-slate-200 hover:border-slate-300 transition-colors hover:shadow-lg hover:shadow-slate-200/50 flex items-center gap-4 relative mx-auto max-w-3xl mb-3">
                ${avatarHtml}
                <div class="flex-1 min-w-0 flex flex-col">
                    <div class="flex justify-between items-end mb-1">
                        <p class="text-[14px] font-black text-slate-800 leading-none">${name}</p>
                        <span class="text-[10px] font-black text-slate-400 uppercase tabular-nums leading-none">${timeLabel}</span>
                    </div>
                    <p class="text-[12px] font-semibold text-slate-500 truncate max-w-sm">${previewText}</p>
                </div>
                <!-- Action Buttons -->
                <div class="flex flex-col gap-1.5 shrink-0 ml-1">
                    <button class="unarchive-btn w-full px-4 py-2 bg-blue-50 text-blue-600 font-black text-[10px] uppercase tracking-wider rounded-xl transition-all hover:bg-blue-600 hover:text-white" data-id="${session.id}">
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
    btn.onclick = async (e) => {
      e.stopPropagation();
      const sid = btn.dataset.id;

      // Build object for Supabase
      const stateObj = {
        is_archived: false,
        is_blocked: adminBlockedSessions.has(sid),
        is_priority: adminPrioritySessions.has(sid),
        is_muted: adminMutedSessions.has(sid),
        is_deleted: adminDeletedSessions.has(sid)
      };

      await saveAdminChatState(sid, stateObj);

      adminArchivedSessions.delete(sid);
      loadAdminConversations();
    };
  });

  archiveList.querySelectorAll('.delete-btn').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("Move to Recently Deleted?")) return;
      const sid = btn.dataset.id;

      adminDeletedSessions.add(sid);
      adminArchivedSessions.delete(sid);

      const stateObj = {
        is_archived: false,
        is_blocked: adminBlockedSessions.has(sid),
        is_priority: adminPrioritySessions.has(sid),
        is_muted: adminMutedSessions.has(sid),
        is_deleted: true,
        deleted_at: new Date().toISOString()
      };

      await saveAdminChatState(sid, stateObj);

      loadAdminConversations();
    };
  });
}

function renderAdminSettings(activeTab = "deleted") {
  const list = document.getElementById("adminSettingsList");
  if (!list) return;

  let itemsToRender = [];
  if (activeTab === "deleted") {
    itemsToRender = allAdminSessions.filter(s => adminDeletedSessions.has(s.id));
  } else {
    itemsToRender = allAdminSessions.filter(s => adminBlockedSessions.has(s.id));
  }

  if (itemsToRender.length === 0) {
    list.innerHTML = `
            <div class="max-w-3xl mx-auto py-12 text-center space-y-4">
                <div class="w-20 h-20 bg-slate-50 rounded-[28px] mx-auto flex items-center justify-center mb-6">
                    <i data-lucide="${activeTab === 'deleted' ? 'trash' : 'ban'}" class="w-10 h-10 text-slate-300"></i>
                </div>
                <h4 class="text-xl font-black text-slate-800">No ${activeTab === 'deleted' ? 'Deleted' : 'Blocked'} Accounts</h4>
                <p class="text-slate-500 font-medium max-w-sm mx-auto">There are currently no items in this list.</p>
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
    const timeLabel = new Date(session.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const avatarHtml = avatarB64
      ? `<img src="${avatarB64}" class="w-14 h-14 rounded-2xl object-cover ring-2 ring-white shadow-sm">`
      : `<div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm shadow-sm ring-2 ring-white">${name.slice(0, 2).toUpperCase()}</div>`;

    let previewText = session.last_message || "";
    if (previewText.startsWith("data:image/")) previewText = '<span class="flex items-center gap-1"><i data-lucide="image" class="w-3.5 h-3.5"></i> Sent an image</span>';

    const actionText = activeTab === "deleted" ? "Restore" : "Unblock";
    const actionBtnClass = activeTab === "deleted" ? "restore-btn text-emerald-600 bg-emerald-50 hover:bg-emerald-600" : "unblock-btn text-blue-600 bg-blue-50 hover:bg-blue-600";

    const daysLeft = session.deleted_at 
        ? Math.max(0, 30 - Math.floor((Date.now() - new Date(session.deleted_at)) / (1000 * 60 * 60 * 24)))
        : 30;

    const countdownHtml = activeTab === "deleted" 
        ? `<div class="mt-1 flex items-center gap-1.5">
            <span class="w-1.5 h-1.5 rounded-full ${daysLeft <= 5 ? 'bg-rose-500 animate-pulse' : 'bg-slate-300'}"></span>
            <span class="text-[9px] font-black uppercase tracking-widest ${daysLeft <= 5 ? 'text-rose-600' : 'text-slate-400'}">${daysLeft} Days Left</span>
           </div>`
        : '';

    item.innerHTML = `
            <div class="p-4 bg-white rounded-3xl border border-slate-200 hover:border-slate-300 transition-colors flex items-center gap-4 relative mx-auto max-w-3xl mb-3">
                ${avatarHtml}
                <div class="flex-1 min-w-0 flex flex-col">
                    <div class="flex justify-between items-end mb-1">
                        <p class="text-[14px] font-black text-slate-800 leading-none">${name}</p>
                        <span class="text-[10px] font-black text-slate-400 uppercase tabular-nums leading-none">${timeLabel}</span>
                    </div>
                    ${countdownHtml}
                </div>
                <div class="flex shrink-0 ml-1">
                    <button class="${actionBtnClass} px-6 py-2.5 font-black text-[12px] uppercase tracking-wider rounded-xl transition-all hover:text-white" data-id="${session.id}">
                        ${actionText}
                    </button>
                    ${activeTab === "deleted" ? `<button class="permanent-delete-btn ml-2 px-3 py-2.5 bg-red-50 text-red-600 font-black text-[12px] uppercase tracking-wider rounded-xl transition-all hover:bg-red-600 hover:text-white" data-id="${session.id}"><i data-lucide="trash-2" class="w-4 h-4"></i></button>` : ''}
                </div>
            </div>
        `;
    list.appendChild(item);
  });

  if (window.lucide) window.lucide.createIcons({ root: list });

  if (activeTab === "deleted") {
    list.querySelectorAll('.restore-btn').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const sid = btn.dataset.id;
        adminDeletedSessions.delete(sid);
        const stateObj = {
          is_archived: adminArchivedSessions.has(sid),
          is_blocked: adminBlockedSessions.has(sid),
          is_priority: adminPrioritySessions.has(sid),
          is_muted: adminMutedSessions.has(sid),
          is_deleted: false
        };
        await saveAdminChatState(sid, stateObj);
        loadAdminConversations();
        renderAdminSettings(activeTab);
      };
    });

    list.querySelectorAll('.permanent-delete-btn').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm("Are you sure you want to permanently delete this? This action cannot be undone and will erase all messages.")) return;
        const sid = btn.dataset.id;
        await sb.from('messages').delete().eq('session_id', sid);
        await sb.from('admin_chat_states').delete().eq('session_id', sid);
        adminDeletedSessions.delete(sid);
        loadAdminConversations();
        renderAdminSettings(activeTab);
      };
    });
  } else {
    list.querySelectorAll('.unblock-btn').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const sid = btn.dataset.id;
        adminBlockedSessions.delete(sid);
        const stateObj = {
          is_archived: adminArchivedSessions.has(sid),
          is_blocked: false,
          is_priority: adminPrioritySessions.has(sid),
          is_muted: adminMutedSessions.has(sid),
          is_deleted: adminDeletedSessions.has(sid)
        };
        await saveAdminChatState(sid, stateObj);
        loadAdminConversations();
        renderAdminSettings(activeTab);
      };
    });
  }
}

// Window Listeners for Settings overlay
const adminChatSettingsBtn = document.getElementById("adminChatSettingsBtn");
const adminSettingsPanel = document.getElementById("adminSettingsPanel");
const closeSettingsPanel = document.getElementById("closeSettingsPanel");
const tabSoftDeleted = document.getElementById("tabSoftDeleted");
const tabBlocked = document.getElementById("tabBlocked");

let currentSettingsTab = "deleted";

if (adminChatSettingsBtn && adminSettingsPanel) {
  adminChatSettingsBtn.addEventListener("click", () => {
    // Close other overlays
    closeAllChatOverlays();

    const chatHeader = document.getElementById("adminChatHeaderContainer");
    const chatInput = document.getElementById("adminChatInputContainer");
    if (chatHeader) chatHeader.classList.add("hidden");
    if (adminChatMessagesContainer) adminChatMessagesContainer.classList.add("hidden");
    if (chatInput) chatInput.classList.add("hidden");

    adminSettingsPanel.classList.remove("hidden");
    adminSettingsPanel.classList.add("flex");
    renderAdminSettings(currentSettingsTab);
  });
}

if (closeSettingsPanel) {
  closeSettingsPanel.addEventListener("click", () => {
    adminSettingsPanel.classList.add("hidden");
    adminSettingsPanel.classList.remove("flex");
    const chatHeader = document.getElementById("adminChatHeaderContainer");
    const chatInput = document.getElementById("adminChatInputContainer");
    if (activeAdminSessionId) {
      if (chatHeader) chatHeader.classList.remove("hidden");
      if (chatInput) chatInput.classList.remove("hidden");
    }
    if (adminChatMessagesContainer) adminChatMessagesContainer.classList.remove("hidden");
  });
}

if (tabSoftDeleted && tabBlocked) {
  tabSoftDeleted.addEventListener("click", () => {
    currentSettingsTab = "deleted";
    tabSoftDeleted.classList.replace("text-slate-400", "text-blue-600");
    tabSoftDeleted.classList.replace("border-transparent", "border-blue-600");
    tabBlocked.classList.replace("text-blue-600", "text-slate-400");
    tabBlocked.classList.replace("border-blue-600", "border-transparent");
    renderAdminSettings(currentSettingsTab);
  });
  tabBlocked.addEventListener("click", () => {
    currentSettingsTab = "blocked";
    tabBlocked.classList.replace("text-slate-400", "text-blue-600");
    tabBlocked.classList.replace("border-transparent", "border-blue-600");
    tabSoftDeleted.classList.replace("text-blue-600", "text-slate-400");
    tabSoftDeleted.classList.replace("border-blue-600", "border-transparent");
    renderAdminSettings(currentSettingsTab);
  });
}

function renderAdminPreviews() {
  // defined locally above
}

async function initSupabaseChat() {
  // Lightbox Close Logic
  const lb = document.getElementById("imageLightbox");
  if (lb) {
    lb.onclick = () => {
      lb.classList.add("hidden");
      lb.classList.remove("flex");
    };
    document.getElementById("closeLightbox")?.addEventListener("click", () => {
      lb.classList.add("hidden");
      lb.classList.remove("flex");
    });

    // Handle Escape Key to close
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !lb.classList.contains("hidden")) {
        lb.classList.add("hidden");
        lb.classList.remove("flex");
      }
    });
  }

  window.openLightbox = (src) => {
    const img = document.getElementById("lightboxImg");
    if (lb && img) {
      img.src = src;
      lb.classList.remove("hidden");
      lb.classList.add("flex");
    }
  };

  if (!sb) return;
  sb.channel('realtime_admin_chats')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
      // If incoming message is from patient, remove from readSessions
      if (payload.new.sender_type !== 'staff') {
        readSessions.delete(payload.new.session_id);
      } else {
        // If we sent it, it's read by us
        readSessions.add(payload.new.session_id);
      }
      localStorage.setItem("adminReadSessions", JSON.stringify(Array.from(readSessions)));

      loadAdminConversations(document.getElementById("adminConvSearch")?.value || "");
      if (payload.new.session_id === activeAdminSessionId && payload.new.sender_type !== 'staff') {
        appendAdminMessage(payload.new.content, false, payload.new.created_at, payload.new.sender_avatar_base64, payload.new.sender_fullname, payload.new.is_seen, payload.new.id, payload.new.is_deleted, payload.new.is_edited);
        if (sb) {
          sb.from('messages').update({ is_seen: true }).eq('session_id', activeAdminSessionId).eq('sender_type', 'patient').then(() => {
            if (typeof refreshUnreadCount === 'function') refreshUnreadCount();
          });
        }
      }
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (payload) => {
      if (payload.new.session_id === activeAdminSessionId) {
        const msgId = payload.new.id;
        const wrapper = document.getElementById(`admin-msg-wrapper-${msgId}`);
        const content = document.getElementById(`admin-msg-content-${msgId}`);

        if (payload.new.is_deleted) {
          const row = wrapper ? wrapper.closest('.flex.w-full') : null;
          if (row) row.remove();
        } else if (payload.new.is_edited && content) {
          content.innerText = payload.new.content;
          // Add "Edited" label if not already there
          if (wrapper && !wrapper.querySelector('span.text-blue-500')) {
            const editedLabel = document.createElement("span");
            editedLabel.className = "text-[9px] font-black text-blue-500 uppercase tracking-widest mb-1 ml-1 px-1";
            editedLabel.textContent = "Edited Message";
            wrapper.prepend(editedLabel);
          }
        }
      }

      if (payload.new.sender_type === 'patient' && payload.new.is_seen) {
        if (typeof refreshUnreadCount === 'function') refreshUnreadCount();
      }

      if (payload.new.session_id === activeAdminSessionId && payload.new.sender_type === 'staff' && payload.new.is_seen) {
        const statusContainer = document.getElementById(`admin-msg-status-${payload.new.id}`);
        if (statusContainer) {
          statusContainer.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="text-blue-500 mr-1"><path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/></svg>
            <span class="text-[10px] font-black text-blue-600 uppercase tracking-widest bg-blue-50/50 px-1.5 py-0.5 rounded-md border border-blue-100">Seen</span>
          `;
        }
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'patient_chat_states' }, (payload) => {
      const state = payload.new;
      if (state && state.session_id === activeAdminSessionId) {
        const indicator = document.getElementById("adminChatTypingIndicator");
        if (indicator) {
          if (state.is_typing) indicator.classList.remove("hidden");
          else indicator.classList.add("hidden");
        }
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_chat_states' }, (payload) => {
      loadAdminConversations(document.getElementById("adminConvSearch")?.value || "");
    })
    .subscribe();
  loadAdminConversations();
}
initSupabaseChat();

// ============================
// UI ENHANCEMENTS: "Today" Buttons for Date Filters
// ============================
function setupTodayButton(dateInputId) {
  const dateInput = document.getElementById(dateInputId);
  if (!dateInput) return;

  // Check if button already exists
  if (dateInput.nextElementSibling && dateInput.nextElementSibling.classList.contains('today-btn')) return;

  // Wrap the date input if it's not already wrapped in a flex container
  const wrapper = document.createElement("div");
  wrapper.style.display = "flex";
  wrapper.style.gap = "6px";
  wrapper.style.alignItems = "center";

  dateInput.parentNode.insertBefore(wrapper, dateInput);
  wrapper.appendChild(dateInput);

  const todayBtn = document.createElement("button");
  todayBtn.type = "button";
  todayBtn.className = "today-btn text-[9px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 focus:ring-2 focus:ring-blue-300 rounded-full px-2 py-[4px] transition-all border border-blue-200 uppercase tracking-wide shrink-0 shadow-sm active:scale-95";
  todayBtn.textContent = "Today";

  todayBtn.addEventListener("click", () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    dateInput.value = `${year}-${month}-${day}`;
    if (dateInputId === "scheduleTimetableDate" && typeof fetchScheduleTimetable === "function") {
      fetchScheduleTimetable();
    } else {
      fetchAppointments(); // Re-trigger filter
    }
  });

  wrapper.appendChild(todayBtn);

  // Reset Button
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "text-[9px] font-bold text-slate-500 bg-white hover:bg-slate-50 border border-slate-200 hover:text-red-500 hover:border-red-200 focus:ring-2 focus:ring-slate-200 rounded-full px-2 py-[4px] transition-all uppercase tracking-wide shrink-0 shadow-sm active:scale-95 flex items-center justify-center group gap-1";
  resetBtn.innerHTML = '<i data-lucide="x" class="w-3 h-3 group-hover:text-red-500"></i> Clear';
  resetBtn.addEventListener("click", () => {
    dateInput.value = ""; // Clear date to fetch default all view
    if (dateInputId === "scheduleTimetableDate" && typeof fetchScheduleTimetable === "function") {
      fetchScheduleTimetable();
    } else {
      fetchAppointments(); // Re-trigger filter
    }
  });
  wrapper.appendChild(resetBtn);
}

setupTodayButton("filterDate");
setupTodayButton("filterDateFollowups");
setupTodayButton("filterDateConsultation");
setupTodayButton("scheduleTimetableDate");

// ============================
// TIMETABLE SCHEDULE PAGE
// ============================
async function fetchScheduleTimetable() {
  const dateInput = document.getElementById("scheduleTimetableDate");
  const container = document.getElementById("scheduleTimetableContainer");
  if (!container) return;

  const rangeInput = document.getElementById("scheduleTimetableRange");
  const range = rangeInput ? rangeInput.value : "daily";
  const targetDate = dateInput.value || new Date().toISOString().split('T')[0];

  container.innerHTML = `
        <div class="py-12 text-center text-sm text-slate-400 flex flex-col items-center">
            <i data-lucide="loader-2" class="w-8 h-8 text-emerald-500 mb-2 animate-spin"></i>
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
  const activeAppts = (appointments || []).filter(a => !["declined", "cancelled"].includes(a.status?.toLowerCase()));

  // Update metric cards
  updateTimetableMetrics(activeAppts);

  // Adaptive Column Logic
  let columns = [];
  const grouped = {};

  if (range === "daily") {
    // Columns are Doctors
    if (typeof allStaffData !== 'undefined' && allStaffData && allStaffData.length > 0) {
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
      const key = "Clinic Staff";
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
  const doctorSelect = document.getElementById("scheduleTimetableDoctor");
  let targetDoctor = doctorSelect ? doctorSelect.value : "";

  // Update Doctor Select options if not daily (it should always have all doctors)
  if (doctorSelect && range !== 'daily') {
    let docNames = new Set(["Clinic Staff"]);
    if (typeof allStaffData !== 'undefined' && allStaffData) {
      allStaffData.forEach(s => { if (s.role === 'doctor' || s.role === 'nurse') docNames.add(s.name); });
    }
    let selectHtml = `<option value="">All Staff</option>`;
    Array.from(docNames).sort().forEach(dn => {
      selectHtml += `<option value="${dn}" ${targetDoctor === dn ? 'selected' : ''}>${escapeHtml(dn)}</option>`;
    });
    doctorSelect.innerHTML = selectHtml;
  }

  // If a specific doctor is selected and we are NOT in daily mode, 
  // we still show the time range units but only appointments for that doctor.
  let filteredGrouped = {};
  Object.keys(grouped).forEach(k => {
    if (targetDoctor) {
      filteredGrouped[k] = grouped[k]; // Doctor filtering removed
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

  const todayIso = new Date().toISOString().split('T')[0];
  const isToday = targetDate === todayIso || !targetDate;

  // DYNAMIC HOURS CALCULATION
  // Default fallbacks if settings not found
  let startHour = 8;
  let endHour = 18;

  const openTimeInput = document.getElementById("clinicOpeningTime");
  const closeTimeInput = document.getElementById("clinicClosingTime");

  if (openTimeInput && openTimeInput.value) {
    startHour = parseInt(openTimeInput.value.split(":")[0]);
  }
  if (closeTimeInput && closeTimeInput.value) {
    endHour = parseInt(closeTimeInput.value.split(":")[0]);
  }

  // Ensure no existing appointments are hidden
  activeAppts.forEach(appt => {
    if (appt.start_time) {
      const h = parseInt(appt.start_time.split(":")[0]);
      if (h < startHour) startHour = h;
      if (h > endHour) endHour = h;
    }
    if (appt.end_time) {
      const h = parseInt(appt.end_time.split(":")[0]);
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
                    <i data-lucide="calendar-range" class="w-4 h-4 text-emerald-400"></i>
                </div>
                <div>
                    <h2 class="text-xs font-black tracking-wide">Clinic Schedule</h2>
                    <p class="text-[8px] text-slate-400 font-medium tracking-widest uppercase">${headerDateStr}</p>
                </div>
            </div>
            <div class="flex items-center gap-2 mt-2 sm:mt-0">
                ${isToday ? `<span class="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[9px] font-bold uppercase tracking-widest border border-emerald-500/30 flex items-center gap-1"><span class="w-1 h-1 rounded-full bg-emerald-400"></span> Live</span>` : ''}
                <button onclick="exportTimetablePDF()" class="bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg px-2 py-1 flex items-center gap-1.5 text-[10px] font-bold transition-all" title="Export to PDF">
                    <i data-lucide="download" class="w-3 h-3"></i> PDF
                </button>
            </div>
        </div>
        
        <div class="w-full overflow-hidden">
            <div class="w-full overflow-x-auto no-scrollbar">
                <div class="min-w-full">
                    <!-- Columns Header -->
                    <div class="flex border-b border-slate-200 bg-slate-50">
                        <div class="w-[60px] shrink-0 border-r border-slate-200 flex items-center justify-center p-1.5">
                            <span class="text-[9px] font-black uppercase tracking-widest text-slate-400">Time</span>
                        </div>
                        ${columns.map((col, idx) => {
    const style = colorStyles[idx % colorStyles.length];
    const apptCount = filteredGrouped[col.id]?.length || 0;
    return `
                        <div class="flex-1 min-w-[120px] border-r border-slate-200 last:border-r-0">
                            <div class="bg-gradient-to-r ${style.header} text-white px-3 py-1.5 flex items-center gap-2">
                                <div class="w-6 h-6 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
                                    <i data-lucide="${range === 'daily' ? 'user' : 'calendar'}" class="w-3.5 h-3.5"></i>
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
                            <div class="flex-1 min-w-[120px] border-r border-slate-100 last:border-r-0 p-1 flex flex-col gap-1">
                                ${apptsNow.length === 0 ? '' : apptsNow.map(appt => {
        let isDone = appt.status?.toLowerCase() === 'done';
        let isPending = appt.status?.toLowerCase() === 'pending';
        let statusBg = isDone ? 'bg-emerald-50 text-emerald-600' : (isPending ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600');
        let statusDot = isDone ? 'bg-emerald-500' : (isPending ? 'bg-amber-500' : 'bg-blue-500');

        let docTag = "";
        if (range !== 'daily' && !targetDoctor) {
          docTag = `<span class="text-[7px] font-black bg-blue-50 text-blue-500 px-1 py-0.5 rounded ml-1 uppercase tracking-tighter">Clinic Staff</span>`;
        }

        let dateTag = "";
        if (range === 'monthly' || range === 'yearly') {
          const d = new Date(appt.appointment_date);
          dateTag = `<span class="text-[7px] font-black bg-slate-100 text-slate-500 px-1 py-0.5 rounded ml-1 uppercase tracking-tighter">${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>`;
        } else if (range === 'weekly') {
          const d = new Date(appt.appointment_date);
          dateTag = `<span class="text-[7px] font-black bg-slate-100 text-slate-500 px-1 py-0.5 rounded ml-1 uppercase tracking-tighter">${d.toLocaleDateString('en-US', { day: 'numeric' })}</span>`;
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
                                    <div class="rounded-lg ${style.border} bg-white border border-slate-200 p-1.5 shadow-sm hover:shadow transition-all cursor-pointer group">
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
                                                     <span class="inline-flex items-center gap-1 text-[8px] uppercase font-black px-1.5 py-0.5 rounded ${statusBg} border border-current/10"><span class="w-1 h-1 rounded-full ${statusDot}"></span>${formatStatusLabel(appt.status)}</span>
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

function updateTimetableMetrics(appts) {
  const todayStr = new Date().toISOString().split('T')[0];
  const todayCount = appts.filter(a => a.appointment_date === todayStr).length;

  const now = new Date();
  const weekEnd = new Date(now);
  weekEnd.setDate(now.getDate() + 7);
  const weekCount = appts.filter(a => {
    if (!a.appointment_date) return false;
    const d = new Date(a.appointment_date);
    return d >= now && d <= weekEnd;
  }).length;

  const docCount = 1;

  const el = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  el("ttMetricToday", todayCount);
  el("ttMetricWeek", weekCount);
  el("ttMetricDocs", docCount);
}

const scheduleTimetableRange = document.getElementById("scheduleTimetableRange");
if (scheduleTimetableRange) {
  scheduleTimetableRange.addEventListener("change", fetchScheduleTimetable);
}

const scheduleTimetableDate = document.getElementById("scheduleTimetableDate");
if (scheduleTimetableDate) {
  scheduleTimetableDate.addEventListener("change", fetchScheduleTimetable);
}

const scheduleTimetableDoctor = document.getElementById("scheduleTimetableDoctor");
if (scheduleTimetableDoctor) {
  scheduleTimetableDoctor.addEventListener("change", fetchScheduleTimetable);
}

// Global Export Function for Table
window.exportTimetablePDF = function () {
  const element = document.getElementById("timetableExportCaptureContainer");
  if (!element) return;

  // Check if html2pdf is successfully loaded from CDN
  if (typeof html2pdf === "undefined") {
    alert("Wait a moment for the PDF library to load, or check your internet connection.");
    return;
  }

  // Get exact dimensions of the timetable
  const clientWidth = element.scrollWidth;
  const clientHeight = element.scrollHeight;

  // Set a custom format so the PDF page is exactly the size of the timetable
  // This forces it to never split into multiple pages.
  const padding = 20; // 20px padding

  const opt = {
    margin: padding,
    filename: 'clinic-schedule.pdf',
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


function getReadAppointmentNotifIds() {
  try {
    const raw = localStorage.getItem(APPT_NOTIF_READ_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function addReadAppointmentNotifId(id) {
  if (!id) return;
  const existing = getReadAppointmentNotifIds();
  if (existing.includes(id)) return;
  existing.push(id);
  try {
    localStorage.setItem(APPT_NOTIF_READ_KEY, JSON.stringify(existing));
  } catch (_) { }
}

function normalizeAppointmentType(rawType) {
  const value = String(rawType || "").toLowerCase();
  if (value === "follow-up" || value === "follow up") return "followups";
  if (value === "follow_up" || value === "followup") return "followups";
  if (value === "consult") return "consultation";
  if (value === "consult" || value === "consultations") return "consultation";
  if (value === "schedule" || value === "scheduled") return "schedule";
  return value || "schedule";
}

function formatAppointmentTypeLabel(rawType) {
  const type = normalizeAppointmentType(rawType);
  if (type === "followups") return "Follow Ups";
  if (type === "consultation") return "Consultation";
  return "Schedule";
}

// ---- Real-time Notification Sync ----
function initRealtimeNotifications() {
  if (!sb) return;

  // Listen for changes in key tables that affect notifications and lists
  sb.channel('realtime_notifications_sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, (payload) => {
      console.log("Real-time Sync: Appointment change detected", payload.eventType);
      fetchNotifications();
      fetchAppointments(); // Refresh the appointment list in real-time
      // Also refresh calendar & dashboard if they are visible
      if (typeof renderCalendar === 'function') {
        try { renderCalendar(); } catch (e) { }
      }
      if (typeof renderDashboard === 'function') {
        try { renderDashboard(); } catch (e) { }
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, () => {
      console.log("Real-time Sync: Attendance change detected");
      fetchNotifications();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'patients' }, () => {
      console.log("Real-time Sync: Patients change detected");
      fetchNotifications();
      fetchPatients();
    })
    .subscribe();
}

async function fetchNotifications() {
  try {
    // Fetch latest appointments regardless of status so mobile-booked entries appear.
    const { data: pendingAppts, error: apptError } = await sb
      .from("appointments")
      .select("*")
      .order("created_at", { ascending: false });

    if (!apptError && pendingAppts) {
      allPendingAppointmentNotifs = pendingAppts.filter((appt) => {
        const type = normalizeAppointmentType(
          appt.appointment_type || appt.service_type || appt.type
        );
        return ["schedule", "followups", "consultation"].includes(type);
      });
    }

    // Fetch leave requests (pending, approved, denied)
    const { data: leaveData, error: leaveError } = await sb
      .from("attendance")
      .select("*")
      .in("status", ["leave-pending", "on-leave", "leave-denied"])
      .order("date", { ascending: false });

    if (!leaveError && leaveData) {
      allLeaveNotifications = leaveData;
    }

    // Fetch pending patient accounts
    const { data: accountsData, error: accountsError } = await sb
      .from("patients")
      .select("*")
      .eq("account_status", "pending")
      .order("created_at", { ascending: false });

    if (!accountsError && accountsData) {
      allPendingAccounts = accountsData;
    }

    updateNotifBadge();
    renderNotifications();
  } catch (err) {
    console.error("Error fetching notifications:", err);
  }
}

function updateNotifBadge() {
  const badge = document.getElementById("notifBadge");
  const apptTabBadge = document.getElementById("notifTabAppointmentsBadge");
  if (!badge) return;

  const readApptIds = new Set(getReadAppointmentNotifIds());
  const unreadAppts = allPendingAppointmentNotifs.filter(
    (appt) => !readApptIds.has(String(appt.id))
  ).length;
  const pendingLeaves = allLeaveNotifications.filter(l => l.status === "leave-pending").length;
  const pendingAccountsCount = allPendingAccounts.length;
  const total = unreadAppts + pendingLeaves + pendingAccountsCount;

  if (total > 0) {
    badge.textContent = total > 99 ? "99+" : total.toString();
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }

  if (apptTabBadge) {
    if (unreadAppts > 0) {
      apptTabBadge.textContent = unreadAppts > 99 ? "99+" : unreadAppts.toString();
      apptTabBadge.classList.remove("hidden");
      apptTabBadge.classList.add("inline-flex");
    } else {
      apptTabBadge.classList.add("hidden");
      apptTabBadge.classList.remove("inline-flex");
    }
  }

  const leaveTabBadge = document.getElementById("notifTabLeavesBadge");
  if (leaveTabBadge) {
    if (pendingLeaves > 0) {
      leaveTabBadge.textContent = pendingLeaves > 99 ? "99+" : pendingLeaves.toString();
      leaveTabBadge.classList.remove("hidden");
      leaveTabBadge.classList.add("inline-flex");
    } else {
      leaveTabBadge.classList.add("hidden");
    }
  }

  const accountTabBadge = document.getElementById("notifTabAccountsBadge");
  if (accountTabBadge) {
    const pendingAccounts = allPendingAccounts.length;
    if (pendingAccounts > 0) {
      accountTabBadge.textContent = pendingAccounts > 99 ? "99+" : pendingAccounts.toString();
      accountTabBadge.classList.remove("hidden");
      accountTabBadge.classList.add("inline-flex");
    } else {
      accountTabBadge.classList.add("hidden");
      accountTabBadge.classList.remove("inline-flex");
    }
  }
}

function renderNotifications() {
  const container = document.getElementById("notifListContainer");
  if (!container) return;

  let items = [];

  if (currentNotifTab === "appointments") {
    // Appointments tab
    items = allPendingAppointmentNotifs;
    
    // Search filtering
    if (notifSearchQuery) {
      items = items.filter(a => 
        (a.patient_name && a.patient_name.toLowerCase().includes(notifSearchQuery)) ||
        (a.patient_condition && a.patient_condition.toLowerCase().includes(notifSearchQuery)) ||
        (a.appointment_type && a.appointment_type.toLowerCase().includes(notifSearchQuery))
      );
    }

    if (items.length === 0) {
      container.innerHTML = `
        <div class="text-center py-8">
          <div class="w-12 h-12 bg-green-50 rounded-2xl mx-auto flex items-center justify-center mb-3">
            <i data-lucide="${notifSearchQuery ? 'search-X' : 'calendar-check'}" class="w-6 h-6 text-green-300"></i>
          </div>
          <p class="text-xs font-bold text-slate-400">${notifSearchQuery ? 'No matching appointments' : 'No appointment notifications'}</p>
          <p class="text-[11px] text-slate-300 mt-1">${notifSearchQuery ? 'Try another search term' : 'New booked appointments will appear here'}</p>
        </div>`;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    container.innerHTML = items.map(appt => {
      const readApptIds = new Set(getReadAppointmentNotifIds());
      const isUnread = !readApptIds.has(String(appt.id));
      const timeAgo = getTimeAgo(appt.created_at);
      const apptTypeLabel = formatAppointmentTypeLabel(
        appt.appointment_type || appt.service_type || appt.type
      );
      const statusLabel = String(appt.status || "pending");
      const statusClass =
        statusLabel === "scheduled"
          ? "bg-blue-100 text-blue-700"
          : "bg-amber-100 text-amber-700";
      
      const highlightedName = highlightText(appt.patient_name || 'Unknown', notifSearchQuery);
      const highlightedNotes = highlightText(appt.patient_condition || 'Routine', notifSearchQuery);

      return `
        <div class="p-4 rounded-2xl border ${isUnread ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200 bg-white'} transition-all hover:shadow-sm cursor-pointer"
             data-open-appointment="true"
             data-appt-id="${appt.id}"
             data-appt-type="${escapeHtml(appt.appointment_type || appt.service_type || appt.type || 'schedule')}"
             data-appt-date="${escapeHtml(appt.appointment_date || '')}">
          <div class="flex items-start gap-3">
            <div class="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center shrink-0 mt-0.5">
              <i data-lucide="calendar-clock" class="w-4 h-4 text-white"></i>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <p class="text-[13px] font-bold text-slate-800 truncate">${highlightedName}</p>
                <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${statusClass}">${escapeHtml(statusLabel)}</span>
                <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">${escapeHtml(apptTypeLabel)}</span>
                ${isUnread ? `<span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">New</span>` : `<span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">Read</span>`}
              </div>
              <p class="text-xs text-slate-500 leading-relaxed">New appointment for <strong>${appt.appointment_date || '—'}</strong> at <strong>${formatAptTimeRange(appt.appointment_time, appt.duration_minutes || appt.duration)}</strong> - ${highlightedNotes}</p>
              <p class="text-[10px] text-slate-400 mt-1.5 font-medium">${timeAgo}</p>
            </div>
          </div>
        </div>`;
    }).join("");

  } else if (currentNotifTab === "leaves") {
    // Leaves tab
    items = allLeaveNotifications;
    
    if (notifSearchQuery) {
      items = items.filter(l => 
        (l.staff_name && l.staff_name.toLowerCase().includes(notifSearchQuery)) ||
        (l.notes && l.notes.toLowerCase().includes(notifSearchQuery))
      );
    }

    if (items.length === 0) {
      container.innerHTML = `
        <div class="text-center py-8">
          <div class="w-12 h-12 bg-pink-50 rounded-2xl mx-auto flex items-center justify-center mb-3">
            <i data-lucide="${notifSearchQuery ? 'search-x' : 'calendar-off'}" class="w-6 h-6 text-pink-300"></i>
          </div>
          <p class="text-xs font-bold text-slate-400">${notifSearchQuery ? 'No matching leaves' : 'No leave requests'}</p>
          <p class="text-[11px] text-slate-300 mt-1">${notifSearchQuery ? 'Try another search term' : 'Staff leave requests will appear here'}</p>
        </div>`;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    container.innerHTML = items.map(leave => {
      const isPending = leave.status === "leave-pending";
      const isApproved = leave.status === "on-leave";
      const isDenied = leave.status === "leave-denied";
      const statusLabel = isPending ? "Pending" : isApproved ? "Approved" : "Denied";
      const statusClass = isPending ? "bg-amber-100 text-amber-700" : isApproved ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700";
      const borderClass = isPending ? "border-pink-200 bg-pink-50/50" : "border-slate-100 bg-white";
      const initials = (leave.staff_name || "??").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
      const reason = (leave.notes || "").replace(/^Leave:\s*/i, "").split(" | Attached")[0] || "No reason";
      const truncReason = reason.length > 45 ? reason.substring(0, 45) + "..." : reason;
      
      const highlightedName = highlightText(leave.staff_name || 'Unknown', notifSearchQuery);
      const highlightedReason = highlightText(truncReason, notifSearchQuery);

      return `
        <div class="p-4 rounded-2xl border ${borderClass} transition-all hover:shadow-sm cursor-pointer" onclick="openLeaveReviewModal('${leave.id}')">
          <div class="flex items-start gap-3">
            <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-pink-400 to-rose-500 flex items-center justify-center shrink-0 mt-0.5">
              <span class="text-white font-black text-[10px]">${initials}</span>
            </div>
            <div class="flex-1 min-w-0 overflow-hidden">
              <div class="flex items-center justify-between gap-2 mb-1">
                <p class="text-[13px] font-bold text-slate-800 truncate flex-1">${highlightedName}</p>
                <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ${statusClass}">${statusLabel}</span>
              </div>
              <p class="text-xs text-slate-500 leading-snug break-words">
                <span class="font-bold text-slate-400 text-[10px] uppercase tracking-tighter mr-1">Date:</span> 
                ${leave.date || '—'}
              </p>
              <p class="text-[11px] text-slate-600 mt-1 line-clamp-2 italic overflow-wrap-anywhere" style="overflow-wrap: anywhere;">"${highlightedReason}"</p>
              
              ${leave.notes && leave.notes.includes("| DATA:") ? `
              <div class="mt-2 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-amber-50 border border-amber-100 w-fit">
                <i data-lucide="image" class="w-3 h-3 text-amber-600"></i>
                <span class="text-[9px] font-black uppercase tracking-widest text-amber-700">Proof Attached</span>
              </div>
              ` : ""}
              <p class="text-[10px] text-slate-400 mt-2 font-medium border-t border-slate-50 pt-1">${leave.staff_role || 'Staff'}</p>
            </div>
          </div>
        </div>`;
    }).join("");
  } else if (currentNotifTab === "accounts") {
    items = allPendingAccounts;
    
    if (notifSearchQuery) {
      items = items.filter(a => 
        (a.full_name && a.full_name.toLowerCase().includes(notifSearchQuery)) ||
        (a.email && a.email.toLowerCase().includes(notifSearchQuery))
      );
    }

    if (items.length === 0) {
      container.innerHTML = `
        <div class="text-center py-8">
          <div class="w-12 h-12 bg-rose-50 rounded-2xl mx-auto flex items-center justify-center mb-3">
            <i data-lucide="${notifSearchQuery ? 'search-x' : 'user-check'}" class="w-6 h-6 text-rose-300"></i>
          </div>
          <p class="text-xs font-bold text-slate-400">${notifSearchQuery ? 'No matching accounts' : 'No pending accounts'}</p>
          <p class="text-[11px] text-slate-300 mt-1">${notifSearchQuery ? 'Try another search term' : 'New registrations will appear here'}</p>
        </div>`;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    container.innerHTML = items.map(account => {
      const timeAgo = getTimeAgo(account.created_at);
      const highlightedName = highlightText(account.full_name || 'New Patient', notifSearchQuery);
      const highlightedEmail = highlightText(account.email || '', notifSearchQuery);

      return `
        <div class="p-4 rounded-2xl border border-rose-200 bg-rose-50/50 transition-all hover:shadow-sm cursor-pointer"
             onclick="openPendingAccountFromNotification()">
          <div class="flex items-start gap-3">
            <div class="w-9 h-9 rounded-xl bg-rose-500 flex items-center justify-center shrink-0 mt-0.5">
              <i data-lucide="user-plus" class="w-4 h-4 text-white"></i>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <p class="text-[13px] font-bold text-slate-800 truncate">${highlightedName}</p>
                <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">Pending</span>
              </div>
              <p class="text-xs text-slate-500 leading-relaxed mb-0.5">Registration from <strong>${highlightedEmail}</strong> is waiting for approval.</p>
              <p class="text-[10px] text-slate-400 mt-1.5 font-medium">${timeAgo}</p>
            </div>
          </div>
        </div>`;
    }).join("");
  }

  if (window.lucide) window.lucide.createIcons();
}

async function openAppointmentFromNotification(apptId, rawType, apptDate) {
  if (!apptId) return;

  const targetType = normalizeAppointmentType(rawType);

  // 1. Switch Page & Tab
  setActivePage("appointments");
  setActiveApptTab(targetType);

  // 2. Force scroll restoration to prevent any lockout from modals or messenger
  document.body.style.overflow = "auto";
  document.body.style.height = "auto";
  const mainContent = document.getElementById("mainContent");
  if (mainContent) mainContent.style.overflow = "hidden"; // Keep main app container clipped
  
  const contentWrapper = document.getElementById("contentWrapper");
  if (contentWrapper) {
    contentWrapper.style.overflowY = "auto";
    contentWrapper.classList.remove("overflow-hidden", "no-scrollbar");
    contentWrapper.classList.add("overflow-y-auto");
  }
  const dateInputId = (targetType === "followups") ? "filterDateFollowups" :
    (targetType === "consultation") ? "filterDateConsultation" :
      "filterDate";
  const searchInputId = (targetType === "followups") ? "searchInputFollowups" :
    (targetType === "consultation") ? "searchInputConsultation" :
      "searchInput";

  const dateEl = document.getElementById(dateInputId);
  const searchEl = document.getElementById(searchInputId);
  const statusEl = (targetType === "followups") ? document.getElementById("filterStatusFollowups") :
                   (targetType === "consultation") ? document.getElementById("filterStatusConsultation") :
                   document.getElementById("filterStatus");

  if (dateEl) dateEl.value = "";
  if (searchEl) searchEl.value = "";
  if (statusEl) statusEl.value = "";

  // 3. Refresh and wait for render
  await fetchAppointments();

  // 4. Find the row and scroll smoothly (Delay to ensure DOM is ready)
  setTimeout(() => {
    const row = document.querySelector(`tr[data-id="${apptId}"]`);
    if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "center" });

      // Premium Pulse Effect
      row.classList.add("notif-highlight-pulse");

      // Auto cleanup class after animation
      setTimeout(() => {
        row.classList.remove("notif-highlight-pulse");
      }, 3500);
    } else {
      showRecruitmentToast("Navigated to appointments, but record not found in current view.", "info");
    }
  }, 300);
}

function openPendingAccountFromNotification() {
  const dropdown = document.getElementById("notifDropdown");
  if (dropdown) {
    dropdown.classList.add("hidden");
    dropdown.classList.remove("flex");
  }

  setActivePage("accounts");
  
  // Make sure to filter for pending accounts when opening
  const searchInput = document.getElementById("patientAccountsSearch");
  if (searchInput) {
    searchInput.value = "";
  }
  
  fetchPatients();
}

function getTimeAgo(dateStr) {
  if (!dateStr) return "";
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHrs < 24) return `${diffHrs}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}



async function markAllNotificationsRead() {
  try {
    // 1. Mark appointments as read in local storage
    allPendingAppointmentNotifs.forEach((appt) => {
      addReadAppointmentNotifId(String(appt.id));
    });

    await fetchNotifications();
  } catch (err) {
    console.error("Error marking all as read:", err);
  }
}

// ---- Leave Review Modal Functions ----

window.openLeaveReviewModal = function (leaveId) {
  const leave = allLeaveNotifications.find(l => String(l.id) === String(leaveId));
  if (!leave) return;

  leaveReviewRecordId = leaveId;
  const modal = document.getElementById("leaveReviewModal");
  if (!modal) return;

  // Populate left side: Leave details
  const dateEl = document.getElementById("leaveReviewDate");
  const statusEl = document.getElementById("leaveReviewStatus");
  const reasonEl = document.getElementById("leaveReviewReason");
  const attachBox = document.getElementById("leaveReviewAttachmentBox");
  const attachEl = document.getElementById("leaveReviewAttachment");
  const actionsEl = document.getElementById("leaveReviewActions");

  if (dateEl) {
    const d = new Date(leave.date + "T00:00:00");
    dateEl.textContent = d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  }

  // Status display
  const isPending = leave.status === "leave-pending";
  const isApproved = leave.status === "on-leave";
  if (statusEl) {
    const label = isPending ? "⏳ Pending Approval" : isApproved ? "✅ Approved" : "❌ Denied";
    const cls = isPending ? "text-amber-600" : isApproved ? "text-emerald-600" : "text-red-600";
    statusEl.textContent = label;
    statusEl.className = `text-sm font-bold ${cls}`;
  }

  // Header status badge
  const statusBadge = document.getElementById("leaveReviewStatusBadge");
  if (statusBadge) {
    const badgeLabel = isPending ? "Pending" : isApproved ? "Approved" : "Denied";
    statusBadge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-white"></span> ${badgeLabel}`;
  }

  // Parse reason and attachment
  const fullNotes = leave.notes || "";
  let reasonText = fullNotes.replace(/^Leave:\s*/i, "");
  let attachmentName = "";
  let base64Data = "";

  // Extract DATA if present
  if (reasonText.includes(" | DATA: ")) {
    const dataSplit = reasonText.split(" | DATA: ");
    base64Data = dataSplit[1] || "";
    reasonText = dataSplit[0];
  }

  // Extract Attachment Name if present
  if (reasonText.includes(" | Attached Document: ")) {
    const nameSplit = reasonText.split(" | Attached Document: ");
    attachmentName = nameSplit[1] || "";
    reasonText = nameSplit[0];
  }

  if (reasonEl) reasonEl.textContent = reasonText.trim() || "No reason provided";

  if (attachBox && attachEl) {
    const imgContainer = document.getElementById("leaveReviewImageContainer");
    const imgEl = document.getElementById("leaveReviewImage");
    const downloadBtn = document.getElementById("leaveReviewDownloadBtn");

    if (attachmentName || base64Data) {
      attachBox.classList.remove("hidden");
      attachEl.textContent = attachmentName ? "📎 " + attachmentName : "📎 Attached File";

      // Download Button Logic
      if (base64Data && downloadBtn) {
        downloadBtn.href = base64Data;
        downloadBtn.download = attachmentName || "attachment";
        downloadBtn.classList.remove("hidden");
      } else if (downloadBtn) {
        downloadBtn.classList.add("hidden");
      }

      // Image Preview Logic
      if (base64Data && base64Data.startsWith("data:image/") && imgContainer && imgEl) {
        imgEl.src = base64Data;
        imgContainer.classList.remove("hidden");
      } else if (imgContainer) {
        imgContainer.classList.add("hidden");
      }
    } else {
      attachBox.classList.add("hidden");
      if (imgContainer) imgContainer.classList.add("hidden");
      if (downloadBtn) downloadBtn.classList.add("hidden");
    }
  }

  // Show/hide action buttons based on status
  if (actionsEl) actionsEl.style.display = isPending ? "flex" : "none";

  // Populate right side: Staff profile
  const staffRec = allStaffData.find(s => s.name === leave.staff_name);
  const initials = (leave.staff_name || "??").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);

  const avatarEl = document.getElementById("leaveReviewAvatar");
  if (avatarEl) {
    if (staffRec && staffRec.image_base64) {
      avatarEl.innerHTML = `<img src="${staffRec.image_base64}" class="w-20 h-20 rounded-[24px] object-cover" />`;
    } else {
      avatarEl.textContent = initials;
    }
  }

  const nameEl = document.getElementById("leaveReviewName");
  if (nameEl) nameEl.textContent = leave.staff_name || "Unknown";

  const roleEl = document.getElementById("leaveReviewRole");
  if (roleEl) roleEl.textContent = leave.staff_role || "Staff";

  const specEl = document.getElementById("leaveReviewSpecialty");
  if (specEl) specEl.textContent = staffRec?.specialty || "General";

  const availEl = document.getElementById("leaveReviewAvailability");
  if (availEl) {
    if (staffRec) {
      availEl.textContent = staffRec.is_available ? "✓ Available" : "✗ Not Available";
      availEl.className = `text-[12px] font-bold ${staffRec.is_available ? "text-emerald-600" : "text-slate-500"}`;
    } else {
      availEl.textContent = "Unknown";
    }
  }

  // Close dropdown and open modal
  document.getElementById("notifDropdown")?.classList.add("hidden");
  modal.classList.remove("hidden");
  if (window.lucide) window.lucide.createIcons();
};

window.handleLeaveAction = async function (newStatus) {
  if (!leaveReviewRecordId) {
    console.error("No leave record ID selected.");
    showRecruitmentToast("Error: No leave record selected.", "error");
    return;
  }

  const approveBtn = document.getElementById("leaveApproveBtn");
  const denyBtn = document.getElementById("leaveDenyBtn");
  const originalApproveText = approveBtn ? approveBtn.innerHTML : "Approve";

  // Visual Feedback
  if (approveBtn) {
    approveBtn.disabled = true;
    approveBtn.innerHTML = '<i class="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></i> Processing...';
  }
  if (denyBtn) denyBtn.disabled = true;

  try {
    // 1. Fetch fresh data to ensure record exists
    const { data: leave, error: fetchError } = await sb
      .from("attendance")
      .select("*")
      .eq("id", leaveReviewRecordId)
      .single();

    if (fetchError || !leave) {
      throw new Error("Could not find the leave record in the database. It may have been deleted or changed.");
    }

    const updatePayload = { status: newStatus };

    // 2. If approving leave (Paid Leave logic)
    if (newStatus === "on-leave") {
      updatePayload.clock_in = "09:00";
      updatePayload.clock_out = "17:00";
      updatePayload.total_hours = 8;
      updatePayload.notes = (leave.notes || "") + " | [AUTO-PAID LEAVE]";

      // Set staff member as Unavailable
      if (leave.staff_name) {
        console.log("Setting staff unavailable:", leave.staff_name);
        const { error: staffError } = await sb.from("clinic_staff")
          .update({ is_available: false })
          .eq("name", leave.staff_name);

        if (staffError) {
          console.warn("Staff status update failed (but proceeding with leave):", staffError);
        }
      }
    }

    // 3. Update the attendance record
    console.log("Updating attendance ID:", leaveReviewRecordId, "to:", newStatus);
    const { error: updateError } = await sb.from("attendance")
      .update(updatePayload)
      .eq("id", leaveReviewRecordId);

    if (updateError) throw updateError;

    // 4. Finalize UI
    console.log("Approval successful. Refreshing UI...");
    document.getElementById("leaveReviewModal")?.classList.add("hidden");
    leaveReviewRecordId = null;

    // Refresh notifications and attendance
    await fetchNotifications();
    if (typeof fetchAttendance === "function") {
      await fetchAttendance();
      if (typeof renderAttendanceTable === "function") renderAttendanceTable();
    }

    showRecruitmentToast(`Successfully ${newStatus === 'on-leave' ? 'approved' : 'denied'} the leave request.`, "success");
  } catch (err) {
    console.error("Leave action critical error:", err);
    showRecruitmentToast("Leave Action Failed: " + (err.message || "Unknown error occurred."), "error");
  } finally {
    if (approveBtn) {
      approveBtn.disabled = false;
      approveBtn.innerHTML = originalApproveText;
    }
    if (denyBtn) denyBtn.disabled = false;
  }
}



function setupNotificationUI() {
  if (notificationUIInitialized) return;
  notificationUIInitialized = true;

  const bellBtn = document.getElementById("notifBellBtn");
  const dropdown = document.getElementById("notifDropdown");
  const markAllBtn = document.getElementById("markAllReadBtn");
  const tabRequests = document.getElementById("notifTabRequests");
  const tabAppointments = document.getElementById("notifTabAppointments");
  const notifContainer = document.getElementById("notifListContainer");

  if (!bellBtn || !dropdown) return;

  // Improved Toggle logic for Admin notifications
  bellBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Check current state
    const isCurrentlyHidden = dropdown.classList.contains("hidden");

    if (isCurrentlyHidden) {
      console.log("Admin Notification Dropdown: Opening");
      // Hide other potential dropdowns here if necessary
      dropdown.classList.remove("hidden");
      dropdown.classList.add("flex"); // Ensure flex is applied when visible
      fetchNotifications();
    } else {
      console.log("Admin Notification Dropdown: Closing");
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
        console.log("Admin Notification Dropdown: Closing (click outside)");
        dropdown.classList.add("hidden");
        dropdown.classList.remove("flex");
      }
    }
  });

  // Mark all read
  if (markAllBtn) {
    markAllBtn.addEventListener("click", () => {
      markAllNotificationsRead();
    });
  }

  // Tab switching
  const tabLeaves = document.getElementById("notifTabLeaves");
  const tabAccounts = document.getElementById("notifTabAccounts");
  const allTabs = [tabRequests, tabAppointments, tabLeaves, tabAccounts].filter(Boolean);

  function activateNotifTab(activeTab, tabKey) {
    currentNotifTab = tabKey;
    allTabs.forEach(t => {
      if (t === activeTab) {
        t.classList.add("text-blue-600", "border-blue-600");
        t.classList.remove("text-slate-400", "border-transparent");
      } else {
        t.classList.remove("text-blue-600", "border-blue-600");
        t.classList.add("text-slate-400", "border-transparent");
      }
    });
    renderNotifications();
  }

  if (tabRequests) tabRequests.addEventListener("click", () => activateNotifTab(tabRequests, "requests"));
  if (tabAppointments) tabAppointments.addEventListener("click", () => activateNotifTab(tabAppointments, "appointments"));
  if (tabLeaves) tabLeaves.addEventListener("click", () => activateNotifTab(tabLeaves, "leaves"));
  if (tabAccounts) tabAccounts.addEventListener("click", () => activateNotifTab(tabAccounts, "accounts"));

  const notifSearchInput = document.getElementById("notifSearchInput");
  if (notifSearchInput) {
    notifSearchInput.addEventListener("input", (e) => {
      notifSearchQuery = e.target.value.toLowerCase().trim();
      renderNotifications();
    });
  }

  // Leave Review Modal handlers
  const leaveModal = document.getElementById("leaveReviewModal");
  const leaveCloseBtn = document.getElementById("leaveReviewCloseBtn");
  const leaveApproveBtn = document.getElementById("leaveApproveBtn");
  const leaveDenyBtn = document.getElementById("leaveDenyBtn");

  if (leaveCloseBtn) leaveCloseBtn.addEventListener("click", () => leaveModal?.classList.add("hidden"));
  if (leaveApproveBtn) leaveApproveBtn.addEventListener("click", () => handleLeaveAction("on-leave"));
  if (leaveDenyBtn) leaveDenyBtn.addEventListener("click", () => handleLeaveAction("leave-denied"));

  // Open and focus appointment from notification card
  if (notifContainer) {
    notifContainer.addEventListener("click", async (e) => {
      // Case A: Appointment Notification
      const apptCard = e.target.closest("[data-open-appointment='true']");
      if (apptCard) {
        const apptId = apptCard.getAttribute("data-appt-id");
        const apptType = apptCard.getAttribute("data-appt-type");
        const apptDate = apptCard.getAttribute("data-appt-date");

        addReadAppointmentNotifId(String(apptId || ""));
        updateNotifBadge();
        renderNotifications();

        dropdown.classList.add("hidden");
        await openAppointmentFromNotification(apptId, apptType, apptDate);
        return;
      }

      // Case B: Profile Edit Request Notification
      const reqCard = e.target.closest("[data-mark-request-read='true']");
      if (reqCard) {
        // Prevent re-triggering if clicking buttons
        if (e.target.closest('button')) return;

        const reqId = reqCard.getAttribute("data-req-id");
        const request = allProfileRequests.find(r => String(r.id) === String(reqId));
        if (request && !request.is_read) {
          // Close dropdown immediately for better UX
          dropdown.classList.add("hidden");
          await sb.from("profile_edit_requests").update({ is_read: true }).eq("id", reqId);
          await fetchNotifications();
          showRecruitmentToast("Profile request marked as read.", "success");
        }
      }
    });
  }
}

// ==========================================
// TREATMENT PROGRESS MANAGEMENT LOGIC
// ==========================================

let activeProgressPatient = null;
let selectedProgressPlan = null;
let treatmentProgressInitialized = false;

function initTreatmentProgress() {
  if (treatmentProgressInitialized) return;
  treatmentProgressInitialized = true;

  const searchProgressPatient = document.getElementById("searchProgressPatient");
  const assignPlanBtn = document.getElementById("assignPlanBtn");

  if (searchProgressPatient) {
    searchProgressPatient.addEventListener("input", () => loadProgressPatients(searchProgressPatient.value));
  }

  document.querySelectorAll(".plan-selector-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const plan = btn.getAttribute("data-plan");
      setSelectedPlan(plan);
    });
  });

  if (assignPlanBtn) {
    assignPlanBtn.addEventListener("click", () => saveProgressPlan());
  }

  const changePlanBtn = document.getElementById("changePlanBtn");
  if (changePlanBtn) {
    changePlanBtn.onclick = () => {
      document.getElementById("planSelectionSection").classList.remove("hidden");
      document.getElementById("activeJourneyTracking").classList.add("hidden");
      document.getElementById("journeyPreviewSection").classList.remove("hidden");
      const assignBtn = document.getElementById("assignPlanBtn");
      if (assignBtn) assignBtn.classList.remove("hidden");
    };
  }

  // Plan Builder Modal ...

  // Plan Builder Modal
  const openPlanBuilderBtn = document.getElementById("openPlanBuilderBtn");
  const planBuilderModal = document.getElementById("planBuilderModal");
  const closePlanBuilderBtn = document.getElementById("closePlanBuilderBtn");
  const cancelPlanBuilderBtn = document.getElementById("cancelPlanBuilderBtn");
  const addPhaseBtn = document.getElementById("addPhaseBtn");
  const customPhasesContainer = document.getElementById("customPhasesContainer");
  const saveCustomPlanBtn = document.getElementById("saveCustomPlanBtn");

  if (openPlanBuilderBtn) {
    openPlanBuilderBtn.onclick = () => {
      planBuilderModal.classList.remove("hidden");
      // Reset and add 1 initial phase
      if (customPhasesContainer) {
        customPhasesContainer.innerHTML = "";
        addPhaseInputRow();
      }
    };
  }

  if (closePlanBuilderBtn) closePlanBuilderBtn.onclick = () => planBuilderModal.classList.add("hidden");
  if (cancelPlanBuilderBtn) cancelPlanBuilderBtn.onclick = () => planBuilderModal.classList.add("hidden");

  if (addPhaseBtn) {
    addPhaseBtn.onclick = () => addPhaseInputRow();
  }

  if (saveCustomPlanBtn) {
    saveCustomPlanBtn.onclick = () => saveCustomToPresets();
  }

  // Filter dropdown
  const progressFilterStatus = document.getElementById("progressFilterStatus");
  if (progressFilterStatus) {
    progressFilterStatus.addEventListener("change", () => {
      const search = document.getElementById("searchProgressPatient");
      loadProgressPatients(search ? search.value : "");
    });
  }

  // Export button
  const exportBtn = document.getElementById("exportProgressBtn");
  if (exportBtn) {
    exportBtn.onclick = () => {
      if (!activeProgressPatient) { alert("Please select a patient first."); return; }
      const patientAppts = allAppointments.filter(a => a.patient_name === activeProgressPatient);
      let planKey = null;
      for (const a of patientAppts) {
        planKey = getTreatmentPlanKey(a);
        if (planKey) break;
      }

      let report = `Treatment Progress Report\n========================\nPatient: ${activeProgressPatient}\nPlan: ${planKey || 'None Assigned'}\nDate: ${new Date().toLocaleDateString()}\n\n`;
      if (planKey && treatmentJourneys[planKey]) {
        const phases = treatmentJourneys[planKey];
        const allText = patientAppts.map(a => `${a.patient_condition || ""} ${a.appointment_type}`).join(" ").toLowerCase();
        phases.forEach((p, i) => {
          const isDone = allText.includes(`[accomplished: ${p.title.toLowerCase()} - ${p.keywords[0].toLowerCase()}]`);
          report += `${i + 1}. ${p.title} - ${isDone ? '✓ COMPLETED' : '○ PENDING'}\n   ${p.desc}\n\n`;
        });
      }
      const blob = new Blob([report], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `progress_${activeProgressPatient.replace(/\s+/g, '_')}.txt`;
      a.click(); URL.revokeObjectURL(url);
    };
  }

  // Print button
  const printBtn = document.getElementById("printProgressBtn");
  if (printBtn) {
    printBtn.onclick = () => {
      const panel = document.getElementById("progressDetailPanel");
      if (panel) { window.print(); }
    };
  }

  // Bulk Mark Done
  const bulkMarkDoneBtn = document.getElementById("bulkMarkDoneBtn");
  if (bulkMarkDoneBtn) {
    bulkMarkDoneBtn.onclick = async () => {
      if (!activeProgressPatient) return;
      const patientAppts = allAppointments.filter(a => a.patient_name === activeProgressPatient);
      let planKey = null;
      for (const a of patientAppts) {
        planKey = getTreatmentPlanKey(a);
        if (planKey) break;
      }

      if (!planKey) return;
      const phases = treatmentJourneys[planKey];
      const allText = patientAppts.map(a => `${a.patient_condition || ""} ${a.appointment_type}`).join(" ").toLowerCase();
      const pending = phases.filter(p => !allText.includes(`[accomplished: ${p.title.toLowerCase()} - ${p.keywords[0].toLowerCase()}]`));
      if (pending.length === 0) { alert("All phases are already completed!"); return; }
      const ok = confirm(`Mark ${pending.length} remaining phase(s) as done?`);
      if (!ok) return;
      for (const p of pending) {
        await markPhaseAccomplished(activeProgressPatient, p.keywords[0], p.title);
      }
    };
  }

  // Inject fadeInUp animation CSS
  if (!document.getElementById("fadeInUpStyle")) {
    const style = document.createElement("style");
    style.id = "fadeInUpStyle";
    style.textContent = `@keyframes fadeInUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }`;
    document.head.appendChild(style);
  }
}

function addPhaseInputRow() {
  const container = document.getElementById("customPhasesContainer");
  if (!container) return;

  const div = document.createElement("div");
  div.className = "flex gap-3 items-start animate-in slide-in-from-left-2 duration-300";
  div.innerHTML = `
        <div class="flex-1 space-y-2">
            <input type="text" placeholder="Phase Title (e.g. Initial Check)" aria-label="Phase Title" class="phase-title-input w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-2 text-xs font-bold focus:ring-2 focus:ring-indigo-500/20" />
            <input type="text" placeholder="Description" aria-label="Phase Description" class="phase-desc-input w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-2 text-[10px] font-medium focus:ring-2 focus:ring-indigo-500/20" />
        </div>
        <button class="remove-phase-btn p-3 text-slate-300 hover:text-red-500 transition-colors" aria-label="Remove Phase"><i data-lucide="minus-circle" class="w-4 h-4"></i></button>
    `;

  div.querySelector(".remove-phase-btn").onclick = () => div.remove();
  container.appendChild(div);
  if (window.lucide) window.lucide.createIcons({ root: div });
}

async function saveCustomToPresets() {
  const nameInput = document.getElementById("customPlanName");
  const titleInputs = document.querySelectorAll(".phase-title-input");
  const descInputs = document.querySelectorAll(".phase-desc-input");

  if (!nameInput.value) {
    alert("Please enter a plan name.");
    return;
  }

  const phases = [];
  titleInputs.forEach((input, i) => {
    if (input.value) {
      phases.push({ title: input.value, desc: descInputs[i].value || "" });
    }
  });

  if (phases.length === 0) {
    alert("Please add at least one phase.");
    return;
  }

  // Add to our global treatmentJourneys
  treatmentJourneys[nameInput.value] = phases.map(p => {
    return { title: p.title, desc: p.desc, keywords: [p.title.toLowerCase()] };
  });

  // Refresh UI - Add a new button to the plan selector UI in activeProgressPanel
  // (In a real app, we'd save this to DB, here we'll just show it in the UI)
  renderCustomPlanButtons();

  const planSelect = document.getElementById("followupPlanSelect");
  if (planSelect) {
    let exists = Array.from(planSelect.options).some(opt => opt.value === nameInput.value);
    if (!exists) {
      const opt = document.createElement("option");
      opt.value = nameInput.value;
      opt.text = `Custom (${nameInput.value})`;
      planSelect.appendChild(opt);
      planSelect.value = nameInput.value; // Auto select for convenience
    }
  }

  const msg = document.getElementById("planBuilderMsg");
  if (msg) {
    msg.classList.remove("hidden");
    setTimeout(() => {
      msg.classList.add("hidden");
      document.getElementById("planBuilderModal").classList.add("hidden");
    }, 1500);
  }
}

function renderCustomPlanButtons() {
  // We already have 4 presets. Let's add any extras.
  const container = document.querySelector("#activeProgressPanel .grid");
  if (!container) return;

  // Clear and re-render all buttons to match treatmentJourneys
  container.innerHTML = "";
  Object.keys(treatmentJourneys).forEach(planName => {
    const isPreset = ["Braces", "Extraction", "Cleaning", "Root Canal"].includes(planName);
    const icon = isPreset ? (planName === "Braces" ? "smile" : planName === "Extraction" ? "scissors" : planName === "Cleaning" ? "sparkles" : "Activity") : "clipboard-list";
    const colorClass = isPreset ? (planName === "Braces" ? "blue" : planName === "Extraction" ? "emerald" : planName === "Cleaning" ? "amber" : "indigo") : "slate";

    const btn = document.createElement("button");
    btn.className = `plan-selector-btn group p-4 rounded-3xl border-2 border-slate-50 hover:border-${colorClass}-100 bg-slate-50/50 hover:bg-${colorClass}-50/30 transition-all text-left`;
    btn.setAttribute("data-plan", planName);

    btn.innerHTML = `
            <div class="flex items-center gap-3 mb-2">
              <div class="w-8 h-8 rounded-xl bg-${colorClass}-100 flex items-center justify-center text-${colorClass}-600 group-data-[active=true]:bg-${colorClass}-600 group-data-[active=true]:text-white transition-colors">
                <i data-lucide="${icon}" class="w-4 h-4"></i>
              </div>
              <span class="text-sm font-black text-slate-800">${planName}</span>
            </div>
            <p class="text-[10px] text-slate-400 font-medium leading-relaxed">${treatmentJourneys[planName][0].desc} (${treatmentJourneys[planName].length} phases)</p>
        `;

    btn.onclick = () => setSelectedPlan(planName);
    container.appendChild(btn);
  });

  if (window.lucide) window.lucide.createIcons({ root: container });
}

let treatmentJourneys = {
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

async function fetchTreatmentJourneys() {
  try {
    const { data, error } = await sb.from("application_config").select("*").eq("id", "treatment_journeys").maybeSingle();
    if (data && data.items) {
      // Merge with defaults to ensure core plans always exist
      treatmentJourneys = { ...treatmentJourneys, ...data.items };
      console.log("Loaded Treatment Journeys from DB");
    }
  } catch (err) {
    console.error("Failed to load treatment journeys:", err);
  }
}

async function saveTreatmentJourneys() {
  try {
    await sb.from("application_config").upsert({
      id: "treatment_journeys",
      items: treatmentJourneys,
      updated_at: new Date().toISOString()
    });
  } catch (err) {
    console.error("Failed to save treatment journeys:", err);
  }
}

window.setTreatmentSidebarFilter = function(filter) {
  const hiddenInput = document.getElementById("internalSidebarFilter");
  if (hiddenInput) hiddenInput.value = filter;
  
  // Update Tab UI
  document.querySelectorAll(".treatment-tab").forEach(tab => {
    tab.classList.remove("bg-white", "text-violet-600", "shadow-sm", "border", "border-slate-200/50");
    tab.classList.add("text-slate-500");
  });
  
  const activeTab = document.getElementById(`tab-${filter}`);
  if (activeTab) {
    activeTab.classList.remove("text-slate-500");
    activeTab.classList.add("bg-white", "text-violet-600", "shadow-sm", "border", "border-slate-200/50");
  }
  
  const searchInput = document.getElementById("searchProgressPatient");
  loadProgressPatients(searchInput ? searchInput.value : "");
};

async function loadProgressPatients(filter = "") {
  const progressPatientList = document.getElementById("progressPatientList");
  if (!progressPatientList) return;

  // Refresh patients if empty
  if (allAppointments.length === 0) await fetchAppointments();

  const filterStatus = document.getElementById("progressFilterStatus");
  const topFilter = filterStatus ? filterStatus.value : "all";
  const sidebarFilter = document.getElementById("internalSidebarFilter")?.value || "active";

  // 1. Group appointments by patient and identify their treatment plans from the joined table
  const patientGroups = {};
  
  allAppointments.forEach(a => {
    const name = (!a.patient_name || a.patient_name === "Self") ? 
      (allPatients.find(rp => rp.email === a.patient_email)?.full_name || a.patient_name) : a.patient_name;
    
    if (!name) return;
    
    if (!patientGroups[name]) {
      patientGroups[name] = {
        name: name,
        appointments: [],
        planKey: null,
        lastAppt: a
      };
    }
    
    patientGroups[name].appointments.push(a);
    
    // Check for plan in the joined treatment_plan object
    if (!patientGroups[name].planKey) {
      patientGroups[name].planKey = getTreatmentPlanKey(a);
    }
    
    // Keep the most recent appointment as lastAppt
    if (new Date(a.appointment_date) > new Date(patientGroups[name].lastAppt.appointment_date)) {
      patientGroups[name].lastAppt = a;
    }
  });

  // 2. Map groups to progress data
  const patients = Object.values(patientGroups)
    .filter(p => p.name.toLowerCase().includes(filter.toLowerCase()))
    .map(p => {
      let totalPhases = 0, donePhases = 0, progressPct = 0;
      
      if (p.planKey && treatmentJourneys[p.planKey]) {
        const phases = treatmentJourneys[p.planKey];
        totalPhases = phases.length;
        const allText = p.appointments.map(a => `${a.patient_condition || ""} ${a.appointment_type}`).join(" ").toLowerCase();
        
        phases.forEach(ph => {
          const isDone = allText.includes(`[accomplished: ${ph.title.toLowerCase()} - ${ph.keywords[0].toLowerCase()}]`);
          if (isDone) donePhases++;
        });
        
        progressPct = totalPhases > 0 ? Math.round((donePhases / totalPhases) * 100) : 0;
      }
      
      return { ...p, totalPhases, donePhases, progressPct };
    })
    .filter(p => {
      // 1. Apply Top Filter (Global View)
      let matchesTop = true;
      if (topFilter === "active") matchesTop = p.planKey && p.progressPct < 100;
      else if (topFilter === "unassigned") matchesTop = !p.planKey;
      else if (topFilter === "completed") matchesTop = p.planKey && p.progressPct === 100;

      // 2. Apply Sidebar Filter (Status Monitor)
      let matchesSidebar = true;
      if (sidebarFilter === "active") matchesSidebar = p.planKey && p.progressPct < 100;
      else if (sidebarFilter === "completed") matchesSidebar = p.planKey && p.progressPct === 100;
      else if (sidebarFilter === "unassigned") matchesSidebar = !p.planKey;

      return matchesTop && matchesSidebar;
    });


  // Update patient count badge

  const countEl = document.getElementById("progressPatientCount");
  if (countEl) countEl.textContent = patients.length;

  progressPatientList.innerHTML = "";
  const summaryGrid = document.getElementById("progressSummaryGrid");
  if (summaryGrid) summaryGrid.innerHTML = "";

  if (patients.length === 0) {
    const emptyMsg = `<div class="p-8 text-center bg-slate-50 rounded-2xl border border-slate-100"><p class="text-xs font-bold text-slate-400 uppercase tracking-widest">No patients found</p></div>`;
    progressPatientList.innerHTML = emptyMsg;
    if (summaryGrid) summaryGrid.innerHTML = `<div class="col-span-full py-20 text-center bg-white rounded-[32px] border border-slate-100 shadow-sm"><i data-lucide="users-2" class="w-12 h-12 text-slate-200 mx-auto mb-4"></i><h3 class="text-lg font-black text-slate-800 mb-1">No Patients to Display</h3><p class="text-xs font-bold text-slate-400 uppercase tracking-widest">Search or filter above to find records</p></div>`;
    return;
  }

  patients.forEach(p => {
    // 1. Sidebar Card
    const card = document.createElement("div");
    const isActive = activeProgressPatient === p.name;
    card.className = `p-4 rounded-2xl border transition-all cursor-pointer group ${isActive ? 'bg-gradient-to-r from-violet-600 to-indigo-600 border-violet-500 text-white shadow-xl shadow-violet-500/20 scale-[1.02]' : 'bg-white border-slate-100 hover:border-violet-200 hover:shadow-md'}`;

    const initials = p.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);

    // Status badge & color logic
    let statusBadge = '';
    let progressFill = '#8b5cf6';
    if (p.planKey) {
      if (p.progressPct === 100) {
        statusBadge = `<span class="text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${isActive ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-700'}">Completed</span>`;
        progressFill = '#10b981';
      } else {
        statusBadge = `<span class="text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${isActive ? 'bg-white/20 text-white' : 'bg-violet-100 text-violet-700'}">Active</span>`;
      }
    } else {
      statusBadge = `<span class="text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-400'}">No Plan</span>`;
      progressFill = '#cbd5e1';
    }

    const lastUpdate = p.lastAppt ? getTimeAgo(p.lastAppt.created_at || p.lastAppt.appointment_date) : 'Never';

    card.innerHTML = `
      <div class="flex items-center gap-3 relative">
        <div class="w-10 h-10 rounded-xl ${isActive ? 'bg-white/20' : 'bg-gradient-to-br from-violet-100 to-indigo-100'} flex items-center justify-center font-black text-xs ${isActive ? 'text-white' : 'text-violet-600'} group-hover:scale-110 transition-transform shrink-0">
          ${initials}
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between gap-2">
            <h4 class="text-[12px] font-black truncate">${p.name}</h4>
            ${statusBadge}
          </div>
          <div class="flex items-center justify-between mt-0.5">
            <p class="text-[9px] ${isActive ? 'text-white/70' : 'text-slate-500'} font-bold truncate">${p.planKey || 'No Plan'}</p>
            <p class="text-[8px] ${isActive ? 'text-white/40' : 'text-slate-300'} font-black uppercase tracking-tighter shrink-0">${lastUpdate}</p>
          </div>
          ${p.planKey ? `
          <div class="mt-2 h-1 rounded-full ${isActive ? 'bg-white/20' : 'bg-slate-100'} overflow-hidden">
            <div class="h-full rounded-full transition-all duration-700 shadow-sm" style="width: ${p.progressPct}%; background: ${isActive ? 'rgba(255,255,255,0.9)' : progressFill}"></div>
          </div>` : ''}
        </div>
        <i data-lucide="chevron-right" class="w-3.5 h-3.5 ${isActive ? 'text-white/60' : 'text-slate-200'} shrink-0 ml-1"></i>
      </div>
    `;

    card.addEventListener("click", () => selectProgressPatient(p.name));
    progressPatientList.appendChild(card);

    // 2. Summary Grid Card (Main Area)
    if (summaryGrid) {
      const sCard = document.createElement("div");
      sCard.className = "bg-white p-6 rounded-[28px] border border-slate-100 shadow-sm hover:shadow-xl hover:border-violet-200 transition-all duration-300 group cursor-pointer animate-in fade-in slide-in-from-bottom-4 duration-500";
      sCard.innerHTML = `
        <div class="flex items-start justify-between mb-5">
          <div class="flex items-center gap-4">
            <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-50 to-indigo-100 flex items-center justify-center text-violet-600 font-black text-lg group-hover:scale-110 transition-transform shadow-inner">
              ${initials}
            </div>
            <div>
              <h4 class="text-base font-black text-slate-800 tracking-tight">${p.name}</h4>
              <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">${p.lastAppt ? p.lastAppt.appointment_date : 'No Recent Appt'}</p>
            </div>
          </div>
          ${statusBadge.replace('text-[8px]', 'text-[10px] px-3 py-1')}
        </div>
        
        <div class="space-y-4">
          <div>
            <div class="flex justify-between items-center mb-2">
              <span class="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <i data-lucide="route" class="w-3.5 h-3.5 text-violet-400"></i>
                ${p.planKey || 'No Treatment Plan Assigned'}
              </span>
              <span class="text-xs font-black text-violet-600 bg-violet-50 px-2 py-0.5 rounded-lg">${p.progressPct}%</span>
            </div>
            <div class="h-3 bg-slate-50 rounded-full overflow-hidden p-0.5 border border-slate-100 shadow-inner">
              <div class="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-600 shadow-[0_0_12px_rgba(139,92,246,0.3)] transition-all duration-1000" style="width: ${p.progressPct}%"></div>
            </div>
          </div>
          
          <div class="flex items-center justify-between pt-2">
            <div class="flex items-center gap-3">
              <div class="flex -space-x-2">
                ${[1, 2, 3].map(i => `<div class="w-6 h-6 rounded-full border-2 border-white bg-slate-100 flex items-center justify-center text-[8px] font-black text-slate-400">${i}</div>`).join('')}
              </div>
              <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">${p.donePhases} / ${p.totalPhases || 0} Phases Done</span>
            </div>
            <button class="text-[10px] font-black text-violet-600 uppercase tracking-widest flex items-center gap-1.5 group/btn">
              Manage Journey
              <i data-lucide="arrow-right" class="w-3.5 h-3.5 group-hover/btn:translate-x-1 transition-transform"></i>
            </button>
          </div>
        </div>
      `;
      sCard.onclick = () => selectProgressPatient(p.name);
      summaryGrid.appendChild(sCard);
    }
  });

  if (window.lucide) {
    window.lucide.createIcons({ root: progressPatientList });
    if (summaryGrid) window.lucide.createIcons({ root: summaryGrid });
  }

  // Update treatment stats
  updateTreatmentStats(patients);
}

function showProgressSummary() {
  activeProgressPatient = null;
  const summaryView = document.getElementById("progressSummaryView");
  const activePanel = document.getElementById("activeProgressPanel");
  const emptyState = document.getElementById("emptyProgressState");
  const searchInput = document.getElementById("searchProgressPatient");

  if (summaryView) summaryView.classList.remove("hidden");
  if (activePanel) activePanel.classList.add("hidden");
  if (emptyState) emptyState.classList.add("hidden");

  // Sync sidebar active state
  loadProgressPatients(searchInput ? searchInput.value : "");
}


function updateTreatmentStats(patients) {
  // Total patients
  const totalPatientsEl = document.getElementById("statTotalPatients");
  const activePlansEl = document.getElementById("statActivePlans");
  const completionRateEl = document.getElementById("statCompletionRate");
  const planTypesEl = document.getElementById("statPlanTypes");

  if (!totalPatientsEl) return;

  // Gather all patients (unfiltered for stats)
  const allPatientNames = Array.from(new Set(allAppointments.map(a => {
    if (!a.patient_name || a.patient_name === "Self") {
        const reg = allPatients.find(p => p.email === a.patient_email);
        return reg ? reg.full_name : (a.patient_name || a.created_by_name || "Unknown Patient");
    }
    return a.patient_name;
  }).filter(Boolean)));
  if (totalPatientsEl) totalPatientsEl.textContent = allPatientNames.length;

  // Count active plans
  let activePlans = 0;
  let totalCompletion = 0;
  let patientsWithPlans = 0;
  const planUsedSet = new Set();

  allPatientNames.forEach(name => {
    const patientAppts = allAppointments.filter(a => {
        const actualName = (!a.patient_name || a.patient_name === "Self") ? 
          (allPatients.find(rp => rp.email === a.patient_email)?.full_name || a.patient_name) : a.patient_name;
        return actualName === name;
    });
    
    let planKey = getTreatmentPlanKey(patientAppts.find(a => getTreatmentPlanKey(a)));


    if (planKey) {
      activePlans++;
      planUsedSet.add(planKey);
      const phases = treatmentJourneys[planKey];
      if (phases) {
        const allText = patientAppts.map(a => `${a.patient_condition || ""} ${a.appointment_type}`).join(" ").toLowerCase();
        let done = 0;
        phases.forEach(p => {
          if (allText.includes(`[accomplished: ${p.title.toLowerCase()} - ${p.keywords[0].toLowerCase()}]`)) done++;
        });
        totalCompletion += Math.round((done / phases.length) * 100);
        patientsWithPlans++;
      }
    }
  });

  if (activePlansEl) activePlansEl.textContent = activePlans;
  if (completionRateEl) completionRateEl.textContent = patientsWithPlans > 0 ? Math.round(totalCompletion / patientsWithPlans) + "%" : "0%";
  if (planTypesEl) planTypesEl.textContent = planUsedSet.size;

  // --- NEW COMMAND CENTER STATS ---
  const miniAvg = document.getElementById("miniStatAvgProgress");
  const miniDue = document.getElementById("miniStatDueToday");
  const distContainer = document.getElementById("planDistributionBars");

  if (miniAvg) miniAvg.textContent = patientsWithPlans > 0 ? Math.round(totalCompletion / patientsWithPlans) + "%" : "0%";
  
  // Calculate Due Today (Appointments today for active patients)
  const today = getTodayStr();
  const dueToday = allAppointments.filter(a => a.appointment_date === today && (a.status !== 'cancelled' && a.status !== 'no_show')).length;
  if (miniDue) miniDue.textContent = dueToday;

  // Plan Distribution Bars
  if (distContainer) {
    const planCounts = {};
    allPatientNames.forEach(name => {
       const patientAppts = allAppointments.filter(a => (a.patient_name || a.created_by_name) === name);
       const planKey = getTreatmentPlanKey(patientAppts.find(a => getTreatmentPlanKey(a)));
       if (planKey) {
          planCounts[planKey] = (planCounts[planKey] || 0) + 1;
       }
    });

    const sortedPlans = Object.entries(planCounts).sort((a,b) => b[1] - a[1]).slice(0, 4);
    if (sortedPlans.length === 0) {
       distContainer.innerHTML = `<p class="text-[9px] text-slate-400 italic text-center py-2">No plans assigned yet</p>`;
    } else {
       const max = Math.max(...Object.values(planCounts));
       distContainer.innerHTML = sortedPlans.map(([plan, count]) => `
          <div class="space-y-1">
             <div class="flex justify-between text-[9px] font-black text-slate-600 uppercase tracking-tighter">
                <span>${plan}</span>
                <span>${count}</span>
             </div>
             <div class="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                <div class="h-full bg-violet-500 rounded-full" style="width: ${(count/max)*100}%"></div>
             </div>
          </div>
       `).join("");
    }
  }

  const summaryStats = document.getElementById("summaryStats");
  if (summaryStats) {
    summaryStats.innerHTML = `
      <div class="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-violet-50 border border-violet-100 shadow-sm">
        <span class="text-[9px] font-black text-violet-400 uppercase tracking-widest">Active Plans</span>
        <span class="text-xs font-black text-violet-700">${activePlans}</span>
      </div>
      <div class="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-100 shadow-sm">
        <span class="text-[9px] font-black text-emerald-400 uppercase tracking-widest">Avg Progress</span>
        <span class="text-xs font-black text-emerald-700">${patientsWithPlans > 0 ? Math.round(totalCompletion / patientsWithPlans) : 0}%</span>
      </div>
    `;
  }
}


async function selectProgressPatient(name) {
  activeProgressPatient = name;
  const searchProgressPatient = document.getElementById("searchProgressPatient");
  loadProgressPatients(searchProgressPatient ? searchProgressPatient.value : "");

  const summaryView = document.getElementById("progressSummaryView");
  const emptyProgressState = document.getElementById("emptyProgressState");
  const activeProgressPanel = document.getElementById("activeProgressPanel");

  if (summaryView) summaryView.classList.add("hidden");
  if (emptyProgressState) emptyProgressState.classList.add("hidden");
  if (activeProgressPanel) {
    activeProgressPanel.classList.remove("hidden");
    activeProgressPanel.classList.add("animate-in", "fade-in", "slide-in-from-right-4", "duration-500");
  }

  const initials = name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  const avatar = document.getElementById("progressActiveAvatar");
  const nameLabel = document.getElementById("progressActiveName");
  const planLabel = document.getElementById("progressActivePlan");

  if (avatar) avatar.innerText = initials;
  if (nameLabel) nameLabel.innerText = name;

  // Look for current plan across all appointments
  const patientAppts = allAppointments.filter(a => {
    const actualName = (!a.patient_name || a.patient_name === "Self") ? 
      (allPatients.find(rp => rp.email === a.patient_email)?.full_name || a.patient_name) : a.patient_name;
    return actualName === name;
  });
  
  let currentPlanKey = null;
  let currentPlanName = "None Assigned";

  try {
      const { data, error } = await sb.from("treatment_plan")
        .select("plan_key")
        .eq("patient_name", name)
        .maybeSingle();
      
      if (!error && data) {
          currentPlanKey = data.plan_key;
      } else {
          // Try by email if we have it
          const email = patientAppts[0]?.patient_email;
          if (email) {
              const { data: eData } = await sb.from("treatment_plan")
                .select("plan_key")
                .eq("patient_email", email)
                .maybeSingle();
              if (eData) currentPlanKey = eData.plan_key;
          }
      }
      
      // Implicit detection: Scan ALL patient appointments for [PLAN:...] tags
      if (!currentPlanKey) {
          const planRegex = /\[PLAN(?:\s*\(.*?\))?:\s*(.*?)\]/i;
          for (const a of patientAppts) {
              const match = (a.patient_condition || "").match(planRegex);
              if (match) {
                  currentPlanKey = match[1].trim();
                  break;
              }
          }
      }

      // Smart fallback removed to ensure 'None Assigned' state triggers the assignment UI

      if (currentPlanKey && treatmentJourneys[currentPlanKey]) {
          currentPlanName = currentPlanKey + " Journey";
      }
      if (planLabel) planLabel.innerText = currentPlanName;

      // Now render phases and progress
      renderTrackingView(currentPlanKey, name);
      loadClinicalPhotos(name);
  } catch (err) {
      console.error("Error fetching patient plan detail:", err);
  }



  // Calculate progress for ring
  let totalPhases = 0, donePhases = 0, progressPct = 0;
  if (currentPlanKey && treatmentJourneys[currentPlanKey]) {
    const phases = treatmentJourneys[currentPlanKey];
    totalPhases = phases.length;
    const allText = patientAppts.map(a => `${a.patient_condition || ""} ${a.appointment_type}`).join(" ").toLowerCase();
        const accomplishedRegex = /\[accomplished:\s*(.*?)\s*-\s*(.*?)\]/gi;
        phases.forEach(p => {
          let isDone = false;
          let match;
          while ((match = accomplishedRegex.exec(allText)) !== null) {
              const tagTitle = match[1].trim().toLowerCase();
              const tagKeyword = match[2].trim().toLowerCase();
              if (tagTitle === p.title.toLowerCase() || p.keywords.some(k => k.toLowerCase() === tagKeyword)) {
                  isDone = true;
                  break;
              }
          }
          if (isDone) donePhases++;
          accomplishedRegex.lastIndex = 0; // Reset for next phase
        });
    progressPct = totalPhases > 0 ? Math.round((donePhases / totalPhases) * 100) : 0;
  }

  // Update progress ring
  const ringCircle = document.getElementById("miniProgressRingCircle");
  const ringPercent = document.getElementById("miniProgressPercent");
  const phasesInfo = document.getElementById("progressPhasesInfo");
  const statusLabel = document.getElementById("progressStatusLabel");
  const addPhaseBtn = document.getElementById("addPhaseToJourneyBtn");

  if (ringCircle) {
    const circumference = 2 * Math.PI * 28; // r=28
    const offset = circumference - (progressPct / 100) * circumference;
    setTimeout(() => { ringCircle.style.strokeDashoffset = offset; }, 100);
  }
  if (ringPercent) ringPercent.textContent = progressPct + "%";
  if (phasesInfo) phasesInfo.textContent = `${donePhases}/${totalPhases} Phases`;
  if (statusLabel) {
    if (progressPct === 100) {
      statusLabel.textContent = "Completed";
      statusLabel.className = "text-[10px] font-black text-emerald-500 uppercase tracking-widest mt-0.5";
    } else if (progressPct > 0) {
      statusLabel.textContent = "In Progress";
      statusLabel.className = "text-[10px] font-black text-amber-500 uppercase tracking-widest mt-0.5";
    } else if (currentPlanKey) {
      statusLabel.textContent = "Not Started";
      statusLabel.className = "text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5";
    } else {
      statusLabel.textContent = "No Plan";
      statusLabel.className = "text-[10px] font-black text-slate-300 uppercase tracking-widest mt-0.5";
    }
  }

  if (currentPlanKey) {
    currentPlanName = currentPlanKey + " Journey";

    document.getElementById("planSelectionSection").classList.add("hidden");
    document.getElementById("activeJourneyTracking").classList.remove("hidden");
    document.getElementById("journeyPreviewSection").classList.add("hidden");
    const assignBtn = document.getElementById("assignPlanBtn");
    if (assignBtn) assignBtn.classList.add("hidden");
    if (addPhaseBtn) {
      addPhaseBtn.classList.remove("hidden");
      addPhaseBtn.onclick = () => {
        const customPhaseModal = document.getElementById("addCustomPhaseModal");
        const customPhaseInput = document.getElementById("customPhaseNameInput");
        const btnCancel = document.getElementById("cancelAddCustomPhaseBtn");
        const btnClose = document.getElementById("closeAddCustomPhaseBtn");
        const btnConfirm = document.getElementById("confirmAddCustomPhaseBtn");

        if (customPhaseModal && customPhaseInput) {
          customPhaseInput.value = "";
          customPhaseModal.classList.remove("hidden");

          const hideModal = () => customPhaseModal.classList.add("hidden");

          if (btnCancel) btnCancel.onclick = hideModal;
          if (btnClose) btnClose.onclick = hideModal;

          if (btnConfirm) {
            btnConfirm.onclick = () => {
              const newPhaseTitle = customPhaseInput.value;
              if (newPhaseTitle && newPhaseTitle.trim() !== "") {
                const title = newPhaseTitle.trim();
                const kw = title.toLowerCase();
                if (!treatmentJourneys[currentPlanKey]) treatmentJourneys[currentPlanKey] = [];
                treatmentJourneys[currentPlanKey].push({ title: title, keywords: [kw] });
                hideModal();
                // Redraw the view and recalculate the ring progress dynamically
                selectProgressPatient(name);
              }
            };
          }
        }
      };
    }
    renderTrackingView(currentPlanKey, name);
  } else {
    document.getElementById("planSelectionSection").classList.remove("hidden");
    document.getElementById("activeJourneyTracking").classList.add("hidden");
    document.getElementById("journeyPreviewSection").classList.remove("hidden");
    const assignBtn = document.getElementById("assignPlanBtn");
    if (assignBtn) assignBtn.classList.remove("hidden");
    if (addPhaseBtn) addPhaseBtn.classList.add("hidden");
    renderCustomPlanButtons();
    // Reset ring
    if (ringCircle) ringCircle.style.strokeDashoffset = "175.93";
    if (ringPercent) ringPercent.textContent = "0%";
  }

  if (planLabel) {
    planLabel.innerHTML = `<span class="w-1.5 h-1.5 rounded-full ${currentPlanKey ? 'bg-violet-500' : 'bg-slate-300'}"></span> Current: ${currentPlanName}`;
  }
  setSelectedPlan(null);

  // Load Before & After Photos
  loadClinicalPhotos(name);

  // Render activity log
  renderActivityLog(name, currentPlanKey);
}

function renderActivityLog(patientName, planKey) {
  const logSection = document.getElementById("treatmentActivityLog");
  const logList = document.getElementById("activityLogList");
  if (!logSection || !logList) return;

  if (!planKey) {
    logSection.classList.add("hidden");
    return;
  }

  logSection.classList.remove("hidden");
  const phases = treatmentJourneys[planKey] || [];
  const patientAppts = allAppointments.filter(a => a.patient_name === patientName);
  const allText = patientAppts.map(a => `${a.patient_condition || ""} ${a.appointment_type}`).join(" ").toLowerCase();

  const entries = [];
  phases.forEach(p => {
    if (allText.includes(`[accomplished: ${p.title.toLowerCase()} - ${p.keywords[0].toLowerCase()}]`)) {
      entries.push({ title: p.title, type: "completed", icon: "check-circle-2", color: "emerald" });
    }
  });

  // Add plan assignment entry
  entries.unshift({ title: `Plan "${planKey}" assigned`, type: "assigned", icon: "clipboard-check", color: "violet" });

  if (entries.length === 0) {
    logList.innerHTML = `<p class="text-[10px] text-slate-400 text-center py-4 font-bold uppercase tracking-widest">No activity recorded yet</p>`;
    return;
  }

  logList.innerHTML = entries.map(e => `
        <div class="flex items-center gap-3 p-3 bg-${e.color}-50/50 rounded-xl border border-${e.color}-100/50 animate-in fade-in duration-300">
            <div class="w-7 h-7 rounded-lg bg-${e.color}-100 flex items-center justify-center shrink-0">
                <i data-lucide="${e.icon}" class="w-3.5 h-3.5 text-${e.color}-600"></i>
            </div>
            <div class="flex-1 min-w-0">
                <p class="text-[11px] font-bold text-slate-700 truncate">${e.title}</p>
                <p class="text-[9px] font-bold text-slate-400 uppercase tracking-widest">${e.type === 'completed' ? 'Phase Completed' : 'Plan Assigned'}</p>
            </div>
            <span class="text-[8px] font-black text-${e.color}-500 uppercase tracking-widest shrink-0">${e.type === 'completed' ? '✓ Done' : '📋'}</span>
        </div>
    `).join("");

  if (window.lucide) window.lucide.createIcons({ root: logList });
}

async function loadClinicalPhotos(patientName) {
  const photosSection = document.getElementById("clinicalPhotosSection");
  if (!photosSection) return;

  // Show section
  photosSection.classList.remove("hidden");

  // Reset previews
  document.getElementById("beforeImgTag").classList.add("hidden");
  document.getElementById("afterImgTag").classList.add("hidden");
  document.getElementById("beforeImgTag").src = "";
  document.getElementById("afterImgTag").src = "";

  // Find appointment with photos (usually the one with the plan tag)
  const patientAppts = allAppointments.filter(a => a.patient_name === patientName);
  const photoAppt = patientAppts.find(a => (a.patient_condition || "").includes("[BEFORE_JPG:") || (a.patient_condition || "").includes("[AFTER_JPG:"));

  if (photoAppt) {
    const notesVal = photoAppt.patient_condition;
    const beforeMatch = notesVal.match(/\[BEFORE_JPG:(.*?)\]/);
    const afterMatch = notesVal.match(/\[AFTER_JPG:(.*?)\]/);

    if (beforeMatch && beforeMatch[1]) {
      const img = document.getElementById("beforeImgTag");
      img.src = beforeMatch[1];
      img.classList.remove("hidden");
    }
    if (afterMatch && afterMatch[1]) {
      const img = document.getElementById("afterImgTag");
      img.src = afterMatch[1];
      img.classList.remove("hidden");
    }
  }
}

async function handlePhotoUpload(input, imgTagId, overlayId) {
  const file = input.files[0];
  if (!file) return;

  const overlay = document.getElementById(overlayId);
  if (overlay) overlay.classList.remove("hidden");

  compressImage(file, (base64) => {
    const img = document.getElementById(imgTagId);
    img.src = base64;
    img.classList.remove("hidden");
    if (overlay) overlay.classList.add("hidden");

    // Save immediately when both or one is changed? 
    // User has a save button, so we'll wait for that.
  }, (err) => {
    console.error(err);
    if (overlay) overlay.classList.add("hidden");
  });
}

async function saveClinicalPhotos() {
  if (!activeProgressPatient) return;

  const saveBtn = document.getElementById("savePhotosBtn");
  const saveMsg = document.getElementById("savePhotosMsg");
  const origText = saveBtn.innerHTML;

  saveBtn.disabled = true;
  saveBtn.innerHTML = '<i data-lucide="loader-2" class="w-3 h-3 animate-spin"></i> Saving...';

  const beforeBase64 = document.getElementById("beforeImgTag").src;
  const afterBase64 = document.getElementById("afterImgTag").src;

  // Find the primary appointment for this progress (the one with the PLAN tag)
  const patientAppts = allAppointments.filter(a => a.patient_name === activeProgressPatient);
  let targetAppt = patientAppts.find(a => (a.patient_condition || "").includes("[PLAN:"));

  // If no plan yet, use the latest one
  if (!targetAppt && patientAppts.length > 0) targetAppt = patientAppts[0];

  if (!targetAppt) {
    alert("Patient must have at least one appointment to save photos.");
    saveBtn.disabled = false;
    saveBtn.innerHTML = origText;
    return;
  }

  let newNotes = targetAppt.patient_condition || "";

  // Clean old tags
  newNotes = newNotes.replace(/\[BEFORE_JPG:.*?\]/g, "").replace(/\[AFTER_JPG:.*?\]/g, "").trim();

  if (beforeBase64 && beforeBase64.startsWith("data:image")) {
    newNotes += ` [BEFORE_JPG:${beforeBase64}]`;
  }
  if (afterBase64 && afterBase64.startsWith("data:image")) {
    newNotes += ` [AFTER_JPG:${afterBase64}]`;
  }

  try {
    const { error } = await sb.from("appointments").update({ patient_condition: newNotes }).eq("id", targetAppt.id);
    if (error) throw error;

    await fetchAppointments(); // Refresh
    if (saveMsg) {
      saveMsg.classList.remove("hidden");
      setTimeout(() => saveMsg.classList.add("hidden"), 3000);
    }
  } catch (err) {
    console.error("Error saving photos:", err);
    alert("Failed to save photos.");
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = origText;
    if (window.lucide) window.lucide.createIcons();
  }
}

function renderTrackingView(planKey, patientName) {
  const container = document.getElementById("trackingPhasesList");
  if (!container) return;

  const phases = treatmentJourneys[planKey];
  if (!phases) return;

  // Get all appointments for this patient to check completion
  const patientAppts = allAppointments.filter(a => a.patient_name === patientName);
  const allText = patientAppts.map(a => `${a.patient_condition || ''} ${a.appointment_type}`).join(" ").toLowerCase();

  let doneCount = 0;
  phases.forEach(p => {
    if (allText.includes(`[accomplished: ${p.title.toLowerCase()} - ${p.keywords[0].toLowerCase()}]`)) doneCount++;
  });

  container.innerHTML = "";
  phases.forEach((p, i) => {
    const isDone = allText.includes(`[accomplished: ${p.title.toLowerCase()} - ${p.keywords[0].toLowerCase()}]`);
    const isNext = !isDone && i === doneCount; // Next phase to complete
    const isLast = i === phases.length - 1;

    const card = document.createElement("div");
    card.className = "flex gap-4 group";
    card.style.animation = `fadeInUp 0.4s ease ${i * 80}ms both`;
    card.innerHTML = `
            <!-- Stepper Column -->
            <div class="flex flex-col items-center shrink-0">
                <div class="w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm transition-all duration-300 ${isDone
        ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30'
        : isNext
          ? 'bg-violet-100 text-violet-600 ring-2 ring-violet-400 ring-offset-2'
          : 'bg-slate-100 text-slate-400'
      }">
                    ${isDone ? '<i data-lucide="check" class="w-5 h-5"></i>' : (i + 1)}
                </div>
                ${!isLast ? `<div class="w-0.5 flex-1 my-1 rounded-full transition-all duration-500 ${isDone ? 'bg-emerald-300' : 'bg-slate-100'}"></div>` : ''}
            </div>
            <!-- Content -->
            <div class="flex-1 pb-${isLast ? '0' : '4'}">
                <div class="p-4 rounded-2xl border transition-all duration-300 ${isDone
        ? 'bg-emerald-50/70 border-emerald-100 hover:shadow-md hover:shadow-emerald-500/10'
        : isNext
          ? 'bg-violet-50/50 border-violet-100 hover:shadow-md hover:shadow-violet-500/10 ring-1 ring-violet-200'
          : 'bg-slate-50/50 border-slate-100 hover:bg-white hover:shadow-sm'
      }">
                    <div class="flex items-center justify-between gap-3">
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2">
                                <h4 class="text-[13px] font-black ${isDone ? 'text-emerald-900' : isNext ? 'text-violet-800' : 'text-slate-700'}">${p.title}</h4>
                                ${isNext ? '<span class="text-[8px] font-black text-violet-600 uppercase tracking-widest bg-violet-100 px-2 py-0.5 rounded-full">Next Up</span>' : ''}
                            </div>
                            <p class="text-[10px] ${isDone ? 'text-emerald-600' : 'text-slate-400'} font-medium mt-0.5 truncate">${p.desc}</p>
                        </div>
                        ${isDone ? `
                            <button class="unmark-done-btn px-3 py-1.5 bg-emerald-100/60 border border-emerald-200 rounded-xl text-[9px] font-black uppercase tracking-widest text-emerald-700 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-all shrink-0" data-keyword="${p.keywords[0]}" data-title="${p.title}">
                                Undo
                            </button>
                        ` : `
                            <button class="mark-done-btn px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-emerald-500 hover:border-emerald-500 hover:text-white transition-all shrink-0 shadow-sm" data-keyword="${p.keywords[0]}" data-title="${p.title}">
                                ${isNext ? '● Mark Done' : 'Mark Done'}
                            </button>
                        `}
                    </div>
                </div>
            </div>
        `;

    const markBtn = card.querySelector(".mark-done-btn");
    if (markBtn) {
      markBtn.onclick = () => markPhaseAccomplished(patientName, p.keywords[0], p.title);
    }

    const unmarkBtn = card.querySelector(".unmark-done-btn");
    if (unmarkBtn) {
      unmarkBtn.onclick = () => unmarkPhaseAccomplished(patientName, p.keywords[0], p.title);
    }

    container.appendChild(card);
  });

  if (window.lucide) window.lucide.createIcons({ root: container });
}

async function markPhaseAccomplished(patientName, keyword, phaseTitle) {
  const patientAppts = allAppointments.filter(a => a.patient_name === patientName);
  if (patientAppts.length === 0) return;

  const targetAppt = patientAppts[0];
  const marker = `[Accomplished: ${phaseTitle} - ${keyword}]`;

  if ((targetAppt.patient_condition || "").includes(marker)) return;

  let newNotes = (targetAppt.patient_condition || "") + (targetAppt.patient_condition ? " " : "") + marker;

  try {
    const { error } = await sb.from("appointments").update({ patient_condition: newNotes }).eq("id", targetAppt.id);
    if (error) throw error;

    await fetchAppointments();
    selectProgressPatient(patientName);
    // Also refresh consultation modal if open
    const modal = document.getElementById("consultationModal");
    if (modal && !modal.classList.contains("hidden")) {
      const apptId = document.getElementById("consultationApptId").value;
      const currentAppt = allAppointments.find(a => a.id == apptId);
      if (currentAppt) openConsultationModal(currentAppt);
    }
  } catch (err) {
    console.error("Error marking phase:", err);
    alert("Failed to update phase.");
  }
}

async function unmarkPhaseAccomplished(patientName, keyword, phaseTitle) {
  // Find the appointment that contains the [PLAN:...] tag or the latest one
  const patientAppts = allAppointments.filter(a => a.patient_name === patientName);
  if (patientAppts.length === 0) return;

  // Find the specific appointment that has the accomplishment tag
  const marker = `[Accomplished: ${phaseTitle} - ${keyword}]`;
  const targetAppt = patientAppts.find(a => (a.patient_condition || "").includes(marker)) || patientAppts[0];

  if (!(targetAppt.patient_condition || "").includes(marker)) {
    // If not found as a tag, it might be auto-detected. 
    // We can't "unmark" a real appointment type/note easily without deleting it,
    // but for manual tags, we should definitely work.
    console.log("Marker not found, might be auto-detected.");
    return;
  }

  // Use Regex to remove ALL instances of this marker, case-insensitive and globally
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escapedMarker, 'g');
  let newNotes = targetAppt.patient_condition.replace(regex, "").trim();

  try {
    const { error } = await sb.from("appointments").update({ patient_condition: newNotes }).eq("id", targetAppt.id);
    if (error) throw error;

    await fetchAppointments();

    // Brief delay to ensure state sync
    setTimeout(() => {
      selectProgressPatient(patientName);
      const modal = document.getElementById("consultationModal");
      if (modal && !modal.classList.contains("hidden")) {
        const apptId = document.getElementById("consultationApptId").value;
        const currentAppt = allAppointments.find(a => a.id == apptId);
        if (currentAppt) openConsultationModal(currentAppt);
      }
    }, 300);
  } catch (err) {
    console.error("Error unmarking phase:", err);
    alert("Failed to update phase.");
  }
}

function setSelectedPlan(plan) {
  selectedProgressPlan = plan;

  document.querySelectorAll(".plan-selector-btn").forEach(btn => {
    const p = btn.getAttribute("data-plan");
    if (p === plan) {
      btn.setAttribute("data-active", "true");
      btn.classList.add("ring-offset-2", "ring-2", "ring-blue-500", "border-blue-500", "bg-blue-50/20");
      btn.classList.remove("border-slate-50", "bg-slate-50/50");
    } else {
      btn.setAttribute("data-active", "false");
      btn.classList.remove("ring-offset-2", "ring-2", "ring-blue-500", "border-blue-500", "bg-blue-50/20");
      btn.classList.add("border-slate-50", "bg-slate-50/50");
    }
  });

  const assignPlanBtn = document.getElementById("assignPlanBtn");
  if (assignPlanBtn) assignPlanBtn.disabled = !plan;
  renderJourneyPreview(plan);
}

function renderJourneyPreview(plan) {
  const journeyPhasePreview = document.getElementById("journeyPhasePreview");
  if (!journeyPhasePreview) return;

  if (!plan) {
    journeyPhasePreview.innerHTML = `<p class="text-[11px] text-slate-400 text-center py-4 font-bold uppercase tracking-widest">Select a plan above to see phases</p>`;
    return;
  }

  const phases = treatmentJourneys[plan];
  journeyPhasePreview.innerHTML = "";

  phases.forEach((p, i) => {
    const item = document.createElement("div");
    item.className = "flex gap-4 items-start group";
    item.innerHTML = `
      <div class="flex flex-col items-center">
        <div class="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-[10px] font-black group-hover:bg-blue-600 group-hover:text-white transition-colors">
          ${i + 1}
        </div>
        ${i < phases.length - 1 ? '<div class="w-[1px] h-8 bg-slate-100 my-1"></div>' : ''}
      </div>
      <div>
        <h5 class="text-xs font-black text-slate-800 uppercase tracking-wider">${p.title}</h5>
        <p class="text-[10px] text-slate-400 font-medium">${p.desc}</p>
      </div>
    `;
    journeyPhasePreview.appendChild(item);
  });
}

async function saveProgressPlan() {
  const assignPlanBtn = document.getElementById("assignPlanBtn");
  if (!activeProgressPatient || !selectedProgressPlan || !assignPlanBtn) return;

  assignPlanBtn.disabled = true;
  assignPlanBtn.innerText = "Assigning...";

  try {
    // We update the LATEST appointment of this patient to include the plan tag
    const patientAppts = allAppointments.filter(a => a.patient_name === activeProgressPatient);
    if (patientAppts.length === 0) {
      alert("Patient has no appointments to attach plan to.");
      return;
    }

    const targetAppt = patientAppts[0]; // latest due to order by date desc
    
    const { error } = await sb.from("treatment_plan").upsert({
        appointment_id: targetAppt.id,
        patient_name: activeProgressPatient,
        patient_email: targetAppt.patient_email || null,
        plan_key: selectedProgressPlan,
        updated_at: new Date().toISOString()
    }, { onConflict: 'appointment_id' });

    if (error) throw error;

    const msg = document.getElementById("saveProgressPlanMsg");
    if (msg) {
      msg.classList.remove("hidden");
      setTimeout(() => msg.classList.add("hidden"), 3000);
    }

    // Refresh local cache
    await fetchAppointments();
    selectProgressPatient(activeProgressPatient);

  } catch (err) {
    console.error("Error saving plan:", err);
    alert("Failed to assign plan. Please try again.");
  } finally {
    assignPlanBtn.innerText = "Assign Plan to Patient";
  }
}

// Photo Input Listeners
document.addEventListener("change", (e) => {
  if (e.target.id === "beforePhotoInput") {
    handlePhotoUpload(e.target, "beforeImgTag", "beforeImgOverlay");
  } else if (e.target.id === "afterPhotoInput") {
    handlePhotoUpload(e.target, "afterImgTag", "afterImgOverlay");
  }
});

const savePhotosBtn = document.getElementById("savePhotosBtn");
if (savePhotosBtn) {
  savePhotosBtn.onclick = saveClinicalPhotos;
}
// ============================
// DASHBOARD ANALYTICS
// ============================
let mainDashboardChartInstance = null;
let dashChartMode = 'live'; // 'live' = today, 'historical' = all-time
let cachedDashAppts = []; // Cache for mode switching

// Close performance dropdown when clicking outside
document.addEventListener('click', function (e) {
  const dropdown = document.getElementById('perfMenuDropdown');
  const btn = document.getElementById('perfMenuBtn');
  if (dropdown && btn && !btn.contains(e.target) && !dropdown.contains(e.target)) {
    dropdown.classList.add('hidden');
  }
});

function setDashChartMode(mode) {
  dashChartMode = mode;
  const liveBtn = document.getElementById("dashChartLiveBtn");
  const histBtn = document.getElementById("dashChartHistBtn");
  const label = document.getElementById("dashChartModeLabel");

  if (mode === 'live') {
    if (liveBtn) { liveBtn.className = "px-3 py-1 rounded-xl bg-white shadow-sm text-[9px] font-black uppercase tracking-widest text-blue-600 border border-slate-200/60 transition-all"; }
    if (histBtn) { histBtn.className = "px-3 py-1 rounded-xl text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-all"; }
    if (label) { label.innerHTML = '<span class="text-[9px] font-black uppercase tracking-widest text-blue-500 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100/50"><i data-lucide="activity" class="w-2.5 h-2.5 inline-block mr-0.5 -mt-0.5"></i> Showing Today\'s Data</span>'; }
  } else {
    if (histBtn) { histBtn.className = "px-3 py-1 rounded-xl bg-white shadow-sm text-[9px] font-black uppercase tracking-widest text-blue-600 border border-slate-200/60 transition-all"; }
    if (liveBtn) { liveBtn.className = "px-3 py-1 rounded-xl text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-all"; }
    if (label) { label.innerHTML = '<span class="text-[9px] font-black uppercase tracking-widest text-violet-500 bg-violet-50 px-2 py-0.5 rounded-md border border-violet-100/50"><i data-lucide="history" class="w-2.5 h-2.5 inline-block mr-0.5 -mt-0.5"></i> Showing All-Time Data</span>'; }
  }
  if (label && window.lucide) window.lucide.createIcons({ root: label });

  // Re-render chart with cached data
  if (cachedDashAppts.length > 0) {
    renderDashChart(cachedDashAppts);
  }
}

function renderDashChart(appts) {
  const today = new Date().toISOString().split("T")[0];
  const chartAppts = dashChartMode === 'live'
    ? appts.filter(a => a.appointment_date === today)
    : appts;

  const totalCount = chartAppts.length;
  const consultCount = chartAppts.filter(a => (a.appointment_type || "").toLowerCase() === "consultation").length;
  const followupCount = chartAppts.filter(a => (a.appointment_type || "").toLowerCase() === "follow_up").length;
  const otherCount = totalCount - consultCount - followupCount;

  const dTotal = document.getElementById("dashTotalGraphVal");
  const dConsult = document.getElementById("dashConsultGraphVal");
  const dFollow = document.getElementById("dashFollowupGraphVal");
  if (dTotal) dTotal.textContent = totalCount;
  if (dConsult) dConsult.textContent = consultCount;
  if (dFollow) dFollow.textContent = followupCount;

  // Update progress bars
  const consultPct = totalCount > 0 ? Math.round((consultCount / totalCount) * 100) : 0;
  const followPct = totalCount > 0 ? Math.round((followupCount / totalCount) * 100) : 0;
  const consultBar = dConsult ? dConsult.closest(".p-4") : null;
  const followBar = dFollow ? dFollow.closest(".p-4") : null;
  if (consultBar) { const bar = consultBar.querySelector(".h-1 > div"); if (bar) bar.style.width = consultPct + "%"; }
  if (followBar) { const bar = followBar.querySelector(".h-1 > div"); if (bar) bar.style.width = followPct + "%"; }

  // Render Chart.js
  const ctx = document.getElementById("dashboardMainChart");
  if (ctx && window.Chart) {
    if (mainDashboardChartInstance) {
      mainDashboardChartInstance.destroy();
    }

    mainDashboardChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Consultations', 'Follow-ups', 'Other'],
        datasets: [{
          data: [consultCount, followupCount, otherCount],
          backgroundColor: ['#f59e0b', '#6366f1', '#3b82f6'],
          borderWidth: 0,
          hoverOffset: 15,
          cutout: '80%'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1e293b',
            titleFont: { size: 11, weight: 'bold' },
            bodyFont: { size: 10 },
            cornerRadius: 12,
            padding: 10
          }
        },
        animation: { animateScale: true, animateRotate: true, duration: 800 }
      }
    });
  }
}

function getTimeAgo(dateStr) {
  if (!dateStr) return "";
  const now = new Date();
  const d = new Date(dateStr);
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return diffMin + "m ago";
  if (diffHr < 24) return diffHr + "h ago";
  if (diffDay < 7) return diffDay + "d ago";
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getStatusColor(status) {
  const s = (status || "").toLowerCase();
  if (s === "approved" || s === "completed") return { bg: "bg-emerald-50", text: "text-emerald-600", dot: "bg-emerald-500" };
  if (s === "pending") return { bg: "bg-amber-50", text: "text-amber-600", dot: "bg-amber-500" };
  if (s === "cancelled" || s === "rejected") return { bg: "bg-rose-50", text: "text-rose-600", dot: "bg-rose-500" };
  return { bg: "bg-blue-50", text: "text-blue-600", dot: "bg-blue-500" };
}

function getTypeIcon(type) {
  const t = (type || "").toLowerCase();
  if (t === "consultation") return "stethoscope";
  if (t === "follow_up") return "refresh-cw";
  return "calendar-check";
}

function getTypeColor(type) {
  const t = (type || "").toLowerCase();
  if (t === "consultation") return { bg: "bg-amber-100", text: "text-amber-600" };
  if (t === "follow_up") return { bg: "bg-indigo-100", text: "text-indigo-600" };
  return { bg: "bg-blue-100", text: "text-blue-600" };
}

async function updateDashboardAnalytics() {
  try {
    const { data: appts, error } = await sb
      .from("appointments")
      .select("id, appointment_type, appointment_date, status, patient_name, created_at")
      .order("created_at", { ascending: false });

    if (error || !appts) return;
    cachedDashAppts = appts;

    // 1. Calculate Dashboard Metrics
    const today = new Date().toISOString().split("T")[0];
    const todayCount = appts.filter(a => a.appointment_date === today).length;

    const todayObj = new Date();
    const oneWeekLater = new Date(todayObj);
    oneWeekLater.setDate(todayObj.getDate() + 7);
    const weekCount = appts.filter(a => {
      if (!a.appointment_date) return false;
      const d = new Date(a.appointment_date);
      return d >= todayObj && d <= oneWeekLater;
    }).length;

    const uniqueDoctors = 1;

    const mToday = document.getElementById("metric-today-appointments");
    const mWeek = document.getElementById("metric-week-appointments");
    const mDocs = document.getElementById("metric-doctors");
    if (mToday) mToday.textContent = todayCount;
    if (mWeek) mWeek.textContent = weekCount;
    if (mDocs) mDocs.textContent = uniqueDoctors;

    // Display Current Date
    const dashDateEl = document.getElementById("dashDisplayDate");
    if (dashDateEl) {
      const now = new Date();
      dashDateEl.textContent = now.toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric'
      });
    }

    // 2. Render Chart (respects current mode)
    renderDashChart(appts);

    // 3. Render Enhanced Live Intelligence Feed
    const recentActivityContainer = document.getElementById("dashboardRecentActivity");
    if (recentActivityContainer) {
      recentActivityContainer.innerHTML = "";
      const recent = appts.slice(0, 8);
      if (recent.length === 0) {
        recentActivityContainer.innerHTML = '<div class="flex flex-col items-center justify-center py-8 opacity-40"><i data-lucide="inbox" class="w-8 h-8 text-slate-300 mb-2"></i><p class="text-[11px] text-slate-400 font-bold">No recent activity</p></div>';
      } else {
        recent.forEach(r => {
          const div = document.createElement("div");
          div.className = "flex items-start gap-2.5 p-2 rounded-xl hover:bg-slate-50/80 transition-all cursor-pointer group";
          div.onclick = function () { setActivePage('appointments'); };
          const typeLabel = (r.appointment_type || "").replace(/_/g, " ");
          const statusColor = getStatusColor(r.status);
          const typeColor = getTypeColor(r.appointment_type);
          const typeIcon = getTypeIcon(r.appointment_type);
          const timeAgo = getTimeAgo(r.created_at);
          const patientName = r.patient_name || ("Appointment #" + r.id);
          const statusLabel = (r.status || "pending").replace(/_/g, " ");

          div.innerHTML = '<div class="w-7 h-7 shrink-0 rounded-lg ' + typeColor.bg + ' flex items-center justify-center ' + typeColor.text + ' group-hover:scale-110 transition-transform">' +
            '<i data-lucide="' + typeIcon + '" class="w-3 h-3"></i>' +
            '</div>' +
            '<div class="flex-1 min-w-0">' +
            '<div class="flex items-center justify-between gap-2">' +
            '<p class="text-[10px] font-bold text-slate-700 truncate">' + patientName + '</p>' +
            '<span class="text-[8px] font-bold text-slate-400 shrink-0">' + timeAgo + '</span>' +
            '</div>' +
            '<div class="flex items-center gap-1.5 mt-0.5">' +
            '<span class="text-[8px] font-bold uppercase tracking-wider text-slate-400 capitalize">' + typeLabel + '</span>' +
            '<span class="text-slate-200">&bull;</span>' +
            '<span class="inline-flex items-center gap-0.5 text-[8px] font-bold ' + statusColor.text + ' capitalize">' +
            '<span class="w-1 h-1 rounded-full ' + statusColor.dot + '"></span> ' + statusLabel +
            '</span>' +
            '</div>' +
            '</div>';
          recentActivityContainer.appendChild(div);
        });
        if (window.lucide) window.lucide.createIcons({ root: recentActivityContainer });
      }
    }

    // 4. Update Performance Section with real data
    const dailyCapPct = Math.min(100, Math.round((todayCount / 40) * 100));
    const capacityBar = document.querySelector(".from-blue-400.to-blue-600");
    const capacityLabel = capacityBar ? capacityBar.closest(".space-y-1\\.5") : null;
    const capacityPctEl = capacityLabel ? capacityLabel.querySelector(".text-base") : null;
    if (capacityBar) capacityBar.style.width = dailyCapPct + "%";
    if (capacityPctEl) capacityPctEl.textContent = dailyCapPct + "%";

    const completedCount = appts.filter(a => {
      const s = (a.status || "").toLowerCase();
      return s === "completed" || s === "approved";
    }).length;
    const completionRate = appts.length > 0 ? ((completedCount / appts.length) * 100).toFixed(1) : "0.0";
    const checkIcon = document.querySelector('[data-lucide="check-circle"]');
    if (checkIcon) {
      const wrapper = checkIcon.closest(".flex.items-center.gap-2");
      if (wrapper) {
        const valEl = wrapper.querySelector(".text-xs");
        if (valEl) valEl.textContent = completionRate + "%";
      }
    }

  } catch (err) {
    console.error("Dashboard Analytics Error:", err);
  }
}

// Initialize immediately on load if authorized
if (localStorage.getItem("isAdminLoggedIn") === "true") {
  setTimeout(updateDashboardAnalytics, 500);
}

// Hook into subsequent fetches to keep dashboard fresh
const _originalFetchForDb = window.fetchAppointments;
if (_originalFetchForDb) {
  window.fetchAppointments = async function () {
    await _originalFetchForDb();
    updateDashboardAnalytics();
  };
}
// INVENTORY MANAGEMENT SYSTEM
// ============================
let allInventoryItems = [];
let invCurrentEditId = null;

const invCategoryIcons = {
  Brackets: "git-branch",
  Wires: "cable",
  Elastics: "circle-dot",
  Bonding: "droplet",
  Instruments: "wrench",
  Consumables: "package",
  Retainers: "smile",
  Other: "box"
};

const invCategoryColors = {
  Brackets: { bg: "from-blue-50 to-blue-100", text: "text-blue-600", badge: "bg-blue-100 text-blue-700" },
  Wires: { bg: "from-cyan-50 to-cyan-100", text: "text-cyan-600", badge: "bg-cyan-100 text-cyan-700" },
  Elastics: { bg: "from-pink-50 to-pink-100", text: "text-pink-600", badge: "bg-pink-100 text-pink-700" },
  Bonding: { bg: "from-amber-50 to-amber-100", text: "text-amber-600", badge: "bg-amber-100 text-amber-700" },
  Instruments: { bg: "from-slate-50 to-slate-200", text: "text-slate-600", badge: "bg-slate-200 text-slate-700" },
  Consumables: { bg: "from-emerald-50 to-emerald-100", text: "text-emerald-600", badge: "bg-emerald-100 text-emerald-700" },
  Retainers: { bg: "from-violet-50 to-violet-100", text: "text-violet-600", badge: "bg-violet-100 text-violet-700" },
  Other: { bg: "from-gray-50 to-gray-100", text: "text-gray-600", badge: "bg-gray-200 text-gray-700" }
};

async function fetchInventory() {
  showGlobalLoader();
  try {
    const { data, error } = await sb
      .from("inventory")
      .select("*")
      .order("name", { ascending: true });

    if (error) { console.error("Inventory fetch error:", error); return; }
    allInventoryItems = data || [];
    renderInventory();
    updateInventoryMetrics();
  } catch (err) {
    console.error("Inventory exception:", err);
  } finally {
    hideGlobalLoader();
  }
}

function getStockStatus(qty, minQty) {
  if (qty <= 0) return { label: "Out of Stock", color: "bg-red-100 text-red-700", dot: "bg-red-500" };
  if (qty <= minQty) return { label: "Low Stock", color: "bg-amber-100 text-amber-700", dot: "bg-amber-500" };
  return { label: "In Stock", color: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500" };
}

function renderInventory() {
  const grid = document.getElementById("invItemsGrid");
  const empty = document.getElementById("invEmptyState");
  const countEl = document.getElementById("invItemCount");
  if (!grid) return;

  const searchVal = (document.getElementById("invSearchInput")?.value || "").toLowerCase();
  const catVal = document.getElementById("invCategoryFilter")?.value || "";
  const stockVal = document.getElementById("invStockFilter")?.value || "";

  let filtered = allInventoryItems.filter(item => {
    const matchSearch = !searchVal ||
      (item.name || "").toLowerCase().includes(searchVal) ||
      (item.sku || "").toLowerCase().includes(searchVal) ||
      (item.category || "").toLowerCase().includes(searchVal);
    const matchCat = !catVal || item.category === catVal;
    let matchStock = true;
    if (stockVal === "low") matchStock = item.quantity > 0 && item.quantity <= (item.min_quantity || 5);
    else if (stockVal === "out") matchStock = item.quantity <= 0;
    else if (stockVal === "ok") matchStock = item.quantity > (item.min_quantity || 5);
    return matchSearch && matchCat && matchStock;
  });

  if (countEl) countEl.textContent = filtered.length;

  if (filtered.length === 0) {
    grid.innerHTML = "";
    if (empty) empty.classList.remove("hidden");
    return;
  }
  if (empty) empty.classList.add("hidden");

  grid.innerHTML = filtered.map(item => {
    const stock = getStockStatus(item.quantity, item.min_quantity || 5);
    const catStyle = invCategoryColors[item.category] || invCategoryColors.Other;
    const icon = invCategoryIcons[item.category] || "box";
    const val = (item.quantity || 0) * (item.unit_price || 0);

    return `
      <div class="rounded-[20px] border border-slate-200 bg-white shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 overflow-hidden group">
        <!-- Top accent -->
        <div class="h-1.5 bg-gradient-to-r ${catStyle.bg.replace("from-", "from-").replace("to-", "to-")} w-full"></div>
        <div class="p-5 space-y-3">
          <!-- Header -->
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-10 h-10 rounded-2xl bg-gradient-to-br ${catStyle.bg} flex items-center justify-center shrink-0">
                <i data-lucide="${icon}" class="w-5 h-5 ${catStyle.text}"></i>
              </div>
              <div class="min-w-0">
                <h3 class="text-sm font-bold text-slate-800 truncate">${item.name || "Untitled"}</h3>
                <p class="text-[10px] text-slate-400 font-mono">${item.sku || "—"}</p>
              </div>
            </div>
            <!-- Actions -->
            <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onclick="openInvEditModal('${item.id}')" class="w-7 h-7 rounded-lg bg-slate-100 hover:bg-blue-100 flex items-center justify-center transition-colors" title="Edit">
                <i data-lucide="pencil" class="w-3.5 h-3.5 text-slate-500 hover:text-blue-600"></i>
              </button>
              <button onclick="deleteInventoryItem('${item.id}')" class="w-7 h-7 rounded-lg bg-slate-100 hover:bg-red-100 flex items-center justify-center transition-colors" title="Delete">
                <i data-lucide="trash-2" class="w-3.5 h-3.5 text-slate-500 hover:text-red-600"></i>
              </button>
            </div>
          </div>

          <!-- Category Badge -->
          <span class="inline-block px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-widest ${catStyle.badge}">${item.category || "Other"}</span>

          <!-- Stats Row -->
          <div class="grid grid-cols-2 gap-2">
            <div class="rounded-xl bg-slate-50 p-2.5 text-center">
              <p class="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Qty</p>
              <p class="text-lg font-black text-slate-800">${item.quantity ?? 0}</p>
              <p class="text-[9px] text-slate-400">${item.unit || "pcs"}</p>
            </div>
            <div class="rounded-xl bg-slate-50 p-2.5 text-center">
              <p class="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Value</p>
              <p class="text-lg font-black text-slate-800">₱${val.toLocaleString()}</p>
              <p class="text-[9px] text-slate-400">@ ₱${(item.unit_price || 0).toLocaleString()}</p>
            </div>
          </div>

          <!-- Stock Status Bar -->
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full ${stock.dot} shrink-0"></span>
            <span class="text-[10px] font-bold ${stock.color} px-2 py-0.5 rounded-full">${stock.label}</span>
            ${item.quantity <= (item.min_quantity || 5) && item.quantity > 0 ? `<span class="text-[9px] text-amber-500 ml-auto">Min: ${item.min_quantity || 5}</span>` : ""}
          </div>

          <!-- Quick Stock Adjust -->
          <div class="flex items-center gap-2 pt-1 border-t border-slate-50">
            <button onclick="event.stopPropagation(); adjustStock('${item.id}', -1)" class="w-8 h-8 rounded-xl border border-slate-200 hover:border-red-300 hover:bg-red-50 flex items-center justify-center transition-all active:scale-90" title="Remove 1">
              <i data-lucide="minus" class="w-3.5 h-3.5 text-slate-500"></i>
            </button>
            <div class="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
              <div class="h-full rounded-full transition-all duration-500 ${item.quantity <= 0 ? 'bg-red-400 w-0' : item.quantity <= (item.min_quantity || 5) ? 'bg-amber-400' : 'bg-emerald-400'}" style="width: ${Math.min(100, (item.quantity / Math.max(item.min_quantity * 3 || 15, 1)) * 100)}%"></div>
            </div>
            <button onclick="event.stopPropagation(); adjustStock('${item.id}', 1)" class="w-8 h-8 rounded-xl border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 flex items-center justify-center transition-all active:scale-90" title="Add 1">
              <i data-lucide="plus" class="w-3.5 h-3.5 text-slate-500"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  if (window.lucide) window.lucide.createIcons();
}

function updateInventoryMetrics() {
  const total = allInventoryItems.length;
  const low = allInventoryItems.filter(i => i.quantity > 0 && i.quantity <= (i.min_quantity || 5)).length;
  const outOfStock = allInventoryItems.filter(i => i.quantity <= 0).length;
  const cats = new Set(allInventoryItems.map(i => i.category).filter(Boolean)).size;
  const value = allInventoryItems.reduce((s, i) => s + ((i.quantity || 0) * (i.unit_price || 0)), 0);

  const el = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  el("invMetricTotal", total);
  el("invMetricLow", low + outOfStock);
  el("invMetricCats", cats);
  el("invMetricValue", "₱" + value.toLocaleString());
}

// Auto-generate SKU based on category
function generateSku(category) {
  const prefixMap = {
    'Brackets': 'BRK',
    'Wires': 'WIR',
    'Elastics': 'ELS',
    'Bonding': 'BND',
    'Instruments': 'INS',
    'Consumables': 'CON',
    'Retainers': 'RET',
    'Other': 'OTH'
  };
  const prefix = prefixMap[category] || 'ITM';

  // Find the highest existing number for this prefix
  let maxNum = 0;
  allInventoryItems.forEach(item => {
    if (item.sku && item.sku.startsWith(prefix + '-')) {
      const num = parseInt(item.sku.split('-')[1], 10);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    }
  });

  return `${prefix}-${String(maxNum + 1).padStart(3, '0')}`;
}

// Open Add Modal
function openInvAddModal() {
  invCurrentEditId = null;
  const title = document.getElementById("invModalTitle");
  if (title) title.textContent = "Add New Item";
  document.getElementById("invItemId").value = "";
  document.getElementById("invItemName").value = "";
  document.getElementById("invItemSku").value = generateSku("");
  document.getElementById("invItemCategory").value = "";
  document.getElementById("invItemQty").value = "";
  document.getElementById("invItemMinQty").value = "5";
  document.getElementById("invItemUnit").value = "";
  document.getElementById("invItemPrice").value = "";
  document.getElementById("invItemNotes").value = "";

  // Make SKU readonly for new items (auto-generated)
  const skuInput = document.getElementById("invItemSku");
  skuInput.readOnly = true;
  skuInput.classList.add("bg-slate-100", "text-slate-500");

  document.getElementById("invItemModal").classList.remove("hidden");
  if (window.lucide) window.lucide.createIcons();

  // Re-generate SKU when category changes
  const catSelect = document.getElementById("invItemCategory");
  catSelect._skuHandler = function () {
    if (!invCurrentEditId) {
      document.getElementById("invItemSku").value = generateSku(this.value);
    }
  };
  catSelect.addEventListener("change", catSelect._skuHandler);
}

// Open Edit Modal
window.openInvEditModal = function (id) {
  const item = allInventoryItems.find(i => String(i.id) === String(id));
  if (!item) return;
  invCurrentEditId = id;
  const title = document.getElementById("invModalTitle");
  if (title) title.textContent = "Edit Item";
  document.getElementById("invItemId").value = id;
  document.getElementById("invItemName").value = item.name || "";
  document.getElementById("invItemSku").value = item.sku || "";
  document.getElementById("invItemCategory").value = item.category || "";
  document.getElementById("invItemQty").value = item.quantity ?? "";
  document.getElementById("invItemMinQty").value = item.min_quantity ?? 5;
  document.getElementById("invItemUnit").value = item.unit || "";
  document.getElementById("invItemPrice").value = item.unit_price ?? "";
  document.getElementById("invItemNotes").value = item.notes || "";

  // Allow SKU editing for existing items
  const skuInput = document.getElementById("invItemSku");
  skuInput.readOnly = false;
  skuInput.classList.remove("bg-slate-100", "text-slate-500");

  document.getElementById("invItemModal").classList.remove("hidden");
  if (window.lucide) window.lucide.createIcons();
};

function closeInvModal() {
  document.getElementById("invItemModal").classList.add("hidden");
  invCurrentEditId = null;
}

// Save (create or update)
async function saveInventoryItem(e) {
  e.preventDefault();
  const payload = {
    name: document.getElementById("invItemName").value.trim(),
    sku: document.getElementById("invItemSku").value.trim(),
    category: document.getElementById("invItemCategory").value,
    quantity: parseInt(document.getElementById("invItemQty").value) || 0,
    min_quantity: parseInt(document.getElementById("invItemMinQty").value) || 5,
    unit: document.getElementById("invItemUnit").value.trim() || "pcs",
    unit_price: parseFloat(document.getElementById("invItemPrice").value) || 0,
    notes: document.getElementById("invItemNotes").value.trim()
  };

  try {
    if (invCurrentEditId) {
      const { error } = await sb.from("inventory").update(payload).eq("id", invCurrentEditId);
      if (error) throw error;
    } else {
      const { error } = await sb.from("inventory").insert([payload]);
      if (error) throw error;
    }
    const msg = document.getElementById("invFormMsg");
    if (msg) { msg.classList.remove("hidden"); setTimeout(() => msg.classList.add("hidden"), 2000); }
    closeInvModal();
    await fetchInventory();
  } catch (err) {
    console.error("Save inventory error:", err);
    alert("Failed to save item. " + (err.message || ""));
  }
}

// Delete
window.deleteInventoryItem = async function (id) {
  console.log("Delete request received for ID:", id);
  if (!confirm("Are you sure you want to delete this inventory item?")) return;

  try {
    // Attempt to move to recycle bin (non-blocking)
    try {
      const { data: invData, error: fetchErr } = await sb.from("inventory").select("*").eq("id", id).single();
      if (fetchErr) console.warn("Fetch for recycle bin failed:", fetchErr);
      if (invData) {
        await moveToRecycleBin('inventory', invData);
      }
    } catch (binErr) {
      console.warn("Recycle bin move failed, proceeding with delete:", binErr);
    }

    // Perform actual deletion
    const { error } = await sb.from("inventory").delete().eq("id", id);
    if (error) throw error;

    await fetchInventory();
  } catch (err) {
    console.error("Delete inventory error:", err);
    alert("Failed to delete item: " + (err.message || "Unknown error") + "\n\nPlease ensure the 'recycle_bin' table is created in Supabase.");
  }
};

// Quick stock adjust (+/- 1)
window.adjustStock = async function (id, delta) {
  const item = allInventoryItems.find(i => String(i.id) === String(id));
  if (!item) {
    console.error("Item not found for adjustment:", id);
    return;
  }
  const newQty = Math.max(0, (item.quantity || 0) + delta);
  try {
    const { error } = await sb.from("inventory").update({ quantity: newQty }).eq("id", id);
    if (error) throw error;
    item.quantity = newQty;
    renderInventory();
    updateInventoryMetrics();
  } catch (err) {
    console.error("Stock adjust error:", err);
  }
};

// Wire up events
document.addEventListener("DOMContentLoaded", () => {
  const addBtn = document.getElementById("invAddItemBtn");
  const closeBtn = document.getElementById("invCloseModalBtn");
  const cancelBtn = document.getElementById("invCancelBtn");
  const form = document.getElementById("invItemForm");
  const searchInput = document.getElementById("invSearchInput");
  const catFilter = document.getElementById("invCategoryFilter");
  const stockFilter = document.getElementById("invStockFilter");

  if (addBtn) addBtn.addEventListener("click", openInvAddModal);
  if (closeBtn) closeBtn.addEventListener("click", closeInvModal);
  if (cancelBtn) cancelBtn.addEventListener("click", closeInvModal);
  if (form) form.addEventListener("submit", saveInventoryItem);
  if (searchInput) searchInput.addEventListener("input", renderInventory);
  if (catFilter) catFilter.addEventListener("change", renderInventory);
  if (stockFilter) stockFilter.addEventListener("change", renderInventory);
});

// Auto-load inventory when navigating to inventory page
const _origSetActivePage = setActivePage;
setActivePage = function (pageKey) {
  _origSetActivePage(pageKey);
  if (pageKey === "inventory" && allInventoryItems.length === 0) {
    fetchInventory();
  }
  if (pageKey === "payroll" && allPayrollRecords.length === 0) {
    fetchPayroll();
  }
};

// ============================
// PAYROLL MANAGEMENT SYSTEM
// ============================
let allPayrollRecords = [];
let payCurrentEditId = null;

async function fetchPayroll() {
  try {
    // 1. Ensure staff data is fetched so we accurately know who the workers are from the staff user account
    if (typeof allStaffData === 'undefined' || allStaffData.length === 0) {
      if (typeof fetchStaff === 'function') {
        await fetchStaff();
      }
    }

    const { data, error } = await sb
      .from("payroll")
      .select("*")
      .order("pay_period", { ascending: false });

    if (error) { console.error("Payroll fetch error:", error); return; }

    let rawRecords = data || [];
    let processedRecords = [];

    // Rigorously enforce the role based on the staff user account AND auto-generate records if empty
    if (typeof allStaffData !== 'undefined' && allStaffData.length > 0) {
      const nurses = allStaffData.filter(s => {
        const role = (s.role || "").toLowerCase();
        return (role.includes("nurse") || role === "staff") && !role.includes("doctor") && !role.includes("dr.");
      });

      const currentPeriod = new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, "0");

      nurses.forEach(nurse => {
        const dbRecords = rawRecords.filter(r => (r.staff_name || "").toLowerCase() === (nurse.name || "").toLowerCase());

        if (dbRecords.length > 0) {
          processedRecords.push(...dbRecords);
        } else {
          // If they have NO records at all in the DB, show an auto-generated dummy record so they appear on the page
          processedRecords.push({
            id: 'dummy_' + nurse.id,
            staff_name: nurse.name,
            pay_period: currentPeriod,
            base_salary: 0,
            days_worked: 0,
            overtime_hours: 0,
            bonus: 0,
            deductions: 0,
            net_pay: 0,
            status: 'pending',
            notes: 'Auto-generated from Accounts. Click Edit to setup.'
          });
        }
      });
      allPayrollRecords = processedRecords;
    } else {
      // Fallback: exclude obvious doctor names if staff array lookup fails somehow
      allPayrollRecords = rawRecords.filter(r => {
        const name = (r.staff_name || "").toLowerCase();
        if (name.includes("dr.") || name.includes("doctor") || name.includes("santos") || name.includes("reyes")) {
          return false;
        }
        return true;
      });
    }

    populatePayPeriodFilter();
    populatePayStaffDropdown();
    renderPayroll();
    updatePayrollMetrics();
  } catch (err) {
    console.error("Payroll exception:", err);
  }
}

function populatePayPeriodFilter() {
  const sel = document.getElementById("payPeriodFilter");
  if (!sel) return;
  const periods = [...new Set(allPayrollRecords.map(r => r.pay_period).filter(Boolean))].sort().reverse();
  const current = sel.value;
  sel.innerHTML = `<option value="">All Periods</option>` + periods.map(p => {
    const d = new Date(p + "-01");
    const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    return `<option value="${p}" ${current === p ? 'selected' : ''}>${label}</option>`;
  }).join("");
}

function populatePayStaffDropdown() {
  const sel = document.getElementById("payStaffName");
  if (!sel) return;
  let html = `<option value="">Select staff member...</option>`;
  if (typeof allStaffData !== 'undefined' && allStaffData.length > 0) {
    // Filter to include only nurses and exclude doctors
    const nurses = allStaffData.filter(s => {
      const role = (s.role || "").toLowerCase();
      // Ensure the role is staff/nurse and explicitly NOT a doctor
      return (role.includes("nurse") || role === "staff") && !role.includes("doctor") && !role.includes("dr.");
    });
    nurses.forEach(s => {
      html += `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)} (${s.role || 'staff'})</option>`;
    });
  }
  sel.innerHTML = html;
}

function getPayStatus(status) {
  if (status === "paid") return { label: "Paid", color: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500", icon: "check-circle" };
  if (status === "partial") return { label: "Partial", color: "bg-amber-100 text-amber-700", dot: "bg-amber-500", icon: "alert-circle" };
  return { label: "Pending", color: "bg-slate-100 text-slate-600", dot: "bg-slate-400", icon: "clock" };
}

function computeNetPay(base, overtime, bonus, deductions) {
  const overtimePay = (overtime || 0) * ((base || 0) / 22 / 8) * 1.25;
  return (base || 0) + overtimePay + (bonus || 0) - (deductions || 0);
}

function renderPayroll() {
  const grid = document.getElementById("payRecordsGrid");
  const empty = document.getElementById("payEmptyState");
  const countEl = document.getElementById("payRecordCount");
  if (!grid) return;

  const searchVal = (document.getElementById("paySearchInput")?.value || "").toLowerCase();
  const periodVal = document.getElementById("payPeriodFilter")?.value || "";
  const statusVal = document.getElementById("payStatusFilter")?.value || "";

  let filtered = allPayrollRecords.filter(r => {
    const matchSearch = !searchVal || (r.staff_name || "").toLowerCase().includes(searchVal);
    const matchPeriod = !periodVal || r.pay_period === periodVal;
    const matchStatus = !statusVal || r.status === statusVal;
    return matchSearch && matchPeriod && matchStatus;
  });

  if (countEl) countEl.textContent = filtered.length;

  if (filtered.length === 0) {
    grid.innerHTML = "";
    if (empty) empty.classList.remove("hidden");
    return;
  }
  if (empty) empty.classList.add("hidden");

  grid.innerHTML = filtered.map(r => {
    const st = getPayStatus(r.status);
    const net = computeNetPay(r.base_salary, r.overtime_hours, r.bonus, r.deductions);
    const overtimePay = (r.overtime_hours || 0) * ((r.base_salary || 0) / 22 / 8) * 1.25;
    const periodLabel = r.pay_period ? new Date(r.pay_period + "-01").toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "—";

    return `
      <div onclick="openPayEditModal('${r.id}')" class="cursor-pointer rounded-[20px] border border-slate-200 bg-white shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 overflow-hidden group">
        <div class="h-1.5 bg-gradient-to-r from-purple-400 to-indigo-500 w-full"></div>
        <div class="p-5 space-y-3">
          <!-- Header -->
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-10 h-10 rounded-2xl bg-gradient-to-br from-purple-100 to-indigo-100 flex items-center justify-center shrink-0">
                <i data-lucide="user" class="w-5 h-5 text-purple-600"></i>
              </div>
              <div class="min-w-0">
                <h3 class="text-sm font-bold text-slate-800 truncate">${escapeHtml(r.staff_name || "Unknown")}</h3>
                <p class="text-[10px] text-slate-400 font-semibold">${periodLabel}</p>
              </div>
            </div>
            <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onclick="event.stopPropagation(); deletePayrollRecord('${r.id}')" class="w-7 h-7 rounded-lg bg-slate-100 hover:bg-red-100 flex items-center justify-center transition-colors" title="Delete">
                <i data-lucide="trash-2" class="w-3.5 h-3.5 text-slate-500"></i>
              </button>
            </div>
          </div>

          <!-- Status -->
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full ${st.dot}"></span>
            <span class="text-[10px] font-bold ${st.color} px-2 py-0.5 rounded-full">${st.label}</span>
            ${r.days_worked ? `<span class="text-[9px] text-slate-400 ml-auto">${r.days_worked} days worked</span>` : ''}
          </div>

          <!-- Earnings Breakdown -->
          <div class="rounded-xl bg-slate-50 p-3 space-y-1.5">
            <div class="flex justify-between text-[11px]"><span class="text-slate-500">Base Salary</span><span class="font-bold text-slate-700">₱${(r.base_salary || 0).toLocaleString()}</span></div>
            ${r.overtime_hours > 0 ? `<div class="flex justify-between text-[11px]"><span class="text-slate-500">Overtime (${r.overtime_hours}h)</span><span class="font-bold text-blue-600">+₱${overtimePay.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>` : ''}
            ${r.bonus > 0 ? `<div class="flex justify-between text-[11px]"><span class="text-slate-500">Bonus</span><span class="font-bold text-emerald-600">+₱${(r.bonus).toLocaleString()}</span></div>` : ''}
            ${r.deductions > 0 ? `<div class="flex justify-between text-[11px]"><span class="text-slate-500">Deductions</span><span class="font-bold text-red-500">-₱${(r.deductions).toLocaleString()}</span></div>` : ''}
          </div>

          <!-- Net Pay -->
          <div class="flex items-center justify-between pt-2 border-t border-slate-100">
            <span class="text-[10px] font-bold uppercase tracking-widest text-slate-400">Net Pay</span>
            <span class="text-lg font-black text-purple-700">₱${net.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
        </div>
      </div>
    `;
  }).join("");

  if (window.lucide) window.lucide.createIcons();
}

function updatePayrollMetrics() {
  const totalNet = allPayrollRecords.reduce((s, r) => s + computeNetPay(r.base_salary, r.overtime_hours, r.bonus, r.deductions), 0);
  const paid = allPayrollRecords.filter(r => r.status === "paid").length;
  const pending = allPayrollRecords.filter(r => r.status === "pending" || r.status === "partial").length;
  const avg = allPayrollRecords.length > 0 ? totalNet / allPayrollRecords.length : 0;

  const el = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  el("payMetricTotal", "₱" + totalNet.toLocaleString(undefined, { maximumFractionDigits: 0 }));
  el("payMetricPaid", paid);
  el("payMetricAvg", "₱" + avg.toLocaleString(undefined, { maximumFractionDigits: 0 }));
  el("payMetricPending", pending);
}

function updateNetPayPreview() {
  const base = parseFloat(document.getElementById("payBaseSalary")?.value) || 0;
  const ot = parseFloat(document.getElementById("payOvertimeHrs")?.value) || 0;
  const bonus = parseFloat(document.getElementById("payBonus")?.value) || 0;
  const ded = parseFloat(document.getElementById("payDeductions")?.value) || 0;
  const net = computeNetPay(base, ot, bonus, ded);
  const preview = document.getElementById("payNetPreview");
  if (preview) preview.textContent = "₱" + net.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function openPayAddModal() {
  payCurrentEditId = null;
  const title = document.getElementById("payModalTitle");
  if (title) title.textContent = "Add Payroll Record";
  document.getElementById("payRecordId").value = "";
  document.getElementById("payStaffName").value = "";
  const now = new Date();
  document.getElementById("payPeriod").value = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  document.getElementById("payHourlyRate").value = "0.00";
  document.getElementById("payBaseSalary").value = "";
  document.getElementById("payDaysWorked").value = "";
  document.getElementById("payOvertimeHrs").value = "0";
  document.getElementById("payBonus").value = "0";
  document.getElementById("payDeductions").value = "0";
  document.getElementById("payStatus").value = "pending";
  document.getElementById("payNotes").value = "";
  document.getElementById("payNetPreview").textContent = "₱0.00";
  const btnPdf = document.getElementById("payExportPdfBtn");
  if (btnPdf) btnPdf.classList.add("hidden");
  populatePayStaffDropdown();
  document.getElementById("payRecordModal").classList.remove("hidden");
  if (window.lucide) window.lucide.createIcons();
}

window.openPayEditModal = function (id) {
  const r = allPayrollRecords.find(x => String(x.id) === String(id));
  if (!r) return;
  payCurrentEditId = id;
  const title = document.getElementById("payModalTitle");
  if (title) title.textContent = "Edit Payroll Record";
  populatePayStaffDropdown();

  if (String(id).startsWith('dummy_')) {
    document.getElementById("payRecordId").value = "";
  } else {
    document.getElementById("payRecordId").value = id;
  }

  // Find hourly rate from staff DB
  const staffObj = allStaffData.find(s => s.name === r.staff_name);
  const hourly_rate = staffObj ? (staffObj.hourly_rate || 0) : 0;

  document.getElementById("payStaffName").value = r.staff_name || "";
  document.getElementById("payPeriod").value = r.pay_period || "";
  document.getElementById("payHourlyRate").value = hourly_rate;
  document.getElementById("payBaseSalary").value = r.base_salary ?? "";
  document.getElementById("payDaysWorked").value = r.days_worked ?? "";
  document.getElementById("payOvertimeHrs").value = r.overtime_hours ?? 0;
  document.getElementById("payBonus").value = r.bonus ?? 0;
  document.getElementById("payDeductions").value = r.deductions ?? 0;
  document.getElementById("payStatus").value = r.status || "pending";
  document.getElementById("payNotes").value = r.notes || "";
  updateNetPayPreview();

  const btnPdf = document.getElementById("payExportPdfBtn");
  if (btnPdf) {
    if (String(id).startsWith('dummy_')) btnPdf.classList.add("hidden");
    else btnPdf.classList.remove("hidden");
  }

  document.getElementById("payRecordModal").classList.remove("hidden");
  if (window.lucide) window.lucide.createIcons();
};

function closePayModal() {
  document.getElementById("payRecordModal").classList.add("hidden");
  payCurrentEditId = null;
}

async function savePayrollRecord(e) {
  e.preventDefault();
  const base = parseFloat(document.getElementById("payBaseSalary").value) || 0;
  const ot = parseFloat(document.getElementById("payOvertimeHrs").value) || 0;
  const bonus = parseFloat(document.getElementById("payBonus").value) || 0;
  const ded = parseFloat(document.getElementById("payDeductions").value) || 0;
  const hourlyRate = parseFloat(document.getElementById("payHourlyRate").value) || 0;
  const staffName = document.getElementById("payStaffName").value;

  const payload = {
    staff_name: staffName,
    pay_period: document.getElementById("payPeriod").value,
    base_salary: base,
    days_worked: parseInt(document.getElementById("payDaysWorked").value) || 0,
    overtime_hours: ot,
    bonus: bonus,
    deductions: ded,
    net_pay: computeNetPay(base, ot, bonus, ded),
    status: document.getElementById("payStatus").value,
    notes: document.getElementById("payNotes").value.trim()
  };

  try {
    // 1. Update Staff Hourly Rate if changed
    const staffRec = allStaffData.find(s => s.name === staffName);
    if (staffRec && hourlyRate !== staffRec.hourly_rate) {
      await sb.from("clinic_staff").update({ hourly_rate: hourlyRate }).eq("name", staffName);
      staffRec.hourly_rate = hourlyRate; // update local cache
    }

    if (payCurrentEditId && !String(payCurrentEditId).startsWith('dummy_')) {
      const { error } = await sb.from("payroll").update(payload).eq("id", payCurrentEditId);
      if (error) throw error;
    } else {
      const { error } = await sb.from("payroll").insert([payload]);
      if (error) throw error;
    }
    const msg = document.getElementById("payFormMsg");
    if (msg) { msg.classList.remove("hidden"); setTimeout(() => msg.classList.add("hidden"), 2000); }
    closePayModal();
    await fetchPayroll();
  } catch (err) {
    console.error("Save payroll error:", err);
    alert("Failed to save record. " + (err.message || ""));
  }
}

window.deletePayrollRecord = async function (id) {
  if (String(id).startsWith("dummy_")) {
    alert("This is an auto-generated row for a Staff member. They don't have a database record yet, so nothing can be deleted.");
    return;
  }
  if (!confirm("Delete this payroll record?")) return;
  try {
    // Non-blocking recycle bin attempt
    try {
      const { data: payData } = await sb.from("payroll").select("*").eq("id", id).single();
      if (payData) await moveToRecycleBin('payroll', payData);
    } catch (binErr) {
      console.warn("Recycle bin move failed for payroll:", binErr);
    }

    const { error } = await sb.from("payroll").delete().eq("id", id);
    if (error) throw error;
    await fetchPayroll();
  } catch (err) {
    console.error("Delete payroll error:", err);
    alert("Failed to delete record.");
  }
};

// Wire up payroll events
document.addEventListener("DOMContentLoaded", () => {
  const addBtn = document.getElementById("payAddRecordBtn");
  const closeBtn = document.getElementById("payCloseModalBtn");
  const cancelBtn = document.getElementById("payCancelBtn");
  const form = document.getElementById("payRecordForm");
  const search = document.getElementById("paySearchInput");
  const periodFilter = document.getElementById("payPeriodFilter");
  const statusFilter = document.getElementById("payStatusFilter");

  if (addBtn) addBtn.addEventListener("click", openPayAddModal);
  if (closeBtn) closeBtn.addEventListener("click", closePayModal);
  if (cancelBtn) cancelBtn.addEventListener("click", closePayModal);
  if (form) form.addEventListener("submit", savePayrollRecord);
  if (search) search.addEventListener("input", renderPayroll);
  if (periodFilter) periodFilter.addEventListener("change", renderPayroll);
  if (statusFilter) statusFilter.addEventListener("change", renderPayroll);

  const pdfBtn = document.getElementById("payExportPdfBtn");
  if (pdfBtn) {
    pdfBtn.addEventListener("click", () => {
      if (!payCurrentEditId || String(payCurrentEditId).startsWith('dummy_')) return alert("Please save the record first before exporting!");

      const r = allPayrollRecords.find(x => String(x.id) === String(payCurrentEditId));
      if (!r) return;

      const staffObj = allStaffData.find(s => s.name === r.staff_name);
      const hourly_rate = staffObj ? (staffObj.hourly_rate || 0) : 0;
      const net = computeNetPay(r.base_salary, r.overtime_hours, r.bonus, r.deductions);
      const overtimePay = (r.overtime_hours || 0) * ((r.base_salary || 0) / 22 / 8) * 1.25;

      const pdfContent = document.createElement("div");
      pdfContent.innerHTML = `
            <div style="padding: 40px; font-family: 'Inter', sans-serif; color: #334155; line-height: 1.6;">
              <div style="text-align: center; margin-bottom: 30px;">
                <h1 style="margin:0; font-size: 24px; color: #4f46e5;">OrthoConnect Clinic</h1>
                <p style="margin:0; color: #64748b; font-size: 14px;">STAFF PAYSLIP</p>
              </div>
              
              <div style="display: flex; justify-content: space-between; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid #e2e8f0;">
                <div>
                  <p style="margin:0; font-size: 12px; color: #94a3b8; text-transform: uppercase;">Staff Name</p>
                  <p style="margin:0; font-size: 16px; font-weight: bold;">${r.staff_name}</p>
                </div>
                <div style="text-align: right;">
                  <p style="margin:0; font-size: 12px; color: #94a3b8; text-transform: uppercase;">Pay Period</p>
                  <p style="margin:0; font-size: 16px; font-weight: bold;">${r.pay_period}</p>
                </div>
              </div>

              <div style="margin-bottom: 20px;">
                <table style="width: 100%; border-collapse: collapse;">
                  <tbody>
                    <tr><td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9;">Days Worked</td><td style="padding: 8px 0; text-align: right; border-bottom: 1px solid #f1f5f9;">${r.days_worked || 0}</td></tr>
                    <tr><td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9;">Hourly Rate</td><td style="padding: 8px 0; text-align: right; border-bottom: 1px solid #f1f5f9;">PHP ${hourly_rate.toFixed(2)}</td></tr>
                  </tbody>
                </table>
              </div>

              <div style="margin-bottom: 20px;">
                <h3 style="margin: 0 0 10px 0; font-size: 13px; text-transform: uppercase; color: #94a3b8;">Earnings</h3>
                <table style="width: 100%; border-collapse: collapse;">
                  <tbody>
                    <tr><td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9;">Gross Base Salary</td><td style="padding: 8px 0; text-align: right; border-bottom: 1px solid #f1f5f9; font-weight: bold;">PHP ${(r.base_salary || 0).toFixed(2)}</td></tr>
                    <tr><td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9;">Overtime (${r.overtime_hours || 0}h)</td><td style="padding: 8px 0; text-align: right; border-bottom: 1px solid #f1f5f9;">PHP ${overtimePay.toFixed(2)}</td></tr>
                    <tr><td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9;">Bonus</td><td style="padding: 8px 0; text-align: right; border-bottom: 1px solid #f1f5f9;">PHP ${(r.bonus || 0).toFixed(2)}</td></tr>
                  </tbody>
                </table>
              </div>

              <div style="margin-bottom: 20px;">
                <h3 style="margin: 0 0 10px 0; font-size: 13px; text-transform: uppercase; color: #94a3b8;">Deductions</h3>
                <table style="width: 100%; border-collapse: collapse;">
                  <tbody>
                    <tr><td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9; color: #ef4444;">Other Deductions (e.g., Lates)</td><td style="padding: 8px 0; text-align: right; border-bottom: 1px solid #f1f5f9; color: #ef4444;">-PHP ${(r.deductions || 0).toFixed(2)}</td></tr>
                  </tbody>
                </table>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center; padding: 15px; background: #f8fafc; border-radius: 8px; margin-top: 20px;">
                <span style="font-size: 14px; font-weight: bold; color: #475569;">NET PAY</span>
                <span style="font-size: 20px; font-weight: 900; color: #4f46e5;">PHP ${net.toFixed(2)}</span>
              </div>
              
              <div style="margin-top: 40px; text-align: center; color: #94a3b8; font-size: 10px;">
                <p>This is a system-generated payslip. No signature is required.</p>
                <p>Status: ${r.status.toUpperCase()}</p>
              </div>
            </div>
          `;

      const sanitizeName = (r.staff_name || "Staff").replace(/\s+/g, '_');
      const opt = {
        margin: 10,
        filename: `Payslip_${sanitizeName}_${r.pay_period}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };

      btnOriginalHtml = pdfBtn.innerHTML;
      pdfBtn.innerHTML = '<i class="lucide-loader-2 w-4 h-4 animate-spin"></i>';

      html2pdf().set(opt).from(pdfContent).save().then(() => {
        pdfBtn.innerHTML = btnOriginalHtml;
      });
    });
  }

  async function autoComputePayroll() {
    const staffName = document.getElementById("payStaffName")?.value;
    const periodStr = document.getElementById("payPeriod")?.value;
    if (!staffName || !periodStr) return; // Do not alert, just quietly return if both aren't set yet.

    try {
      const [year, month] = periodStr.split("-");
      const lastDay = new Date(year, month, 0).getDate();
      const lastDayStr = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
      const firstDay = periodStr + "-01";

      const { data: attData, error } = await sb.from("attendance")
        .select("*")
        .eq("staff_name", staffName)
        .gte("date", firstDay)
        .lte("date", lastDayStr);

      if (error) throw error;

      let totalMinutes = 0;
      let workedDays = 0;
      let lates = 0;

      (attData || []).forEach(r => {
        if (r.status === "present" || r.status === "late") {
          workedDays++;
          if (r.status === "late") lates++;
          if (r.clock_in && r.clock_out) {
            const [h1, m1] = r.clock_in.split(":").map(Number);
            const [h2, m2] = r.clock_out.split(":").map(Number);
            const mins = (h2 * 60 + m2) - (h1 * 60 + m1);
            if (mins > 0) totalMinutes += mins;
          }
        }
      });

      const hrRate = parseFloat(document.getElementById("payHourlyRate").value) || 0;
      const grossPay = (totalMinutes / 60) * hrRate;

      document.getElementById("payDaysWorked").value = workedDays;
      document.getElementById("payBaseSalary").value = grossPay.toFixed(2);
      document.getElementById("payDeductions").value = (lates * 50).toFixed(2);

      updateNetPayPreview();
    } catch (err) {
      console.error("Auto-compute failed:", err);
    }
  }

  const staffNameSelect = document.getElementById("payStaffName");
  if (staffNameSelect) {
    staffNameSelect.addEventListener("change", (e) => {
      const staffRec = allStaffData.find(s => s.name === e.target.value);
      if (staffRec && staffRec.hourly_rate) {
        document.getElementById("payHourlyRate").value = staffRec.hourly_rate;
      }
      autoComputePayroll();
    });
  }

  const payPeriodEl = document.getElementById("payPeriod");
  if (payPeriodEl) {
    payPeriodEl.addEventListener("change", autoComputePayroll);
  }

  const payHourlyRateEl = document.getElementById("payHourlyRate");
  if (payHourlyRateEl) {
    payHourlyRateEl.addEventListener("input", () => {
      // Re-compute base salary based on new hourly rate automatically
      const grossPay = parseFloat(document.getElementById("payBaseSalary").value) || 0;
      if (grossPay > 0 || document.getElementById("payDaysWorked").value) {
        autoComputePayroll();
      }
    });
  }

  // Live net pay preview
  ["payBaseSalary", "payOvertimeHrs", "payBonus", "payDeductions"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", updateNetPayPreview);
  });
});

// ============================
// ATTENDANCE MANAGEMENT SYSTEM
// ============================

let allAttendanceRecords = [];
let attCalMonth = new Date().getMonth();
let attCalYear = new Date().getFullYear();
let attLiveClockInterval = null;

function getTodayStr() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function getWeekStart() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day;
  const start = new Date(d.setDate(diff));
  return start.getFullYear() + "-" + String(start.getMonth() + 1).padStart(2, "0") + "-" + String(start.getDate()).padStart(2, "0");
}

function formatTime12h(time24) {
  if (!time24) return "—";
  const [h, m] = time24.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12.toString().padStart(2, '0')}:${m} ${ampm}`;
}

function formatAptTimeRange(time24, durationMins) {
  if (!time24 || time24 === "—" || time24 === "00:00:00" || time24 === "00:00") return "—";
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
  if (mins <= 0) return "—";
  const hrs = Math.floor(mins / 60);
  const rm = mins % 60;
  return `${hrs}h ${rm}m`;
}

function attStatusPill(status) {
  const map = {
    present: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500", label: "Present" },
    late: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500", label: "Late" },
    absent: { bg: "bg-red-50", text: "text-red-600", dot: "bg-red-500", label: "Absent" },
    "half-day": { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500", label: "Half Day" },
    "on-leave": { bg: "bg-violet-50", text: "text-violet-700", dot: "bg-violet-500", label: "On Leave" },
    "leave-pending": { bg: "bg-pink-50", text: "text-pink-700", dot: "bg-pink-500", label: "Leave Pending" },
    "leave-denied": { bg: "bg-slate-50", text: "text-slate-500", dot: "bg-slate-400", label: "Leave Denied" }
  };
  const s = map[status] || map["present"];
  return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${s.bg} ${s.text} text-[10px] font-black uppercase tracking-widest">
    <span class="w-1.5 h-1.5 rounded-full ${s.dot}"></span>${s.label}</span>`;
}

// ---- Fetch all attendance records ----
async function fetchAttendance() {
  try {
    const { data, error } = await sb.from("attendance").select("*").order("date", { ascending: false }).order("clock_in", { ascending: false });
    if (error) throw error;
    allAttendanceRecords = data || [];
  } catch (err) {
    console.error("Error fetching attendance:", err);
    allAttendanceRecords = [];
  }
}

// ---- Render attendance table ----
function renderAttendanceTable() {
  const body = document.getElementById("attendanceBody");
  const countEl = document.getElementById("attLogCount");
  const searchVal = (document.getElementById("attSearchInput")?.value || "").toLowerCase();
  const dateVal = document.getElementById("attFilterDate")?.value || "";
  const statusVal = document.getElementById("attFilterStatus")?.value || "";

  let filtered = allAttendanceRecords.filter(r => {
    if (searchVal && !(r.staff_name || "").toLowerCase().includes(searchVal)) return false;
    if (dateVal && r.date !== dateVal) return false;
    if (statusVal && r.status !== statusVal) return false;
    return true;
  });

  if (countEl) countEl.textContent = `${filtered.length} Record${filtered.length !== 1 ? "s" : ""}`;

  if (filtered.length === 0) {
    body.innerHTML = `
      <tr>
        <td colspan="7" class="text-center py-16">
          <div class="flex flex-col items-center gap-3">
            <div class="w-16 h-16 rounded-[24px] bg-teal-50 flex items-center justify-center">
              <i data-lucide="scan-line" class="w-8 h-8 text-teal-300"></i>
            </div>
            <p class="text-sm font-black text-slate-600">No attendance records found</p>
            <p class="text-[11px] font-medium text-slate-400">Try adjusting your filters or clock in a staff member</p>
          </div>
        </td>
      </tr>`;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  body.innerHTML = filtered.map((r, idx) => {
    const initials = (r.staff_name || "??").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
    const hours = calcHours(r.clock_in, r.clock_out);
    const role = r.staff_role || "Staff";

    return `
    <tr class="border-b border-slate-100 hover:bg-teal-50/30 transition-colors group" style="animation: fadeInUp 0.3s ease ${idx * 30}ms both;">
      <td class="px-5 py-3.5">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center text-white font-black text-[10px] shadow-sm">
            ${initials}
          </div>
          <div>
            <p class="text-[12px] font-black text-slate-800">${escapeHtml(r.staff_name || "Unknown")}</p>
            <p class="text-[10px] font-bold text-slate-400 uppercase">${escapeHtml(role)}</p>
          </div>
        </div>
      </td>
      <td class="px-4 py-3.5 text-[12px] font-bold text-slate-600">${r.date || "—"}</td>
      <td class="px-4 py-3.5">
        <span class="text-[12px] font-bold ${r.clock_in ? "text-emerald-600" : "text-slate-400"}">${formatTime12h(r.clock_in)}</span>
      </td>
      <td class="px-4 py-3.5">
        <span class="text-[12px] font-bold ${r.clock_out ? "text-rose-500" : "text-slate-400"}">${formatTime12h(r.clock_out)}</span>
      </td>
      <td class="px-4 py-3.5 text-[12px] font-black text-slate-700">${hours}</td>
      <td class="px-4 py-3.5">${attStatusPill(r.status)}</td>
      <td class="px-4 py-3.5">
        <div class="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onclick="openAttEditModal('${r.id}')" class="p-1.5 rounded-xl text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors" title="Edit">
            <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
          </button>
          <button onclick="deleteAttRecord('${r.id}')" class="p-1.5 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Delete">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      </td>
    </tr>`;
  }).join("");

  if (window.lucide) window.lucide.createIcons();
}

// ---- Update stats cards ----
function updateAttStats() {
  const today = getTodayStr();
  const todayRecords = allAttendanceRecords.filter(r => r.date === today);
  const present = todayRecords.filter(r => r.status === "present" || r.status === "late" || r.status === "half-day").length;
  const late = todayRecords.filter(r => r.status === "late").length;
  const targetStaff = allStaffData.filter(s => {
    const role = (s.role || "").toLowerCase();
    return (role.includes("nurse") || role === "staff") && !role.includes("doctor") && !role.includes("dr.");
  });
  const totalStaff = targetStaff.length;
  const staffWithRecord = new Set(todayRecords.map(r => r.staff_name)).size;
  const absent = Math.max(0, totalStaff - staffWithRecord);

  const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
  el("attStatPresent", present);
  el("attStatLate", late);
  el("attStatAbsent", absent);

  // Weekly stats
  const weekStart = getWeekStart();
  const weekRecords = allAttendanceRecords.filter(r => r.date >= weekStart);
  const wPresent = weekRecords.filter(r => r.status === "present" || r.status === "half-day").length;
  const wLate = weekRecords.filter(r => r.status === "late").length;
  const wAbsent = weekRecords.filter(r => r.status === "absent").length;
  const totalW = wPresent + wLate + wAbsent;
  const rate = totalW > 0 ? Math.round(((wPresent + wLate) / totalW) * 100) : 0;

  el("attWeekPresent", wPresent);
  el("attWeekLate", wLate);
  el("attWeekAbsent", wAbsent);
  el("attWeekRate", `${rate}%`);
  const bar = document.getElementById("attWeekRateBar");
  if (bar) bar.style.width = `${rate}%`;
}

// ---- Staff status sidebar ----
function renderAttStaffStatus() {
  const container = document.getElementById("attStaffStatusList");
  if (!container) return;

  const today = getTodayStr();
  const todayRecords = allAttendanceRecords.filter(r => r.date === today);

  const targetStaff = allStaffData.filter(s => {
    const role = (s.role || "").toLowerCase();
    return (role.includes("nurse") || role === "staff") && !role.includes("doctor") && !role.includes("dr.");
  });

  if (targetStaff.length === 0) {
    container.innerHTML = `<div class="text-center py-6"><p class="text-[11px] font-bold text-slate-400">No staff members found</p></div>`;
    return;
  }

  container.innerHTML = targetStaff.map(staff => {
    const record = todayRecords.find(r => r.staff_name === staff.name);
    const initials = (staff.name || "??").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
    let statusDot = "bg-slate-300";
    let statusText = "Not logged";
    let statusTextColor = "text-slate-400";

    if (record) {
      if (record.clock_out) {
        statusDot = "bg-blue-500";
        statusText = `Out at ${formatTime12h(record.clock_out)}`;
        statusTextColor = "text-blue-600";
      } else if (record.status === "absent") {
        statusDot = "bg-red-500";
        statusText = "Absent";
        statusTextColor = "text-red-500";
      } else if (record.status === "on-leave") {
        statusDot = "bg-violet-500";
        statusText = "On leave";
        statusTextColor = "text-violet-500";
      } else if (record.clock_in) {
        statusDot = "bg-emerald-500 animate-pulse";
        statusText = `In since ${formatTime12h(record.clock_in)}`;
        statusTextColor = "text-emerald-600";
      }
    }

    return `
      <div class="flex items-center justify-between p-3 rounded-2xl hover:bg-slate-50 transition-colors group">
        <div class="flex items-center gap-3">
          <div class="relative">
            <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-slate-100 to-slate-50 border border-slate-200/50 flex items-center justify-center text-slate-600 font-black text-[10px]">${initials}</div>
            <span class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${statusDot}"></span>
          </div>
          <div>
            <p class="text-[11px] font-black text-slate-700">${escapeHtml(staff.name)}</p>
            <p class="text-[9px] font-bold ${statusTextColor} uppercase tracking-widest">${statusText}</p>
          </div>
        </div>
      </div>`;
  }).join("");
}

// ---- Calendar Heatmap ----
function renderAttCalendar() {
  const grid = document.getElementById("attCalendarGrid");
  const label = document.getElementById("attCalMonthLabel");
  if (!grid || !label) return;

  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  label.textContent = `${months[attCalMonth]} ${attCalYear}`;

  const firstDay = new Date(attCalYear, attCalMonth, 1).getDay();
  const daysInMonth = new Date(attCalYear, attCalMonth + 1, 0).getDate();
  const today = getTodayStr();

  // Get attendance for this month
  const monthStr = `${attCalYear}-${String(attCalMonth + 1).padStart(2, "0")}`;
  const monthRecords = allAttendanceRecords.filter(r => r.date && r.date.startsWith(monthStr));

  // Keep day headers
  let html = `
    <div class="text-center text-[9px] font-black text-slate-400 uppercase py-1">Su</div>
    <div class="text-center text-[9px] font-black text-slate-400 uppercase py-1">Mo</div>
    <div class="text-center text-[9px] font-black text-slate-400 uppercase py-1">Tu</div>
    <div class="text-center text-[9px] font-black text-slate-400 uppercase py-1">We</div>
    <div class="text-center text-[9px] font-black text-slate-400 uppercase py-1">Th</div>
    <div class="text-center text-[9px] font-black text-slate-400 uppercase py-1">Fr</div>
    <div class="text-center text-[9px] font-black text-slate-400 uppercase py-1">Sa</div>`;

  // Empty cells before first day
  for (let i = 0; i < firstDay; i++) {
    html += `<div class="aspect-square"></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${attCalYear}-${String(attCalMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dayRecords = monthRecords.filter(r => r.date === dateStr);
    const isToday = dateStr === today;

    let bg = "bg-slate-50";
    let dotColor = "";

    if (dayRecords.length > 0) {
      const allPresent = dayRecords.every(r => r.status === "present");
      const hasLate = dayRecords.some(r => r.status === "late");
      const hasHalfDay = dayRecords.some(r => r.status === "half-day");
      const allAbsent = dayRecords.every(r => r.status === "absent");

      if (allPresent) {
        bg = "bg-emerald-100 border-emerald-200";
        dotColor = "bg-emerald-500";
      } else if (allAbsent) {
        bg = "bg-red-100 border-red-200";
        dotColor = "bg-red-400";
      } else {
        bg = "bg-amber-100 border-amber-200";
        dotColor = "bg-amber-400";
      }
    }

    const todayRing = isToday ? "ring-2 ring-teal-500 ring-offset-1" : "";

    html += `
      <div class="aspect-square rounded-xl ${bg} border border-transparent ${todayRing} flex flex-col items-center justify-center cursor-default hover:scale-110 transition-transform relative group">
        <span class="text-[11px] font-bold ${isToday ? "text-teal-700" : "text-slate-600"}">${d}</span>
        ${dotColor ? `<span class="w-1.5 h-1.5 rounded-full ${dotColor} mt-0.5"></span>` : ""}
        ${dayRecords.length > 0 ? `<div class="absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[9px] font-bold px-2 py-1 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">${dayRecords.length} record${dayRecords.length > 1 ? "s" : ""}</div>` : ""}
      </div>`;
  }

  grid.innerHTML = html;
}

// ---- Live Clock ----
function startAttLiveClock() {
  if (attLiveClockInterval) clearInterval(attLiveClockInterval);

  function updateClock() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
    const dateStr = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

    const clockEl = document.getElementById("attendanceLiveClock");
    const dateEl = document.getElementById("attendanceLiveDate");
    const modalTimeEl = document.getElementById("attClockModalTime");

    if (clockEl) clockEl.textContent = timeStr;
    if (dateEl) dateEl.textContent = dateStr;
    if (modalTimeEl) modalTimeEl.textContent = `Current Time: ${timeStr}`;
  }

  updateClock();
  attLiveClockInterval = setInterval(updateClock, 1000);
}

// ---- Clock In/Out Modal ----
function openAttClockModal() {
  const modal = document.getElementById("attClockModal");
  const select = document.getElementById("attClockStaffSelect");
  if (!modal || !select) return;

  // Populate staff dropdown
  select.innerHTML = `<option value="">Choose a staff member...</option>`;

  // Filter out doctors and admins from attendance clocking
  const clockableStaff = allStaffData.filter(s => {
    const role = (s.role || "").toLowerCase();
    return !role.includes("doctor") && !role.includes("dr.") && !role.includes("admin");
  });

  clockableStaff.forEach(staff => {
    select.innerHTML += `<option value="${escapeHtml(staff.name)}" data-role="${escapeHtml(staff.role || "Staff")}">${escapeHtml(staff.name)} — ${escapeHtml(staff.role || "Staff")}</option>`;
  });

  // Reset
  document.getElementById("attClockNotes").value = "";
  document.getElementById("attClockStaffPreview").classList.add("hidden");

  modal.classList.remove("hidden");
  if (window.lucide) window.lucide.createIcons();
}

function closeAttClockModal() {
  document.getElementById("attClockModal")?.classList.add("hidden");
}

// Staff select change handler
document.addEventListener("DOMContentLoaded", () => {
  const select = document.getElementById("attClockStaffSelect");
  if (select) {
    select.addEventListener("change", () => {
      const preview = document.getElementById("attClockStaffPreview");
      const name = select.value;
      if (!name) {
        preview?.classList.add("hidden");
        return;
      }

      const option = select.selectedOptions[0];
      const role = option?.getAttribute("data-role") || "Staff";
      const initials = name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);

      document.getElementById("attClockStaffAvatar").textContent = initials;
      document.getElementById("attClockStaffName").textContent = name;
      document.getElementById("attClockStaffRole").textContent = role;

      // Check today's record
      const today = getTodayStr();
      const record = allAttendanceRecords.find(r => r.staff_name === name && r.date === today);
      const statusEl = document.getElementById("attClockStaffStatus");

      if (record) {
        if (record.clock_out) {
          statusEl.textContent = `Already clocked out at ${formatTime12h(record.clock_out)}`;
          statusEl.className = "text-[11px] font-bold text-blue-600";
        } else if (record.clock_in) {
          statusEl.textContent = `Clocked in at ${formatTime12h(record.clock_in)} — Not yet out`;
          statusEl.className = "text-[11px] font-bold text-emerald-600";
        } else if (record.status === "absent") {
          statusEl.textContent = "Marked as absent today";
          statusEl.className = "text-[11px] font-bold text-red-500";
        } else if (record.status === "on-leave") {
          statusEl.textContent = "On leave today";
          statusEl.className = "text-[11px] font-bold text-violet-500";
        }
      } else {
        statusEl.textContent = "No record for today — ready to clock in";
        statusEl.className = "text-[11px] font-bold text-slate-500";
      }

      preview?.classList.remove("hidden");
    });
  }

  // Clock In button
  document.getElementById("attDoClockIn")?.addEventListener("click", async () => {
    const name = document.getElementById("attClockStaffSelect")?.value;
    if (!name) return alert("Please select a staff member first.");

    const today = getTodayStr();
    const now = new Date();
    const timeNow = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    const notes = document.getElementById("attClockNotes")?.value?.trim() || "";

    // Check if already clocked in
    const existing = allAttendanceRecords.find(r => r.staff_name === name && r.date === today);
    if (existing && existing.clock_in) {
      return alert(`${name} has already clocked in today at ${formatTime12h(existing.clock_in)}.`);
    }

    // Determine if late (assume 9:00 AM is standard)
    const isLate = now.getHours() > 9 || (now.getHours() === 9 && now.getMinutes() > 0);
    const staff = allStaffData.find(s => s.name === name);
    const role = staff?.role || "Staff";

    try {
      const { error } = await sb.from("attendance").insert([{
        staff_name: name,
        staff_role: role,
        date: today,
        clock_in: timeNow,
        status: isLate ? "late" : "present",
        notes: notes
      }]);
      if (error) throw error;
      closeAttClockModal();
      await fetchAttendance();
      renderAttendanceTable();
      updateAttStats();
      renderAttStaffStatus();
      renderAttCalendar();
    } catch (err) {
      console.error("Clock in error:", err);
      alert("Failed to clock in: " + err.message);
    }
  });

  // Clock Out button
  document.getElementById("attDoClockOut")?.addEventListener("click", async () => {
    const name = document.getElementById("attClockStaffSelect")?.value;
    if (!name) return alert("Please select a staff member first.");

    const today = getTodayStr();
    const now = new Date();
    const timeNow = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");

    const existing = allAttendanceRecords.find(r => r.staff_name === name && r.date === today && r.clock_in && !r.clock_out);
    if (!existing) {
      return alert(`${name} hasn't clocked in today or has already clocked out.`);
    }

    try {
      const { error } = await sb.from("attendance").update({
        clock_out: timeNow
      }).eq("id", existing.id);
      if (error) throw error;
      closeAttClockModal();
      await fetchAttendance();
      renderAttendanceTable();
      updateAttStats();
      renderAttStaffStatus();
      renderAttCalendar();
    } catch (err) {
      console.error("Clock out error:", err);
      alert("Failed to clock out: " + err.message);
    }
  });

  // Mark Absent button
  document.getElementById("attDoMarkAbsent")?.addEventListener("click", async () => {
    const name = document.getElementById("attClockStaffSelect")?.value;
    if (!name) return alert("Please select a staff member first.");

    const today = getTodayStr();
    const notes = document.getElementById("attClockNotes")?.value?.trim() || "";
    const staff = allStaffData.find(s => s.name === name);
    const role = staff?.role || "Staff";

    const existing = allAttendanceRecords.find(r => r.staff_name === name && r.date === today);
    if (existing) return alert(`${name} already has a record for today.`);

    try {
      const { error } = await sb.from("attendance").insert([{
        staff_name: name,
        staff_role: role,
        date: today,
        status: "absent",
        notes: notes
      }]);
      if (error) throw error;
      closeAttClockModal();
      await fetchAttendance();
      renderAttendanceTable();
      updateAttStats();
      renderAttStaffStatus();
      renderAttCalendar();
    } catch (err) {
      console.error("Mark absent error:", err);
      alert("Failed to mark absent: " + err.message);
    }
  });

  // Mark Leave button
  document.getElementById("attDoMarkLeave")?.addEventListener("click", async () => {
    const name = document.getElementById("attClockStaffSelect")?.value;
    if (!name) return alert("Please select a staff member first.");

    const today = getTodayStr();
    const notes = document.getElementById("attClockNotes")?.value?.trim() || "";
    const staff = allStaffData.find(s => s.name === name);
    const role = staff?.role || "Staff";

    const existing = allAttendanceRecords.find(r => r.staff_name === name && r.date === today);
    if (existing) return alert(`${name} already has a record for today.`);

    try {
      const { error } = await sb.from("attendance").insert([{
        staff_name: name,
        staff_role: role,
        date: today,
        status: "on-leave",
        notes: notes
      }]);
      if (error) throw error;
      closeAttClockModal();
      await fetchAttendance();
      renderAttendanceTable();
      updateAttStats();
      renderAttStaffStatus();
      renderAttCalendar();
    } catch (err) {
      console.error("Mark leave error:", err);
      alert("Failed to mark leave: " + err.message);
    }
  });

  // Close modal buttons
  document.getElementById("closeAttClockModal")?.addEventListener("click", closeAttClockModal);
  document.getElementById("attClockInBtn")?.addEventListener("click", openAttClockModal);

  // Calendar navigation
  document.getElementById("attCalPrev")?.addEventListener("click", () => {
    attCalMonth--;
    if (attCalMonth < 0) { attCalMonth = 11; attCalYear--; }
    renderAttCalendar();
  });
  document.getElementById("attCalNext")?.addEventListener("click", () => {
    attCalMonth++;
    if (attCalMonth > 11) { attCalMonth = 0; attCalYear++; }
    renderAttCalendar();
  });

  // Filter event listeners
  document.getElementById("attSearchInput")?.addEventListener("input", renderAttendanceTable);
  document.getElementById("attFilterDate")?.addEventListener("change", renderAttendanceTable);
  document.getElementById("attFilterStatus")?.addEventListener("change", renderAttendanceTable);

  // Edit Modal
  document.getElementById("closeAttEditModal")?.addEventListener("click", () => {
    document.getElementById("attEditModal")?.classList.add("hidden");
  });
  document.getElementById("attEditCancel")?.addEventListener("click", () => {
    document.getElementById("attEditModal")?.classList.add("hidden");
  });

  document.getElementById("attEditForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("attEditId")?.value;
    if (!id) return;

    const payload = {
      clock_in: document.getElementById("attEditClockIn")?.value || null,
      clock_out: document.getElementById("attEditClockOut")?.value || null,
      status: document.getElementById("attEditStatus")?.value || "present",
      notes: document.getElementById("attEditNotes")?.value?.trim() || ""
    };

    try {
      const { error } = await sb.from("attendance").update(payload).eq("id", id);
      if (error) throw error;
      document.getElementById("attEditModal")?.classList.add("hidden");
      await fetchAttendance();
      renderAttendanceTable();
      updateAttStats();
      renderAttStaffStatus();
      renderAttCalendar();
    } catch (err) {
      console.error("Edit attendance error:", err);
      alert("Failed to update: " + err.message);
    }
  });
});

// ---- Open Edit Modal ----
function openAttEditModal(id) {
  const record = allAttendanceRecords.find(r => String(r.id) === String(id));
  if (!record) return;

  document.getElementById("attEditId").value = record.id;
  document.getElementById("attEditClockIn").value = record.clock_in || "";
  document.getElementById("attEditClockOut").value = record.clock_out || "";
  document.getElementById("attEditStatus").value = record.status || "present";
  document.getElementById("attEditNotes").value = record.notes || "";

  document.getElementById("attEditModal")?.classList.remove("hidden");
  if (window.lucide) window.lucide.createIcons();
}

// ---- Delete Record ----
async function deleteAttRecord(id) {
  const confirmed = await showConfirm("Delete Record", "Are you sure you want to delete this attendance record? This will move it to the recycle bin.");
  if (!confirmed) return;
  try {
    // Non-blocking recycle bin attempt
    try {
      const { data: attData } = await sb.from("attendance").select("*").eq("id", id).single();
      if (attData) await moveToRecycleBin('attendance', attData);
    } catch (binErr) {
      console.warn("Recycle bin move failed for attendance:", binErr);
    }

    const { error } = await sb.from("attendance").delete().eq("id", id);
    if (error) throw error;
    await fetchAttendance();
    renderAttendanceTable();
    updateAttStats();
    renderAttStaffStatus();
    renderAttCalendar();
  } catch (err) {
    console.error("Delete attendance error:", err);
    alert("Failed to delete: " + err.message);
  }
}

// ---- Initialize Attendance Page ----
async function initAttendancePage() {
  startAttLiveClock();
  await fetchAttendance();
  renderAttendanceTable();
  updateAttStats();
  renderAttStaffStatus();
  renderAttCalendar();

  // Set date filter to today by default
  const dateFilter = document.getElementById("attFilterDate");
  if (dateFilter && !dateFilter.value) {
    dateFilter.value = getTodayStr();
    renderAttendanceTable();
  }
}

// ==========================================
// APPLICATION FORM MANAGER (ADMIN)
// ==========================================
let appConfig = {
  requirements: [],
  qualifications: [],
  fields: [],
  positions: []
};

async function initAppFormManager() {
  try {
    const { data, error } = await sb.from("application_config").select("*");
    if (error) throw error;

    data.forEach(row => {
      appConfig[row.id] = row.items;
    });

    renderAppConfig("requirements");
    renderAppConfig("qualifications");
    renderAppConfig("fields");
    renderPositions();
  } catch (err) {
    console.error("Failed to load app config:", err);
  }
}

function renderPositions() {
  const listEl = document.getElementById("positionsEditorList");
  const emptyEl = document.getElementById("positionsEmptyState");
  if (!listEl) return;

  listEl.innerHTML = "";
  const positions = appConfig.positions || [];

  if (emptyEl) {
    emptyEl.classList.toggle("hidden", positions.length > 0);
  }

  positions.forEach((pos, index) => {
    const div = document.createElement("div");
    div.className = "group flex items-center gap-3 p-3 rounded-2xl bg-white border border-slate-200 shadow-sm hover:border-rose-300 transition-all";
    div.innerHTML = `
      <div class="w-8 h-8 rounded-xl bg-rose-100 flex items-center justify-center shrink-0">
        <i data-lucide="badge-check" class="w-4 h-4 text-rose-500"></i>
      </div>
      <input type="text" value="${pos}" onchange="updatePositionItem(${index}, this.value)" placeholder="e.g. Dental Hygienist" class="flex-1 text-[12px] font-bold text-slate-700 bg-slate-50 rounded-lg px-3 py-1.5 border-none focus:ring-1 focus:ring-rose-500">
      <button onclick="removePositionItem(${index})" class="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all">
        <i data-lucide="trash-2" class="w-4 h-4"></i>
      </button>
    `;
    listEl.appendChild(div);
  });

  if (window.lucide) window.lucide.createIcons();
}

function addPositionItem() {
  if (!appConfig.positions) appConfig.positions = [];
  appConfig.positions.push("New Position");
  renderPositions();
  saveAppConfig("positions");
}

function updatePositionItem(index, value) {
  appConfig.positions[index] = value;
  saveAppConfig("positions");
}

function removePositionItem(index) {
  if (confirm("Remove this position?")) {
    appConfig.positions.splice(index, 1);
    renderPositions();
    saveAppConfig("positions");
  }
}

function renderAppConfig(type) {
  const listEl = document.getElementById(type === "requirements" ? "reqEditorList" : type === "qualifications" ? "qualEditorList" : "fieldsEditorList");
  if (!listEl) return;

  listEl.innerHTML = "";

  const total = appConfig[type].length;
  appConfig[type].forEach((item, index) => {
    const div = document.createElement("div");
    div.className = "group flex items-start gap-2 p-3 rounded-2xl bg-white border border-slate-200 shadow-sm hover:border-violet-300 transition-all";

    // Reorder buttons column
    const reorderHtml = `
      <div class="flex flex-col gap-0.5 shrink-0 pt-1">
        <button onclick="moveConfigItem('${type}', ${index}, -1)" class="p-1 rounded-md ${index === 0 ? 'text-slate-200 cursor-not-allowed' : 'text-slate-400 hover:text-violet-600 hover:bg-violet-50'} transition-all" ${index === 0 ? 'disabled' : ''} title="Move up">
          <i data-lucide="chevron-up" class="w-3.5 h-3.5"></i>
        </button>
        <span class="text-[9px] font-black text-slate-300 text-center tabular-nums">${index + 1}</span>
        <button onclick="moveConfigItem('${type}', ${index}, 1)" class="p-1 rounded-md ${index === total - 1 ? 'text-slate-200 cursor-not-allowed' : 'text-slate-400 hover:text-violet-600 hover:bg-violet-50'} transition-all" ${index === total - 1 ? 'disabled' : ''} title="Move down">
          <i data-lucide="chevron-down" class="w-3.5 h-3.5"></i>
        </button>
      </div>
    `;

    if (type === "fields") {
      div.innerHTML = `
        ${reorderHtml}
        <div class="flex-1 space-y-2">
          <div class="flex gap-2">
            <input type="text" value="${item.label}" onchange="updateConfigItem('fields', ${index}, 'label', this.value)" placeholder="Field Label" class="flex-1 text-[12px] font-bold text-slate-700 bg-slate-50 rounded-lg px-2 py-1 border-none focus:ring-1 focus:ring-violet-500">
            <select onchange="updateConfigItem('fields', ${index}, 'type', this.value)" class="text-[11px] bg-slate-100 rounded-lg px-2 py-1 border-none">
              <option value="text" ${item.type === 'text' ? 'selected' : ''}>Text</option>
              <option value="email" ${item.type === 'email' ? 'selected' : ''}>Email</option>
              <option value="tel" ${item.type === 'tel' ? 'selected' : ''}>Phone</option>
              <option value="file" ${item.type === 'file' ? 'selected' : ''}>File/Attachment</option>
              <option value="select" ${item.type === 'select' ? 'selected' : ''}>Dropdown</option>
              <option value="textarea" ${item.type === 'textarea' ? 'selected' : ''}>Textarea</option>
            </select>
          </div>
          <div class="flex items-center gap-4">
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" ${item.required ? 'checked' : ''} onchange="updateConfigItem('fields', ${index}, 'required', this.checked)" class="rounded text-violet-600">
              <span class="text-[10px] font-bold text-slate-500 uppercase">Required</span>
            </label>
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" ${item.fullWidth ? 'checked' : ''} onchange="updateConfigItem('fields', ${index}, 'fullWidth', this.checked)" class="rounded text-violet-600">
              <span class="text-[10px] font-bold text-slate-500 uppercase">Full Width</span>
            </label>
          </div>
          ${item.type === 'select' ? `
            <input type="text" value="${item.options ? item.options.join(', ') : ''}" onchange="updateConfigFieldsOptions(${index}, this.value)" placeholder="Options (comma separated)" class="w-full text-[11px] bg-slate-50 rounded-lg px-2 py-1 border-none focus:ring-1 focus:ring-violet-500">
          ` : ''}
        </div>
        <button onclick="removeConfigItem('${type}', ${index})" class="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
      `;
    } else {
      div.innerHTML = `
        ${reorderHtml}
        <div class="flex-1">
          <input type="text" value="${item.title}" onchange="updateConfigItem('${type}', ${index}, 'title', this.value)" placeholder="Title" class="w-full text-[12px] font-bold text-slate-700 bg-slate-50 rounded-lg px-2 py-1 border-none focus:ring-1 focus:ring-violet-500 mb-1">
          <input type="text" value="${item.desc}" onchange="updateConfigItem('${type}', ${index}, 'desc', this.value)" placeholder="Description" class="w-full text-[11px] text-slate-500 bg-slate-50 rounded-lg px-2 py-1 border-none focus:ring-1 focus:ring-violet-500">
        </div>
        <button onclick="removeConfigItem('${type}', ${index})" class="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
      `;
    }
    listEl.appendChild(div);
  });

  if (window.lucide) window.lucide.createIcons();
}

function moveConfigItem(type, index, direction) {
  const arr = appConfig[type];
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= arr.length) return;
  [arr[index], arr[newIndex]] = [arr[newIndex], arr[index]];
  renderAppConfig(type);
  saveAppConfig(type);
}

function updateConfigItem(type, index, field, value) {
  appConfig[type][index][field] = value;
  saveAppConfig(type);
  if (field === 'type') renderAppConfig(type); // Re-render to show/hide options field
}

function updateConfigFieldsOptions(index, value) {
  appConfig.fields[index].options = value.split(',').map(s => s.trim());
  saveAppConfig('fields');
}

function addConfigItem(type) {
  appConfig[type].push({ title: "New Item", desc: "Short description" });
  renderAppConfig(type);
  saveAppConfig(type);
}

function addFieldItem() {
  appConfig.fields.push({ label: "New Field", type: "text", placeholder: "...", required: false });
  renderAppConfig("fields");
  saveAppConfig("fields");
}

function removeConfigItem(type, index) {
  if (confirm("Remove this item?")) {
    appConfig[type].splice(index, 1);
    renderAppConfig(type);
    saveAppConfig(type);
  }
}

async function saveAppConfig(type) {
  try {
    const { error } = await sb.from("application_config").upsert({
      id: type,
      items: appConfig[type],
      updated_at: new Date().toISOString()
    });
    if (error) throw error;
  } catch (err) {
    console.error(`Failed to save ${type} config:`, err);
  }
}

function copyApplicationLink() {
  const link = window.location.origin + "/application-form";
  navigator.clipboard.writeText(link).then(() => {
    const toast = document.getElementById("copyLinkToast");
    if (toast) {
      toast.classList.remove("hidden");
      setTimeout(() => toast.classList.add("hidden"), 3000);
    }
  });
}

// Hook into page switching to load config
const originalSetActivePage = setActivePage;
setActivePage = function (pageKey) {
  originalSetActivePage(pageKey);
  if (pageKey === "application-form") {
    initAppFormManager();
  } else if (pageKey === "application-records") {
    loadApplicationRecords();
  } else if (pageKey === "treatment-progress") {
    showProgressSummary();
  }
};


// ==========================================
// APPLICATION RECORDS (ADVANCED)
// ==========================================
let allApplications = [];
let applicationStatusFilter = 'all';
let recruitChannel = null;

async function loadApplicationRecords() {
  const listEl = document.getElementById("applicationRecordsList");
  if (!listEl) return;

  listEl.innerHTML = `
    <div class="col-span-full py-20 text-center">
      <div class="w-16 h-16 rounded-full border-4 border-slate-100 border-t-emerald-500 animate-spin mx-auto mb-4"></div>
      <p class="text-slate-400 font-black uppercase tracking-widest text-[11px]">Syncing Applicant Data...</p>
    </div>
  `;

  try {
    const { data, error } = await sb
      .from("applicants_records")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    allApplications = data;
    renderApplicationRecords(data);
    updateApplicationStats(data);

    if (!recruitChannel && sb) {
      recruitChannel = sb.channel('realtime_applicants').on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'applicants_records'
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          if (!allApplications.some(a => a.id === payload.new.id)) {
            allApplications.unshift(payload.new);
          }
        } else if (payload.eventType === 'UPDATE') {
          const idx = allApplications.findIndex(a => a.id === payload.new.id);
          if (idx > -1) {
            allApplications[idx] = { ...allApplications[idx], ...payload.new };
          }
        } else if (payload.eventType === 'DELETE') {
          allApplications = allApplications.filter(a => a.id !== payload.old.id);
        }

        updateApplicationStats(allApplications);
        filterApplicationRecords();
      }).subscribe();
    }

  } catch (err) {
    console.error("Failed to load applications:", err);
    listEl.innerHTML = `
      <div class="col-span-full py-12 text-center bg-red-50 rounded-3xl border border-red-100 italic text-red-500 text-sm">
        Failed to sync with recruitment database. Please ensure 'status' and 'sender_role' columns exist.
      </div>
    `;
  }
}

function updateApplicationStats(data) {
  const total = data.length;
  const accepted = data.filter(a => a.status === 'accepted').length;
  const pending = data.filter(a => !a.status || a.status === 'pending').length;

  const tEl = document.getElementById("totalApplicants");
  const aEl = document.getElementById("acceptedCount");
  const pEl = document.getElementById("pendingCount");

  if (tEl) tEl.textContent = total;
  if (aEl) aEl.textContent = `${accepted} Accepted`;
  if (pEl) pEl.textContent = `${pending} Pending`;
}

function setStatusFilter(status) {
  applicationStatusFilter = status;

  // Update UI buttons
  document.querySelectorAll(".record-filter-btn").forEach(btn => {
    if (btn.dataset.status === status) {
      btn.className = "record-filter-btn px-4 py-2.5 rounded-xl text-[12px] font-bold bg-emerald-500 text-white shadow-lg shadow-emerald-500/20 transition-all";
    } else {
      btn.className = "record-filter-btn px-4 py-2.5 rounded-xl text-[12px] font-bold text-slate-500 hover:bg-slate-100 transition-all border border-slate-200";
    }
  });

  filterApplicationRecords();
}

function filterApplicationRecords() {
  const search = document.getElementById("applicantSearch").value.toLowerCase();

  const filtered = allApplications.filter(app => {
    const matchesStatus = applicationStatusFilter === 'all' || (app.status || 'pending') === applicationStatusFilter;
    const matchesSearch = (app.sender_name || "").toLowerCase().includes(search) || (app.message || "").toLowerCase().includes(search);
    return matchesStatus && matchesSearch;
  });

  renderApplicationRecords(filtered);
}

function renderApplicationRecords(data) {
  const listEl = document.getElementById("applicationRecordsList");
  if (!listEl) return;

  if (data.length === 0) {
    listEl.innerHTML = `
      <div class="py-20 text-center bg-slate-50/50 rounded-[40px] border-2 border-dashed border-slate-200 m-4">
        <div class="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
          <i data-lucide="search-x" class="w-8 h-8 text-slate-300"></i>
        </div>
        <p class="text-slate-500 font-black text-sm uppercase tracking-widest">No matching candidates found</p>
      </div>
    `;
  } else {
    listEl.innerHTML = data.map(app => {
      const date = new Date(app.created_at).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      });

      const name = app.sender_name || 'Anonymous Applicant';
      const status = app.status || 'pending';
      const statusColors = {
        'pending': 'bg-amber-100 text-amber-700 border-amber-200',
        'accepted': 'bg-emerald-100 text-emerald-700 border-emerald-200',
        'interview': 'bg-indigo-100 text-indigo-700 border-indigo-200',
        'hired': 'bg-violet-100 text-violet-700 border-violet-200',
        'declined': 'bg-red-100 text-red-700 border-red-200'
      };

      let actionButtons = "";
      if (status === 'pending') {
        actionButtons = `
          <button onclick="event.stopPropagation(); updateApplicationStatus('${app.id}', 'accepted')" class="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-500 hover:bg-emerald-500 hover:text-white transition-all flex items-center justify-center shadow-sm" title="Accept">
            <i data-lucide="check" class="w-4 h-4"></i>
          </button>
          <button onclick="event.stopPropagation(); updateApplicationStatus('${app.id}', 'declined')" class="w-8 h-8 rounded-xl bg-red-50 text-red-500 hover:bg-red-500 hover:text-white transition-all flex items-center justify-center shadow-sm" title="Decline">
            <i data-lucide="x" class="w-4 h-4"></i>
          </button>
        `;
      } else if (status === 'accepted') {
        actionButtons = `
          <button onclick="event.stopPropagation(); openInterviewModal('${app.id}')" class="px-3 py-1.5 rounded-xl bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white transition-all flex items-center gap-2 text-[10px] font-black uppercase tracking-widest shadow-sm">
            <i data-lucide="calendar" class="w-3.5 h-3.5"></i> For Interview
          </button>
        `;
      } else if (status === 'interview') {
        actionButtons = `
          <button onclick="event.stopPropagation(); finalizeHireDirectly('${app.id}')" class="px-4 py-1.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-all flex items-center gap-2 text-[10px] font-black uppercase tracking-widest shadow-lg shadow-emerald-500/30">
            <i data-lucide="award" class="w-3.5 h-3.5"></i> Hired
          </button>
        `;
      }

      return `
        <div onclick="openApplicantDetail('${app.id}')" class="group flex items-center justify-between p-5 hover:bg-slate-50 transition-all cursor-pointer border-l-4 border-transparent hover:border-emerald-500">
          <div class="flex items-center gap-5 flex-1">
            <div class="w-10 h-10 rounded-xl bg-slate-100 group-hover:bg-emerald-100 flex items-center justify-center text-slate-400 group-hover:text-emerald-600 font-black transition-colors">
              ${name.charAt(0).toUpperCase()}
            </div>
            <div class="flex-1">
              <h3 class="text-[14px] font-black text-slate-800 tracking-tight leading-none mb-1">${name}</h3>
              <div class="flex items-center gap-3">
                <p class="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-none">${date}</p>
                <div class="w-1 h-1 rounded-full bg-slate-200"></div>
                <p class="text-[10px] text-slate-500 font-medium">Click to view dossier</p>
              </div>
            </div>
          </div>
          
          <div class="flex items-center gap-3">
            <span class="px-3 py-1 rounded-full border text-[9px] font-black uppercase tracking-widest ${statusColors[status] || statusColors.pending}">
              ${status}
            </span>
            
            <div class="flex items-center gap-1.5 ml-4">
              ${actionButtons}
              <div class="w-[1px] h-4 bg-slate-200 mx-1"></div>
              <button onclick="event.stopPropagation(); deleteApplicationRecord('${app.id}')" class="w-8 h-8 rounded-xl bg-slate-50 text-slate-300 hover:bg-slate-800 hover:text-white transition-all flex items-center justify-center" title="Delete">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              </button>
            </div>
            <i data-lucide="chevron-right" class="w-4 h-4 text-slate-300 group-hover:translate-x-1 transition-transform ml-2"></i>
          </div>
        </div>
      `;
    }).join('');
  }

  if (window.lucide) window.lucide.createIcons();
}

function openApplicantDetail(id) {
  const app = allApplications.find(a => String(a.id) === String(id));
  if (!app) return;

  const modal = document.getElementById("applicantDetailModal");
  if (!modal) return;

  const name = app.sender_name || 'Anonymous Applicant';

  // Populate Sidebar
  document.getElementById("modalApplicantInitials").textContent = name.charAt(0).toUpperCase();
  document.getElementById("modalApplicantName").textContent = name;
  document.getElementById("modalApplicantDate").textContent = new Date(app.created_at).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  const status = app.status || 'pending';
  const badge = document.getElementById("modalStatusBadge");
  const dot = document.getElementById("modalStatusDot");
  badge.textContent = status;

  if (status === 'accepted') {
    badge.className = "inline-block px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-600 border-emerald-100";
    dot.className = "w-3 h-3 rounded-full bg-emerald-500";
  } else if (status === 'declined') {
    badge.className = "inline-block px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest bg-red-50 text-red-600 border-red-100";
    dot.className = "w-3 h-3 rounded-full bg-red-500";
  } else {
    badge.className = "inline-block px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest bg-amber-50 text-amber-600 border-amber-100";
    dot.className = "w-3 h-3 rounded-full bg-amber-400 animate-pulse";
  }

  // Parse Content & Extract Media
  const mediaContainer = document.getElementById("modalApplicantMedia");
  mediaContainer.innerHTML = ''; // Clear

  const safeMessage = app.message || "";
  
  // Extract ALL media (Images, PDF, Word)
  const mediaRegex = /\[IMAGE:(.*?)\](data:(.*?);base64,[^\s]+)/g;
  let match;
  let hasMedia = false;

  while ((match = mediaRegex.exec(app.message || "")) !== null) {
    hasMedia = true;
    const label = match[1] || "Attachment";
    const data = match[2];
    const mime = match[3] || "";
    
    let icon = "file-text";
    let isImage = false;
    
    if (mime.includes("image")) {
      icon = "file-image";
      isImage = true;
    } else if (mime.includes("pdf")) {
      icon = "file-digit";
    } else if (mime.includes("word") || mime.includes("officedocument")) {
      icon = "file-type";
    }

    mediaContainer.innerHTML += `
      <div class="rounded-[32px] overflow-hidden border border-slate-200 bg-white shadow-sm transition-all duration-500">
        <div class="flex items-center justify-between p-6 hover:bg-slate-50/50 transition-colors">
          <div class="flex items-center gap-4">
            <div class="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <i data-lucide="${icon}" class="w-5 h-5"></i>
            </div>
            <div class="flex flex-col">
              <span class="text-[13px] font-black text-slate-700 tracking-tight">${label}</span>
              <span class="text-[9px] font-bold text-slate-400 uppercase tracking-widest">${mime.split('/')[1] || 'File'}</span>
            </div>
          </div>
          <div class="flex items-center gap-2">
            ${isImage ? `
            <button onclick="toggleApplicantImage(this)" class="p-2 rounded-xl text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all" title="View Preview">
              <i data-lucide="eye" class="w-4 h-4"></i>
            </button>` : ''}
            <a href="${data}" download="${label.replace(/\s+/g, '_')}" class="p-2 rounded-xl text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-all" title="Download">
              <i data-lucide="download" class="w-4 h-4"></i>
            </a>
          </div>
        </div>
        ${isImage ? `
        <div class="max-h-0 overflow-hidden transition-all duration-500 bg-slate-50">
          <div class="p-6 border-t border-slate-100">
            <img src="${data}" class="w-full h-auto rounded-[24px] shadow-lg cursor-zoom-in hover:scale-[1.01] transition-transform" onclick="showFullImage('${data}')">
          </div>
        </div>` : ''}
      </div>
    `;
  }

  if (!hasMedia) {
    mediaContainer.innerHTML = `<div class="py-10 text-center bg-white rounded-[32px] border border-dashed border-slate-200 text-slate-300 italic text-xs">No media attachments found</div>`;
  }

  // Text content: Remove ALL base64 data to keep the cards clean
  const textOnly = safeMessage.replace(/\[IMAGE:.*?\]data:[^\s]+/g, '').trim().replace(/\n/g, '<br>');

  // Parse Content: Split text into structured data cards
  const lines = textOnly.split('<br>');
  let organizedHtml = '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">';
  let hasData = false;

  lines.forEach(line => {
    const parts = line.split(':');
    if (parts.length >= 2) {
      hasData = true;
      const label = parts[0].trim();
      const value = parts.slice(1).join(':').trim();

      // Skip empty or purely technical lines
      if (!label || !value) return;

      organizedHtml += `
        <div class="p-4 rounded-3xl bg-white border border-slate-100 shadow-sm transition-all hover:border-indigo-200 group overflow-hidden">
          <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 group-hover:text-indigo-500 transition-colors">${label}</p>
          <p class="text-xs font-bold text-slate-700 leading-relaxed break-all">${value || 'Not provided'}</p>
        </div>
      `;
    }
  });
  organizedHtml += '</div>';

  document.getElementById("modalApplicantContent").innerHTML = hasData ? organizedHtml : `<p class="text-slate-400 italic text-sm p-4">${textOnly}</p>`;

  // Buttons
  const acceptBtn = document.getElementById("modalAcceptBtn");
  const declineBtn = document.getElementById("modalDeclineBtn");

  if (status === 'pending') {
    acceptBtn.style.display = '';
    declineBtn.style.display = '';
  } else {
    acceptBtn.style.display = 'none';
    declineBtn.style.display = 'none';
  }

  acceptBtn.onclick = () => {
    updateApplicationStatus(app.id, 'accepted');
    closeApplicantDetail();
  };
  declineBtn.onclick = () => {
    updateApplicationStatus(app.id, 'declined');
    closeApplicantDetail();
  };

  // Show
  modal.classList.remove("hidden");
  if (window.lucide) window.lucide.createIcons();
}

function toggleApplicantImage(btn) {
  // Traverse up to the row container (flex justify-between) and find the next sibling (the hidden content)
  const row = btn.closest('.flex.items-center.justify-between');
  const content = row ? row.nextElementSibling : null;
  const icon = btn.querySelector('.lucide-eye') || btn.querySelector('i');

  if (content.style.maxHeight === '0px' || !content.style.maxHeight) {
    content.style.maxHeight = '2000px'; // Support large images
    if (icon) icon.style.transform = "rotate(-180deg)";
  } else {
    content.style.maxHeight = "0px";
    if (icon) icon.style.transform = "rotate(0deg)";
  }
}

// ---- Full Image Lightbox ----
function showFullImage(src) {
  const modal = document.getElementById("imagePreviewModal");
  const img = document.getElementById("fullImageElement");
  if (!modal || !img) return;

  img.src = src;
  modal.classList.remove("hidden");
  
  // Animate in
  setTimeout(() => {
    modal.classList.remove("opacity-0");
  }, 10);
  
  if (window.lucide) window.lucide.createIcons({ root: modal });
}

function closeFullImage() {
  const modal = document.getElementById("imagePreviewModal");
  if (!modal) return;

  modal.classList.add("opacity-0");
  setTimeout(() => {
    modal.classList.add("hidden");
  }, 300);
}

function closeApplicantDetail() {
  const modal = document.getElementById("applicantDetailModal");
  if (modal) modal.classList.add("hidden");
}

async function updateApplicationStatus(id, newStatus) {
  try {
    const { error } = await sb
      .from("applicants_records")
      .update({ status: newStatus })
      .eq("id", id);

    if (error) throw error;

    // Update local state and UI
    const appIndex = allApplications.findIndex(a => String(a.id) === String(id));
    if (appIndex > -1) allApplications[appIndex].status = newStatus;

    updateApplicationStats(allApplications);
    filterApplicationRecords(); // This triggers re-render
  } catch (err) {
    console.error("Update failed:", err);
    alert("Update failed. Please ensure the 'status' column exists in your 'messages' table.");
  }
}

async function deleteApplicationRecord(id) {
  if (confirm("Are you sure you want to delete this application record? It will be moved to the Recycle Bin.")) {
    try {
      // Non-blocking recycle bin attempt
      try {
        const { data: appData } = await sb.from("applicants_records").select("*").eq("id", id).single();
        if (appData) await moveToRecycleBin('applicant', appData);
      } catch (binErr) {
        console.warn("Recycle bin move failed for application:", binErr);
      }

      const { error } = await sb.from("applicants_records").delete().eq("id", id);
      if (error) throw error;
      loadApplicationRecords();
    } catch (err) {
      console.error("Delete application error:", err);
      alert("Failed to delete record.");
    }
  }
}

// ==========================================
// RECRUITMENT WORKFLOW (Interview & Hiring)
// ==========================================

let activeRecruitId = null;

function openInterviewModal(id) {
  activeRecruitId = id;
  document.getElementById("interviewModal")?.classList.remove("hidden");
}

function closeInterviewModal() {
  document.getElementById("interviewModal")?.classList.add("hidden");
}

async function scheduleInterview() {
  const date = document.getElementById("interviewDate").value;
  const time = document.getElementById("interviewTime").value;
  const location = document.getElementById("interviewLocation").value;

  if (!date || !time) {
    alert("Please select date and time.");
    return;
  }

  const app = allApplications.find(a => String(a.id) === String(activeRecruitId));
  if (!app) return;

  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const extractedEmail = (app.message || "").match(emailRegex);
  const email = extractedEmail ? extractedEmail[0] : prompt("Candidate email not found. Please enter manually:");

  if (!email) return;

  const btn = document.getElementById("sendInviteBtn");
  btn.disabled = true;
  btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Processing...`;
  if (window.lucide) window.lucide.createIcons();

  try {
    const response = await fetch("/api/recruitment/interview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name: app.sender_name, date, time, location })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);

    await updateApplicationStatus(activeRecruitId, 'interview');
    await showAlert("Invitation Sent", "Interview invitation has been sent successfully to the candidate.", "success");
    closeInterviewModal();
  } catch (err) {
    await showAlert("Failed to Send", "Error: " + err.message, "danger");
  } finally {
    btn.disabled = false;
    btn.textContent = "Send Invite";
    if (window.lucide) window.lucide.createIcons();
  }
}

function showRecruitmentToast(message, type = 'success', persist = false) {
  const toast = document.createElement('div');

  let bgClass = "bg-emerald-500 shadow-emerald-500/30";
  let icon = "check-circle-2";
  let label = "SUCCESS";

  if (type === 'error') {
    bgClass = "bg-rose-500 shadow-rose-500/30";
    icon = "alert-circle";
    label = "ERROR";
  } else if (type === 'info') {
    bgClass = "bg-indigo-500 shadow-indigo-500/30";
    icon = "info";
    label = "INFO";
  } else if (type === 'processing') {
    bgClass = "bg-amber-500 shadow-amber-500/30";
    icon = "loader-2";
    label = "PROCESSING";
  }

  toast.className = `fixed bottom-6 right-6 z-[9999] flex items-center justify-between gap-4 px-6 py-4 rounded-2xl text-white font-bold shadow-2xl transition-all duration-500 translate-y-24 opacity-0 ${bgClass}`;

  toast.innerHTML = `
    <div class="flex items-center gap-3">
      <div class="${type === 'processing' ? 'animate-spin' : ''}">
        <i data-lucide="${icon}" class="w-6 h-6"></i>
      </div>
      <div class="flex flex-col">
        <span class="text-sm font-black tracking-wide leading-tight">${label}</span>
        <span class="text-xs font-medium text-white/90 mt-0.5">${message}</span>
      </div>
    </div>
  `;

  document.body.appendChild(toast);
  if (window.lucide) window.lucide.createIcons({ root: toast });

  // Slide in
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-24', 'opacity-0');
  });

  // Auto destroy if not persisted
  if (!persist) {
    setTimeout(() => {
      toast.classList.add('translate-y-24', 'opacity-0');
      setTimeout(() => toast.remove(), 500);
    }, 4000);
  }

  return toast;
}

async function finalizeHireDirectly(id) {
  const app = allApplications.find(a => String(a.id) === String(id));
  if (!app) return;

  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const extractedEmail = (app.message || "").match(emailRegex);
  const email = extractedEmail ? extractedEmail[0] : prompt("Candidate email not found. Please enter manually:");
  if (!email) return;

  const roleMatch = (app.message || "").match(/(?:role|position|applying for|job title)[\s:]*([^\n<]+)/i);
  let role = "staff"; // Default fallback
  if (roleMatch && roleMatch[1]) {
    role = roleMatch[1].trim().toLowerCase();
  } else {
    // If exact field isn't clear, check simple keywords
    const msg = (app.message || "").toLowerCase();
    if (msg.includes("dental nurse")) role = "dental nurse";
    else if (msg.includes("nurse")) role = "nurse";
    else if (msg.includes("doctor") || msg.includes("dentist")) role = "doctor";
    else if (msg.includes("admin") || msg.includes("receptionist")) role = "admin";
  }

  // Capitalize first letter for visual niceness in email
  const displayRole = role.charAt(0).toUpperCase() + role.slice(1);

  const loadingToast = showRecruitmentToast(`Hiring ${app.sender_name}... Generating ${displayRole} credentials.`, "processing", true);

  try {
    // Generate secure password frontend-side
    // Generate secure but clear password (no ambiguous characters like 0/O or 1/l)
    const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#";
    let generatedPassword = "";
    for (let i = 0; i < 10; i++) {
      generatedPassword += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    // 2. Insert into clinic_staff
    // Map roles to standard DB categories: 'nurse', 'doctor', 'admin'
    let dbRole = "nurse"; // Default fallback
    if (role.includes("doctor") || role.includes("dentist")) {
      dbRole = "doctor";
    } else if (role.includes("admin") || role.includes("recep") || role.includes("clerk")) {
      dbRole = "admin";
    } else {
      dbRole = "nurse";
    }

    // Check if staff already exists by email to prevent 400 Unique Constraint error
    const { data: existingStaff } = await sb.from("clinic_staff").select("id").eq("email", email).maybeSingle();

    if (existingStaff) {
      const { error: updateError } = await sb.from("clinic_staff").update({
        role: dbRole,
        name: app.sender_name,
        is_available: true
      }).eq("email", email);
      if (updateError) throw new Error("Staff update failed: " + updateError.message);
    } else {
      const { error: staffError } = await sb.from("clinic_staff").insert([{
        name: app.sender_name,
        email: email,
        role: dbRole,
        is_available: true
      }]);
      if (staffError) throw new Error("Staff DB insert failed: " + (staffError.details || staffError.message));
    }

    // 2.5 Create Auth User so they can actually login
    try {
      const tempAuth = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
      const { data: authData, error: authError } = await tempAuth.auth.signUp({
        email: email,
        password: generatedPassword,
        options: {
          data: {
            full_name: app.sender_name,
            role: dbRole
          }
        }
      });
      
      if (authError) {
        if (authError.message.includes("already registered")) {
           console.log("User already exists in Auth, skipping creation.");
        } else {
           throw new Error("Security Account Error: " + authError.message);
        }
      } else if (!authData.user) {
        throw new Error("Security account creation returned empty data.");
      }
    } catch (authErr) {
      console.error("Critical Auth Error:", authErr);
      if (loadingToast) loadingToast.remove();
      showRecruitmentToast("Hire Failed at Security Step: " + authErr.message, "error");
      return; 
    }

    // 3. Trigger Welcome Email
    const response = await fetch("/api/recruitment/hire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name: app.sender_name, role, password: generatedPassword })
    });
    const result = await response.json();
    if (!response.ok) {
      console.error("Email API Error:", result.error);
      showRecruitmentToast("Hired locally, but welcome email failed. User can still login with manual credentials.", "error");
    }

    // 4. Update Application Status
    await updateApplicationStatus(id, 'hired');

    loadingToast.remove();
    // Use a custom modal for the success so they can copy the password if needed
    await showAlert("Hiring Successful", `Hired ${app.sender_name} successfully!\n\nCredentials:\nEmail: ${email}\nPassword: ${generatedPassword}\n\nThese details were also sent to their email.`, "success");
  } catch (err) {
    if (loadingToast) loadingToast.remove();
    showRecruitmentToast("Hiring failed: " + err.message, "error");
  }
}


// ============================
// REPORTS & ANALYTICS PAGE
// ============================
let reportTypeChartInstance = null;
let reportDailyChartInstance = null;

function setReportRange(range) {
  const from = document.getElementById("reportDateFrom");
  const to = document.getElementById("reportDateTo");
  const now = new Date();
  const fmt = d => d.toISOString().split("T")[0];
  if (range === "today") { from.value = fmt(now); to.value = fmt(now); }
  else if (range === "week") { const s = new Date(now); s.setDate(now.getDate() - now.getDay()); from.value = fmt(s); to.value = fmt(now); }
  else if (range === "month") { from.value = fmt(new Date(now.getFullYear(), now.getMonth(), 1)); to.value = fmt(now); }
  else if (range === "year") { from.value = fmt(new Date(now.getFullYear(), 0, 1)); to.value = fmt(now); }
  document.querySelectorAll(".report-range-btn").forEach(b => { b.classList.remove("bg-blue-100", "text-blue-600"); b.classList.add("bg-slate-100", "text-slate-500"); });
  if (event && event.target) { event.target.classList.remove("bg-slate-100", "text-slate-500"); event.target.classList.add("bg-blue-100", "text-blue-600"); }
  initReportsPage();
}

async function initReportsPage() {
  const from = document.getElementById("reportDateFrom");
  const to = document.getElementById("reportDateTo");
  if (!from.value) { 
    const now = new Date(); 
    from.value = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0]; 
    to.value = now.toISOString().split("T")[0]; 
  }
  const startDate = from.value, endDate = to.value;
  
  // Show loading states
  document.getElementById("reportTotalAppts").textContent = "...";
  document.getElementById("reportTopConditions").innerHTML = `<p class="text-xs text-slate-400 text-center py-6 font-bold uppercase tracking-widest animate-pulse">Fetching latest data...</p>`;

  // Fetch specifically for the range to avoid using the potentially-filtered 'allAppointments'
  const { data: filtered, error } = await sb
    .from("appointments")
    .select("*")
    .gte("appointment_date", startDate)
    .lte("appointment_date", endDate);

  if (error) {
    console.error("Error fetching report data:", error);
    return;
  }

  const total = filtered.length;
  const completed = filtered.filter(a => { const s = (a.status || "").toLowerCase(); return s === "completed" || s === "done"; }).length;
  const cancelled = filtered.filter(a => { const s = (a.status || "").toLowerCase(); return s === "cancelled"; }).length;
  const uniquePatients = new Set(filtered.map(a => a.patient_name)).size;
  
  document.getElementById("reportTotalAppts").textContent = total;
  document.getElementById("reportCompletedAppts").textContent = completed;
  document.getElementById("reportCancelledAppts").textContent = cancelled;
  document.getElementById("reportUniquePatients").textContent = uniquePatients;
  
  const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
  const trendEl = document.getElementById("reportTotalTrend");
  if (trendEl) trendEl.innerHTML = `<i data-lucide="trending-up" class="w-3 h-3"></i> ${rate}% done`;

  // Doughnut Chart
  const typeCounts = {}; 
  filtered.forEach(a => { 
    const t = a.appointment_type || "Other"; 
    typeCounts[t] = (typeCounts[t] || 0) + 1; 
  });
  const typeLabels = Object.keys(typeCounts), typeData = Object.values(typeCounts);
  const typeColors = ["#6366f1", "#06b6d4", "#f59e0b", "#10b981", "#ec4899", "#8b5cf6", "#f97316", "#14b8a6"];
  if (reportTypeChartInstance) reportTypeChartInstance.destroy();
  const typeCtx = document.getElementById("reportTypeChart");
  if (typeCtx && window.Chart) {
    reportTypeChartInstance = new Chart(typeCtx, { type: "doughnut", data: { labels: typeLabels, datasets: [{ data: typeData, backgroundColor: typeColors.slice(0, typeLabels.length), borderWidth: 0, hoverOffset: 8 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: "68%", plugins: { legend: { display: false } } } });
  }
  const legendEl = document.getElementById("reportTypeLegend");
  if (legendEl) legendEl.innerHTML = typeLabels.map((l, i) => `<div class="flex items-center gap-2 text-[11px] font-bold text-slate-600"><span class="w-3 h-3 rounded-full shrink-0" style="background:${typeColors[i % typeColors.length]}"></span>${l} <span class="text-slate-400">(${typeData[i]})</span></div>`).join("");

  // Bar Chart
  const dailyCounts = {}; 
  filtered.forEach(a => { 
    const d = a.appointment_date ? a.appointment_date.split("T")[0] : null; 
    if (d) dailyCounts[d] = (dailyCounts[d] || 0) + 1; 
  });
  const dailyLabels = Object.keys(dailyCounts).sort(), dailyData = dailyLabels.map(d => dailyCounts[d]);
  if (reportDailyChartInstance) reportDailyChartInstance.destroy();
  const dailyCtx = document.getElementById("reportDailyChart");
  if (dailyCtx && window.Chart) {
    reportDailyChartInstance = new Chart(dailyCtx, { type: "bar", data: { labels: dailyLabels.map(d => { const dt = new Date(d + "T00:00"); return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" }); }), datasets: [{ label: "Appointments", data: dailyData, backgroundColor: "rgba(99,102,241,0.7)", borderRadius: 8, borderSkipped: false, barPercentage: 0.6 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 10, weight: "bold" } }, grid: { color: "#f1f5f9" } }, x: { ticks: { font: { size: 9, weight: "bold" }, maxRotation: 45 }, grid: { display: false } } } } });
  }

  // Top Patients
  const patientCounts = {}; 
  filtered.forEach(a => { 
    if (a.patient_name) patientCounts[a.patient_name] = (patientCounts[a.patient_name] || 0) + 1; 
  });
  const topP = Object.entries(patientCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const topPEl = document.getElementById("reportTopPatients");
  if (topPEl) {
    if (topP.length === 0) { 
      topPEl.innerHTML = `<p class="text-xs text-slate-400 text-center py-6 font-bold uppercase tracking-widest">No data in selected range</p>`; 
    } else {
      const pc = ["from-violet-500 to-indigo-600", "from-blue-500 to-cyan-600", "from-emerald-500 to-teal-600", "from-amber-500 to-orange-600", "from-rose-500 to-pink-600"];
      topPEl.innerHTML = topP.map((p, i) => { 
        const ini = p[0].split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2); 
        return `<div class="flex items-center gap-3 p-3 rounded-xl bg-slate-50/50 border border-slate-100/50 hover:bg-white hover:shadow-sm transition-all"><div class="w-9 h-9 rounded-xl bg-gradient-to-br ${pc[i % pc.length]} flex items-center justify-center text-white text-[11px] font-black shrink-0 shadow-sm">${ini}</div><div class="flex-1 min-w-0"><p class="text-[12px] font-bold text-slate-700 truncate">${p[0]}</p><p class="text-[10px] font-bold text-slate-400">${p[1]} appt${p[1] > 1 ? "s" : ""}</p></div><span class="text-[10px] font-black text-slate-400 bg-slate-100 px-2 py-1 rounded-lg">#${i + 1}</span></div>`; 
      }).join("");
    }
  }

    // Top Conditions
    const conditionCounts = {};
    filtered.forEach(a => {
        const notes = a.patient_condition || "";
        const type = (a.appointment_type || "").toLowerCase();
        
        // 1. Try to find a formal diagnosis tag first
        const diagMatch = notes.match(/Diagnosed:\s*([^\[\n]+)/i);
        let condition = "";
        
        if (diagMatch && diagMatch[1]) {
            condition = diagMatch[1].trim();
        } else {
            // 2. If no diagnosis tag, clean the notes to extract a meaningful snippet
            condition = notes
                .replace(/\[\[.*?\]\]/g, "") // Handle double brackets first
                .replace(/\[.*?\]/g, "")     // Handle single brackets
                .replace(/\{.*?\}/g, "")     // Handle braces
                .replace(/(?:First Time Visit|Medical History|First Visit|Prev Conditions):[^\[\n]*/gi, "")
                .trim();
        }

        // Cleanup: Remove any remaining artifacts and truncate
        condition = condition.replace(/[\[\]{}]+/g, "").trim();
        
        // Fallback to Appointment Type if notes are empty or just artifacts
        if (!condition || condition.length < 2) {
            if (type === "consultation") condition = "General Consultation";
            else if (type === "followups") condition = "Follow-up Visit";
            else if (type === "schedule") condition = "Routine Checkup";
            else condition = "General Case";
        }

        // Final Truncation for list display
        if (condition.length > 30) {
            condition = condition.substring(0, 27) + "...";
        }

        if (condition && condition !== "—") {
            conditionCounts[condition] = (conditionCounts[condition] || 0) + 1;
        }
    });
  
  const topC = Object.entries(conditionCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const topCEl = document.getElementById("reportTopConditions");
  if (topCEl) {
    if (topC.length === 0) { 
      topCEl.innerHTML = `<p class="text-xs text-slate-400 text-center py-6 font-bold uppercase tracking-widest">No data in selected range</p>`; 
    } else { 
      topCEl.innerHTML = topC.map((c, i) => `
        <div class="flex items-center gap-3 p-3 rounded-xl bg-slate-50/50 border border-slate-100/50 hover:bg-white hover:shadow-sm transition-all">
          <div class="w-9 h-9 rounded-xl bg-teal-50 flex items-center justify-center text-teal-600 shrink-0">
            <i data-lucide="activity" class="w-4 h-4"></i>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-[12px] font-bold text-slate-700 truncate">${c[0]}</p>
            <p class="text-[10px] font-bold text-slate-400">${c[1]} case${c[1] > 1 ? "s" : ""}</p>
          </div>
          <span class="text-[10px] font-black text-slate-400 bg-slate-100 px-2 py-1 rounded-lg">#${i + 1}</span>
        </div>`).join(""); 
    }
  }

  from.onchange = () => initReportsPage();
  to.onchange = () => initReportsPage();

  if (window.lucide) window.lucide.createIcons();
}


// ============================
// AUDIT TRAIL PAGE
// ============================
function initAuditTrailPage() {
  const si = document.getElementById("auditSearchInput");
  const tf = document.getElementById("auditTypeFilter");
  const so = document.getElementById("auditSortOrder");
  const rb = document.getElementById("refreshAuditBtn");
  renderAuditTrail();
  if (si) si.oninput = () => renderAuditTrail();
  if (tf) tf.onchange = () => renderAuditTrail();
  if (so) so.onchange = () => renderAuditTrail();
  if (rb) rb.onclick = () => { fetchAppointments(); setTimeout(renderAuditTrail, 1000); };
}

function renderAuditTrail() {
  const query = (document.getElementById("auditSearchInput")?.value || "").toLowerCase();
  const filterType = document.getElementById("auditTypeFilter")?.value || "all";
  const sort = document.getElementById("auditSortOrder")?.value || "newest";
  const logList = document.getElementById("auditLogList");
  const todayStr = new Date().toISOString().split("T")[0];
  let entries = [];

  allAppointments.forEach(a => {
    const dateStr = a.appointment_date ? a.appointment_date.split("T")[0] : todayStr;
    const timeStr = a.appointment_time || "00:00";
    const ts = new Date(dateStr + "T" + timeStr);
    entries.push({ category: "appointment", icon: "calendar-plus", color: "blue", title: "Appointment Scheduled", detail: `${a.patient_name || "Unknown"} — ${a.appointment_type || "General"} with Clinic Staff`, timestamp: ts, dateStr });
    const status = (a.status || "").toLowerCase();
    if (status === "completed" || status === "done") entries.push({ category: "appointment", icon: "check-circle-2", color: "emerald", title: "Appointment Completed", detail: `${a.patient_name || "Unknown"} — ${a.appointment_type || "General"} marked as completed`, timestamp: new Date(ts.getTime() + 3600000), dateStr });
    else if (status === "cancelled") entries.push({ category: "appointment", icon: "x-circle", color: "rose", title: "Appointment Cancelled", detail: `${a.patient_name || "Unknown"} — ${a.appointment_type || "General"} was cancelled`, timestamp: new Date(ts.getTime() + 1800000), dateStr });
    if (a.patient_condition && a.patient_condition.includes("[PLAN:")) { const m = a.patient_condition.match(/\[PLAN:([^\]]+)\]/); if (m) entries.push({ category: "patient", icon: "clipboard-list", color: "violet", title: "Treatment Plan Assigned", detail: `Plan "${m[1]}" assigned to ${a.patient_name || "Unknown"}`, timestamp: new Date(ts.getTime() + 900000), dateStr }); }
    if (a.patient_condition && a.patient_condition.includes("[accomplished:")) { for (const m of a.patient_condition.matchAll(/\[accomplished:\s*([^\]]+)\]/gi)) { entries.push({ category: "patient", icon: "award", color: "amber", title: "Phase Accomplished", detail: `${a.patient_name || "Unknown"} completed: ${m[1].trim()}`, timestamp: new Date(ts.getTime() + 7200000), dateStr }); } }
  });

  allPatients.forEach(p => {
    entries.push({ category: "patient", icon: "user-plus", color: "indigo", title: "Patient Registered", detail: `${p.full_name || p.name || "Unknown"} joined the clinic`, timestamp: p.created_at ? new Date(p.created_at) : new Date(), dateStr: p.created_at ? p.created_at.split("T")[0] : todayStr });
  });

  if (typeof allStaffData !== 'undefined') {
    allStaffData.forEach(s => {
      entries.push({ category: "system", icon: "user-cog", color: "amber", title: "Staff Assigned", detail: `${s.name} assigned as ${s.role || 'Staff'}`, timestamp: s.created_at ? new Date(s.created_at) : new Date(), dateStr: s.created_at ? s.created_at.split("T")[0] : todayStr });
    });
  }

  entries.push({ category: "system", icon: "log-in", color: "teal", title: "Admin Session Started", detail: `${currentAdminStaff ? currentAdminStaff.name : "Administrator"} logged into the portal`, timestamp: new Date(), dateStr: todayStr });

  if (filterType !== "all") entries = entries.filter(e => e.category === filterType);
  if (query) entries = entries.filter(e => e.title.toLowerCase().includes(query) || e.detail.toLowerCase().includes(query));
  entries.sort((a, b) => sort === "newest" ? b.timestamp - a.timestamp : a.timestamp - b.timestamp);

  const el = id => document.getElementById(id);
  if (el("auditTotalEvents")) el("auditTotalEvents").textContent = entries.length;
  if (el("auditApptEvents")) el("auditApptEvents").textContent = entries.filter(e => e.category === "appointment").length;
  if (el("auditPatientEvents")) el("auditPatientEvents").textContent = entries.filter(e => e.category === "patient").length;
  if (el("auditTodayEvents")) el("auditTodayEvents").textContent = entries.filter(e => e.dateStr === todayStr).length;
  if (el("auditShowingCount")) el("auditShowingCount").textContent = `Showing ${entries.length} events`;

  const display = entries.slice(0, 100);
  if (!logList) return;
  if (display.length === 0) {
    logList.innerHTML = `<div class="flex flex-col items-center justify-center py-16 text-center"><div class="w-20 h-20 rounded-[24px] bg-slate-50 flex items-center justify-center mb-4"><i data-lucide="search-x" class="w-8 h-8 text-slate-300"></i></div><p class="text-sm font-black text-slate-400">No matching events</p><p class="text-[10px] font-bold text-slate-300 uppercase tracking-widest mt-1">Try adjusting your filters</p></div>`;
    if (window.lucide) window.lucide.createIcons(); return;
  }

  logList.innerHTML = display.map((e, i) => {
    const timeAgo = getAuditTimeAgo(e.timestamp);
    const dateD = e.timestamp.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const timeD = e.timestamp.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return `<div class="flex items-start gap-4 px-6 py-4 hover:bg-slate-50/50 transition-colors" style="animation: fadeIn 0.3s ease ${i * 20}ms both;"><div class="w-10 h-10 rounded-xl bg-${e.color}-50 flex items-center justify-center shrink-0 mt-0.5"><i data-lucide="${e.icon}" class="w-4.5 h-4.5 text-${e.color}-600"></i></div><div class="flex-1 min-w-0"><div class="flex items-center gap-2 flex-wrap"><p class="text-[12px] font-black text-slate-700">${e.title}</p><span class="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md bg-${e.color}-50 text-${e.color}-600">${e.category}</span></div><p class="text-[11px] font-medium text-slate-500 mt-0.5 truncate">${e.detail}</p></div><div class="text-right shrink-0"><p class="text-[10px] font-bold text-slate-400">${timeAgo}</p><p class="text-[9px] font-bold text-slate-300 mt-0.5">${dateD} ${timeD}</p></div></div>`;
  }).join("");
  if (window.lucide) window.lucide.createIcons();
}


function getAuditTimeAgo(date) {
  const diff = Math.floor((new Date() - date) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / 604800)}w ago`;
}

// ============================
// FLOATING CHAT NOTIFICATIONS
// ============================
function updateFloatingChatBadge(count) {
  const badge = document.getElementById("headerMessageBadge");
  if (!badge) return;

  if (count > 0) {
    badge.textContent = count > 99 ? "99+" : count;
    badge.classList.remove("hidden");
    badge.classList.add("flex");

    // Pop animation
    if (badge.dataset.lastCount !== String(count)) {
      badge.style.transform = "scale(1.4)";
      setTimeout(() => badge.style.transform = "scale(1)", 200);
    }
    badge.dataset.lastCount = count;
  } else {
    badge.classList.add("hidden");
    badge.classList.remove("flex");
    badge.dataset.lastCount = 0;
  }
}

function showFloatingChatNotification(totalUnread) {
  if (typeof showRecruitmentToast === "function") {
    showRecruitmentToast(`You have ${totalUnread} unread message${totalUnread > 1 ? 's' : ''}`, "info");
  }
}

// Global unread count tracker (to detect increments)
let lastTotalUnreadCount = 0;
let isFirstLoadMessages = true;

async function refreshUnreadCount() {
  if (!sb) return;
  try {
    const { data: rawMessages, error } = await sb
      .from('messages')
      .select('session_id, sender_type, is_seen')
      .eq('sender_type', 'patient')
      .eq('is_seen', false);
    if (!error && rawMessages) {
      checkUnreadMessageChange(rawMessages);
    }
  } catch (e) {
    console.error("Error refreshing unread count:", e);
  }
}

function checkUnreadMessageChange(messages) {
  const currentUnread = messages.filter(m => {
    if (m.sender_type !== 'patient') return false;
    if (m.is_seen) return false;
    if (adminDeletedSessions.has(m.session_id)) return false;
    if (adminBlockedSessions.has(m.session_id)) return false;
    if (adminArchivedSessions.has(m.session_id)) return false;
    return true;
  }).length;
  updateFloatingChatBadge(currentUnread);

  // Only notify if count increased AND it's not the initial dashboard load
  if (currentUnread > lastTotalUnreadCount && !isFirstLoadMessages) {
    showFloatingChatNotification(currentUnread);
  }

  lastTotalUnreadCount = currentUnread;
  isFirstLoadMessages = false;
}

// --- Admin Collapsible Sidebar Toggle ---
window.toggleAdminSidebarCollapse = function () {
  const sidebar = document.getElementById("adminSidebar");
  if (!sidebar) return;
  sidebar.classList.toggle("collapsed");

  // Re-run lucide to fix any icon rendering in mini state
  if (window.lucide) window.lucide.createIcons();
};

// --- Dynamic Sidebar Date Update ---
function updateSidebarDateTime() {
  const dateEl = document.getElementById("sidebarDateDisplay");
  const dayEl = document.getElementById("sidebarDayDisplay");
  if (!dateEl || !dayEl) return;

  const now = new Date();
  const options = { month: 'long', day: 'numeric', year: 'numeric' };
  dateEl.textContent = now.toLocaleDateString('en-US', options);

  const dayOptions = { weekday: 'long' };
  dayEl.textContent = now.toLocaleDateString('en-US', dayOptions);
}

// Initialize Sidebar Date
updateSidebarDateTime();
// Keep it fresh every minute
setInterval(updateSidebarDateTime, 60000);

// --- Admin Credentials Update Handler ---


// Helper for password visibility toggle
window.togglePasswordVisibility = function (inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const icon = input.nextElementSibling?.querySelector('i');
  if (input.type === "password") {
    input.type = "text";
    if (window.lucide) {
      input.nextElementSibling.innerHTML = '<i data-lucide="eye-off" class="w-4 h-4"></i>';
      window.lucide.createIcons();
    }
  } else {
    input.type = "password";
    if (window.lucide) {
      input.nextElementSibling.innerHTML = '<i data-lucide="eye" class="w-4 h-4"></i>';
      window.lucide.createIcons();
    }
  }
};

// ============================
// PENDING PATIENTS LOGIC
// ============================

async function fetchPendingPatients() {
  const body = document.getElementById("pendingPatientsBody");
  const empty = document.getElementById("pendingEmptyState");
  const countEl = document.getElementById("pendingCount");
  if (!body) return;

  body.innerHTML = `<tr><td colspan="4" class="px-6 py-10 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest">Loading pending accounts...</td></tr>`;

  try {
    const { data, error } = await sb
      .from("patients")
      .select("*")
      .eq("account_status", "pending")
      .order("full_name", { ascending: true });

    if (error) {
      if (error.code === '42703') {
        body.innerHTML = `<tr><td colspan="4" class="px-6 py-10 text-center text-amber-600 text-[10px] font-black uppercase tracking-widest font-bold">
          <i data-lucide="database" class="w-4 h-4 mx-auto mb-2 opacity-50"></i>
          Database Update Required:<br>Please add the 'account_status' column to the 'patients' table in Supabase.
        </td></tr>`;
        if (window.lucide) window.lucide.createIcons({ root: body });
        return;
      }
      throw error;
    }

    body.innerHTML = "";
    if (!data || data.length === 0) {
      if (empty) empty.classList.remove("hidden");
      if (countEl) countEl.textContent = "0 Pending";
      return;
    }

    if (empty) empty.classList.add("hidden");
    if (countEl) countEl.textContent = `${data.length} Pending`;

    const calculateAge = (birthday) => {
      if (!birthday) return "N/A";
      const birthDate = new Date(birthday);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const m = today.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      return age;
    };

    data.forEach(p => {
      const age = calculateAge(p.birthday);
      const row = document.createElement("tr");
      row.className = "hover:bg-slate-50/50 transition-colors group cursor-pointer";
      
      // Make only the text areas clickable for the modal, not the action buttons
      row.onclick = (e) => {
        if (!e.target.closest('button')) {
          showPendingPatientModal(p, age);
        }
      };

      row.innerHTML = `
        <td class="px-6 py-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center text-orange-600 shrink-0 font-black text-xs uppercase">
              ${p.full_name.charAt(0)}
            </div>
            <div class="flex flex-col">
              <span class="text-[13px] font-black text-slate-700 tracking-tight">${p.full_name}</span>
              <span class="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">${p.gender || "No Gender"} • Age: ${age} • ${p.birthday || "No Birthday"}</span>
            </div>
          </div>
        </td>
        <td class="px-6 py-4">
          <div class="flex flex-col">
            <span class="text-[12px] font-bold text-slate-600">${p.contact_no}</span>
            <span class="text-[11px] text-slate-400">${p.email}</span>
          </div>
        </td>
        <td class="px-6 py-4">
          <span class="text-[11px] font-medium text-slate-500">${p.created_at ? new Date(p.created_at).toLocaleDateString() : "N/A"}</span>
        </td>
        <td class="px-6 py-4 text-right">
          <div class="flex items-center justify-end gap-2">
            <button class="btn-approve px-3 py-1.5 rounded-xl bg-emerald-500 text-white text-[10px] font-black uppercase tracking-widest hover:bg-emerald-600 shadow-sm shadow-emerald-500/20 transition-all active:scale-95">
              Accept
            </button>
            <button class="btn-decline px-3 py-1.5 rounded-xl bg-rose-50 text-rose-500 text-[10px] font-black uppercase tracking-widest hover:bg-rose-100 transition-all active:scale-95">
              Decline
            </button>
          </div>
        </td>
      `;

      // Attach button listeners
      row.querySelector('.btn-approve').onclick = (e) => {
        e.stopPropagation();
        currentPendingPatient = p;
        approvePatientAction();
      };
      row.querySelector('.btn-decline').onclick = (e) => {
        e.stopPropagation();
        currentPendingPatient = p;
        declinePatientAction();
      };

      body.appendChild(row);
    });

    if (window.lucide) window.lucide.createIcons({ root: body });

  } catch (err) {
    console.error("Error fetching pending patients:", err);
    body.innerHTML = `<tr><td colspan="4" class="px-6 py-10 text-center text-rose-500 text-[10px] font-black uppercase tracking-widest">Failed to load data.</td></tr>`;
  }
}

let currentPendingPatient = null;

function showPendingPatientModal(p, age) {
  currentPendingPatient = p;
  const modal = document.getElementById("pendingPatientDetailModal");
  if (!modal) return;

  document.getElementById("detName").textContent = p.full_name;
  document.getElementById("detGender").textContent = p.gender || "N/A";
  document.getElementById("detAge").textContent = age;
  document.getElementById("detBirthday").textContent = p.birthday || "N/A";
  document.getElementById("detAddress").textContent = p.address || "No Address Provided";
  document.getElementById("detPhone").textContent = p.contact_no || "N/A";
  document.getElementById("detEmail").textContent = p.email || "N/A";
  document.getElementById("detRegDate").textContent = p.created_at ? new Date(p.created_at).toLocaleString() : "N/A";
  
  // Update action buttons in modal
  const footer = modal.querySelector(".modal-footer-actions");
  if (footer) {
    footer.innerHTML = `
      <button onclick="approvePatientAction(); closePendingModal()" class="flex-1 py-3 rounded-2xl bg-emerald-500 text-white text-[11px] font-black uppercase tracking-widest hover:bg-emerald-600 transition-all">Accept Patient</button>
      <button onclick="declinePatientAction(); closePendingModal()" class="flex-1 py-3 rounded-2xl bg-slate-100 text-slate-500 text-[11px] font-black uppercase tracking-widest hover:bg-slate-200 transition-all">Decline</button>
    `;
  }

  modal.classList.remove("hidden");
  modal.classList.add("flex");
}

function closePendingModal() {
  const modal = document.getElementById("pendingPatientDetailModal");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
}

async function approvePatientAction() {
  if (!currentPendingPatient) return;
  const { full_name, email } = currentPendingPatient;

  const confirmed = await showConfirm(
    "Accept Patient?",
    `Are you sure you want to ACCEPT ${full_name} as a patient?`,
    "success"
  );

  if (!confirmed) return;

  try {
    const { error } = await sb
      .from("patients")
      .update({ account_status: "approved" })
      .eq("full_name", full_name);

    if (error) throw error;

    // Send Email Notification
    if (email) {
      try {
        await fetch("/api/patient/status-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email, name: full_name, status: "approved" })
        });
      } catch (e) { console.error("Email notification failed:", e); }
    }

    fetchPendingPatients();
    fetchPatients(); // Refresh the main accounts directory
  } catch (err) {
    console.error("Error approving patient:", err);
    alert("Failed to approve patient.");
  }
}

async function declinePatientAction() {
  if (!currentPendingPatient) return;
  const { full_name, email } = currentPendingPatient;

  const confirmed = await showConfirm(
    "Decline Patient?",
    `Are you sure you want to DECLINE ${full_name}? They will not be able to log in.`,
    "danger"
  );

  if (!confirmed) return;

  try {
    const { error } = await sb
      .from("patients")
      .update({ account_status: "declined" })
      .eq("full_name", full_name);

    if (error) throw error;

    // Send Email Notification
    if (email) {
      try {
        await fetch("/api/patient/status-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email, name: full_name, status: "declined" })
        });
      } catch (e) { console.error("Email notification failed:", e); }
    }

    alert(`${full_name} has been declined and a notification email has been sent.`);
    fetchPendingPatients();
  } catch (err) {
    console.error("Error declining patient:", err);
    alert("Failed to decline patient.");
  }
}

// ---- Custom Alert Modal Helper ----
function showAlert(title, message, type = 'success') {
  return showConfirm(title, message, type, true);
}

// ---- Custom Confirm Modal Helper ----
function showConfirm(title, message, type = 'danger', isAlert = false) {
  return new Promise((resolve) => {
    const modal = document.getElementById("customConfirmModal");
    const card = document.getElementById("customConfirmCard");
    const iconContainer = document.getElementById("customConfirmIconContainer");
    const iconEl = document.getElementById("customConfirmIcon");
    const titleEl = document.getElementById("customConfirmTitle");
    const msgEl = document.getElementById("customConfirmMessage");
    const yesBtn = document.getElementById("customConfirmYes");
    const noBtn = document.getElementById("customConfirmNo");

    if (!modal || !card) {
      alert(message);
      resolve(true);
      return;
    }

    // Adjust theme based on type
    if (type === 'success') {
      iconContainer.className = "w-20 h-20 bg-emerald-50 rounded-3xl flex items-center justify-center mx-auto mb-6 text-emerald-500 shadow-inner";
      iconEl.setAttribute("data-lucide", "check-circle");
      yesBtn.className = "w-full py-4 bg-gradient-to-br from-emerald-500 to-teal-600 text-white rounded-2xl text-[12px] font-black uppercase tracking-[2px] shadow-lg shadow-emerald-500/25 hover:scale-[1.02] active:scale-95 transition-all";
      yesBtn.textContent = isAlert ? "Okay" : "Yes, Confirm";
    } else {
      iconContainer.className = "w-20 h-20 bg-rose-50 rounded-3xl flex items-center justify-center mx-auto mb-6 text-rose-500 shadow-inner";
      iconEl.setAttribute("data-lucide", "alert-triangle");
      yesBtn.className = "w-full py-4 bg-gradient-to-br from-rose-500 to-pink-600 text-white rounded-2xl text-[12px] font-black uppercase tracking-[2px] shadow-lg shadow-rose-500/25 hover:scale-[1.02] active:scale-95 transition-all";
      yesBtn.textContent = isAlert ? "Okay" : "Yes, Confirm";
    }

    if (isAlert) {
      noBtn.classList.add("hidden");
    } else {
      noBtn.classList.remove("hidden");
    }

    titleEl.textContent = title;
    msgEl.textContent = message;

    modal.classList.remove("hidden");
    if (window.lucide) window.lucide.createIcons({ root: modal });

    setTimeout(() => {
      card.classList.remove("scale-95", "opacity-0");
      card.classList.add("scale-100", "opacity-100");
    }, 10);

    const cleanup = (result) => {
      card.classList.add("scale-95", "opacity-0");
      card.classList.remove("scale-100", "opacity-100");
      setTimeout(() => {
        modal.classList.add("hidden");
        resolve(result);
      }, 200);
    };

    yesBtn.onclick = () => cleanup(true);
    noBtn.onclick = () => cleanup(false);
    modal.onclick = (e) => { if (e.target === modal) cleanup(false); };
  });
}

// ---- Global Loader Helpers (Disabled) ----
function showGlobalLoader() {
  // Disabled as per user request
}

function hideGlobalLoader() {
  // Disabled as per user request
}

// ---- Custom Prompt Modal Helper ----
function showPrompt(title, message, defaultValue = "") {
  return new Promise((resolve) => {
    const modal = document.getElementById("customPromptModal");
    const card = document.getElementById("customPromptCard");
    const titleEl = document.getElementById("customPromptTitle");
    const msgEl = document.getElementById("customPromptMessage");
    const inputEl = document.getElementById("customPromptInput");
    const yesBtn = document.getElementById("customPromptYes");
    const noBtn = document.getElementById("customPromptNo");

    if (!modal || !card) {
      resolve(prompt(message, defaultValue));
      return;
    }

    titleEl.textContent = title;
    msgEl.textContent = message;
    inputEl.value = defaultValue;

    modal.classList.remove("hidden");
    if (window.lucide) window.lucide.createIcons({ root: modal });

    setTimeout(() => {
      card.classList.remove("scale-95", "opacity-0");
      card.classList.add("scale-100", "opacity-100");
      inputEl.focus();
    }, 10);

    const cleanup = (result) => {
      card.classList.add("scale-95", "opacity-0");
      card.classList.remove("scale-100", "opacity-100");
      setTimeout(() => {
        modal.classList.add("hidden");
        resolve(result);
      }, 200);
    };

    yesBtn.onclick = () => cleanup(inputEl.value);
    noBtn.onclick = () => cleanup(null);
    modal.onclick = (e) => { if (e.target === modal) cleanup(null); };
  });
}


