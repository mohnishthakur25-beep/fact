// Seed data generator for the 74-bed Quarantine & Treatment Facility

const FIRST_NAMES = [
  "Aarav", "Priya", "Rohan", "Ananya", "Vikram", "Neha", "Kabir", "Meera",
  "Arjun", "Sanya", "Dev", "Ishita", "Karan", "Divya", "Rahul", "Pooja",
  "Siddharth", "Kavya", "Aditya", "Nisha", "Nikhil", "Riya", "Varun", "Tara",
  "Manish", "Shreya", "Gaurav", "Aditi", "Deepak", "Sneha", "Amit", "Swati",
  "Rajesh", "Kiran", "Suresh", "Lakshmi", "Vivek", "Meenakshi", "Pranav", "Asha"
];

const LAST_NAMES = [
  "Sharma", "Patel", "Verma", "Nair", "Reddy", "Gupta", "Iyer", "Mehta",
  "Joshi", "Singh", "Kulkarni", "Desai", "Bhat", "Rao", "Malhotra", "Kapoor",
  "Chopra", "Menon", "Pillai", "Agarwal", "Banerjee", "Chatterjee", "Das", "Bose"
];

export const FEVER_THRESHOLD_C = 38.0;

export function addDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function getTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

function pickName(idx) {
  const first = FIRST_NAMES[idx % FIRST_NAMES.length];
  const last = LAST_NAMES[(idx * 7 + 3) % LAST_NAMES.length];
  return `${first} ${last}`;
}

export function createInitialDatabase() {
  const today = getTodayStr();
  const patients = [];
  let nextId = 1;

  // Create 74 active patients occupying Rooms 1..74 (full occupancy as described)
  for (let room = 1; room <= 74; room++) {
    const id = `P-${String(nextId++).padStart(3, "0")}`;
    const name = pickName(room - 1);
    const age = 22 + ((room * 13) % 56);
    const daysAdmitted = 2 + (room % 6); // 2 to 7 days
    const admittedAt = addDays(today, -daysAdmitted);

    const logs = [];

    // Determine profile for realistic clinical variety:
    // Rooms 1-6: Already 3+ fever-free days & doctor approved -> Discharge Queue
    // Rooms 7-30: Needs Temp Today (some on day 2 of fever-free, some still febrile)
    // Rooms 31-56: Temp Taken Today, Ready for Doctor Visit (some hit 3/3 today!)
    // Rooms 57-74: Temp Taken & Doctor Visited Today
    let readyForDischarge = false;
    let treatmentNotes = "Standard antiviral & hydration protocol.";

    if (room <= 6) {
      // 3+ days fever-free, visited today & approved for discharge
      for (let d = daysAdmitted; d >= 0; d--) {
        const date = addDays(today, -d);
        const temp = d >= 3 ? 38.6 : Number((36.6 + (d * 0.2)).toFixed(1));
        logs.push({
          date,
          temperature: temp,
          tempTakenAt: `${date}T08:${String(10 + room).padStart(2, "0")}:00Z`,
          doctorVisited: true,
          doctorVisitedAt: `${date}T10:${String(15 + room).padStart(2, "0")}:00Z`,
          doctorNotes: d === 0 ? "3 consecutive fever-free days met. Cleared for discharge." : "Fever subsiding."
        });
      }
      readyForDischarge = true;
      treatmentNotes = "Afebrile 3+ days. Ready for admin discharge.";
    } else if (room <= 30) {
      // Needs Temp Today
      for (let d = daysAdmitted; d >= 1; d--) {
        const date = addDays(today, -d);
        // Half of them have 2 fever-free days already (so today's temp could make it 3!)
        const isRecovering = room % 2 === 0;
        const temp = isRecovering && d <= 2
          ? Number((36.8 + (d * 0.15)).toFixed(1))
          : Number((38.2 + ((room + d) % 12) * 0.1).toFixed(1));
        logs.push({
          date,
          temperature: temp,
          tempTakenAt: `${date}T08:30:00Z`,
          doctorVisited: true,
          doctorVisitedAt: `${date}T11:00:00Z`,
          doctorNotes: temp >= FEVER_THRESHOLD_C ? "Continue antipyretics & fluids." : "Afebrile. Monitor."
        });
      }
    } else if (room <= 56) {
      // Temp Taken Today, Waiting for Doctor Visit
      for (let d = daysAdmitted; d >= 0; d--) {
        const date = addDays(today, -d);
        const isCuredToday = room <= 36; // Rooms 31-36 hit 3/3 fever-free today!
        let temp;
        if (isCuredToday) {
          temp = d >= 3 ? 38.7 : Number((36.7 + (d * 0.15)).toFixed(1));
        } else {
          temp = d === 0 && room % 3 === 0
            ? 37.3
            : Number((38.1 + ((room + d) % 14) * 0.1).toFixed(1));
        }
        logs.push({
          date,
          temperature: temp,
          tempTakenAt: `${date}T08:${String((room % 50) + 10).padStart(2, "0")}:00Z`,
          doctorVisited: d > 0,
          doctorVisitedAt: d > 0 ? `${date}T11:30:00Z` : null,
          doctorNotes: d > 0 ? "Reviewed chart, continue monitoring." : null
        });
      }
    } else {
      // Temp Taken & Doctor Visited Today
      for (let d = daysAdmitted; d >= 0; d--) {
        const date = addDays(today, -d);
        const temp = d === 0 && room % 2 === 0
          ? 37.4
          : Number((38.0 + ((room + d) % 11) * 0.1).toFixed(1));
        logs.push({
          date,
          temperature: temp,
          tempTakenAt: `${date}T07:45:00Z`,
          doctorVisited: true,
          doctorVisitedAt: `${date}T10:15:00Z`,
          doctorNotes: temp >= FEVER_THRESHOLD_C ? "Persistent fever, adjusted dosage." : "Improving, afebrile today."
        });
      }
    }

    patients.push({
      id,
      name,
      age,
      roomNumber: room,
      admittedAt,
      status: "active",
      outcomeAt: null,
      readyForDischarge,
      treatmentNotes,
      logs
    });
  }

  // Historical closed cases to track against 85% success / 15% mortality benchmark
  // 34 cured/discharged + 5 deceased = 39 total closed (12.8% mortality, 87.2% success)
  for (let i = 0; i < 39; i++) {
    const isDeceased = i >= 34;
    const id = `P-${String(nextId++).padStart(3, "0")}`;
    const outcomeDaysAgo = 1 + (i % 14);
    const outcomeAt = addDays(today, -outcomeDaysAgo);
    const admittedAt = addDays(outcomeAt, -(4 + (i % 5)));

    patients.push({
      id,
      name: pickName(80 + i),
      age: isDeceased ? 64 + (i % 20) : 25 + ((i * 7) % 45),
      roomNumber: null,
      admittedAt,
      status: isDeceased ? "deceased" : "discharged",
      outcomeAt,
      readyForDischarge: false,
      treatmentNotes: isDeceased
        ? "Severe respiratory complications despite ICU care."
        : "Completed 3-day fever-free protocol and discharged.",
      logs: []
    });
  }

  return {
    totalRooms: 74,
    currentDate: today,
    nextPatientNum: nextId,
    patients
  };
}
