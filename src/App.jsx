import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BedDouble,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  FastForward,
  HeartPulse,
  Plus,
  RotateCcw,
  Search,
  Stethoscope,
  Thermometer,
  UserCheck,
  X
} from "lucide-react";

const STAGE_LABELS = {
  NEEDS_TEMP: "Needs Temp",
  READY_FOR_DOCTOR: "Ready for Doctor",
  VISITED_TODAY: "Visited Today",
  DISCHARGE_READY: "Discharge Ready"
};

function StreakPips({ days }) {
  const capped = Math.min(days, 3);
  return (
    <span className="streak-pips" title={`${days} consecutive fever-free day(s)`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={`pip ${i < capped ? "filled" : ""}`} />
      ))}
      <span style={{ fontSize: "0.78rem", fontWeight: 600, marginLeft: 4 }}>
        {days}/3d
      </span>
    </span>
  );
}

function TempBadge({ temp, threshold = 38.0 }) {
  if (temp === null || temp === undefined) {
    return <span className="badge amber">Pending</span>;
  }
  const hasFever = temp >= threshold;
  return (
    <span className={`badge ${hasFever ? "fever" : "normal"}`}>
      {temp.toFixed(1)}°C {hasFever ? "Fever" : "Normal"}
    </span>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");
  const [search, setSearch] = useState("");
  const [roomFilter, setRoomFilter] = useState("ALL");
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [showAdmitModal, setShowAdmitModal] = useState(false);
  const [admitRoomPrefill, setAdmitRoomPrefill] = useState("");
  const [toast, setToast] = useState(null);

  // Nurse inline temp inputs: { [patientId]: "37.2" }
  const [tempInputs, setTempInputs] = useState({});
  // Doctor inline note inputs: { [patientId]: "notes..." }
  const [docNotes, setDocNotes] = useState({});

  // Admit form state
  const [admitForm, setAdmitForm] = useState({
    name: "",
    age: "38",
    roomNumber: "",
    initialTemp: "",
    treatmentNotes: ""
  });

  function showToast(message, isError = false) {
    setToast({ message, isError });
    setTimeout(() => setToast(null), 3500);
  }

  async function fetchDashboard() {
    try {
      const res = await fetch("/api/dashboard");
      const json = await res.json();
      setData(json);
      if (selectedPatient) {
        const updated = json.activePatients.find((p) => p.id === selectedPatient.id);
        setSelectedPatient(updated || null);
      }
    } catch (err) {
      showToast("Failed to load facility data", true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchDashboard();
  }, []);

  async function apiPost(url, body = {}) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || "Action failed", true);
        return null;
      }
      setData(json);
      if (selectedPatient) {
        const updated = json.activePatients.find((p) => p.id === selectedPatient.id);
        setSelectedPatient(updated || null);
      }
      return json;
    } catch (err) {
      showToast("Network error", true);
      return null;
    }
  }

  async function handleLogTemp(patientId, customTemp, overwrite = false) {
    const val = customTemp ?? tempInputs[patientId];
    if (!val) {
      showToast("Enter a temperature in °C", true);
      return;
    }
    const updated = await apiPost(`/api/patients/${patientId}/temperature`, {
      temperature: Number(val),
      overwrite
    });
    if (updated) {
      setTempInputs((prev) => ({ ...prev, [patientId]: "" }));
      showToast(`Temperature ${Number(val).toFixed(1)}°C recorded`);
    }
  }

  async function handleDoctorVisit(patientId, approveDischarge = false, customNotes) {
    const notes = customNotes ?? docNotes[patientId] ?? "";
    const updated = await apiPost(`/api/patients/${patientId}/visit`, {
      doctorNotes: notes,
      readyForDischarge: approveDischarge
    });
    if (updated) {
      setDocNotes((prev) => ({ ...prev, [patientId]: "" }));
      showToast(
        approveDischarge
          ? "Visit complete — patient sent to Admin Discharge Queue"
          : "Doctor visit recorded"
      );
    }
  }

  async function handleDischarge(patientId, name) {
    const updated = await apiPost(`/api/patients/${patientId}/discharge`);
    if (updated) {
      setSelectedPatient(null);
      showToast(`${name} discharged — room is now vacant`);
    }
  }

  async function handleDeceased(patientId, name) {
    if (!window.confirm(`Record deceased outcome for ${name}? This will free the room and update mortality metrics.`)) {
      return;
    }
    const updated = await apiPost(`/api/patients/${patientId}/outcome`, {
      status: "deceased"
    });
    if (updated) {
      setSelectedPatient(null);
      showToast(`Outcome recorded for ${name}`);
    }
  }

  async function handleAdmitSubmit(e) {
    e.preventDefault();
    const updated = await apiPost("/api/patients", {
      ...admitForm,
      roomNumber: admitForm.roomNumber || admitRoomPrefill
    });
    if (updated) {
      setShowAdmitModal(false);
      setAdmitForm({ name: "", age: "38", roomNumber: "", initialTemp: "", treatmentNotes: "" });
      setAdmitRoomPrefill("");
      showToast("New patient admitted");
    }
  }

  const filteredPatients = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.activePatients;
    return data.activePatients.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        String(p.roomNumber).includes(q) ||
        p.id.toLowerCase().includes(q)
    );
  }, [data, search]);

  if (loading || !data) {
    return (
      <div className="empty-state" style={{ marginTop: 80 }}>
        Loading QuarantineCare 74-Bed Tracker...
      </div>
    );
  }

  const { summary, activePatients, vacantRooms, recentOutcomes, currentDate, totalRooms, feverThresholdC } = data;

  const needsTempList = filteredPatients.filter((p) => p.workflowStage === "NEEDS_TEMP");
  const completedTempList = filteredPatients.filter((p) => p.workflowStage !== "NEEDS_TEMP");

  const readyForDoctorList = filteredPatients.filter((p) => p.workflowStage === "READY_FOR_DOCTOR");
  const waitingForNurseList = filteredPatients.filter((p) => p.workflowStage === "NEEDS_TEMP");
  const visitedTodayList = filteredPatients.filter(
    (p) => p.workflowStage === "VISITED_TODAY" || p.workflowStage === "DISCHARGE_READY"
  );

  const dischargeQueue = filteredPatients.filter((p) => p.readyForDischarge);

  // Build 74 room slots for Overview grid
  const roomMap = new Map(activePatients.map((p) => [p.roomNumber, p]));
  const roomSlots = Array.from({ length: totalRooms }, (_, i) => {
    const roomNum = i + 1;
    return { roomNum, patient: roomMap.get(roomNum) || null };
  }).filter(({ patient }) => {
    if (roomFilter === "ALL") return true;
    if (roomFilter === "VACANT") return !patient;
    return patient && patient.workflowStage === roomFilter;
  });

  return (
    <div className="app-shell">
      {/* Top Bar */}
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div className="brand-icon">
              <HeartPulse size={20} />
            </div>
            <div>
              <h1>QuarantineCare</h1>
              <p>74-Bed Fever & Isolation Tracker (Fever ≥ {feverThresholdC}°C • Cure = 3d Fever-Free)</p>
            </div>
          </div>

          <div className="topbar-actions">
            <span className="pill info">
              <Calendar size={14} /> {currentDate}
            </span>
            <span className="pill">
              <BedDouble size={14} /> {summary.occupiedCount}/{totalRooms} Beds
            </span>
            <span className={`pill ${summary.mortalityAlert ? "warn" : "ok"}`}>
              <Activity size={14} />
              Mortality: {summary.mortalityRate}% (Max 15%)
            </span>
            <button
              className="btn btn-outline btn-sm"
              title="Simulate advancing to the next day to test 3-day fever-free streaks"
              onClick={async () => {
                const res = await apiPost("/api/simulate-next-day");
                if (res) showToast(`Advanced to ${res.currentDate}`);
              }}
            >
              <FastForward size={14} /> Next Day
            </button>
            <button
              className="btn btn-outline btn-sm"
              title="Reset demo data to full 74-bed occupancy"
              onClick={async () => {
                const res = await apiPost("/api/reset-demo");
                if (res) showToast("Demo data reset to 74-bed occupancy");
              }}
            >
              <RotateCcw size={14} /> Reset
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="nav-tabs">
          <button
            className={`nav-tab ${activeTab === "overview" ? "active" : ""}`}
            onClick={() => setActiveTab("overview")}
          >
            <BedDouble size={16} /> Overview & 74 Rooms
          </button>
          <button
            className={`nav-tab ${activeTab === "nurse" ? "active" : ""}`}
            onClick={() => setActiveTab("nurse")}
          >
            <Thermometer size={16} /> Nurse Temps
            <span className={`tab-badge ${needsTempList.length > 0 ? "urgent" : ""}`}>
              {activePatients.filter((p) => p.workflowStage === "NEEDS_TEMP").length} left
            </span>
          </button>
          <button
            className={`nav-tab ${activeTab === "doctor" ? "active" : ""}`}
            onClick={() => setActiveTab("doctor")}
          >
            <Stethoscope size={16} /> Doctor Rounds
            <span className="tab-badge">
              {summary.readyForDoctorCount} ready
            </span>
          </button>
          <button
            className={`nav-tab ${activeTab === "admin" ? "active" : ""}`}
            onClick={() => setActiveTab("admin")}
          >
            <ClipboardCheck size={16} /> Admin & Discharges
            <span className={`tab-badge ${summary.dischargeQueueCount > 0 ? "teal" : ""}`}>
              {summary.dischargeQueueCount} queue
            </span>
          </button>
        </nav>
      </header>

      <main className="main-content">
        {/* Mortality Benchmark Alert */}
        {summary.mortalityAlert && (
          <div className="alert-banner danger">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <AlertTriangle size={18} />
              <span>
                <strong>Quality Alert:</strong> Centre mortality rate is{" "}
                <strong>{summary.mortalityRate}%</strong> (exceeds the 15.0% benchmark; success rate{" "}
                {summary.successRate}% vs 85.0% target). Immediate clinical protocol review recommended.
              </span>
            </div>
          </div>
        )}

        {/* Search bar for clinical tabs */}
        {activeTab !== "overview" && (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            <div style={{ position: "relative", minWidth: 260, flex: "1 1 280px", maxWidth: 420 }}>
              <Search
                size={16}
                style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }}
              />
              <input
                className="input"
                style={{ width: "100%", paddingLeft: 34 }}
                placeholder="Search by room #, patient name, or ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {activeTab === "admin" && (
              <button
                className="btn btn-primary"
                disabled={vacantRooms.length === 0}
                onClick={() => {
                  setAdmitRoomPrefill(vacantRooms[0] ? String(vacantRooms[0]) : "");
                  setShowAdmitModal(true);
                }}
              >
                <Plus size={16} /> Admit Patient ({vacantRooms.length} beds free)
              </button>
            )}
          </div>
        )}

        {/* TAB 1: OVERVIEW & 74-ROOM MAP */}
        {activeTab === "overview" && (
          <>
            <div className="kpi-grid">
              <div className="kpi-card">
                <div className="kpi-header">
                  <span>Bed Occupancy</span>
                  <BedDouble size={16} color="#0284c7" />
                </div>
                <div className="kpi-value">
                  {summary.occupiedCount} <span style={{ fontSize: "1rem", color: "#64748b", fontWeight: 500 }}>/ {totalRooms}</span>
                </div>
                <div className="kpi-sub">
                  {summary.vacantCount === 0 ? "At full capacity (0 vacant)" : `${summary.vacantCount} room(s) available`}
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${(summary.occupiedCount / totalRooms) * 100}%`, background: "#0284c7" }}
                  />
                </div>
              </div>

              <div className="kpi-card">
                <div className="kpi-header">
                  <span>Today&apos;s Clinical Workflow</span>
                  <Thermometer size={16} color="#d97706" />
                </div>
                <div className="kpi-value">
                  {summary.tempsTakenToday} <span style={{ fontSize: "0.95rem", color: "#64748b", fontWeight: 500 }}>temps</span>{" "}
                  · {summary.doctorVisitedToday} <span style={{ fontSize: "0.95rem", color: "#64748b", fontWeight: 500 }}>visits</span>
                </div>
                <div className="kpi-sub">
                  {summary.readyForDoctorCount} waiting for doctor · {summary.occupiedCount - summary.tempsTakenToday} need temp
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${summary.occupiedCount ? (summary.doctorVisitedToday / summary.occupiedCount) * 100 : 0}%`,
                      background: "#059669"
                    }}
                  />
                </div>
              </div>

              <div className="kpi-card">
                <div className="kpi-header">
                  <span>Discharge Pipeline</span>
                  <UserCheck size={16} color="#0d9488" />
                </div>
                <div className="kpi-value">{summary.dischargeQueueCount}</div>
                <div className="kpi-sub">
                  Approved for admin discharge
                  {summary.eligibleNotFlaggedCount > 0 && ` (+${summary.eligibleNotFlaggedCount} eligible for doctor sign-off)`}
                </div>
              </div>

              <div className="kpi-card">
                <div className="kpi-header">
                  <span>Treatment Quality (85% Target)</span>
                  <Activity size={16} color={summary.mortalityAlert ? "#dc2626" : "#059669"} />
                </div>
                <div className="kpi-value" style={{ color: summary.mortalityAlert ? "#dc2626" : "#059669" }}>
                  {summary.successRate}%{" "}
                  <span style={{ fontSize: "0.88rem", fontWeight: 600, color: "#64748b" }}>
                    ({summary.dischargedCount} cured / {summary.deceasedCount} deceased)
                  </span>
                </div>
                <div className="kpi-sub">
                  Mortality: <strong>{summary.mortalityRate}%</strong> (Benchmark ≤ 15.0%)
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${summary.successRate}%`,
                      background: summary.mortalityAlert ? "#dc2626" : "#059669"
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">74-Room Live Status Map</h2>
                  <p className="card-subtitle">Click any room to view 7-day temperature history, log vitals, or process discharge.</p>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <select
                    className="select"
                    value={roomFilter}
                    onChange={(e) => setRoomFilter(e.target.value)}
                  >
                    <option value="ALL">All Rooms ({totalRooms})</option>
                    <option value="NEEDS_TEMP">Needs Temp ({activePatients.filter((p) => p.workflowStage === "NEEDS_TEMP").length})</option>
                    <option value="READY_FOR_DOCTOR">Ready for Doctor ({summary.readyForDoctorCount})</option>
                    <option value="VISITED_TODAY">Visited Today ({activePatients.filter((p) => p.workflowStage === "VISITED_TODAY").length})</option>
                    <option value="DISCHARGE_READY">Discharge Ready ({summary.dischargeQueueCount})</option>
                    <option value="VACANT">Vacant ({summary.vacantCount})</option>
                  </select>
                </div>
              </div>

              <div className="legend" style={{ marginBottom: 14 }}>
                <span className="legend-item"><span className="dot" style={{ background: "#f59e0b" }} /> Needs Temp</span>
                <span className="legend-item"><span className="dot" style={{ background: "#3b82f6" }} /> Ready for Doctor</span>
                <span className="legend-item"><span className="dot" style={{ background: "#10b981" }} /> Visited Today</span>
                <span className="legend-item"><span className="dot" style={{ background: "#14b8a6" }} /> Discharge Ready (3d+)</span>
                <span className="legend-item"><span className="dot" style={{ background: "#cbd5e1" }} /> Vacant</span>
              </div>

              <div className="room-grid">
                {roomSlots.map(({ roomNum, patient }) => {
                  if (!patient) {
                    return (
                      <button
                        key={roomNum}
                        className="room-tile vacant"
                        onClick={() => {
                          setAdmitRoomPrefill(String(roomNum));
                          setShowAdmitModal(true);
                        }}
                      >
                        <div className="room-num">R{String(roomNum).padStart(2, "0")}</div>
                        <div className="room-name">Vacant</div>
                        <div className="room-meta">+ Admit</div>
                      </button>
                    );
                  }
                  const tempStr = patient.todayLog?.temperature != null
                    ? `${patient.todayLog.temperature.toFixed(1)}°`
                    : "—";
                  return (
                    <button
                      key={roomNum}
                      className={`room-tile ${patient.workflowStage}`}
                      onClick={() => setSelectedPatient(patient)}
                    >
                      <div className="room-num">
                        <span>R{String(roomNum).padStart(2, "0")}</span>
                        {patient.isCuredEligible && <span title="3+ fever-free days">★</span>}
                      </div>
                      <div className="room-name">{patient.name.split(" ")[0]}</div>
                      <div className="room-meta">
                        <span>{tempStr}</span>
                        <span>{patient.consecutiveFeverFreeDays}/3d</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* TAB 2: NURSE STATION */}
        {activeTab === "nurse" && (
          <>
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">
                    <Thermometer size={18} color="#d97706" /> Pending Daily Temperatures ({needsTempList.length})
                  </h2>
                  <p className="card-subtitle">
                    Patients who have NOT had their temperature measured today ({currentDate}). Once logged, they automatically move to the Doctor Queue.
                  </p>
                </div>
              </div>

              {needsTempList.length === 0 ? (
                <div className="empty-state">
                  <CheckCircle2 size={28} color="#059669" style={{ marginBottom: 6 }} />
                  <div>All active patients have had their temperature measured today!</div>
                </div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Room</th>
                        <th>Patient</th>
                        <th>Previous Temp</th>
                        <th>Fever-Free Streak</th>
                        <th>Record Today&apos;s Temp (°C)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {needsTempList.map((p) => (
                        <tr key={p.id}>
                          <td><strong>R{String(p.roomNumber).padStart(2, "0")}</strong></td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{p.name}</div>
                            <div style={{ fontSize: "0.76rem", color: "#64748b" }}>{p.id} · Age {p.age}</div>
                          </td>
                          <td><TempBadge temp={p.latestTemp} threshold={feverThresholdC} /></td>
                          <td><StreakPips days={p.consecutiveFeverFreeDays} /></td>
                          <td>
                            <form
                              style={{ display: "flex", gap: 8, alignItems: "center" }}
                              onSubmit={(e) => {
                                e.preventDefault();
                                handleLogTemp(p.id);
                              }}
                            >
                              <input
                                type="number"
                                step="0.1"
                                min="34"
                                max="43"
                                placeholder="e.g. 37.2"
                                className="input"
                                style={{ width: 105 }}
                                value={tempInputs[p.id] ?? ""}
                                onChange={(e) =>
                                  setTempInputs((prev) => ({ ...prev, [p.id]: e.target.value }))
                                }
                              />
                              <button type="submit" className="btn btn-primary btn-sm">
                                Log Temp
                              </button>
                            </form>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">
                    <CheckCircle2 size={18} color="#059669" /> Completed Today ({completedTempList.length})
                  </h2>
                  <p className="card-subtitle">
                    Duplicate measurements are prevented — these patients already have a recorded temperature for {currentDate}.
                  </p>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Room</th>
                      <th>Patient</th>
                      <th>Today&apos;s Temp</th>
                      <th>Fever-Free Streak</th>
                      <th>Workflow Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {completedTempList.map((p) => (
                      <tr key={p.id} onClick={() => setSelectedPatient(p)} style={{ cursor: "pointer" }}>
                        <td><strong>R{String(p.roomNumber).padStart(2, "0")}</strong></td>
                        <td>{p.name}</td>
                        <td><TempBadge temp={p.todayLog?.temperature} threshold={feverThresholdC} /></td>
                        <td><StreakPips days={p.consecutiveFeverFreeDays} /></td>
                        <td>
                          <span className={`badge ${p.readyForDischarge ? "teal" : p.todayLog?.doctorVisited ? "normal" : "blue"}`}>
                            {STAGE_LABELS[p.workflowStage]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* TAB 3: DOCTOR ROUNDS */}
        {activeTab === "doctor" && (
          <>
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">
                    <Stethoscope size={18} color="#2563eb" /> Ready for Doctor Visit ({readyForDoctorList.length})
                  </h2>
                  <p className="card-subtitle">
                    Only patients whose temperature has been taken today appear here — no wasted trips.
                  </p>
                </div>
              </div>

              {readyForDoctorList.length === 0 ? (
                <div className="empty-state">No patients currently waiting for a doctor visit.</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Room</th>
                        <th>Patient</th>
                        <th>Today&apos;s Temp</th>
                        <th>Fever-Free Streak</th>
                        <th>Treatment Note</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {readyForDoctorList.map((p) => (
                        <tr key={p.id}>
                          <td><strong>R{String(p.roomNumber).padStart(2, "0")}</strong></td>
                          <td>
                            <button
                              className="btn btn-outline btn-sm"
                              style={{ border: "none", padding: 0, fontWeight: 600 }}
                              onClick={() => setSelectedPatient(p)}
                            >
                              {p.name}
                            </button>
                            <div style={{ fontSize: "0.75rem", color: "#64748b" }}>Age {p.age}</div>
                          </td>
                          <td><TempBadge temp={p.todayLog?.temperature} threshold={feverThresholdC} /></td>
                          <td>
                            <StreakPips days={p.consecutiveFeverFreeDays} />
                            {p.isCuredEligible && (
                              <div style={{ fontSize: "0.72rem", color: "#0d9488", fontWeight: 700, marginTop: 2 }}>
                                Eligible for Discharge!
                              </div>
                            )}
                          </td>
                          <td>
                            <input
                              className="input"
                              style={{ width: "100%", minWidth: 160 }}
                              placeholder="Optional visit note..."
                              value={docNotes[p.id] ?? ""}
                              onChange={(e) =>
                                setDocNotes((prev) => ({ ...prev, [p.id]: e.target.value }))
                              }
                            />
                          </td>
                          <td>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {p.isCuredEligible ? (
                                <button
                                  className="btn btn-teal btn-sm"
                                  onClick={() => handleDoctorVisit(p.id, true)}
                                >
                                  Approve Discharge
                                </button>
                              ) : (
                                <button
                                  className="btn btn-primary btn-sm"
                                  onClick={() => handleDoctorVisit(p.id, false)}
                                >
                                  Complete Visit
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">Waiting for Nurse Temperature ({waitingForNurseList.length})</h2>
                  <p className="card-subtitle">Do not visit yet — daily temperature has not been recorded.</p>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Room</th>
                      <th>Patient</th>
                      <th>Last Known Temp</th>
                      <th>Streak</th>
                    </tr>
                  </thead>
                  <tbody>
                    {waitingForNurseList.slice(0, 12).map((p) => (
                      <tr key={p.id}>
                        <td><strong>R{String(p.roomNumber).padStart(2, "0")}</strong></td>
                        <td>{p.name}</td>
                        <td><TempBadge temp={p.latestTemp} threshold={feverThresholdC} /></td>
                        <td><StreakPips days={p.consecutiveFeverFreeDays} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {waitingForNurseList.length > 12 && (
                  <div style={{ padding: "10px 12px", fontSize: "0.8rem", color: "#64748b" }}>
                    + {waitingForNurseList.length - 12} more waiting for nurse temperature
                  </div>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h2 className="card-title">Visited Today ({visitedTodayList.length})</h2>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Room</th>
                      <th>Patient</th>
                      <th>Today&apos;s Temp</th>
                      <th>Streak</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visitedTodayList.map((p) => (
                      <tr key={p.id} onClick={() => setSelectedPatient(p)} style={{ cursor: "pointer" }}>
                        <td><strong>R{String(p.roomNumber).padStart(2, "0")}</strong></td>
                        <td>{p.name}</td>
                        <td><TempBadge temp={p.todayLog?.temperature} threshold={feverThresholdC} /></td>
                        <td><StreakPips days={p.consecutiveFeverFreeDays} /></td>
                        <td>
                          <span className={`badge ${p.readyForDischarge ? "teal" : "normal"}`}>
                            {p.readyForDischarge ? "Queued for Discharge" : "Visited"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* TAB 4: ADMIN & DISCHARGES */}
        {activeTab === "admin" && (
          <>
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">
                    <ClipboardCheck size={18} color="#0d9488" /> Admin Discharge Queue ({dischargeQueue.length})
                  </h2>
                  <p className="card-subtitle">
                    Patients cleared by doctors (3+ consecutive fever-free days). Discharge immediately to free beds.
                  </p>
                </div>
              </div>

              {dischargeQueue.length === 0 ? (
                <div className="empty-state">No patients currently waiting in the discharge queue.</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Room</th>
                        <th>Patient</th>
                        <th>Admitted</th>
                        <th>Fever-Free Streak</th>
                        <th>Doctor Note</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dischargeQueue.map((p) => (
                        <tr key={p.id}>
                          <td><strong>R{String(p.roomNumber).padStart(2, "0")}</strong></td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{p.name}</div>
                            <div style={{ fontSize: "0.75rem", color: "#64748b" }}>{p.id} · Age {p.age}</div>
                          </td>
                          <td>{p.admittedAt}</td>
                          <td><StreakPips days={p.consecutiveFeverFreeDays} /></td>
                          <td style={{ maxWidth: 260, fontSize: "0.82rem", color: "#475569" }}>{p.treatmentNotes}</td>
                          <td>
                            <button
                              className="btn btn-teal btn-sm"
                              onClick={() => handleDischarge(p.id, p.name)}
                            >
                              Discharge & Free Bed
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">Recent Outcomes & Quality Log</h2>
                  <p className="card-subtitle">
                    Success Rate: <strong>{summary.successRate}%</strong> (Target ≥ 85%) · Mortality Rate:{" "}
                    <strong>{summary.mortalityRate}%</strong> (Max ≤ 15%)
                  </p>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Patient</th>
                      <th>Admitted</th>
                      <th>Outcome Date</th>
                      <th>Outcome</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentOutcomes.map((p) => (
                      <tr key={p.id}>
                        <td>{p.id}</td>
                        <td>{p.name} (Age {p.age})</td>
                        <td>{p.admittedAt}</td>
                        <td>{p.outcomeAt}</td>
                        <td>
                          <span className={`badge ${p.status === "discharged" ? "normal" : "fever"}`}>
                            {p.status === "discharged" ? "Cured / Discharged" : "Deceased"}
                          </span>
                        </td>
                        <td style={{ fontSize: "0.8rem", color: "#475569" }}>{p.treatmentNotes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>

      {/* Patient Detail Modal */}
      {selectedPatient && (
        <div className="modal-backdrop" onClick={() => setSelectedPatient(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="badge blue">Room {String(selectedPatient.roomNumber).padStart(2, "0")}</span>
                  <span className="badge gray">{selectedPatient.id}</span>
                </div>
                <h2 style={{ margin: "6px 0 2px", fontSize: "1.2rem" }}>{selectedPatient.name}</h2>
                <div style={{ fontSize: "0.82rem", color: "#64748b" }}>
                  Age {selectedPatient.age} · Admitted {selectedPatient.admittedAt}
                </div>
              </div>
              <button className="btn btn-outline btn-sm" onClick={() => setSelectedPatient(null)}>
                <X size={16} />
              </button>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "#f8fafc", borderRadius: 10, marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 600 }}>FEVER-FREE STREAK</div>
                <StreakPips days={selectedPatient.consecutiveFeverFreeDays} />
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 600 }}>TODAY&apos;S STATUS</div>
                <span className="badge gray">{STAGE_LABELS[selectedPatient.workflowStage]}</span>
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: "0.8rem", fontWeight: 700, marginBottom: 6 }}>Recent Temperature History</div>
              <div className="history-strip">
                {selectedPatient.logs.length === 0 ? (
                  <div style={{ fontSize: "0.82rem", color: "#64748b" }}>No temperatures logged yet.</div>
                ) : (
                  selectedPatient.logs.map((l) => {
                    const isFever = l.temperature >= feverThresholdC;
                    return (
                      <div key={l.date} className={`history-day ${isFever ? "fever" : "ok"}`}>
                        <div style={{ color: "#64748b", fontSize: "0.7rem" }}>{l.date.slice(5)}</div>
                        <div style={{ fontWeight: 700, fontSize: "0.9rem", margin: "2px 0" }}>
                          {l.temperature != null ? `${l.temperature.toFixed(1)}°C` : "—"}
                        </div>
                        <div style={{ fontSize: "0.68rem" }}>{l.doctorVisited ? "Dr ✓" : "No Dr"}</div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div style={{ fontSize: "0.82rem", color: "#334155", marginBottom: 16 }}>
              <strong>Treatment Notes:</strong> {selectedPatient.treatmentNotes}
            </div>

            {/* Quick Actions inside Modal */}
            <div style={{ display: "grid", gap: 10, borderTop: "1px solid #e2e8f0", paddingTop: 14 }}>
              {!selectedPatient.todayLog && (
                <form
                  style={{ display: "flex", gap: 8 }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleLogTemp(selectedPatient.id);
                  }}
                >
                  <input
                    type="number"
                    step="0.1"
                    min="34"
                    max="43"
                    placeholder="Today's Temp (°C)"
                    className="input"
                    style={{ flex: 1 }}
                    value={tempInputs[selectedPatient.id] ?? ""}
                    onChange={(e) =>
                      setTempInputs((prev) => ({ ...prev, [selectedPatient.id]: e.target.value }))
                    }
                  />
                  <button type="submit" className="btn btn-primary btn-sm">
                    Nurse: Log Temp
                  </button>
                </form>
              )}

              {selectedPatient.todayLog && !selectedPatient.todayLog.doctorVisited && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => handleDoctorVisit(selectedPatient.id, false)}
                  >
                    Doctor: Complete Visit
                  </button>
                  {selectedPatient.isCuredEligible && (
                    <button
                      className="btn btn-teal btn-sm"
                      onClick={() => handleDoctorVisit(selectedPatient.id, true)}
                    >
                      Doctor: Approve Discharge (3/3 Days)
                    </button>
                  )}
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 4 }}>
                {selectedPatient.readyForDischarge ? (
                  <button
                    className="btn btn-teal btn-sm"
                    onClick={() => handleDischarge(selectedPatient.id, selectedPatient.name)}
                  >
                    Admin: Discharge & Free Room
                  </button>
                ) : (
                  <span />
                )}
                <button
                  className="btn btn-danger-outline btn-sm"
                  onClick={() => handleDeceased(selectedPatient.id, selectedPatient.name)}
                >
                  Record Outcome: Deceased
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Admit Patient Modal */}
      {showAdmitModal && (
        <div className="modal-backdrop" onClick={() => setShowAdmitModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ margin: 0, fontSize: "1.15rem" }}>Admit New Patient</h2>
              <button className="btn btn-outline btn-sm" onClick={() => setShowAdmitModal(false)}>
                <X size={16} />
              </button>
            </div>
            <form className="form-grid" onSubmit={handleAdmitSubmit}>
              <div className="form-row">
                <label>Patient Full Name *</label>
                <input
                  required
                  className="input"
                  placeholder="e.g. Ananya Verma"
                  value={admitForm.name}
                  onChange={(e) => setAdmitForm({ ...admitForm, name: e.target.value })}
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div className="form-row">
                  <label>Age</label>
                  <input
                    type="number"
                    min="1"
                    max="120"
                    className="input"
                    value={admitForm.age}
                    onChange={(e) => setAdmitForm({ ...admitForm, age: e.target.value })}
                  />
                </div>
                <div className="form-row">
                  <label>Assign Vacant Room</label>
                  <select
                    className="select"
                    value={admitForm.roomNumber || admitRoomPrefill}
                    onChange={(e) => setAdmitForm({ ...admitForm, roomNumber: e.target.value })}
                  >
                    {vacantRooms.map((r) => (
                      <option key={r} value={r}>
                        Room {String(r).padStart(2, "0")}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <label>Initial Temperature (°C, optional)</label>
                <input
                  type="number"
                  step="0.1"
                  min="34"
                  max="43"
                  placeholder="e.g. 38.9"
                  className="input"
                  value={admitForm.initialTemp}
                  onChange={(e) => setAdmitForm({ ...admitForm, initialTemp: e.target.value })}
                />
              </div>
              <div className="form-row">
                <label>Admission Notes</label>
                <input
                  className="input"
                  placeholder="Initial symptoms & treatment plan"
                  value={admitForm.treatmentNotes}
                  onChange={(e) => setAdmitForm({ ...admitForm, treatmentNotes: e.target.value })}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
                <button type="button" className="btn btn-outline" onClick={() => setShowAdmitModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Admit Patient
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className={`alert-banner toast ${toast.isError ? "error" : ""}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
