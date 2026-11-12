import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createInitialDatabase, addDays, FEVER_THRESHOLD_C } from "./seed.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.VERCEL
  ? path.join("/tmp", "quarantine-data")
  : path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const DIST_DIR = path.join(__dirname, "..", "dist");

const app = express();
app.use(cors());
app.use(express.json());

function loadDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    const initial = createInitialDatabase();
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
}

function saveDb(db) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function computeStreak(logs) {
  if (!logs || logs.length === 0) return 0;
  // Sort logs descending by date
  const sorted = [...logs]
    .filter((l) => l.temperature !== null && l.temperature !== undefined)
    .sort((a, b) => b.date.localeCompare(a.date));

  let streak = 0;
  let expectedDate = null;

  for (const log of sorted) {
    if (expectedDate && log.date !== expectedDate) {
      // Gap in daily measurements breaks consecutive streak
      break;
    }
    if (log.temperature < FEVER_THRESHOLD_C) {
      streak++;
      expectedDate = addDays(log.date, -1);
    } else {
      break;
    }
  }
  return streak;
}

function enrichPatient(patient, currentDate) {
  const todayLog = patient.logs.find((l) => l.date === currentDate) || null;
  const consecutiveFeverFreeDays = computeStreak(patient.logs);
  const isCuredEligible = consecutiveFeverFreeDays >= 3;

  let workflowStage = "NEEDS_TEMP";
  if (patient.readyForDischarge) {
    workflowStage = "DISCHARGE_READY";
  } else if (todayLog && todayLog.doctorVisited) {
    workflowStage = "VISITED_TODAY";
  } else if (todayLog && todayLog.temperature !== null) {
    workflowStage = "READY_FOR_DOCTOR";
  }

  const sortedLogs = [...patient.logs].sort((a, b) => a.date.localeCompare(b.date));
  const latestLog = sortedLogs[sortedLogs.length - 1] || null;

  return {
    ...patient,
    logs: sortedLogs.slice(-7), // Last 7 days for clean UI history
    todayLog,
    latestTemp: latestLog ? latestLog.temperature : null,
    consecutiveFeverFreeDays,
    isCuredEligible,
    workflowStage
  };
}

function buildDashboardPayload(db) {
  const activePatients = db.patients
    .filter((p) => p.status === "active")
    .map((p) => enrichPatient(p, db.currentDate))
    .sort((a, b) => a.roomNumber - b.roomNumber);

  const occupiedRooms = new Set(activePatients.map((p) => p.roomNumber));
  const vacantRooms = [];
  for (let r = 1; r <= db.totalRooms; r++) {
    if (!occupiedRooms.has(r)) vacantRooms.push(r);
  }

  const discharged = db.patients.filter((p) => p.status === "discharged");
  const deceased = db.patients.filter((p) => p.status === "deceased");
  const totalClosed = discharged.length + deceased.length;

  const successRate = totalClosed > 0 ? Number(((discharged.length / totalClosed) * 100).toFixed(1)) : 100.0;
  const mortalityRate = totalClosed > 0 ? Number(((deceased.length / totalClosed) * 100).toFixed(1)) : 0.0;

  const tempsTakenToday = activePatients.filter((p) => p.todayLog && p.todayLog.temperature !== null).length;
  const doctorVisitedToday = activePatients.filter((p) => p.todayLog && p.todayLog.doctorVisited).length;
  const readyForDoctorCount = activePatients.filter((p) => p.workflowStage === "READY_FOR_DOCTOR").length;
  const dischargeQueueCount = activePatients.filter((p) => p.readyForDischarge).length;
  const eligibleNotFlaggedCount = activePatients.filter((p) => p.isCuredEligible && !p.readyForDischarge).length;

  const recentOutcomes = db.patients
    .filter((p) => p.status !== "active")
    .sort((a, b) => (b.outcomeAt || "").localeCompare(a.outcomeAt || ""))
    .slice(0, 20);

  return {
    currentDate: db.currentDate,
    totalRooms: db.totalRooms,
    feverThresholdC: FEVER_THRESHOLD_C,
    summary: {
      occupiedCount: activePatients.length,
      vacantCount: vacantRooms.length,
      tempsTakenToday,
      doctorVisitedToday,
      readyForDoctorCount,
      dischargeQueueCount,
      eligibleNotFlaggedCount,
      dischargedCount: discharged.length,
      deceasedCount: deceased.length,
      totalClosed,
      successRate,
      mortalityRate,
      mortalityAlert: mortalityRate > 15.0
    },
    activePatients,
    vacantRooms,
    recentOutcomes
  };
}

app.get("/api/dashboard", (req, res) => {
  const db = loadDb();
  res.json(buildDashboardPayload(db));
});

// Nurse logs daily temperature
app.post("/api/patients/:id/temperature", (req, res) => {
  const { id } = req.params;
  const { temperature, overwrite } = req.body;
  const tempNum = Number(temperature);

  if (Number.isNaN(tempNum) || tempNum < 34 || tempNum > 43) {
    return res.status(400).json({ error: "Please enter a valid temperature between 34.0°C and 43.0°C." });
  }

  const db = loadDb();
  const patient = db.patients.find((p) => p.id === id && p.status === "active");
  if (!patient) {
    return res.status(404).json({ error: "Active patient not found." });
  }

  const existingIdx = patient.logs.findIndex((l) => l.date === db.currentDate);
  if (existingIdx !== -1 && patient.logs[existingIdx].temperature !== null && !overwrite) {
    return res.status(409).json({
      error: `Temperature already recorded today (${patient.logs[existingIdx].temperature}°C).`
    });
  }

  const nowIso = new Date().toISOString();
  if (existingIdx !== -1) {
    patient.logs[existingIdx].temperature = Number(tempNum.toFixed(1));
    patient.logs[existingIdx].tempTakenAt = nowIso;
  } else {
    patient.logs.push({
      date: db.currentDate,
      temperature: Number(tempNum.toFixed(1)),
      tempTakenAt: nowIso,
      doctorVisited: false,
      doctorVisitedAt: null,
      doctorNotes: null
    });
  }

  saveDb(db);
  res.json(buildDashboardPayload(db));
});

// Doctor logs daily visit (only after temperature is taken)
app.post("/api/patients/:id/visit", (req, res) => {
  const { id } = req.params;
  const { doctorNotes, readyForDischarge } = req.body;

  const db = loadDb();
  const patient = db.patients.find((p) => p.id === id && p.status === "active");
  if (!patient) {
    return res.status(404).json({ error: "Active patient not found." });
  }

  const todayLog = patient.logs.find((l) => l.date === db.currentDate);
  if (!todayLog || todayLog.temperature === null) {
    return res.status(400).json({
      error: "Cannot complete doctor visit before today's temperature has been taken by a nurse."
    });
  }

  const streak = computeStreak(patient.logs);
  if (readyForDischarge && streak < 3) {
    return res.status(400).json({
      error: `Patient only has ${streak}/3 consecutive fever-free days. 3 full days required for discharge.`
    });
  }

  todayLog.doctorVisited = true;
  todayLog.doctorVisitedAt = new Date().toISOString();
  if (doctorNotes !== undefined && doctorNotes.trim() !== "") {
    todayLog.doctorNotes = doctorNotes.trim();
    patient.treatmentNotes = doctorNotes.trim();
  }
  if (readyForDischarge === true) {
    patient.readyForDischarge = true;
  }

  saveDb(db);
  res.json(buildDashboardPayload(db));
});

// Admin discharges patient (frees room)
app.post("/api/patients/:id/discharge", (req, res) => {
  const { id } = req.params;
  const db = loadDb();
  const patient = db.patients.find((p) => p.id === id && p.status === "active");
  if (!patient) {
    return res.status(404).json({ error: "Active patient not found." });
  }

  patient.status = "discharged";
  patient.roomNumber = null;
  patient.readyForDischarge = false;
  patient.outcomeAt = db.currentDate;

  saveDb(db);
  res.json(buildDashboardPayload(db));
});

// Record deceased outcome (frees room, updates mortality benchmark)
app.post("/api/patients/:id/outcome", (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body;
  if (status !== "deceased") {
    return res.status(400).json({ error: "Invalid outcome status." });
  }

  const db = loadDb();
  const patient = db.patients.find((p) => p.id === id && p.status === "active");
  if (!patient) {
    return res.status(404).json({ error: "Active patient not found." });
  }

  patient.status = "deceased";
  patient.roomNumber = null;
  patient.readyForDischarge = false;
  patient.outcomeAt = db.currentDate;
  if (notes) patient.treatmentNotes = notes;

  saveDb(db);
  res.json(buildDashboardPayload(db));
});

// Admin admits a new patient into a vacant room
app.post("/api/patients", (req, res) => {
  const { name, age, roomNumber, initialTemp, treatmentNotes } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Patient name is required." });
  }

  const db = loadDb();
  const occupied = new Set(db.patients.filter((p) => p.status === "active").map((p) => p.roomNumber));

  let assignedRoom = Number(roomNumber);
  if (!assignedRoom || assignedRoom < 1 || assignedRoom > db.totalRooms || occupied.has(assignedRoom)) {
    // Auto-assign first vacant room if not specified
    assignedRoom = null;
    for (let r = 1; r <= db.totalRooms; r++) {
      if (!occupied.has(r)) {
        assignedRoom = r;
        break;
      }
    }
  }

  if (!assignedRoom) {
    return res.status(400).json({ error: "All 74 rooms are currently occupied." });
  }

  const id = `P-${String(db.nextPatientNum++).padStart(3, "0")}`;
  const logs = [];
  if (initialTemp !== undefined && initialTemp !== "" && !Number.isNaN(Number(initialTemp))) {
    logs.push({
      date: db.currentDate,
      temperature: Number(Number(initialTemp).toFixed(1)),
      tempTakenAt: new Date().toISOString(),
      doctorVisited: false,
      doctorVisitedAt: null,
      doctorNotes: null
    });
  }

  db.patients.push({
    id,
    name: name.trim(),
    age: Number(age) || 35,
    roomNumber: assignedRoom,
    admittedAt: db.currentDate,
    status: "active",
    outcomeAt: null,
    readyForDischarge: false,
    treatmentNotes: treatmentNotes?.trim() || "Newly admitted. Monitor daily temperature.",
    logs
  });

  saveDb(db);
  res.status(201).json(buildDashboardPayload(db));
});

// Demo helper: Advance to next day
app.post("/api/simulate-next-day", (req, res) => {
  const db = loadDb();
  db.currentDate = addDays(db.currentDate, 1);
  saveDb(db);
  res.json(buildDashboardPayload(db));
});

// Demo helper: Reset seed data
app.post("/api/reset-demo", (req, res) => {
  const db = createInitialDatabase();
  saveDb(db);
  res.json(buildDashboardPayload(db));
});

// Serve static frontend in production if built (non-Vercel)
if (!process.env.VERCEL && fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get("*", (req, res) => {
    res.sendFile(path.join(DIST_DIR, "index.html"));
  });
}

if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`QuarantineCare server running on http://localhost:${PORT}`);
  });
}

export default app;
