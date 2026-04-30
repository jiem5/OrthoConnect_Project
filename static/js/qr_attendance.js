// =============================================
// QR ATTENDANCE KIOSK — JAVASCRIPT
// OrthoConnect Clinic Management System
// =============================================

// ---- SUPABASE CONFIG (same as main app) ----
const SUPABASE_URL = "https://ctoybxukmkcnwdeueorm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0b3lieHVrbWtjbndkZXVlb3JtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3ODg3NzAsImV4cCI6MjA4ODM2NDc3MH0.hLDzyCvNzWbrXW-5Z1NsE6eH2sF_3S5L33htZYjEiH0";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- Utility: Robust Time Parser ----
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

function getElapsedMinutes(currentMins, openMins) {
  if (currentMins >= openMins) return currentMins - openMins;
  return (1440 - openMins) + currentMins;
}

function getTotalShiftMinutes(openMins, closeMins) {
  if (closeMins < openMins) return (1440 - openMins) + closeMins;
  return closeMins - openMins;
}

// ---- CLINIC CONFIGURATION ----
const CLINIC_CONFIG = {
  openingTime: "09:00",   // 9:00 AM
  closingTime: "17:00",   // 5:00 PM
  graceMinutes: 10,       // 10 minutes grace period for late
  maxLeavePerMonth: 3,    // 3 days leave per month

  // GEOLOCATION CONFIG (Placeholder: Change to clinic's exact coords)
  clinicLat: 14.1770696851092,    // Office Latitude (Example: Manila)
  clinicLon: 121.26719967463303,    // Office Longitude
  allowedRadius: 150      // Allowed distance in meters
};

// ---- STATE ----
let allStaff = [];
let allAttendance = [];
let recentScans = [];
let html5QrScanner = null;
let isScannerRunning = false;
let scanCooldown = false;
let dbClinicSettings = null; // Stores live settings from DB

async function fetchLiveClinicSettings() {
  try {
    const { data, error } = await sb.from("clinics").select("*").limit(1);
    if (error) throw error;
    if (data && data.length > 0) {
      dbClinicSettings = data[0];
      // Update the rules UI dynamically
      const openEl = document.getElementById("qrRuleOpen");
      const closeEl = document.getElementById("qrRuleClose");
      const graceEl = document.getElementById("qrRuleGrace");

      const formatTime = (timeStr) => {
        if (!timeStr) return "";
        const [h, m] = timeStr.split(":");
        if (!h || !m) return timeStr;
        const hour = parseInt(h, 10);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const hour12 = hour % 12 || 12;
        return `${hour12}:${m} ${ampm}`;
      };

      if (openEl) openEl.textContent = formatTime(dbClinicSettings.opening_time) || "9:00 AM";
      if (closeEl) closeEl.textContent = formatTime(dbClinicSettings.closing_time) || "5:00 PM";
      if (graceEl) graceEl.textContent = (dbClinicSettings.grace_period || 10) + " min";

      // Force UI update immediately after fetching new settings
      if (typeof updateClinicCountdown === "function") {
        updateClinicCountdown(new Date());
      }
    }
  } catch (err) {
    console.warn("Could not load DB settings.", err);
  }
}

// ---- INIT ----
document.addEventListener("DOMContentLoaded", async () => {
  startLiveClock();

  // Fetch Live Clinic Settings and setup polling
  await fetchLiveClinicSettings();
  setInterval(fetchLiveClinicSettings, 8000);

  await loadStaff();
  await loadAttendance();
  updateTodayStats();
  renderRecentScans();
  setupTabs();
  setupLeaveForm();
  renderStaffQRCards();
  renderLeaveRecords();

  // Auto-mark absent for staff who haven't scanned at end of day
  autoMarkAbsent();
});

// =============================================
// TAB NAVIGATION
// =============================================
function setupTabs() {
  const tabs = document.querySelectorAll(".tab-btn");
  tabs.forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;
      tabs.forEach(t => t.classList.remove("active"));
      btn.classList.add("active");

      document.querySelectorAll(".tab-content").forEach(c => {
        c.classList.remove("active");
      });
      const content = document.getElementById(`tab-${target}`);
      if (content) content.classList.add("active");

      // Start/stop scanner based on tab
      if (target === "scanner") {
        // Don't auto-start, let user click button
      } else {
        stopScanner();
      }

      // Refresh QR cards when switching to that tab
      if (target === "qrcodes") {
        renderStaffQRCards();
      }
      if (target === "leave") {
        renderLeaveRecords();
      }
    });
  });
}

// =============================================
// LIVE CLOCK
// =============================================
function updateClinicCountdown(now) {
  const statusInd = document.getElementById("clinicStatusIndicator");
  const statusTxt = document.getElementById("clinicStatusText");
  const countTxt = document.getElementById("clinicCountdownText");
  if (!statusInd || !statusTxt || !countTxt) return;

  if (!dbClinicSettings) {
    statusTxt.textContent = "Connecting...";
    return;
  }

  const clinicManualOpen = dbClinicSettings.is_open !== false;
  const currentDay = now.getDay();
  const operatingDays = dbClinicSettings.operating_days || [1, 2, 3, 4, 5];
  const isOperatingDay = operatingDays.some(d => parseInt(d, 10) === currentDay);

  if (!clinicManualOpen) {
    statusInd.style.background = "#ef4444";
    statusInd.style.boxShadow = "0 0 8px rgba(239, 68, 68, 0.4)";
    statusTxt.textContent = "CLINIC CLOSED";
    statusTxt.style.color = "#ef4444";
    countTxt.textContent = "Manually closed by admin";
    return;
  }

  if (!isOperatingDay) {
    statusInd.style.background = "#ef4444";
    statusInd.style.boxShadow = "0 0 8px rgba(239, 68, 68, 0.4)";
    statusTxt.textContent = "CLOSED TODAY";
    statusTxt.style.color = "#ef4444";
    countTxt.textContent = "Not an operating day";
    return;
  }

  const openTimeStr = dbClinicSettings.opening_time || CLINIC_CONFIG.openingTime;
  const closeTimeStr = dbClinicSettings.closing_time || CLINIC_CONFIG.closingTime;
  const { h: oH, m: oM } = parseTimeString(openTimeStr);
  const { h: cH, m: cM } = parseTimeString(closeTimeStr);

  const nowTotalMins = now.getHours() * 60 + now.getMinutes();
  const openTotalMins = oH * 60 + oM;
  const closeTotalMins = cH * 60 + cM;

  const totalShift = getTotalShiftMinutes(openTotalMins, closeTotalMins);
  const elapsed = getElapsedMinutes(nowTotalMins, openTotalMins);

  let isCurrentlyOpen = false;
  let isBeforeOpening = false;
  let diffToClose = 0;
  let diffToOpen = 0;

  if (elapsed <= totalShift) {
    if (elapsed === totalShift) {
      isCurrentlyOpen = false;
    } else {
      isCurrentlyOpen = true;
      diffToClose = totalShift - elapsed;
    }
  } else {
    isBeforeOpening = true;
    diffToOpen = 1440 - elapsed;
  }

  if (isBeforeOpening) {
    const hrs = Math.floor(diffToOpen / 60);
    const mins = diffToOpen % 60;
    statusInd.style.background = "#f59e0b";
    statusInd.style.boxShadow = "0 0 8px rgba(245, 158, 11, 0.4)";
    statusTxt.textContent = "OPENING SOON";
    statusTxt.style.color = "#f59e0b";
    countTxt.textContent = `Opens in ${hrs > 0 ? hrs + 'h ' : ''}${mins}m`;
  } else if (isCurrentlyOpen) {
    const hrs = Math.floor(diffToClose / 60);
    const mins = diffToClose % 60;
    statusInd.style.background = "#10b981";
    statusInd.style.boxShadow = "0 0 8px rgba(16, 185, 129, 0.4)";
    statusTxt.textContent = "CLINIC OPEN";
    statusTxt.style.color = "#10b981";
    countTxt.textContent = `Closes in ${hrs > 0 ? hrs + 'h ' : ''}${mins}m`;
  } else {
    statusInd.style.background = "#ef4444";
    statusInd.style.boxShadow = "0 0 8px rgba(239, 68, 68, 0.4)";
    statusTxt.textContent = "CLINIC CLOSED";
    statusTxt.style.color = "#ef4444";
    countTxt.textContent = "Operating hours ended";
  }
}

function startLiveClock() {
  function update() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true
    });
    const dateStr = now.toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric"
    });

    const clockEl = document.getElementById("liveClock");
    const dateEl = document.getElementById("liveDate");
    if (clockEl) clockEl.textContent = timeStr;
    if (dateEl) dateEl.textContent = dateStr;

    updateClinicCountdown(now);
  }
  update();
  setInterval(update, 1000);
}


// =============================================
// SUPABASE FETCHERS
// =============================================
async function loadStaff() {
  try {
    const { data, error } = await sb
      .from("clinic_staff")
      .select("*")
      .order("name", { ascending: true });
    if (error) throw error;
    allStaff = data || [];
  } catch (err) {
    console.error("Failed to load staff:", err);
    allStaff = [];
  }
}

async function loadAttendance() {
  try {
    const { data, error } = await sb
      .from("attendance")
      .select("*")
      .order("date", { ascending: false })
      .order("clock_in", { ascending: false });
    if (error) throw error;
    allAttendance = data || [];
  } catch (err) {
    console.error("Failed to load attendance:", err);
    allAttendance = [];
  }
}

// =============================================
// QR SCANNER
// =============================================
async function startScanner() {
  const container = document.getElementById("qr-reader");
  const placeholder = document.getElementById("scannerPlaceholder");
  const overlay = document.getElementById("scannerOverlay");
  const startBtn = document.getElementById("startScanBtn");
  const stopBtn = document.getElementById("stopScanBtn");

  if (isScannerRunning) return;

  if (placeholder) placeholder.style.display = "none";
  if (container) container.style.display = "block";
  if (overlay) overlay.style.display = "flex";

  // Initialize once if needed
  if (!html5QrScanner) {
    html5QrScanner = new Html5Qrcode("qr-reader");
  }

  try {
    // Determine optimal configuration
    const config = {
      fps: 30, // Increased for snappier recognition
      qrbox: { width: 220, height: 220 },
      aspectRatio: 1.0,
      disableFlip: false,
      experimentalFeatures: {
        useBarCodeDetectorIfSupported: true
      }
    };

    // Try starting with environment camera (back camera)
    await html5QrScanner.start(
      { facingMode: "environment" },
      config,
      onScanSuccess,
      (err) => { /* ignore noisy continuous scanning errors silently */ }
    ).catch(async (e) => {
      console.warn("Could not start with environment camera, trying default...", e);
      // Fallback to any available camera if environment fails
      await html5QrScanner.start(
        { facingMode: "user" },
        config,
        onScanSuccess,
        (err) => { /* ignore */ }
      );
    });

    isScannerRunning = true;
    if (startBtn) startBtn.style.display = "none";
    if (stopBtn) stopBtn.style.display = "inline-flex";

    // Start Real-time instructions
    startScannerFeedback();

    // Aesthetic upgrade
    container.style.boxShadow = "0 0 0 4px rgba(14, 165, 233, 0.4)";
    showToast("Scanner active! Align QR code in the frame.", "info");

  } catch (err) {
    console.error("Scanner failed to start:", err);
    showToast("Camera Error: Please ensure you've allowed camera access.", "error");
    if (placeholder) placeholder.style.display = "flex";
    if (container) container.style.display = "none";
    if (overlay) overlay.style.display = "none";
  }
}

function stopScanner() {
  if (!isScannerRunning || !html5QrScanner) return;

  html5QrScanner.stop().then(() => {
    isScannerRunning = false;
    const startBtn = document.getElementById("startScanBtn");
    const stopBtn = document.getElementById("stopScanBtn");
    const placeholder = document.getElementById("scannerPlaceholder");
    const container = document.getElementById("qr-reader");
    const overlay = document.getElementById("scannerOverlay");

    // Stop feedback
    stopScannerFeedback();

    if (startBtn) startBtn.style.display = "inline-flex";
    if (stopBtn) stopBtn.style.display = "none";
    if (placeholder) placeholder.style.display = "flex";
    if (overlay) overlay.style.display = "none";
    if (container) {
      container.style.display = "none";
      container.style.boxShadow = "none";
    }
  }).catch(err => {
    console.error("Scanner stop error:", err);
    isScannerRunning = false; // Force status update anyway
  });
}

// ---- Handle Scan Result ----
async function onScanSuccess(decodedText) {
  try {
    // Beep sound to confirm camera caught something
    try {
      const audio = new Audio("https://actions.google.com/sounds/v1/alarms/beep_short.ogg");
      audio.play().catch(e => { });
    } catch (e) { }

    console.log("QR Processing:", decodedText);

    // Cooldown to prevent double scans
    if (scanCooldown) return;

    // Parse: "ORTHO_STAFF:Name:Role:Date:Token"
    const parts = decodedText.split(":");
    if (parts.length < 3 || parts[0].trim().toUpperCase() !== "ORTHO_STAFF") {
      scanCooldown = true;
      setTimeout(() => { scanCooldown = false; }, 1500);
      showScanResult("error", "Invalid QR", "This is not a valid OrthoConnect specialist badge.", null);
      return;
    }

    // Extraction (Format: ORTHO_STAFF:Name:Role:Date:Token:DeviceID)
    const qrName = parts[1]?.trim() || "Unknown";
    const qrRole = parts[2]?.trim() || "Staff";
    const qrDate = parts[3]?.trim();
    const qrToken = parts[4]?.trim();
    const qrDeviceId = parts[5]?.trim();
    const today = (typeof getTodayStr === 'function') ? getTodayStr() : new Date().toISOString().split('T')[0];

    // QR expiration logic removed for 24/7 scanning with static badges


    // Success Start processing
    scanCooldown = true;
    setTimeout(() => { scanCooldown = false; }, 10000); // 10s cooldown for success

    // Verify staff
    const staff = allStaff.find(s => s.name?.trim().toLowerCase() === qrName.toLowerCase());
    if (!staff) {
      showScanResult("error", "Unknown Specialist", `"${qrName}" not found in system.`, null);
      return;
    }

    showToast(`Welcome, ${staff.name}!`, "info");
    await processAttendanceScan(staff.name, staff.role || qrRole, qrDeviceId);

  } catch (err) {
    console.error("Critical Scan Error:", err);
    showScanResult("error", "System Error", "Something went wrong while processing the scan. Check console.", null);
  }
}

// ---- Process Attendance Logic ----

// ---- Process Attendance Logic ----
async function processAttendanceScan(staffName, staffRole, qrDeviceId = null) {
  const today = getTodayStr();
  const now = new Date();
  const timeNow = formatTimeNow();

  // 0. GEOLOCATION CHECK (Optimized for speed)
  try {
    const position = await new Promise((resolve, reject) => {
      // Use maximumAge to get cached location instantly if available
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        timeout: 3000,
        maximumAge: 60000
      });
    });

    const distance = calculateDistance(
      position.coords.latitude,
      position.coords.longitude,
      CLINIC_CONFIG.clinicLat,
      CLINIC_CONFIG.clinicLon
    );

    if (distance > CLINIC_CONFIG.allowedRadius) {
      const msg = `Out of range! You are ${Math.round(distance)}m away. Attendance must be scanned within the clinic premises.`;
      showScanResult("error", "Location Blocked", msg, null);
      showToast("Access Denied: Distance too far", "error");
      return;
    }
  } catch (err) {
    console.warn("Location check error:", err);
    showScanResult("error", "Location Needed", "Please enable GPS/Location access to verify you are at the clinic.", null);
    showToast("GPS Error: Location required", "error");
    return;
  }

  // 1. Check Clinic Status (Use pre-fetched settings for speed)
  const clinicManualOpen = dbClinicSettings?.is_open !== false;
  const currentDay = now.getDay(); // 0(Sun) - 6(Sat)
  const operatingDays = dbClinicSettings?.operating_days || [1, 2, 3, 4, 5]; // Default Mon-Fri if not set

  // Convert operatingDays array (strings/ints) to sorted numbers for checking
  const isOperatingDay = operatingDays.some(d => parseInt(d, 10) === currentDay);

  // Time-based check
  const openTimeStr = dbClinicSettings?.opening_time || CLINIC_CONFIG.openingTime;
  const closeTimeStr = dbClinicSettings?.closing_time || CLINIC_CONFIG.closingTime;
  const { h: oH, m: oM } = parseTimeString(openTimeStr);
  const { h: cH, m: cM } = parseTimeString(closeTimeStr);

  const nowH = now.getHours();
  const nowM = now.getMinutes();
  const nowTotalMins = nowH * 60 + nowM;
  const openTotalMins = oH * 60 + oM;
  const closeTotalMins = cH * 60 + cM;

  const totalShift = getTotalShiftMinutes(openTotalMins, closeTotalMins);
  const elapsed = getElapsedMinutes(nowTotalMins, openTotalMins);
  const isOperatingTime = elapsed <= totalShift;

  // Clinic status checks removed to allow 24/7 scanning for static badges
/*
  if (!clinicManualOpen) {
    showScanResult("error", "Clinic Closed", "Public scanning is currently disabled by the administrator.", null);
    showToast("Clinic is manually closed", "error");
    return;
  }

  if (!isOperatingDay) {
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const msg = `Today (${dayNames[currentDay]}) is not a scheduled clinic operating day.`;
    showScanResult("error", "Not Operating Today", msg, null);
    showToast("Clinic is closed today", "error");
    return;
  }

  if (!isOperatingTime) {
    const msg = `Clinic is closed. Operating hours are from ${openTimeStr} to ${closeTimeStr}.`;
    showScanResult("error", "Outside Hours", msg, null);
    showToast("Outside clinic hours", "error");
    return;
  }
*/

  // 2. DEVICE BINDING SECURITY
  if (qrDeviceId) {
    try {
      const { data: deviceLog, error: dError } = await sb.from("attendance")
        .select("staff_name")
        .eq("date", today)
        .eq("device_id", qrDeviceId)
        .neq("staff_name", staffName) // Check if used by SOMEONE ELSE
        .limit(1);

      if (dError) throw dError;

      if (deviceLog && deviceLog.length > 0) {
        const msg = `This device has already been used by ${deviceLog[0].staff_name} today. Proxy scanning is disabled for security.`;
        showScanResult("error", "Security: Device Locked", msg, null);
        showToast("Device Binding Violation", "error");
        return;
      }
    } catch (err) {
      console.warn("Device check failed, skipping security check to ensure continuity.", err);
    }
  }

  // Check if already has a record today
  const existing = allAttendance.find(r => r.staff_name === staffName && r.date === today);

  // 3. REMOVED TESTING OVERRIDE: 
  // If record exists and status is already Absent or On-Leave, they cannot scan anymore today.
  if (existing && (existing.status === "absent" || existing.status === "on-leave")) {
    const reason = existing.status === "absent" ? "You are marked ABSENT for today." : "You are currently ON LEAVE.";
    showScanResult("error", "Access Denied", reason, null);
    showToast(reason, "error");
    return;
  }

  // LOGIC: If no record exists OR if record exists but they haven't clocked in yet 
  if (!existing || !existing.clock_in) {
    // ---- CLOCK IN ----
    const status = determineClockInStatus(now);

    try {
      // Calculate Lateness Duration for notes and display
      let statusNote = "QR scan clock-in";
      let lateLabel = "";
      if (status === "late" || status === "half-day") {
        const openingStr = dbClinicSettings?.opening_time || CLINIC_CONFIG.openingTime;
        const { h: oH, m: oM } = parseTimeString(openingStr);
        const openMins = oH * 60 + oM;
        const nowMins = now.getHours() * 60 + now.getMinutes();
        const diff = nowMins - openMins;
        const hours = Math.floor(diff / 60);
        const mins = diff % 60;
        lateLabel = `Late by ${hours > 0 ? hours + 'h ' : ''}${mins}m`;
        statusNote += ` (${lateLabel})`;
      }

      if (!existing) {
        // Create new record
        const { error } = await sb.from("attendance").insert([{
          staff_name: staffName,
          staff_role: staffRole,
          date: today,
          clock_in: timeNow,
          status: status,
          notes: statusNote,
          device_id: qrDeviceId // Save Device ID
        }]);
        if (error) throw error;
      } else {
        // Update existing 'absent' or 'on-leave' record to be a valid clock-in
        const { error } = await sb.from("attendance").update({
          clock_in: timeNow,
          status: status,
          notes: (existing.notes || "") + ` | ${statusNote} (Override ${existing.status === 'on-leave' ? 'Leave' : 'Absent'})`,
          device_id: qrDeviceId
        }).eq("id", existing.id);
        if (error) throw error;
      }

      // Restore availability on clock-in
      await sb.from("clinic_staff").update({ is_available: true }).eq("name", staffName);

      await loadAttendance();
      updateTodayStats();

      let dispStatus = status === "present" ? "Present" : (status === "late" ? "Late" : "Half Day");
      const scanDisplayMsg = lateLabel ? `Clocked in at ${formatTime12h(timeNow)} (${lateLabel})` : `Clocked in at ${formatTime12h(timeNow)}`;

      showScanResult("success", staffName, scanDisplayMsg, {
        role: staffRole,
        status: status,
        time: timeNow,
        action: "Clock In"
      });

      addRecentScan(staffName, staffRole, "Clock In", status, timeNow);
      showToast(`${staffName} clocked in — ${dispStatus}`, status === "present" ? "success" : "warning");

    } catch (err) {
      console.error("Clock-in error:", err);
      showToast("Failed to record clock-in: " + err.message, "error");
    }

  } else if (existing.clock_in && !existing.clock_out) {
    // ---- CLOCK OUT ----
    const hoursWorked = calcHoursWorked(existing.clock_in, timeNow);
    const totalWorkHours = calcTotalWorkHours();
    const halfDayThreshold = totalWorkHours / 2;

    // Determine if half-day
    let finalStatus = existing.status; // keep original (present/late)
    if (hoursWorked <= halfDayThreshold) {
      finalStatus = "half-day";
    }

    try {
      const updatePayload = {
        clock_out: timeNow,
        status: finalStatus,
        total_hours: hoursWorked,
        notes: (existing.notes || "") + ` | QR scan clock-out (${hoursWorked.toFixed(1)}h)`
      };

      const { error } = await sb.from("attendance").update(updatePayload).eq("id", existing.id);
      if (error) throw error;

      await loadAttendance();
      updateTodayStats();

      const statusLabel = finalStatus === "half-day" ? "Half Day" : (finalStatus === "late" ? "Late" : "Present");
      showScanResult("success", staffName, `Clocked out at ${formatTime12h(timeNow)} — ${hoursWorked.toFixed(1)} hours`, {
        role: staffRole,
        status: finalStatus,
        time: timeNow,
        action: "Clock Out",
        hours: hoursWorked.toFixed(1)
      });

      addRecentScan(staffName, staffRole, "Clock Out", finalStatus, timeNow);

      if (finalStatus === "half-day") {
        showToast(`${staffName} clocked out — Half Day (${hoursWorked.toFixed(1)}h)`, "warning");
      } else {
        showToast(`${staffName} clocked out — ${hoursWorked.toFixed(1)} hours`, "success");
      }

    } catch (err) {
      console.error("Clock-out error:", err);
      showToast("Failed to record clock-out: " + err.message, "error");
    }

  } else if (existing.clock_out) {
    // ---- ALREADY DONE ----
    showScanResult("warning", staffName, `Already completed for today. In: ${formatTime12h(existing.clock_in)} | Out: ${formatTime12h(existing.clock_out)}`, {
      role: staffRole,
      status: existing.status,
      time: null,
      action: "Already Done"
    });
    showToast(`${staffName} has already completed attendance today.`, "info");

    // ---- ON LEAVE EXCEPTION REMOVED FOR TESTING ----
    // (Handled at the start of the function for testing purposes as requested)
  }
}

// ---- Determine Clock-In Status ----
function determineClockInStatus(now) {
  const openingStr = dbClinicSettings?.opening_time || CLINIC_CONFIG.openingTime;
  const closingStr = dbClinicSettings?.closing_time || CLINIC_CONFIG.closingTime;
  const graceMinutesVal = dbClinicSettings?.grace_period || CLINIC_CONFIG.graceMinutes;

  const { h: openH, m: openM } = parseTimeString(openingStr);
  const { h: closeH, m: closeM } = parseTimeString(closingStr);

  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;

  const totalShift = getTotalShiftMinutes(openMinutes, closeMinutes);
  const elapsed = getElapsedMinutes(now.getHours() * 60 + now.getMinutes(), openMinutes);

  const midpointElapsed = totalShift / 2;

  if (elapsed <= graceMinutesVal) {
    return "present";
  } else if (elapsed < midpointElapsed) {
    return "late";
  } else {
    return "half-day";
  }
}

// ---- Calculate Hours Worked ----
function calcHoursWorked(clockIn, clockOut) {
  const [h1, m1] = clockIn.split(":").map(Number);
  const [h2, m2] = clockOut.split(":").map(Number);
  let mins1 = h1 * 60 + m1;
  let mins2 = h2 * 60 + m2;
  if (mins2 < mins1) mins2 += 1440;
  const mins = mins2 - mins1;
  return Math.max(0, mins / 60);
}

// ---- Calculate Total Work Hours ----
function calcTotalWorkHours() {
  const openingStr = dbClinicSettings?.opening_time || CLINIC_CONFIG.openingTime;
  const closingStr = dbClinicSettings?.closing_time || CLINIC_CONFIG.closingTime;

  const { h: oh, m: om } = parseTimeString(openingStr);
  const { h: ch, m: cm } = parseTimeString(closingStr);
  return getTotalShiftMinutes(oh * 60 + om, ch * 60 + cm) / 60;
}

// =============================================
// AUTO-MARK ABSENT
// =============================================
async function autoMarkAbsent() {
  const today = getTodayStr();
  const now = new Date();

  const openingStr = dbClinicSettings?.opening_time || CLINIC_CONFIG.openingTime;
  const closingStr = dbClinicSettings?.closing_time || CLINIC_CONFIG.closingTime;
  const { h: openH, m: openM } = parseTimeString(openingStr);
  const { h: closeH, m: closeM } = parseTimeString(closingStr);

  const nowMins = now.getHours() * 60 + now.getMinutes();
  const openMins = openH * 60 + openM;
  const closeMins = closeH * 60 + closeM;

  const elapsed = getElapsedMinutes(nowMins, openMins);
  const totalShift = getTotalShiftMinutes(openMins, closeMins);

  // Only auto-mark after closing time
  if (elapsed <= totalShift) {
    return;
  }

  for (const staff of allStaff) {
    const hasRecord = allAttendance.find(r => r.staff_name === staff.name && r.date === today);
    if (!hasRecord) {
      try {
        await sb.from("attendance").insert([{
          staff_name: staff.name,
          staff_role: staff.role || "Staff",
          date: today,
          status: "absent",
          notes: "Auto-marked absent (no QR scan)"
        }]);
      } catch (err) {
        console.error(`Auto-absent error for ${staff.name}:`, err);
      }
    }
  }

  // Reload
  await loadAttendance();
  updateTodayStats();
}

// =============================================
// SCAN RESULT DISPLAY
// =============================================
function showScanResult(type, name, message, details) {
  const panel = document.getElementById("scanResultPanel");
  if (!panel) return;

  const initials = name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
  const avatarGradients = {
    success: "linear-gradient(135deg, #059669, #10b981)",
    error: "linear-gradient(135deg, #dc2626, #ef4444)",
    warning: "linear-gradient(135deg, #d97706, #f59e0b)"
  };

  let statusBadgeHtml = "";
  if (details && details.status) {
    const badgeClass = `badge-${details.status}`;
    const label = {
      present: "✓ Present", late: "⏰ Late", "half-day": "½ Half Day",
      absent: "✗ Absent", "on-leave": "📋 On Leave"
    }[details.status] || details.status;
    statusBadgeHtml = `<span class="scan-status-badge ${badgeClass}">${label}</span>`;
  }

  let actionHtml = "";
  if (details && details.action) {
    actionHtml = `<p style="font-size:11px; font-weight:700; color:#64748b; margin-top:6px;">${details.action}${details.hours ? ` — ${details.hours}h worked` : ""}</p>`;
  }

  panel.innerHTML = `
    <div class="scan-status-card scan-status-${type}">
      <div class="scan-avatar" style="background: ${avatarGradients[type] || avatarGradients.success}">${initials}</div>
      <p class="scan-name">${escapeHtml(name)}</p>
      ${details && details.role ? `<p class="scan-role">${escapeHtml(details.role)}</p>` : ""}
      ${details && details.time ? `<p class="scan-time">${formatTime12h(details.time)}</p>` : ""}
      <p style="font-size:12px; font-weight:600; color:#475569; margin:8px 0;">${escapeHtml(message)}</p>
      ${statusBadgeHtml}
      ${actionHtml}
    </div>
  `;
}

// =============================================
// RECENT SCANS
// =============================================
function addRecentScan(name, role, action, status, time) {
  recentScans.unshift({ name, role, action, status, time, timestamp: new Date() });
  if (recentScans.length > 10) recentScans.pop();
  renderRecentScans();
}

function renderRecentScans() {
  const list = document.getElementById("recentScansList");
  if (!list) return;

  if (recentScans.length === 0) {
    list.innerHTML = `
      <div class="empty-state" style="padding: 32px 16px;">
        <div class="empty-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 7h.01M7 12h.01M12 7h.01"/></svg>
        </div>
        <p class="empty-title" style="font-size:13px;">No scans yet</p>
        <p class="empty-desc" style="font-size:11px;">Start scanning QR codes to see activity here</p>
      </div>`;
    return;
  }

  const gradients = [
    "linear-gradient(135deg, #0891b2, #0d9488)",
    "linear-gradient(135deg, #6366f1, #8b5cf6)",
    "linear-gradient(135deg, #059669, #10b981)",
    "linear-gradient(135deg, #d97706, #f59e0b)",
    "linear-gradient(135deg, #dc2626, #ef4444)"
  ];

  list.innerHTML = recentScans.map((s, i) => {
    const initials = s.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
    const grad = gradients[i % gradients.length];
    const badgeColors = {
      present: "background:#d1fae5; color:#065f46;",
      late: "background:#fef3c7; color:#92400e;",
      "half-day": "background:#dbeafe; color:#1e40af;",
      absent: "background:#fee2e2; color:#991b1b;",
      "on-leave": "background:#ede9fe; color:#5b21b6;"
    };
    const badgeStyle = badgeColors[s.status] || badgeColors.present;
    const statusLabel = {
      present: "Present", late: "Late", "half-day": "Half Day",
      absent: "Absent", "on-leave": "On Leave"
    }[s.status] || s.status;

    return `
      <div class="recent-scan-item" style="animation-delay:${i * 50}ms">
        <div class="recent-scan-avatar" style="background:${grad}">${initials}</div>
        <div class="recent-scan-info">
          <p class="recent-scan-name">${escapeHtml(s.name)}</p>
          <p class="recent-scan-detail">${s.action} • ${formatTime12h(s.time)}</p>
        </div>
        <span class="recent-scan-badge" style="${badgeStyle}">${statusLabel}</span>
      </div>`;
  }).join("");
}

// =============================================
// TODAY STATS
// =============================================
function updateTodayStats() {
  const today = getTodayStr();
  const todayRecords = allAttendance.filter(r => r.date === today);

  const presentCount = todayRecords.filter(r => r.status === "present" || r.status === "late" || r.status === "half-day").length;
  const lateCount = todayRecords.filter(r => r.status === "late").length;
  const absentCount = todayRecords.filter(r => r.status === "absent").length;
  const leaveCount = todayRecords.filter(r => r.status === "on-leave").length;

  setEl("statPresent", presentCount);
  setEl("statLate", lateCount);
  setEl("statAbsent", absentCount);
  setEl("statLeave", leaveCount);
}

// =============================================
// QR CODE GENERATION
// =============================================
function renderStaffQRCards() {
  const grid = document.getElementById("staffQRGrid");
  if (!grid) return;

  if (allStaff.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1/-1;">
        <div class="empty-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>
        </div>
        <p class="empty-title">No Specialists Found</p>
        <p class="empty-desc">Add specialists in the admin panel first</p>
      </div>`;
    return;
  }

  const today = getTodayStr();
  // We'll use a local token for rendering (based on config)
  // In a real environment, we'd fetch from DB but here we use the UI state
  const statusToken = "OPN"; // Default for kiosk unless closed

  grid.innerHTML = allStaff.map((staff, idx) => {
    const initials = (staff.name || "??").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
    const qrData = `ORTHO_STAFF:${staff.name}:${staff.role || "Staff"}:${today}:${statusToken}`;

    return `
      <div class="staff-qr-card" style="animation: fadeInUp 0.4s ease ${idx * 80}ms both;">
        <div class="staff-qr-avatar">${initials}</div>
        <p class="staff-qr-name">${escapeHtml(staff.name)}</p>
        <p class="staff-qr-role">${escapeHtml(staff.role || "Staff")}</p>
        <div class="qr-code-box" id="qr-${idx}"></div>
        <div class="staff-qr-actions">
          <button class="btn btn-outline btn-sm" onclick="downloadQR(${idx}, '${escapeHtml(staff.name)}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download
          </button>
          <button class="btn btn-primary btn-sm" onclick="printQR(${idx}, '${escapeHtml(staff.name)}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            Print
          </button>
        </div>
      </div>`;
  }).join("");

  // Generate QR codes after DOM update
  setTimeout(() => {
    allStaff.forEach((staff, idx) => {
      const container = document.getElementById(`qr-${idx}`);
      if (container && !container.querySelector("canvas")) {
        const today = getTodayStr();
        const qrData = `ORTHO_STAFF:${staff.name}:${staff.role || "Staff"}:${today}:OPN`;
        new QRCode(container, {
          text: qrData,
          width: 256,
          height: 256,
          colorDark: "#0f172a",
          colorLight: "#ffffff",
          correctLevel: QRCode.CorrectLevel.M // Medium error correction = better reliability on different screens!
        });

        // Scale down the 256px canvas with CSS to fit the layout
        const canvas = container.querySelector("canvas");
        const img = container.querySelector("img");
        if (canvas) canvas.style.width = "160px";
        if (img) img.style.width = "160px";
      }
    });
  }, 200);
}

function downloadQR(idx, name) {
  const container = document.getElementById(`qr-${idx}`);
  if (!container) return;

  const canvas = container.querySelector("canvas");
  if (!canvas) return;

  const link = document.createElement("a");
  link.download = `QR_${name.replace(/\s+/g, "_")}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
  showToast(`QR code for ${name} downloaded!`, "success");
}

function printQR(idx, name) {
  const container = document.getElementById(`qr-${idx}`);
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
      <script>window.onload = function() { window.print(); }</script>
    </body>
    </html>
  `);
  printWindow.document.close();
}

// =============================================
// LEAVE MANAGEMENT
// =============================================
function setupLeaveForm() {
  const form = document.getElementById("leaveForm");
  if (!form) return;

  // Populate staff dropdown
  const select = document.getElementById("leaveStaffSelect");
  if (select) {
    select.innerHTML = `<option value="">Select staff member...</option>`;
    allStaff.forEach(s => {
      select.innerHTML += `<option value="${escapeHtml(s.name)}" data-role="${escapeHtml(s.role || "Staff")}">${escapeHtml(s.name)} — ${escapeHtml(s.role || "Staff")}</option>`;
    });

    // Show leave balance when staff is selected
    select.addEventListener("change", () => {
      updateLeaveBalanceDisplay(select.value);
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const staffName = document.getElementById("leaveStaffSelect")?.value;
    const leaveDate = document.getElementById("leaveDate")?.value;
    const leaveReason = document.getElementById("leaveReason")?.value?.trim() || "";

    if (!staffName || !leaveDate) {
      showToast("Please select a staff member and date.", "error");
      return;
    }

    // Check leave balance
    const usedLeaves = getUsedLeaves(staffName, leaveDate);
    if (usedLeaves >= CLINIC_CONFIG.maxLeavePerMonth) {
      showToast(`${staffName} has used all ${CLINIC_CONFIG.maxLeavePerMonth} leave days this month!`, "error");
      return;
    }

    // Check if already has record for that date
    const existing = allAttendance.find(r => r.staff_name === staffName && r.date === leaveDate);
    if (existing) {
      showToast(`${staffName} already has an attendance record for ${leaveDate}.`, "error");
      return;
    }

    const staff = allStaff.find(s => s.name === staffName);
    const role = staff?.role || "Staff";

    try {
      const { error } = await sb.from("attendance").insert([{
        staff_name: staffName,
        staff_role: role,
        date: leaveDate,
        status: "on-leave",
        notes: `Leave: ${leaveReason || "No reason provided"}`
      }]);
      if (error) throw error;

      await loadAttendance();
      updateTodayStats();
      renderLeaveRecords();
      updateLeaveBalanceDisplay(staffName);
      form.reset();
      showToast(`Leave recorded for ${staffName} on ${leaveDate}!`, "success");
    } catch (err) {
      console.error("Leave error:", err);
      showToast("Failed to record leave: " + err.message, "error");
    }
  });
}

function getUsedLeaves(staffName, dateStr) {
  const d = new Date(dateStr || Date.now());
  const monthStr = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  return allAttendance.filter(r =>
    r.staff_name === staffName &&
    r.status === "on-leave" &&
    r.date && r.date.startsWith(monthStr)
  ).length;
}

function updateLeaveBalanceDisplay(staffName) {
  const balanceContainer = document.getElementById("leaveBalanceDisplay");
  if (!balanceContainer) return;

  if (!staffName) {
    balanceContainer.innerHTML = "";
    return;
  }

  const leaveDate = document.getElementById("leaveDate")?.value || getTodayStr();
  const used = getUsedLeaves(staffName, leaveDate);
  const remaining = Math.max(0, CLINIC_CONFIG.maxLeavePerMonth - used);
  const pct = (used / CLINIC_CONFIG.maxLeavePerMonth) * 100;

  balanceContainer.innerHTML = `
    <div class="leave-balance-wrapper">
      <div class="leave-balance-circle" style="--leave-pct: ${pct}%">
        <div class="leave-balance-inner">${remaining}</div>
      </div>
      <div class="leave-balance-text">
        <h4>${remaining} of ${CLINIC_CONFIG.maxLeavePerMonth} days remaining</h4>
        <p>${used} leave day${used !== 1 ? "s" : ""} used this month</p>
      </div>
    </div>`;
}

function renderLeaveRecords() {
  const container = document.getElementById("leaveRecordsList");
  if (!container) return;

  const leaveRecords = allAttendance
    .filter(r => r.status === "on-leave")
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 20);

  if (leaveRecords.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:32px;">
        <div class="empty-icon" style="background:#f5f3ff;">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        </div>
        <p class="empty-title">No Leave Records</p>
        <p class="empty-desc">Filed leaves will appear here</p>
      </div>`;
    return;
  }

  container.innerHTML = leaveRecords.map((r, idx) => {
    const initials = (r.staff_name || "??").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
    const reason = (r.notes || "").replace("Leave: ", "");

    return `
      <div class="leave-record" style="animation: fadeInUp 0.3s ease ${idx * 40}ms both;">
        <div class="leave-avatar">${initials}</div>
        <div class="leave-info">
          <p class="leave-name">${escapeHtml(r.staff_name)}</p>
          <p class="leave-dates">${r.date} • ${escapeHtml(reason || "No reason")}</p>
        </div>
        <span class="scan-status-badge badge-on-leave" style="font-size:9px;">On Leave</span>
      </div>`;
  }).join("");
}

// =============================================
// TOAST NOTIFICATIONS
// =============================================
function showToast(message, type = "info") {
  let container = document.getElementById("toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  const icons = {
    success: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
    error: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    warning: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    info: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`
  };

  toast.innerHTML = `${icons[type] || icons.info}<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(40px)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// =============================================
// UTILITY FUNCTIONS
// =============================================
function getTodayStr() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function formatTimeNow() {
  const now = new Date();
  return String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
}

function formatTime12h(time24) {
  if (!time24) return "—";
  const [h, m] = time24.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${m} ${ampm}`;
}

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
// ---- SMART SCANNER FEEDBACK SYSTEM ----
let feedbackInterval = null;
let instructionIndex = 0;
const generalInstructions = [
  "Align QR Code within frame",
  "Hold steady for a few seconds",
  "Ensure good lighting",
  "Keep distance 10-15cm",
  "Avoid screen reflections",
  "Make sure QR is centered"
];

function startScannerFeedback() {
  if (feedbackInterval) clearInterval(feedbackInterval);

  // Reset UI
  instructionIndex = 0;
  const ft = document.getElementById("feedbackText");
  if (ft) ft.textContent = generalInstructions[0];

  feedbackInterval = setInterval(() => {
    if (!isScannerRunning) {
      stopScannerFeedback();
      return;
    }
    analyzeScannerConditions();
  }, 3000);
}

function stopScannerFeedback() {
  if (feedbackInterval) {
    clearInterval(feedbackInterval);
    feedbackInterval = null;
  }
}

function analyzeScannerConditions() {
  const video = document.querySelector("#qr-reader video");
  const feedbackText = document.getElementById("feedbackText");
  const pulse = document.querySelector(".feedback-icon-pulse");
  if (!video || !feedbackText) return;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, 64, 64);
    const data = ctx.getImageData(0, 0, 64, 64).data;

    let colorSum = 0;
    for (let x = 0; x < data.length; x += 4) {
      colorSum += (data[x] + data[x + 1] + data[x + 2]) / 3;
    }
    const brightness = Math.floor(colorSum / (data.length / 4));

    if (brightness < 45) {
      feedbackText.textContent = "⚠️ Too dark! Move to light";
      if (pulse) pulse.style.background = "#ef4444";
    } else if (brightness > 225) {
      feedbackText.textContent = "⚠️ Too bright! Reduce glare";
      if (pulse) pulse.style.background = "#f59e0b";
    } else {
      // Normal conditions, rotate general tips
      instructionIndex = (instructionIndex + 1) % generalInstructions.length;
      feedbackText.textContent = generalInstructions[instructionIndex];
      if (pulse) pulse.style.background = "#38bdf8";
    }
  } catch (e) {
    // Fallback if canvas analysis is blocked (CORS/Security)
    instructionIndex = (instructionIndex + 1) % generalInstructions.length;
    feedbackText.textContent = generalInstructions[instructionIndex];
  }
}

// ---- Utility: Calculate Distance (Haversine) ----
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
