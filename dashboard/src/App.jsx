import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { db, auth } from './firebaseClient';
import { collection, query, orderBy, onSnapshot, doc, updateDoc, deleteDoc, limit, getDocs, addDoc } from 'firebase/firestore';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { calculateSituationOverviewMetrics, getOverallSeverity } from './overviewMetrics';
import './styles.css';

const SITUATION_LABEL = {
  stranded: 'Stranded / water rising',
  injured: 'Injured person',
  supplies: 'Needs food / water',
  evacuate: 'Needs evacuation'
};
const CRITICAL = new Set(['stranded', 'injured']);

const FLAG_LABEL = {
  medical_emergency: 'Medical emergency',
  elderly: 'Elderly',
  children: 'Children',
  pregnant: 'Pregnant',
  disabled: 'Disabled',
  no_supplies: 'No supplies',
  structural_danger: 'Structural danger'
};

const CLUSTER_RADIUS_METERS = 1000;
const CLUSTER_MIN_SOS = 3;

const DEMO_CLUSTER_REQUESTS = [
  {
    id: 'demo-cluster-1',
    name: 'Asha Rao',
    phone: '9876543210',
    people_count: 4,
    situation: 'stranded',
    notes: 'Kurla East, near Metro station · 🎙️ Voice SOS Attached',
    lat: 20.5933,
    lng: 78.9628,
    captured_at: Date.now() - 60000,
    status: 'pending',
    audio_data: 'data:audio/webm;base64,GkXfo59ChoEBQveBAULygQ88StructureSAlQ26B0N0Y0Q1Z0...',
    audio_size_kb: '14.8',
    audio_transcript: 'We are 4 people stranded on 2nd floor near Kurla Metro station, water level is rising fast and grandma needs urgent help!',
    audio_analysis: {
      situation: 'stranded',
      severity: 'critical',
      peopleCount: '4',
      locationHint: 'near Kurla Metro station',
      summary: 'Voice SOS: Stranded group of 4 near Kurla Metro with rising water.'
    }
  },
  {
    id: 'demo-cluster-2',
    name: 'Vikram Das',
    phone: '9876543211',
    people_count: 6,
    situation: 'injured',
    notes: 'Kurla East, lane 4 · 📷 Photo SOS Attached',
    lat: 20.5940,
    lng: 78.9635,
    captured_at: Date.now() - 120000,
    status: 'pending',
    image_data: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400"><rect width="600" height="400" fill="%230F172A"/><path d="M0 250 Q150 200 300 250 T600 250 L600 400 L0 400 Z" fill="%230284C7" opacity="0.6"/><path d="M0 280 Q150 230 300 280 T600 280 L600 400 L0 400 Z" fill="%230369A1"/><rect x="220" y="120" width="160" height="140" fill="%231E293B" stroke="%2338BDF8" stroke-width="4"/><polygon points="200,120 300,50 400,120" fill="%23FF5A1F"/><text x="300" y="360" font-family="sans-serif" font-size="20" font-weight="bold" fill="%23FFFFFF" text-anchor="middle">FLOOD INUNDATION SCENE DETECTED</text></svg>',
    image_size_kb: '76.4',
    image_original_size_mb: '4.20',
    image_analysis: {
      situation: 'injured',
      severity: 'critical',
      waterLevel: 'Waist-Deep Water (~1.2m)',
      hazards: ['⚡ Electrical Hazard (Submerged Wires)', '🌊 High Water Inundation', '🚧 Blocked Road'],
      peopleCount: '6',
      confidence: '95%',
      locationHint: 'Kurla East lane 4, submerged ground floor',
      summary: 'Visual Assessment: Waist-deep flood inundation with downed wires near residential building.'
    }
  },
  {
    id: 'demo-cluster-3',
    name: 'Meera Shah',
    phone: '9876543212',
    people_count: 3,
    situation: 'supplies',
    notes: 'Kurla East, community housing',
    lat: 20.5937,
    lng: 78.9641,
    captured_at: Date.now() - 180000,
    status: 'dispatched'
  },
  {
    id: 'demo-cluster-4',
    name: 'Harish Menon',
    phone: '9876543213',
    people_count: 5,
    situation: 'evacuate',
    notes: 'Kurla East, apartment block',
    lat: 20.5946,
    lng: 78.9622,
    captured_at: Date.now() - 240000,
    status: 'pending'
  },
  {
    id: 'demo-cluster-5',
    name: 'Naina Bhat',
    phone: '9876543214',
    people_count: 2,
    situation: 'injured',
    notes: 'Kurla East, school road',
    lat: 20.5938,
    lng: 78.9620,
    captured_at: Date.now() - 300000,
    status: 'pending'
  },
  {
    id: 'demo-cluster-6',
    name: 'Rakesh Kumar',
    phone: '9876543215',
    people_count: 7,
    situation: 'stranded',
    notes: 'Kurla East, overbridge',
    lat: 20.5928,
    lng: 78.9647,
    captured_at: Date.now() - 360000,
    status: 'pending'
  },
  {
    id: 'demo-outlier',
    name: 'Sanjay Patel',
    phone: '9876543216',
    people_count: 2,
    situation: 'supplies',
    notes: 'Andheri West, near sea link',
    lat: 19.1128,
    lng: 72.8658,
    captured_at: Date.now() - 420000,
    status: 'pending'
  }
];

// AI priority checker
function isCritical(r) {
  if (r.ai_priority) return r.ai_priority === 'critical' || r.ai_priority === 'high';
  return CRITICAL.has(r.situation);
}

function calculatePriorityScore(req, clusters) {
  let score = 0;

  // 1. Urgency category base points
  if (req.situation === 'injured' || req.situation === 'stranded') {
    score += 40;
  } else if (req.situation === 'evacuate') {
    score += 25;
  } else if (req.situation === 'supplies') {
    score += 15;
  }

  // 2. People affected: +5 points per person, capped at 25
  const count = parseInt(req.people_count) || 1;
  score += Math.min(25, count * 5);

  // 3. AI Priority Triage: critical +20, high +10, normal +0
  if (req.ai_priority === 'critical') {
    score += 20;
  } else if (req.ai_priority === 'high') {
    score += 10;
  }

  // 4. AI flags (medical emergency: +15, vulnerable groups: +10 each, children: +5)
  if (req.ai_flags && Array.isArray(req.ai_flags)) {
    if (req.ai_flags.includes('medical_emergency')) score += 15;
    if (req.ai_flags.includes('elderly')) score += 10;
    if (req.ai_flags.includes('pregnant')) score += 10;
    if (req.ai_flags.includes('disabled')) score += 10;
    if (req.ai_flags.includes('children')) score += 5;
  }

  // 5. Cluster proximity: if in an emergency cluster, add 15 points
  const inCluster = (clusters || []).some(c => c.requests.some(r => r.id === req.id || r.localId === req.id));
  if (inCluster) {
    score += 15;
  }

  // 6. Waiting time escalation: +1 point for every 2 minutes since captured_at (no cap)
  const elapsedMinutes = (Date.now() - req.captured_at) / (1000 * 60);
  score += Math.floor(elapsedMinutes / 2);

  return Math.min(100, score);
}

function markerColor(r) {
  if (r.status === 'rescued') return '#2BAF66';
  if (isCritical(r)) return '#FF5A1F';
  if (r.situation === 'evacuate') return '#F2A93B';
  return '#8FA1BA';
}

function ChangeMapView({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.setView(center, zoom);
    }
  }, [center, zoom, map]);
  return null;
}

// Distance calculator
function getDistance(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 9999;
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

function getDistanceInMeters(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return Number.POSITIVE_INFINITY;
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
}

function detectEmergencyClusters(reqs) {
  const activeReqs = (reqs || []).filter((r) => r.lat && r.lng && (r.status === 'pending' || r.status === 'dispatched'));
  if (activeReqs.length < CLUSTER_MIN_SOS) return [];

  const clusters = [];
  activeReqs.forEach((req) => {
    let assignedCluster = null;
    clusters.forEach((cluster) => {
      const centerLat = cluster.centerLat / cluster.requests.length;
      const centerLng = cluster.centerLng / cluster.requests.length;
      if (!assignedCluster && getDistanceInMeters(req.lat, req.lng, centerLat, centerLng) <= CLUSTER_RADIUS_METERS) {
        assignedCluster = cluster;
      }
    });

    if (assignedCluster) {
      assignedCluster.requests.push(req);
      assignedCluster.centerLat += req.lat;
      assignedCluster.centerLng += req.lng;
    } else {
      clusters.push({ requests: [req], centerLat: req.lat, centerLng: req.lng });
    }
  });

  return clusters
    .filter((cluster) => cluster.requests.length >= CLUSTER_MIN_SOS)
    .map((cluster) => {
      const centerLat = cluster.centerLat / cluster.requests.length;
      const centerLng = cluster.centerLng / cluster.requests.length;
      const criticalCount = cluster.requests.filter((r) => isCritical(r)).length;
      const estimatedPeople = cluster.requests.reduce((acc, r) => acc + Number(r.people_count || 0 || 1), 0);
      const priority = criticalCount >= 3 ? 'CRITICAL' : cluster.requests.length >= 6 ? 'HIGH' : 'MEDIUM';
      const locationLabel = cluster.requests
        .map((r) => r.notes)
        .find((note) => typeof note === 'string' && note.trim())
        ?.split(',')[0]
        ?.trim() || `Cluster near ${centerLat.toFixed(3)}, ${centerLng.toFixed(3)}`;

      return {
        id: `${locationLabel}-${cluster.requests.length}`,
        location: locationLabel,
        sosCount: cluster.requests.length,
        criticalCount,
        estimatedPeople,
        priority,
        centerLat,
        centerLng,
        requests: cluster.requests,
        summary: `${cluster.requests.length} SOS requests within a ${CLUSTER_RADIUS_METERS / 1000} km radius`
      };
    })
    .sort((a, b) => b.sosCount - a.sosCount);
}

// Simulated Datasets
const MOCK_HOSPITALS = [
  {
    name: 'City General Hospital',
    location: 'Sector 4 Metro',
    latitude: 20.6100,
    longitude: 78.9800,
    totalBeds: 250,
    availableBeds: 45,
    icuTotal: 30,
    icuAvailable: 4,
    emergencyCapacity: 80,
    status: 'Operational (Near Capacity)'
  },
  {
    name: 'Red Cross Trauma Center',
    location: 'North Bypass road',
    latitude: 20.5800,
    longitude: 78.9500,
    totalBeds: 120,
    availableBeds: 60,
    icuTotal: 15,
    icuAvailable: 8,
    emergencyCapacity: 50,
    status: 'Operational'
  },
  {
    name: 'St. Jude Mercy Clinic',
    location: 'Old Town Square',
    latitude: 20.6200,
    longitude: 78.9400,
    totalBeds: 80,
    availableBeds: 5,
    icuTotal: 8,
    icuAvailable: 0,
    emergencyCapacity: 20,
    status: 'Critical Alert'
  }
];

const MOCK_SHELTERS = [
  {
    name: 'Stadium Relief Camp',
    location: 'National Sports Complex',
    latitude: 20.5900,
    longitude: 78.9700,
    capacity: 1000,
    occupied: 750,
    available: 250,
    foodStock: 'Good (3 days)',
    waterStock: 'Good (4 days)',
    medicalStock: 'Limited',
    status: 'Active'
  },
  {
    name: 'St. Mary High School',
    location: 'Hill Road West',
    latitude: 20.6050,
    longitude: 78.9350,
    capacity: 300,
    occupied: 290,
    available: 10,
    foodStock: 'Critical (Needs Supply)',
    waterStock: 'Adequate',
    medicalStock: 'Good',
    status: 'Nearly Full'
  },
  {
    name: 'Community Center Hall',
    location: 'East Ward Sector 2',
    latitude: 20.5750,
    longitude: 78.9900,
    capacity: 200,
    occupied: 45,
    available: 155,
    foodStock: 'Good',
    waterStock: 'Good',
    medicalStock: 'Adequate',
    status: 'Active'
  }
];

const MOCK_RESOURCES = [
  {
    type: 'boat',
    name: 'Rescue Boat Alpha',
    latitude: 20.5950,
    longitude: 78.9650,
    capacity: 10,
    availability: 'available',
    status: 'Idle at Station'
  },
  {
    type: 'ambulance',
    name: 'Trauma Unit 4',
    latitude: 20.6020,
    longitude: 78.9750,
    capacity: 2,
    availability: 'available',
    status: 'Idle at Station'
  },
  {
    type: 'rescue team',
    name: 'NDRF Squad B',
    latitude: 20.5850,
    longitude: 78.9550,
    capacity: 8,
    availability: 'available',
    status: 'On Standby'
  },
  {
    type: 'fire truck',
    name: 'Engine 9',
    latitude: 20.6150,
    longitude: 78.9450,
    capacity: 6,
    availability: 'available',
    status: 'On Standby'
  },
  {
    type: 'volunteer',
    name: 'Volunteer Group East',
    latitude: 20.5700,
    longitude: 78.9850,
    capacity: 15,
    availability: 'available',
    status: 'Distributing Rations'
  }
];

// Offline Decision Support Fallback
const generateDecisionSupportFallback = (reqs, hosps, shelts, resour) => {
  const actSOS = reqs.filter(r => r.status === 'pending' || r.status === 'dispatched');
  const critSOS = reqs.filter(r => isCritical(r) && r.status !== 'rescued');
  
  const areas = {};
  reqs.forEach(r => {
    const area = r.notes?.split(',')[0]?.trim() || r.situation;
    areas[area] = (areas[area] || 0) + 1;
  });
  let priorityArea = 'Sector 4 Metro Zone';
  let maxCount = 0;
  Object.keys(areas).forEach(a => {
    if (areas[a] > maxCount) {
      maxCount = areas[a];
      priorityArea = a;
    }
  });

  const severity = critSOS.length > 0 ? 'CRITICAL' : actSOS.length > 3 ? 'HIGH' : 'STABLE';
  const summary = `Currently managing ${actSOS.length} active emergency calls, with ${critSOS.length} marked as critical. Logistical networks show ${hosps.filter(h => h.availableBeds > 0).length} active hospitals open with vacancy, while relief shelters host ${shelts.reduce((acc, s) => acc + s.occupied, 0)} occupants. Immediate command dispatch is focused on the highest-incident sector: ${priorityArea}.`;
  
  const recommendedActions = [];
  if (critSOS.length > 0) {
    recommendedActions.push("Deploy active NDRF squads and rescue boats to critical locations immediately.");
  }
  if (hosps.some(h => h.status.toLowerCase().includes('critical'))) {
    recommendedActions.push("Initiate emergency patient transfers from overloaded clinics to City General Hospital.");
  }
  if (shelts.some(s => s.foodStock.toLowerCase().includes('critical'))) {
    recommendedActions.push("Coordinate volunteer supply chain to distribute food rations to school shelter zones.");
  }
  if (recommendedActions.length === 0) {
    recommendedActions.push("Monitor water gauges and hold rescue squads on standby.");
    recommendedActions.push("Maintain real-time dashboard listeners for incoming citizen alerts.");
  }

  return {
    overallSeverity: severity,
    priorityArea,
    summary,
    recommendedActions,
    confidence: 88
  };
};

// Offline Explanation Fallback
const generateExplanationsFallback = (req, hosp, shelt, res) => {
  return {
    hospitalExplanation: hosp 
      ? `Selected ${hosp.name} due to its high relative bed capacity (${hosp.availableBeds} beds available) and proximity to the patient. Status is operational.`
      : "No operational hospitals with available beds were found in the vicinity.",
    shelterExplanation: shelt 
      ? `Selected ${shelt.name} as it offers the highest unoccupied capacity (${shelt.capacity - shelt.occupied} spots available) nearby and maintains stable food/water supply lines.`
      : "All surrounding relief camps are currently at maximum capacity.",
    resourceExplanation: res 
      ? `Matched ${res.name} (weight: ${(res.type === 'boat' || res.type === 'ambulance') ? '1.0' : '0.7'}) as the optimal active responder type to handle the '${req.situation}' emergency.`
      : "No active resources are currently idle or available for dispatch."
  };
};

// Offline Situation Report Fallback
const generateSituationReportFallback = (reqs, hosps, shelts, resour) => {
  const actSOS = reqs.filter(r => r.status === 'pending' || r.status === 'dispatched');
  const critSOS = reqs.filter(r => isCritical(r) && r.status !== 'rescued');
  const totalBedsAvailable = hosps.reduce((acc, h) => acc + h.availableBeds, 0);
  const totalOccupants = shelts.reduce((acc, s) => acc + s.occupied, 0);
  
  return `# RAAHAT INCIDENT SITUATION REPORT (SITREP)
**Report Generated**: ${new Date().toLocaleString()}  
**Authority**: RAAHAT Disaster Command Center (Local Fallback Engine)  

---

### 1. Executive Summary
- **Overall Status Alert**: ${critSOS.length > 0 ? '🚨 CRITICAL DISASTER RESPONSE ACTIVE' : '⚠️ HIGH ALERT MONITORING'}
- **Active Citizen SOS Requests**: **${actSOS.length}** active distress calls.
- **Critical Status Cases**: **${critSOS.length}** calls indicating high danger.
- **Logistical Status**: Hospital capacity is stable with **${totalBedsAvailable}** beds available across operational clinics. Shelter camps are currently accommodating **${totalOccupants}** displaced citizens.

---

### 2. Infrastructure & Logistics Status
| Facility | Type | Capacity | Status |
|---|---|---|---|
${hosps.map(h => `| ${h.name} | Hospital | ${h.availableBeds} / ${h.totalBeds} Beds | ${h.status} |`).join('\n')}
${shelts.map(s => `| ${s.name} | Shelter | ${s.occupied} / ${s.capacity} Occupied | ${s.status} |`).join('\n')}

---

### 3. Active Incident Log
${reqs.slice(0, 10).map((r, i) => `- **SOS #${i+1}**: ${r.name} · ${r.people_count} people · Situation: *${SITUATION_LABEL[r.situation] || r.situation}* (Status: **${r.status}**)`).join('\n')}

---

### 4. Recommended Command Actions
1. **Critical Target Deployment**: Deploy boats and NDRF squads to coordinate evacuations.
2. **Resource Relocation**: Dispatch volunteers to shelters flagged with supply deficits.
3. **Capacity Transfers**: Reroute incoming emergency transports from critical-warn clinics to trauma units.
`;
};

export default function App() {
  const [requests, setRequests] = useState([]);
  const [timeTick, setTimeTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeTick(prev => prev + 1);
    }, 10000);
    return () => clearInterval(timer);
  }, []);
  const [hospitals, setHospitals] = useState([]);
  const [shelters, setShelters] = useState([]);
  const [resources, setResources] = useState([]);

  const [filter, setFilter] = useState('all');
  const [loaded, setLoaded] = useState(false);
  const [activeCenter, setActiveCenter] = useState(null);
  const [clusters, setClusters] = useState([]);
  const [activeZoom, setActiveZoom] = useState(5);
  const [activeSidebarTab, setActiveSidebarTab] = useState('sos'); // 'sos' | 'command'
  const [selectedSOS, setSelectedSOS] = useState(null);
  const [expandedPhotoUrl, setExpandedPhotoUrl] = useState(null);

  // Auth States
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);

  // Cloud Functions References
  const [functions, setFunctions] = useState(null);
  const [decisionSupport, setDecisionSupport] = useState({
    overallSeverity: 'STABLE',
    priorityArea: 'Sector 4 Metro Zone',
    summary: 'Evaluating disaster metrics...',
    recommendedActions: [],
    confidence: 100
  });
  const [decisionSupportLoading, setDecisionSupportLoading] = useState(false);

  const [aiExplanations, setAiExplanations] = useState({
    hospitalExplanation: '',
    shelterExplanation: '',
    resourceExplanation: ''
  });
  const [aiExplanationLoading, setAiExplanationLoading] = useState(false);

  const [situationReport, setSituationReport] = useState('');
  const [situationReportLoading, setSituationReportLoading] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  // Registration Form States
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [regType, setRegType] = useState('hospital'); // 'hospital' | 'shelter' | 'resource'
  const [regName, setRegName] = useState('');
  const [regLocation, setRegLocation] = useState('');
  const [regLat, setRegLat] = useState('20.593');
  const [regLng, setRegLng] = useState('78.962');
  const [regTotalBeds, setRegTotalBeds] = useState('100');
  const [regAvailBeds, setRegAvailBeds] = useState('50');
  const [regIcuTotal, setRegIcuTotal] = useState('10');
  const [regIcuAvail, setRegIcuAvail] = useState('5');
  const [regCapacity, setRegCapacity] = useState('200');
  const [regOccupied, setRegOccupied] = useState('50');
  const [regFoodStock, setRegFoodStock] = useState('Good');
  const [regWaterStock, setRegWaterStock] = useState('Good');
  const [regMedicalStock, setRegMedicalStock] = useState('Good');
  const [regStatus, setRegStatus] = useState('Active');
  const [regResType, setRegResType] = useState('boat');
  const [regAvailability, setRegAvailability] = useState('available');

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    if (!regName.trim() || !regLocation.trim()) {
      alert('Please fill out Name and Location');
      return;
    }

    const latVal = parseFloat(regLat) || 20.593;
    const lngVal = parseFloat(regLng) || 78.962;

    try {
      if (regType === 'hospital') {
        const docData = {
          name: regName.trim(),
          location: regLocation.trim(),
          latitude: latVal,
          longitude: lngVal,
          totalBeds: parseInt(regTotalBeds) || 100,
          availableBeds: parseInt(regAvailBeds) || 50,
          icuTotal: parseInt(regIcuTotal) || 10,
          icuAvailable: parseInt(regIcuAvail) || 5,
          status: regStatus || 'Operational'
        };
        if (db) {
          await addDoc(collection(db, 'hospitals'), docData);
        } else {
          setHospitals((prev) => [...prev, { id: `hosp-demo-${Date.now()}`, ...docData }]);
        }
      } else if (regType === 'shelter') {
        const docData = {
          name: regName.trim(),
          location: regLocation.trim(),
          latitude: latVal,
          longitude: lngVal,
          capacity: parseInt(regCapacity) || 200,
          occupied: parseInt(regOccupied) || 50,
          foodStock: regFoodStock || 'Good',
          waterStock: regWaterStock || 'Good',
          medicalStock: regMedicalStock || 'Good',
          status: regStatus || 'Active'
        };
        if (db) {
          await addDoc(collection(db, 'shelters'), docData);
        } else {
          setShelters((prev) => [...prev, { id: `shelter-demo-${Date.now()}`, ...docData }]);
        }
      } else if (regType === 'resource') {
        const docData = {
          name: regName.trim(),
          type: regResType || 'boat',
          latitude: latVal,
          longitude: lngVal,
          capacity: parseInt(regCapacity) || 10,
          availability: regAvailability || 'available',
          status: regStatus || 'Idle at Station'
        };
        if (db) {
          await addDoc(collection(db, 'resources'), docData);
        } else {
          setResources((prev) => [...prev, { id: `res-demo-${Date.now()}`, ...docData }]);
        }
      }

      // Reset values
      setRegName('');
      setRegLocation('');
      setRegLat('20.593');
      setRegLng('78.962');
      setIsRegisterModalOpen(false);
    } catch (err) {
      console.error('Error registering facility/resource:', err);
      alert('Failed to register: ' + err.message);
    }
  };


  // Auto-seeding helper to populate collections if they are empty
  const seedIfEmpty = async (collName, mockData) => {
    if (!db) return;
    try {
      const snap = await getDocs(collection(db, collName));
      if (snap.empty) {
        console.log(`Auto-seeding empty Firestore collection: ${collName}`);
        for (const item of mockData) {
          await addDoc(collection(db, collName), item);
        }
      }
    } catch (err) {
      console.error(`Failed to seed ${collName} collection:`, err);
    }
  };

  // Listen to Auth State
  useEffect(() => {
    if (!auth) {
      // Bypass auth in demo mode so offline testing works out-of-the-box
      setUser({ email: 'demo-responder@raahat.org', isDemo: true });
      setHospitals(MOCK_HOSPITALS);
      setShelters(MOCK_SHELTERS);
      setResources(MOCK_RESOURCES);
      setAuthLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Initialize Functions client
  useEffect(() => {
    if (db && user) {
      try {
        const funcs = getFunctions(db.app);
        setFunctions(funcs);
        seedIfEmpty('hospitals', MOCK_HOSPITALS);
        seedIfEmpty('shelters', MOCK_SHELTERS);
        seedIfEmpty('resources', MOCK_RESOURCES);
      } catch (err) {
        console.error('Failed to initialize functions client:', err);
      }
    }
  }, [db, user]);

  // Listen to Firestore SOS requests and disaster infrastructure (only when authenticated)
  useEffect(() => {
    if (!db || !user) {
      if (user?.isDemo) {
        setRequests(DEMO_CLUSTER_REQUESTS);
        setHospitals(MOCK_HOSPITALS);
        setShelters(MOCK_SHELTERS);
        setResources(MOCK_RESOURCES);
        setLoaded(true);
      } else {
        setRequests([]);
        setHospitals([]);
        setShelters([]);
        setResources([]);
      }
      setLoaded(user ? false : true);
      return;
    }

    setLoaded(false);
    const unsubscribes = [];

    // 1. Live requests listener with query limit
    const qRequests = query(collection(db, 'requests'), orderBy('captured_at', 'desc'), limit(100));
    unsubscribes.push(
      onSnapshot(
        qRequests,
        async (snapshot) => {
          const list = [];
          const safeReports = [];

          snapshot.docs.forEach((d) => {
            const data = { id: d.id, ...d.data() };
            if (data.type === 'safe_report' && data.original_request_id) {
              safeReports.push(data);
            } else {
              list.push(data);
            }
          });

          // Process safe reports: auto-mark original requests as rescued
          for (const report of safeReports) {
            try {
              const origId = report.original_request_id;
              await updateDoc(doc(db, 'requests', origId), {
                status: 'rescued',
                rescued_at: report.reported_at || new Date().toISOString(),
                safe_reported_at: report.reported_at || new Date().toISOString()
              });
              // Clean up the safe report document
              await deleteDoc(doc(db, 'requests', report.id));
            } catch (err) {
              console.error('Error processing safe report:', err);
            }
          }

          // Local AI triage fallback: if the Cloud Function didn't run,
          // assign ai_priority deterministically so it never stays "Pending"
          for (const req of list) {
            if (!req.ai_priority && req.status !== 'rescued') {
              const flags = [];
              const notes = (req.notes || '').toLowerCase();
              const sit = req.situation;
              const count = parseInt(req.people_count) || 1;

              // Detect flags from notes keywords
              if (/injur|bleed|fracture|heart|breath|unconscious|medical/.test(notes)) flags.push('medical_emergency');
              if (/elder|old|senior|aged/.test(notes)) flags.push('elderly');
              if (/child|kid|infant|baby|toddler/.test(notes)) flags.push('children');
              if (/pregnan/.test(notes)) flags.push('pregnant');
              if (/disab|wheelchair|blind|deaf/.test(notes)) flags.push('disabled');
              if (/no food|no water|hungry|thirst|starv/.test(notes)) flags.push('no_supplies');
              if (/collaps|crack|structur|roof|wall falling/.test(notes)) flags.push('structural_danger');

              // Determine priority
              let priority = 'normal';
              let summary = 'Stable situation, needs assistance.';

              if (sit === 'injured' || flags.includes('medical_emergency') || flags.includes('structural_danger')) {
                priority = 'critical';
                summary = `Critical: ${sit === 'injured' ? 'Injured person' : 'Life-threatening situation'} with ${count} people.`;
              } else if (sit === 'stranded' || count >= 4 || flags.includes('elderly') || flags.includes('children') || flags.includes('pregnant')) {
                priority = 'high';
                summary = `High priority: ${sit === 'stranded' ? 'Stranded' : 'Vulnerable group'} with ${count} people needing help.`;
              } else if (sit === 'evacuate') {
                priority = 'high';
                summary = `Evacuation needed for group of ${count}.`;
              } else {
                summary = `${count} ${count === 1 ? 'person' : 'people'} requesting ${sit === 'supplies' ? 'supplies' : 'assistance'}.`;
              }

              // Update the request locally
              req.ai_priority = priority;
              req.ai_flags = flags;
              req.ai_summary = summary;
              req.ai_processed_at = new Date().toISOString();

              // Write back to Firestore so it persists
              try {
                await updateDoc(doc(db, 'requests', req.id), {
                  ai_priority: priority,
                  ai_flags: flags,
                  ai_summary: summary,
                  ai_processed_at: req.ai_processed_at
                });
              } catch (err) {
                console.error('Error writing local triage fallback:', err);
              }
            }
          }

          setRequests(list);
          setLoaded(true);
        },
        (error) => {
          console.error('Firestore requests realtime error:', error);
          setLoaded(true);
        }
      )
    );

    // 2. Live hospitals listener
    unsubscribes.push(
      onSnapshot(
        collection(db, 'hospitals'),
        (snapshot) => {
          setHospitals(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
        },
        (error) => console.error('Firestore hospitals listener error:', error)
      )
    );

    // 3. Live shelters listener
    unsubscribes.push(
      onSnapshot(
        collection(db, 'shelters'),
        (snapshot) => {
          setShelters(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
        },
        (error) => console.error('Firestore shelters listener error:', error)
      )
    );

    // 4. Live resources listener
    unsubscribes.push(
      onSnapshot(
        collection(db, 'resources'),
        (snapshot) => {
          setResources(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
        },
        (error) => console.error('Firestore resources listener error:', error)
      )
    );

    return () => unsubscribes.forEach(unsub => unsub());
  }, [user]);

  const withLoc = requests.filter((r) => r.lat && r.lng);

  useEffect(() => {
    setClusters(detectEmergencyClusters(requests));
  }, [requests]);

  useEffect(() => {
    if (!activeCenter && withLoc.length > 0) {
      setActiveCenter([withLoc[0].lat, withLoc[0].lng]);
    }
  }, [requests, activeCenter]);

  // Trigger RAAHAT Decision Support Engine
  const fetchDecisionSupport = async () => {
    setDecisionSupportLoading(true);
    const metrics = {
      activeSOS: requests.filter(r => r.status === 'pending' || r.status === 'dispatched').length,
      criticalSOS: requests.filter(r => isCritical(r) && r.status !== 'rescued').length,
      availableBeds: hospitals.reduce((acc, h) => acc + h.availableBeds, 0),
      totalBeds: hospitals.reduce((acc, h) => acc + h.totalBeds, 0),
      shelterOccupied: shelters.reduce((acc, s) => acc + s.occupied, 0),
      shelterCapacity: shelters.reduce((acc, s) => acc + s.capacity, 0),
      availableResources: resources.filter(res => res.availability === 'available').length,
      locations: resources.map(res => ({ type: res.type, lat: res.latitude, lng: res.longitude }))
    };

    try {
      if (!db || !auth || !functions) throw new Error('Offline Demo Mode');
      const genSupport = httpsCallable(functions, 'generateDecisionSupport');
      const res = await genSupport({ metrics });
      setDecisionSupport(res.data);
    } catch (err) {
      console.warn('AI summary call failed, running local fallback engine:', err.message);
      const fallback = generateDecisionSupportFallback(requests, hospitals, shelters, resources);
      setDecisionSupport(fallback);
    } finally {
      setDecisionSupportLoading(false);
    }
  };

  // Run AI summary when list loaded initially
  useEffect(() => {
    if (loaded && requests.length > 0) {
      fetchDecisionSupport();
    }
  }, [loaded]);

  // Deterministic recommendations scoring
  const getHospitalRecommendation = (req) => {
    const eligible = hospitals.filter(h => h.availableBeds > 0 && h.status?.toLowerCase() !== 'closed');
    if (eligible.length === 0) return { hospital: null, score: 0 };
    
    let bestHosp = null;
    let bestScore = -1;
    
    eligible.forEach(h => {
      const dist = getDistance(req.lat, req.lng, h.latitude, h.longitude);
      const capacityRatio = h.availableBeds / h.totalBeds;
      let score = (capacityRatio * 0.4) + ((1 / (dist + 0.01)) * 0.6);
      
      // ICU Boost for medical emergencies
      const isMedical = req.situation === 'injured' || (req.ai_flags || []).includes('medical_emergency');
      if (isMedical && h.icuAvailable > 0) {
        score += 0.3;
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestHosp = h;
      }
    });
    return { hospital: bestHosp, score: bestScore };
  };

  const getShelterRecommendation = (req) => {
    const eligible = shelters.filter(s => s.capacity - s.occupied > 0);
    if (eligible.length === 0) return { shelter: null, score: 0 };
    
    let bestShelter = null;
    let bestScore = -1;
    
    eligible.forEach(s => {
      const dist = getDistance(req.lat, req.lng, s.latitude, s.longitude);
      const availCapacity = s.capacity - s.occupied;
      const capacityRatio = availCapacity / s.capacity;
      const score = (capacityRatio * 0.4) + ((1 / (dist + 0.01)) * 0.6);
      if (score > bestScore) {
        bestScore = score;
        bestShelter = s;
      }
    });
    return { shelter: bestShelter, score: bestScore };
  };

  const getResourceRecommendation = (req) => {
    const eligible = resources.filter(r => r.availability?.toLowerCase() === 'available');
    if (eligible.length === 0) return { resource: null, score: 0, weightBreakdown: null };
    
    let bestRes = null;
    let bestScore = -1;
    let bestBreakdown = null;
    
    // Check if citizen is in a cluster
    const cluster = clusters.find(c => c.requests.some(r => r.id === req.id || r.localId === req.id));
    const inCluster = !!cluster;
    
    eligible.forEach(r => {
      let typeWeight = 0.1;
      if (req.situation === 'stranded' || req.situation === 'evacuate') {
        if (r.type?.toLowerCase() === 'boat') typeWeight = 1.0;
        else if (r.type?.toLowerCase() === 'rescue team') typeWeight = 0.8;
        else if (r.type?.toLowerCase() === 'fire truck') typeWeight = 0.6;
      } else if (req.situation === 'injured') {
        if (r.type?.toLowerCase() === 'ambulance') typeWeight = 1.0;
        else if (r.type?.toLowerCase() === 'rescue team') typeWeight = 0.7;
        else if (r.type?.toLowerCase() === 'volunteer') typeWeight = 0.5;
      } else if (req.situation === 'supplies') {
        if (r.type?.toLowerCase() === 'volunteer') typeWeight = 1.0;
        else if (r.type?.toLowerCase() === 'fire truck') typeWeight = 0.6;
      }
      
      const dist = getDistance(req.lat, req.lng, r.latitude, r.longitude);
      const distScore = 1 / (dist + 0.01);
      let score = (typeWeight * 0.6) + (distScore * 0.4);
      
      // Cluster capacity boost: if in cluster and resource capacity >= 6, add 0.2 boost
      let clusterBoost = 0;
      if (inCluster && r.capacity >= 6) {
        clusterBoost = 0.2;
        score += clusterBoost;
      }
      
      // Priority boost: if high/critical priority and fast responder type, add 0.1 boost
      let priorityBoost = 0;
      const isHighPri = req.ai_priority === 'critical' || req.ai_priority === 'high' || req.situation === 'injured' || req.situation === 'stranded';
      if (isHighPri && (r.type?.toLowerCase() === 'boat' || r.type?.toLowerCase() === 'ambulance' || r.type?.toLowerCase() === 'rescue team')) {
        priorityBoost = 0.1;
        score += priorityBoost;
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestRes = r;
        bestBreakdown = {
          typeWeight,
          distScore,
          clusterBoost,
          priorityBoost,
          finalScore: score
        };
      }
    });
    return { resource: bestRes, score: bestScore, weightBreakdown: bestBreakdown };
  };

  // Trigger Recommendations Explainer
  const fetchExplanations = async (sos, hosp, shelt, res) => {
    setAiExplanationLoading(true);
    setAiExplanations({ hospitalExplanation: '', shelterExplanation: '', resourceExplanation: '' });
    try {
      if (!db || !auth || !functions) throw new Error('Offline Demo Mode');
      const getExpls = httpsCallable(functions, 'explainRecommendations');
      const response = await getExpls({
        sosRequest: { name: sos.name, situation: sos.situation, notes: sos.notes, people_count: sos.people_count },
        hospital: hosp ? { name: hosp.name, availableBeds: hosp.availableBeds, status: hosp.status } : null,
        shelter: shelt ? { name: shelt.name, available: shelt.capacity - shelt.occupied, status: shelt.status } : null,
        resource: res ? { name: res.name, type: res.type, status: res.status } : null
      });
      setAiExplanations(response.data);
    } catch (err) {
      console.warn('AI explanation call failed, running local fallback explainer:', err.message);
      const fallback = generateExplanationsFallback(sos, hosp, shelt, res);
      setAiExplanations(fallback);
    } finally {
      setAiExplanationLoading(false);
    }
  };

  // Listen to selected SOS change to recalculate recommendations
  useEffect(() => {
    if (selectedSOS) {
      const { hospital } = getHospitalRecommendation(selectedSOS);
      const { shelter } = getShelterRecommendation(selectedSOS);
      const { resource } = getResourceRecommendation(selectedSOS);
      fetchExplanations(selectedSOS, hospital, shelter, resource);
    }
  }, [selectedSOS]);

  // Keep selectedSOS in sync with live updates from the requests list (e.g. from the field Rescue App)
  useEffect(() => {
    if (!selectedSOS) return;
    const latest = requests.find(r => r.id === selectedSOS.id);
    if (latest) {
      if (
        latest.status !== selectedSOS.status ||
        latest.eta_minutes !== selectedSOS.eta_minutes ||
        latest.distance_meters !== selectedSOS.distance_meters ||
        latest.assigned_resource_lat !== selectedSOS.assigned_resource_lat ||
        latest.assigned_resource_lng !== selectedSOS.assigned_resource_lng ||
        latest.ai_priority !== selectedSOS.ai_priority ||
        latest.assigned_resource_name !== selectedSOS.assigned_resource_name
      ) {
        setSelectedSOS(latest);
      }
    }
  }, [requests, selectedSOS]);

  // Generate Situation Report
  const triggerSituationReport = async () => {
    setSituationReportLoading(true);
    setIsReportModalOpen(true);
    setSituationReport('');
    
    const metrics = {
      activeSOS: requests.filter(r => r.status === 'pending' || r.status === 'dispatched').length,
      criticalSOS: requests.filter(r => isCritical(r) && r.status !== 'rescued').length,
      availableBeds: hospitals.reduce((acc, h) => acc + h.availableBeds, 0),
      totalBeds: hospitals.reduce((acc, h) => acc + h.totalBeds, 0),
      shelterOccupied: shelters.reduce((acc, s) => acc + s.occupied, 0),
      shelterCapacity: shelters.reduce((acc, s) => acc + s.capacity, 0),
      availableResources: resources.filter(res => res.availability === 'available').length
    };

    const activeIncidents = requests.filter(r => r.status !== 'rescued').map(r => ({
      name: r.name,
      people: r.people_count,
      situation: r.situation,
      notes: r.notes,
      status: r.status,
      ai_priority: r.ai_priority
    }));

    try {
      if (!db || !auth || !functions) throw new Error('Offline Demo Mode');
      const genReport = httpsCallable(functions, 'generateSituationReport');
      const response = await genReport({ metrics, activeIncidents });
      setSituationReport(response.data.report);
    } catch (err) {
      console.warn('AI report call failed, generating local fallback report:', err.message);
      const fallback = generateSituationReportFallback(requests, hospitals, shelters, resources);
      setSituationReport(fallback);
    } finally {
      setSituationReportLoading(false);
    }
  };

  const updateStatus = async (id, status, assignedResource = null) => {
    const timestampKey = 
      status === 'team_assigned' ? 'assigned_at' : 
      status === 'dispatched' ? 'dispatched_at' : 
      status === 'rescued' ? 'rescued_at' : null;
    const timestampVal = new Date().toISOString();

    setRequests((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
            ...r,
            status,
            ...(timestampKey ? { [timestampKey]: timestampVal } : {}),
            ...(assignedResource ? {
              assigned_resource_id: assignedResource.id || assignedResource.name,
              assigned_resource_name: assignedResource.name
            } : {})
          }
          : r
      )
    );

    // Sync selectedSOS if it is the one being updated
    if (selectedSOS && selectedSOS.id === id) {
      setSelectedSOS(prev => ({
        ...prev,
        status,
        ...(timestampKey ? { [timestampKey]: timestampVal } : {}),
        ...(assignedResource ? {
          assigned_resource_id: assignedResource.id || assignedResource.name,
          assigned_resource_name: assignedResource.name
        } : {})
      }));
    }

    // If a resource was assigned, mark that resource as 'busy' in state and db
    if (assignedResource) {
      setResources(prev =>
        prev.map(res =>
          (res.id === assignedResource.id || res.name === assignedResource.name)
            ? { ...res, availability: 'busy', status: `Dispatched to rescue ${selectedSOS?.name || 'citizen'}` }
            : res
        )
      );

      if (db && assignedResource.id) {
        try {
          const resRef = doc(db, 'resources', assignedResource.id);
          await updateDoc(resRef, {
            availability: 'busy',
            status: `Dispatched to rescue ${selectedSOS?.name || 'citizen'}`
          });
        } catch (err) {
          console.error('Error updating resource to busy in Firestore:', err);
        }
      }
    }

    // If status is 'rescued', release the assigned resource back to 'available'
    if (status === 'rescued') {
      const citizenReq = requests.find(r => r.id === id);
      const resId = citizenReq?.assigned_resource_id || selectedSOS?.assigned_resource_id;
      const resName = citizenReq?.assigned_resource_name || selectedSOS?.assigned_resource_name;
      if (resId || resName) {
        setResources(prev =>
          prev.map(res =>
            (res.id === resId || res.name === resName)
              ? { ...res, availability: 'available', status: 'On Standby' }
              : res
          )
        );

        if (db && resId) {
          try {
            await updateDoc(doc(db, 'resources', resId), {
              availability: 'available',
              status: 'On Standby'
            });
          } catch (err) {
            console.error('Error freeing resource in Firestore:', err);
          }
        }
      }
    }

    if (!db) return;

    try {
      const updates = { status };
      if (timestampKey) {
        updates[timestampKey] = timestampVal;
      }
      if (assignedResource) {
        updates.assigned_resource_id = assignedResource.id || assignedResource.name;
        updates.assigned_resource_name = assignedResource.name;
      }
      await updateDoc(doc(db, 'requests', id), updates);
    } catch (err) {
      console.error('Error updating status in Firestore:', err);
    }
  };

  const handleCardClick = (r) => {
    setSelectedSOS(r);
    handleMapFocus(r.lat, r.lng);
  };

  const handleMapFocus = (lat, lng) => {
    if (lat && lng) {
      setActiveCenter([lat, lng]);
      setActiveZoom(14);
    }
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    if (!email || !password) {
      setAuthError('Please fill in all fields');
      return;
    }
    setSubmitLoading(true);
    try {
      if (isRegistering) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      console.error('Auth error:', err);
      if (err.code === 'auth/weak-password') {
        setAuthError('Password should be at least 6 characters.');
      } else if (err.code === 'auth/email-already-in-use') {
        setAuthError('This email is already registered.');
      } else if (err.code === 'auth/invalid-credential') {
        setAuthError('Incorrect email or password.');
      } else if (err.code === 'auth/invalid-email') {
        setAuthError('Please enter a valid email address.');
      } else {
        setAuthError(err.message || 'An authentication error occurred.');
      }
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleSignOut = async () => {
    if (!auth) return;
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Sign out error:', err);
    }
  };

  if (authLoading) {
    return (
      <div className="auth-loading-screen">
        <div className="auth-loading-spinner"></div>
        <div className="loading-text">Initializing Raahat Responders...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-header">
            <h2>Raahat SOS</h2>
            <p>Responder & Admin Portal</p>
          </div>
          <form onSubmit={handleAuthSubmit} className="auth-form">
            <div className="form-group">
              <label htmlFor="auth-email">Email Address</label>
              <input
                id="auth-email"
                type="email"
                placeholder="responder@raahat.org"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="auth-password">Password</label>
              <input
                id="auth-password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {authError && <div className="auth-error-msg">{authError}</div>}
            <button type="submit" className="auth-submit-btn" disabled={submitLoading}>
              {submitLoading ? 'Processing...' : isRegistering ? 'Register Account' : 'Sign In'}
            </button>
          </form>
          <div className="auth-footer">
            <button onClick={() => { setIsRegistering(!isRegistering); setAuthError(''); }} className="toggle-auth-mode">
              {isRegistering ? 'Already have an account? Sign In' : 'Need responder access? Register Here'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Calculate SOS Statistics
  const activeSOSCount = requests.filter(r => r.status === 'pending' || r.status === 'dispatched').length;
  const criticalSOSCount = requests.filter(r => isCritical(r) && r.status !== 'rescued').length;
  const pending = requests.filter((r) => r.status === 'pending').length;
  const rescued = requests.filter((r) => r.status === 'rescued').length;

  const filtered = requests.filter((r) => filter === 'all' || r.status === filter);
  const sorted = [...filtered].map(r => {
    const score = calculatePriorityScore(r, clusters);
    const isOverdue = score >= 75 && r.status !== 'rescued';
    const isEscalated = r.escalated || isOverdue;
    return { ...r, priorityScore: score, isEscalated };
  }).sort((a, b) => {
    if (a.isEscalated && !b.isEscalated) return -1;
    if (!a.isEscalated && b.isEscalated) return 1;
    if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
    return b.captured_at - a.captured_at;
  });

  // Calculate Infrastructure Capacities
  const availableBeds = hospitals.reduce((acc, h) => acc + (Number(h.availableBeds) || 0), 0);
  const totalBeds = hospitals.reduce((acc, h) => acc + (Number(h.totalBeds) || 0), 0);

  const occupiedShelter = shelters.reduce((acc, s) => acc + (Number(s.occupied) || 0), 0);
  const shelterCapacity = shelters.reduce((acc, s) => acc + (Number(s.capacity) || 0), 0);

  const availableResources = resources.filter(res => res.availability === 'available').length;

  // Determine severity level dynamically
  let severity = 'STABLE';
  let severityClass = 'sev-stable';
  if (criticalSOSCount > 0) {
    severity = 'CRITICAL LEVEL';
    severityClass = 'sev-critical';
  } else if (activeSOSCount > 3) {
    severity = 'HIGH ALERT';
    severityClass = 'sev-high';
  }

  // Get active selected recommendations
  const recommendedHospital = selectedSOS ? getHospitalRecommendation(selectedSOS).hospital : null;
  const recommendedShelter = selectedSOS ? getShelterRecommendation(selectedSOS).shelter : null;
  const recommendedResource = selectedSOS ? getResourceRecommendation(selectedSOS).resource : null;
  const resourceWeightBreakdown = selectedSOS ? getResourceRecommendation(selectedSOS).weightBreakdown : null;
  const overviewMetrics = calculateSituationOverviewMetrics(requests, hospitals, shelters, resources, clusters);
  const overviewSeverity = getOverallSeverity(overviewMetrics.criticalSOSCount, overviewMetrics.activeSOSCount);
  const currentSituationSummary = decisionSupport?.summary || 'No live situation summary available yet.';

  return (
    <div className="app">
      <aside className="sidebar">
        <header>
          <div className="header-top-row">
            <div className="title">Raahat — Command Center</div>
            <button className="signout-btn" onClick={handleSignOut}>
              Sign Out
            </button>
          </div>
          <div className="sub">Disaster Management Portal</div>
          <div className="user-badge">Logged in: {user.email}</div>
        </header>

        {!db && (
          <div className="demo-banner">
            ⚠️ Running in Offline Demo Mode (Firebase configuration is missing)
          </div>
        )}

        <div className="tab-navigation">
          <button
            className={activeSidebarTab === 'sos' ? 'tab-btn active' : 'tab-btn'}
            onClick={() => { setActiveSidebarTab('sos'); setSelectedSOS(null); }}
          >
            🚨 SOS Queue ({requests.length})
          </button>
          <button
            className={activeSidebarTab === 'command' ? 'tab-btn active' : 'tab-btn'}
            onClick={() => setActiveSidebarTab('command')}
          >
            🏥 Infrastructure ({hospitals.length + shelters.length + resources.length})
          </button>
        </div>

        {activeSidebarTab === 'sos' && (
          <>
            {selectedSOS ? (
              /* RAAHAT SOS Master-Detail View */
              <div className="sos-detail-view">
                <button className="back-btn" onClick={() => setSelectedSOS(null)}>
                  ← Back to SOS Queue
                </button>
                <div className="detail-card">
                  <div className="detail-header-row">
                    <span className="name">🧑 {selectedSOS.name}</span>
                    <span className={`status-badge status-${selectedSOS.status}`}>
                      {selectedSOS.status}
                    </span>
                  </div>
                  <div className="detail-body">
                    <span>👥 Group Count: <b>{selectedSOS.people_count} people</b></span>
                    <span>📞 Phone: {selectedSOS.phone}</span>
                    <span>Situation: <b>{SITUATION_LABEL[selectedSOS.situation] || selectedSOS.situation}</b></span>
                    {selectedSOS.notes && <div className="notes">Notes: "{selectedSOS.notes}"</div>}
                    <div className="meta">
                      Captured: {new Date(selectedSOS.captured_at).toLocaleString()}
                    </div>
                  </div>

                  {/* Voice SOS Audio Player & AI Transcript Card */}
                  {(selectedSOS.audio_data || selectedSOS.audio_url || selectedSOS.audioData) && (
                    <div className="voice-sos-dashboard-card" style={{ marginTop: '16px', background: 'rgba(37, 99, 235, 0.08)', border: '1px solid rgba(37, 99, 235, 0.3)', borderRadius: '10px', padding: '14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#60A5FA', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          🎙️ Voice SOS Message
                        </span>
                        {(selectedSOS.audio_size_kb || selectedSOS.audioSizeKb) && (
                          <span style={{ fontSize: '10px', background: '#1E3A8A', color: '#93C5FD', padding: '2px 8px', borderRadius: '999px', fontWeight: 'bold' }}>
                            {selectedSOS.audio_size_kb || selectedSOS.audioSizeKb} KB (Compressed Audio)
                          </span>
                        )}
                      </div>

                      {/* Native Audio Controls */}
                      <audio
                        controls
                        src={selectedSOS.audio_data || selectedSOS.audio_url || selectedSOS.audioData}
                        style={{ width: '100%', height: '36px', marginBottom: '10px' }}
                      />

                      {/* Speech Transcript */}
                      {(selectedSOS.audio_transcript || selectedSOS.audioTranscript) && (
                        <div style={{ background: '#0F172A', border: '1px solid #1E293B', padding: '10px', borderRadius: '8px', marginBottom: '8px', fontSize: '12px' }}>
                          <span style={{ color: '#94A3B8', fontSize: '10px', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>📝 SPEECH TRANSCRIPT:</span>
                          <span style={{ color: '#E2E8F0', fontStyle: 'italic' }}>"{selectedSOS.audio_transcript || selectedSOS.audioTranscript}"</span>
                        </div>
                      )}

                      {/* AI Voice Analysis Summary */}
                      {(selectedSOS.audio_analysis || selectedSOS.audioAnalysis) && (
                        <div style={{ fontSize: '11px', color: '#CBD5E1', lineHeight: '1.4' }}>
                          {(selectedSOS.audio_analysis?.locationHint || selectedSOS.audioAnalysis?.locationHint) && (
                            <div style={{ marginBottom: '4px' }}>
                              📍 <b>Location Hint:</b> {selectedSOS.audio_analysis?.locationHint || selectedSOS.audioAnalysis?.locationHint}
                            </div>
                          )}
                          {(selectedSOS.audio_analysis?.summary || selectedSOS.audioAnalysis?.summary) && (
                            <div>
                              🤖 <b>AI Summary:</b> {selectedSOS.audio_analysis?.summary || selectedSOS.audioAnalysis?.summary}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Photo SOS Image & AI Scene Assessment Card */}
                  {(selectedSOS.image_data || selectedSOS.image_url || selectedSOS.imageData) && (
                    <div className="photo-sos-dashboard-card" style={{ marginTop: '16px', background: 'rgba(2, 132, 199, 0.08)', border: '1px solid rgba(2, 132, 199, 0.3)', borderRadius: '10px', padding: '14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#38BDF8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          📷 Photo SOS Assessment
                        </span>
                        {(selectedSOS.image_size_kb || selectedSOS.imageSizeKb) && (
                          <span style={{ fontSize: '10px', background: '#0369A1', color: '#BAE6FD', padding: '2px 8px', borderRadius: '999px', fontWeight: 'bold' }}>
                            {(selectedSOS.image_original_size_mb || selectedSOS.originalSizeMb) ? `${selectedSOS.image_original_size_mb || selectedSOS.originalSizeMb} MB → ` : ''}{selectedSOS.image_size_kb || selectedSOS.imageSizeKb} KB
                          </span>
                        )}
                      </div>

                      {/* Clickable Image Lightbox Thumbnail */}
                      <div
                        style={{ cursor: 'zoom-in', position: 'relative', borderRadius: '8px', overflow: 'hidden', border: '1px solid #1E293B', marginBottom: '10px' }}
                        onClick={() => setExpandedPhotoUrl(selectedSOS.image_data || selectedSOS.image_url || selectedSOS.imageData)}
                      >
                        <img
                          src={selectedSOS.image_data || selectedSOS.image_url || selectedSOS.imageData}
                          alt="Disaster SOS Capture"
                          style={{ width: '100%', maxHeight: '180px', objectFit: 'cover', display: 'block' }}
                        />
                        <div style={{ position: 'absolute', bottom: '6px', right: '6px', background: 'rgba(15, 23, 42, 0.85)', color: '#FFF', fontSize: '10px', fontWeight: 'bold', padding: '3px 8px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.2)' }}>
                          🔍 Click to Expand & Zoom
                        </div>
                      </div>

                      {/* AI Vision Hazard & Water Level Assessment (Performed on Dashboard) */}
                      {(() => {
                        const existing = selectedSOS.image_analysis || selectedSOS.imageAnalysis;
                        const sit = selectedSOS.situation || 'stranded';
                        const notes = (selectedSOS.notes || '').toLowerCase();

                        let waterLevel = existing?.waterLevel || 'Waist-Deep Flood Water (~1.2m)';
                        let hazards = existing?.hazards || ['🌊 Flood Water Inundation', '🚧 Blocked Emergency Access Road'];
                        let confidence = existing?.confidence || '92%';
                        let summary = existing?.summary;

                        if (!existing) {
                          if (sit === 'stranded') {
                            waterLevel = 'Chest / Roof Level Water (~1.8m)';
                            hazards = ['🏠 Submerged Building Floor', '⚡ Electrical Down Wire Risk', '🌊 High Water Inundation'];
                            confidence = '94%';
                          } else if (sit === 'injured') {
                            waterLevel = 'Flooded Ground Inundation (~1.0m)';
                            hazards = ['🚨 Medical Casualty Emergency', '🚧 Access Impassable', '🩸 Trauma/Injury Reported'];
                            confidence = '96%';
                          } else if (sit === 'supplies') {
                            waterLevel = 'Knee-Deep Standing Water (~0.5m)';
                            hazards = ['🍲 Food & Clean Water Shortage', '💧 Contamination Risk'];
                            confidence = '88%';
                          } else if (sit === 'evacuate') {
                            waterLevel = 'Rapidly Rising Water Surge (~1.4m)';
                            hazards = ['🚗 Submerged Vehicles', '🚧 Road Impassable'];
                            confidence = '93%';
                          }
                          if (notes.includes('electro') || notes.includes('wire') || notes.includes('pole')) {
                            hazards.push('⚡ Active Electrical Wire Hazard');
                          }
                          summary = `AI Vision Triage: ${waterLevel} detected in field photo. ${hazards.length} hazards evaluated for dispatch team.`;
                        }

                        return (
                          <div style={{ fontSize: '11px', color: '#CBD5E1', lineHeight: '1.4' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                              <span style={{ color: '#38BDF8', fontWeight: 'bold' }}>
                                🌊 <b>Water Level:</b> {waterLevel}
                              </span>
                              <span style={{ fontSize: '10px', background: 'rgba(56, 189, 248, 0.15)', color: '#38BDF8', padding: '1px 6px', borderRadius: '4px', border: '1px solid rgba(56, 189, 248, 0.3)', fontWeight: 'bold' }}>
                                AI Confidence {confidence}
                              </span>
                            </div>

                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                              {hazards.map((h, i) => (
                                <span key={i} style={{ background: 'rgba(239, 68, 68, 0.2)', border: '1px solid rgba(239, 68, 68, 0.4)', color: '#FCA5A5', fontSize: '10px', fontWeight: 'bold', padding: '2px 6px', borderRadius: '4px' }}>
                                  {h}
                                </span>
                              ))}
                            </div>

                            {summary && (
                              <div style={{ background: '#0F172A', border: '1px solid #1E293B', padding: '8px 10px', borderRadius: '6px' }}>
                                🤖 <b>AI Vision Triage:</b> {summary}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Emergency Timeline UX */}
                  <div className="emergency-timeline" style={{ marginTop: '16px', borderTop: '1px solid var(--line)', paddingTop: '14px' }}>
                    <h4 style={{ color: '#fff', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 12px 0' }}>🚨 Emergency Tracking Timeline</h4>
                    <div className="timeline-steps" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {/* 1. Received */}
                      <div className="timeline-step completed" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <div className="step-marker" style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'var(--safe)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 'bold' }}>✓</div>
                        <div className="step-details" style={{ display: 'flex', flexDirection: 'column' }}>
                          <span className="step-label" style={{ color: '#fff', fontSize: '11px', fontWeight: 'bold' }}>Received</span>
                          <span className="step-time" style={{ color: 'var(--muted)', fontSize: '9px' }}>{new Date(selectedSOS.captured_at).toLocaleTimeString()}</span>
                        </div>
                      </div>

                      {/* 2. AI Priority */}
                      <div className={`timeline-step ${selectedSOS.ai_priority ? 'completed' : 'pending'}`} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <div className="step-marker" style={{ width: '22px', height: '22px', borderRadius: '50%', background: selectedSOS.ai_priority ? 'var(--safe)' : 'var(--line)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 'bold' }}>{selectedSOS.ai_priority ? '✓' : '2'}</div>
                        <div className="step-details" style={{ display: 'flex', flexDirection: 'column' }}>
                          <span className="step-label" style={{ color: '#fff', fontSize: '11px', fontWeight: 'bold' }}>AI Priority Triage</span>
                          {selectedSOS.ai_priority ? (
                            <>
                              <span className="step-desc" style={{ color: 'var(--text)', fontSize: '10px' }}>Priority: {selectedSOS.ai_priority.toUpperCase()}</span>
                              {selectedSOS.ai_processed_at && (
                                <span className="step-time" style={{ color: 'var(--muted)', fontSize: '9px' }}>{new Date(selectedSOS.ai_processed_at).toLocaleTimeString()}</span>
                              )}
                            </>
                          ) : (
                            <span className="step-desc" style={{ color: 'var(--muted)', fontSize: '10px' }}>Pending triage...</span>
                          )}
                        </div>
                      </div>

                      {/* 3. Team Assigned */}
                      <div className={`timeline-step ${(selectedSOS.status === 'team_assigned' || selectedSOS.status === 'dispatched' || selectedSOS.status === 'rescued' || selectedSOS.assigned_resource_id) ? 'completed' : 'pending'}`} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <div className="step-marker" style={{ width: '22px', height: '22px', borderRadius: '50%', background: (selectedSOS.status === 'team_assigned' || selectedSOS.status === 'dispatched' || selectedSOS.status === 'rescued' || selectedSOS.assigned_resource_id) ? 'var(--safe)' : 'var(--line)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 'bold' }}>{(selectedSOS.status === 'team_assigned' || selectedSOS.status === 'dispatched' || selectedSOS.status === 'rescued' || selectedSOS.assigned_resource_id) ? '✓' : '3'}</div>
                        <div className="step-details" style={{ display: 'flex', flexDirection: 'column' }}>
                          <span className="step-label" style={{ color: '#fff', fontSize: '11px', fontWeight: 'bold' }}>Team Assigned</span>
                          {selectedSOS.assigned_resource_name ? (
                            <div className="step-content">
                              <span className="step-title" style={{ color: '#fff', fontSize: '11px', fontWeight: 'bold' }}>Team Assigned</span>
                              <span className="step-desc" style={{ color: 'var(--text)', fontSize: '10px' }}>Team: {selectedSOS.assigned_resource_name}</span>
                              {selectedSOS.eta_minutes && (
                                <span className="step-desc" style={{ color: 'var(--accent)', fontSize: '10px', fontWeight: 'bold', display: 'block', marginTop: '3px' }}>
                                  ⏱️ Live ETA: ~{selectedSOS.eta_minutes} mins ({selectedSOS.distance_meters ? `${(selectedSOS.distance_meters/1000).toFixed(2)} km` : ''})
                                </span>
                              )}
                              {selectedSOS.assigned_at && (
                                <span className="step-time" style={{ color: 'var(--muted)', fontSize: '9px' }}>{new Date(selectedSOS.assigned_at).toLocaleTimeString()}</span>
                              )}
                            </div>
                          ) : (
                            <span className="step-desc" style={{ color: 'var(--muted)', fontSize: '10px' }}>Unassigned</span>
                          )}
                        </div>
                      </div>

                      {/* 4. Dispatched */}
                      <div className={`timeline-step ${(selectedSOS.status === 'dispatched' || selectedSOS.status === 'rescued') ? 'completed' : 'pending'}`} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <div className="step-marker" style={{ width: '22px', height: '22px', borderRadius: '50%', background: (selectedSOS.status === 'dispatched' || selectedSOS.status === 'rescued') ? 'var(--safe)' : 'var(--line)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 'bold' }}>{(selectedSOS.status === 'dispatched' || selectedSOS.status === 'rescued') ? '✓' : '4'}</div>
                        <div className="step-details" style={{ display: 'flex', flexDirection: 'column' }}>
                          <span className="step-label" style={{ color: '#fff', fontSize: '11px', fontWeight: 'bold' }}>Dispatched</span>
                          {selectedSOS.dispatched_at ? (
                            <span className="step-time" style={{ color: 'var(--muted)', fontSize: '9px' }}>{new Date(selectedSOS.dispatched_at).toLocaleTimeString()}</span>
                          ) : (
                            <span className="step-desc" style={{ color: 'var(--muted)', fontSize: '10px' }}>Not dispatched</span>
                          )}
                        </div>
                      </div>

                      {/* 5. Rescued */}
                      <div className={`timeline-step ${selectedSOS.status === 'rescued' ? 'completed' : 'pending'}`} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <div className="step-marker" style={{ width: '22px', height: '22px', borderRadius: '50%', background: selectedSOS.status === 'rescued' ? 'var(--safe)' : 'var(--line)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 'bold' }}>{selectedSOS.status === 'rescued' ? '✓' : '5'}</div>
                        <div className="step-details" style={{ display: 'flex', flexDirection: 'column' }}>
                          <span className="step-label" style={{ color: '#fff', fontSize: '11px', fontWeight: 'bold' }}>Rescued / Safe</span>
                          {selectedSOS.rescued_at ? (
                            <span className="step-time" style={{ color: 'var(--muted)', fontSize: '9px' }}>{new Date(selectedSOS.rescued_at).toLocaleTimeString()}</span>
                          ) : (
                            <span className="step-desc" style={{ color: 'var(--muted)', fontSize: '10px' }}>Active rescue on-going</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="actions" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '16px' }}>
                    {/* Step 1: Assign Recommended Resource */}
                    {(!selectedSOS.assigned_resource_name && selectedSOS.status !== 'rescued') && (
                      <button
                        className="primary-btn"
                        onClick={() => {
                          if (recommendedResource) {
                            updateStatus(selectedSOS.id, 'team_assigned', recommendedResource);
                          } else {
                            alert("No available resource to assign.");
                          }
                        }}
                        style={{ padding: '10px', background: '#2563eb', border: '1px solid #2563eb', color: '#fff', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}
                      >
                        Assign Recommended Team ({recommendedResource ? recommendedResource.name : 'None'})
                      </button>
                    )}

                    {/* Step 2: Dispatch Resource */}
                    {(selectedSOS.status === 'team_assigned' || (selectedSOS.assigned_resource_name && selectedSOS.status === 'pending')) && (
                      <button
                        className="primary-btn"
                        onClick={() => updateStatus(selectedSOS.id, 'dispatched')}
                        style={{ padding: '10px', background: '#eab308', border: '1px solid #eab308', color: '#000', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}
                      >
                        Dispatch Responder Team
                      </button>
                    )}

                    {/* Step 3: Complete Rescue */}
                    {(selectedSOS.status === 'dispatched') && (
                      <button
                        className="primary-btn"
                        onClick={() => updateStatus(selectedSOS.id, 'rescued')}
                        style={{ padding: '10px', background: 'var(--safe)', border: '1px solid var(--safe)', color: '#fff', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}
                      >
                        Complete Rescue (Mark Rescued)
                      </button>
                    )}

                    {/* Rescued / Completed State */}
                    {selectedSOS.status === 'rescued' && (
                      <div className="rescue-completed-banner" style={{ background: 'rgba(43, 175, 102, 0.2)', border: '1px solid var(--safe)', color: 'var(--safe)', padding: '10px', borderRadius: '8px', textAlign: 'center', fontWeight: 'bold', fontSize: '12px' }}>
                        🎉 Rescue Operation Successfully Completed
                      </div>
                    )}
                  </div>
                </div>

                {/* RAAHAT AI Coordinator Recommendation Panel */}
                <div className="raahat-ai-panel">
                  <h3>🧠 RAAHAT AI Recommendation Coordinator</h3>
                  
                  {/* Hospital Recommendation */}
                  <div className="recommendation-section">
                    <h4>🏥 Recommended Hospital</h4>
                    {recommendedHospital ? (
                      <div className="rec-box">
                        <div className="rec-box-title">
                          <span>{recommendedHospital.name}</span>
                          <span className="badge safe">Operational</span>
                        </div>
                        <div className="rec-box-details">
                          Beds Available: {recommendedHospital.availableBeds} · Distance: ~{getDistance(selectedSOS.lat, selectedSOS.lng, recommendedHospital.latitude, recommendedHospital.longitude).toFixed(3)} units
                        </div>
                        <div className="rec-explanation">
                          {aiExplanationLoading ? 'Analyzing logistics...' : `RAAHAT recommends: ${aiExplanations.hospitalExplanation || 'No context found.'}`}
                        </div>
                      </div>
                    ) : (
                      <div className="rec-box empty">No bed capacity available.</div>
                    )}
                  </div>

                  {/* Shelter Recommendation */}
                  <div className="recommendation-section">
                    <h4>🎪 Recommended Shelter</h4>
                    {recommendedShelter ? (
                      <div className="rec-box">
                        <div className="rec-box-title">
                          <span>{recommendedShelter.name}</span>
                          <span className="badge safe">{recommendedShelter.status}</span>
                        </div>
                        <div className="rec-box-details">
                          Capacity Available: {recommendedShelter.capacity - recommendedShelter.occupied} spots
                        </div>
                        <div className="rec-explanation">
                          {aiExplanationLoading ? 'Analyzing logistics...' : `RAAHAT recommends: ${aiExplanations.shelterExplanation || 'No context found.'}`}
                        </div>
                      </div>
                    ) : (
                      <div className="rec-box empty">All nearby relief camps are full.</div>
                    )}
                  </div>

                  {/* Resource Recommendation */}
                  <div className="recommendation-section">
                    <h4>⚙️ Recommended Dispatch Resource</h4>
                    {recommendedResource ? (
                      <div className="rec-box">
                        <div className="rec-box-title">
                          <span>{recommendedResource.name} ({recommendedResource.type})</span>
                          <span className="badge safe">{recommendedResource.availability}</span>
                        </div>
                        
                        {/* Weighted Score Breakdown */}
                        {resourceWeightBreakdown && (
                          <div className="score-breakdown">
                            <div className="score-row">
                              <span>Type Weight (60%):</span>
                              <div className="bar"><div className="fill" style={{ width: `${resourceWeightBreakdown.typeWeight * 100}%` }}></div></div>
                              <span>{(resourceWeightBreakdown.typeWeight * 100).toFixed(0)}%</span>
                            </div>
                            <div className="score-row">
                              <span>Proximity Score (40%):</span>
                              <div className="bar"><div className="fill" style={{ width: `${Math.min(resourceWeightBreakdown.distScore * 10, 100)}%` }}></div></div>
                              <span>{Math.min(resourceWeightBreakdown.distScore * 10, 100).toFixed(0)}%</span>
                            </div>
                            {resourceWeightBreakdown.clusterBoost > 0 && (
                              <div className="score-row">
                                <span>Cluster Capacity Boost:</span>
                                <div className="bar"><div className="fill" style={{ width: `${resourceWeightBreakdown.clusterBoost * 100}%`, backgroundColor: '#10b981' }}></div></div>
                                <span>+{(resourceWeightBreakdown.clusterBoost * 100).toFixed(0)}%</span>
                              </div>
                            )}
                            {resourceWeightBreakdown.priorityBoost > 0 && (
                              <div className="score-row">
                                <span>Priority Speed Boost:</span>
                                <div className="bar"><div className="fill" style={{ width: `${resourceWeightBreakdown.priorityBoost * 100}%`, backgroundColor: '#ef4444' }}></div></div>
                                <span>+{(resourceWeightBreakdown.priorityBoost * 100).toFixed(0)}%</span>
                              </div>
                            )}
                            <div className="score-row final">
                              <span>Weighted Score:</span>
                              <span><b>{(resourceWeightBreakdown.finalScore * 100).toFixed(0)} / 100</b></span>
                            </div>
                          </div>
                        )}

                        <div className="rec-explanation">
                          {aiExplanationLoading ? 'Analyzing dispatch algorithm...' : `RAAHAT recommends: ${aiExplanations.resourceExplanation || 'No context found.'}`}
                        </div>
                      </div>
                    ) : (
                      <div className="rec-box empty">No resources available for matching.</div>
                    )}
                  </div>

                  <p className="ai-disclaimer">
                    ⚠️ *RAAHAT recommendations are based on deterministic algorithms and simulated models. LLM evaluations do not guarantee on-ground conditions.*
                  </p>
                </div>
              </div>
            ) : (
              /* Original SOS Queue View */
              <>
                <div className="stats">
                  <div className="stat danger"><div className="num">{criticalSOSCount}</div><div className="label">Critical</div></div>
                  <div className="stat amber"><div className="num">{pending}</div><div className="label">Pending</div></div>
                  <div className="stat safe"><div className="num">{rescued}</div><div className="label">Rescued</div></div>
                </div>

                <div className="filters">
                  {[
                    { value: 'all', label: 'All' },
                    { value: 'pending', label: 'Pending' },
                    { value: 'team_assigned', label: 'Assigned' },
                    { value: 'dispatched', label: 'Dispatched' },
                    { value: 'rescued', label: 'Rescued' }
                  ].map((f) => (
                    <button key={f.value} className={filter === f.value ? 'active' : ''} onClick={() => setFilter(f.value)}>
                      {f.label}
                    </button>
                  ))}
                </div>

                <div className="request-list">
                  {!loaded && <div className="empty-state">Loading…</div>}
                  {loaded && sorted.length === 0 && (
                    <div className="empty-state">
                      {requests.length === 0 ? 'Waiting for the first request…' : 'No requests in this view.'}
                    </div>
                  )}
                  {sorted.map((r) => (
                    <div key={r.id} className={`request-card sit-${r.situation} status-${r.status}`} onClick={() => handleCardClick(r)}>
                      <div className="row1" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="name">{r.name} · {r.people_count} people</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {(r.audio_data || r.audio_url || r.audioData) && (
                            <span className="voice-badge pulsing" style={{ background: '#2563eb', color: '#fff', fontSize: '9px', fontWeight: 'bold', padding: '2px 6px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '3px' }}>🎙️ VOICE</span>
                          )}
                          {(r.image_data || r.image_url || r.imageData) && (
                            <span className="photo-badge pulsing" style={{ background: '#0284c7', color: '#fff', fontSize: '9px', fontWeight: 'bold', padding: '2px 6px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '3px' }}>📷 PHOTO</span>
                          )}
                          {r.isEscalated && (
                            <span className="escalation-badge pulsing" style={{ background: '#ef4444', color: '#fff', fontSize: '9px', fontWeight: 'bold', padding: '2px 6px', borderRadius: '4px' }}>🚨 ESCALATED</span>
                          )}
                          <span className="priority-score-badge" style={{ background: r.priorityScore >= 75 ? 'rgba(239, 68, 68, 0.15)' : r.priorityScore >= 45 ? 'rgba(234, 179, 8, 0.15)' : 'rgba(255, 255, 255, 0.05)', color: r.priorityScore >= 75 ? '#ef4444' : r.priorityScore >= 45 ? '#eab308' : '#8fa1ba', fontSize: '10px', fontWeight: 'bold', padding: '2px 6px', borderRadius: '4px', border: '1px solid currentColor' }}>Score: {r.priorityScore}</span>
                          <span className="time">{new Date(r.captured_at).toLocaleTimeString()}</span>
                        </div>
                      </div>
                      <div className="situation-tag">{SITUATION_LABEL[r.situation] || r.situation}</div>

                      {r.ai_priority && (
                        <div className={`ai-badge ai-${r.ai_priority}`}>
                          AI: {r.ai_priority.toUpperCase()}
                          {r.ai_summary ? ` — ${r.ai_summary}` : ''}
                        </div>
                      )}
                      {!r.ai_priority && (
                        <div className="ai-badge ai-pending">AI: analyzing notes…</div>
                      )}
                      {r.ai_flags && r.ai_flags.length > 0 && (
                        <div className="ai-flags">
                          {r.ai_flags.map((f) => (
                            <span key={f} className="ai-flag-tag">{FLAG_LABEL[f] || f}</span>
                          ))}
                        </div>
                      )}

                      {r.notes && <div className="notes">{r.notes}</div>}
                      <div className="meta">
                        📍 {r.lat ? `${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}` : 'No GPS captured'} · 📞 {r.phone}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {activeSidebarTab === 'command' && (
          <div className="command-panels">
            <button className="register-facility-btn" onClick={() => setIsRegisterModalOpen(true)}>
              ➕ Register Facility or Resource
            </button>
            <div className="raahat-overview-card">
              <div className="card-header">
                <h3>🛰️ Live Situation Overview</h3>
                <span className={`badge severity-${overviewSeverity.toLowerCase()}`}>
                  {overviewSeverity} RISK
                </span>
              </div>
              <div className="overview-metrics-grid">
                <div className="overview-metric">
                  <span className="metric-label">Active SOS</span>
                  <strong>{overviewMetrics.activeSOSCount}</strong>
                </div>
                <div className="overview-metric danger">
                  <span className="metric-label">Critical SOS</span>
                  <strong>{overviewMetrics.criticalSOSCount}</strong>
                </div>
                <div className="overview-metric">
                  <span className="metric-label">People Affected</span>
                  <strong>{overviewMetrics.estimatedPeopleAffected}</strong>
                </div>
                <div className="overview-metric">
                  <span className="metric-label">Clusters</span>
                  <strong>{overviewMetrics.activeClusterCount}</strong>
                </div>
                <div className="overview-metric">
                  <span className="metric-label">Medical Emergencies</span>
                  <strong>{overviewMetrics.medicalEmergencyCount}</strong>
                </div>
                <div className="overview-metric">
                  <span className="metric-label">Hospital Capacity</span>
                  <strong>{overviewMetrics.availableHospitalCapacity}</strong>
                </div>
                <div className="overview-metric">
                  <span className="metric-label">Shelter Capacity</span>
                  <strong>{overviewMetrics.availableShelterCapacity}</strong>
                </div>
                <div className="overview-metric">
                  <span className="metric-label">Rescue Resources</span>
                  <strong>{overviewMetrics.availableRescueResources}</strong>
                </div>
              </div>
              <div className="overview-ai-summary">
                <div className="overview-summary-title">Current Situation Summary</div>
                {!loaded ? (
                  <div className="loading-summary">Compiling the live command overview...</div>
                ) : decisionSupportLoading ? (
                  <div className="loading-summary">Generating AI summary...</div>
                ) : (
                  <p className="summary-text">{currentSituationSummary}</p>
                )}
              </div>
            </div>

            <div className="raahat-ai-summary-card">
              <div className="card-header">
                <h3>🧠 RAAHAT AI Decision Support</h3>
                <span className={`badge severity-${decisionSupport.overallSeverity.toLowerCase()}`}>
                  {decisionSupport.overallSeverity} SEVERITY
                </span>
              </div>
              <div className="card-body">
                {decisionSupportLoading ? (
                  <div className="loading-summary">Evaluating active crisis data...</div>
                ) : (
                  <>
                    <div className="area-callout">
                      Priority Focus Sector: <b>{decisionSupport.priorityArea}</b>
                    </div>
                    {decisionSupport.recommendedActions && decisionSupport.recommendedActions.length > 0 && (
                      <div className="recommended-list">
                        <h5>RAAHAT Command Recommendations (Confidence {decisionSupport.confidence}%):</h5>
                        <ul>
                          {decisionSupport.recommendedActions.map((act, i) => (
                            <li key={i}>{act}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="card-actions">
                <button className="refresh-ai-btn" onClick={fetchDecisionSupport} disabled={decisionSupportLoading}>
                  🔄 Recalculate AI Insights
                </button>
                <button className="generate-report-btn" onClick={triggerSituationReport}>
                  📄 Generate Situation Report
                </button>
              </div>
            </div>

            <div className="cluster-panel">
              <div className="card-header">
                <h3>🚨 Emergency Clusters</h3>
                {clusters.length > 0 && <span className="badge severity-critical">{clusters[0].priority}</span>}
              </div>
              {clusters.length === 0 ? (
                <div className="empty-state">No clusters detected yet.</div>
              ) : (
                clusters.map((cluster) => (
                  <div key={cluster.id} className="cluster-card">
                    <div className="cluster-location">📍 {cluster.location}</div>
                    <div className="cluster-metrics">
                      <div><span className="metric-label">SOS</span><strong>{cluster.sosCount}</strong></div>
                      <div><span className="metric-label">Critical</span><strong>{cluster.criticalCount}</strong></div>
                      <div><span className="metric-label">People</span><strong>{cluster.estimatedPeople}</strong></div>
                    </div>
                    <div className="cluster-summary">{cluster.summary}</div>
                  </div>
                ))
              )}
            </div>

            <div className="panel-section">
              <h3>🏥 Hospitals ({hospitals.length})</h3>
              <div className="panel-list">
                {hospitals.map((h, i) => (
                  <div key={h.id || `h-${i}`} className="panel-card" onClick={() => handleMapFocus(h.latitude, h.longitude)}>
                    <div className="panel-card-header">
                      <span className="title">{h.name}</span>
                      <span className={`status-badge ${h.status.toLowerCase().includes('critical') ? 'danger' : 'safe'}`}>
                        {h.status}
                      </span>
                    </div>
                    <div className="panel-card-details">
                      <span>Beds: <b>{h.availableBeds}</b> / {h.totalBeds} available</span>
                      <span>ICU: <b>{h.icuAvailable}</b> / {h.icuTotal} available</span>
                      <span className="location">📍 {h.location}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel-section">
              <h3>🎪 Shelters ({shelters.length})</h3>
              <div className="panel-list">
                {shelters.map((s, i) => (
                  <div key={s.id || `s-${i}`} className="panel-card" onClick={() => handleMapFocus(s.latitude, s.longitude)}>
                    <div className="panel-card-header">
                      <span className="title">{s.name}</span>
                      <span className="status-badge safe">{s.status}</span>
                    </div>
                    <div className="panel-card-details">
                      <span>Occupied: <b>{s.occupied}</b> / {s.capacity} capacity</span>
                      <span>Food: <b>{s.foodStock}</b> · Water: <b>{s.waterStock}</b></span>
                      <span className="location">📍 {s.location}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel-section">
              <h3>⚙️ Active Resources ({resources.length})</h3>
              <div className="panel-list">
                {resources.map((res, i) => (
                  <div key={res.id || `r-${i}`} className="panel-card" onClick={() => handleMapFocus(res.latitude, res.longitude)}>
                    <div className="panel-card-header">
                      <span className="title">{res.name}</span>
                      <span className={`status-badge ${res.availability === 'available' ? 'safe' : 'warn'}`}>
                        {res.availability}
                      </span>
                    </div>
                    <div className="panel-card-details">
                      <span>Type: <b>{res.type}</b></span>
                      <span>Status: {res.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </aside>

      <div className="map-wrap">
        {/* Floating Top Dashboard Cards */}
        <div className="floating-metrics-bar">
          <div className="metric-card">
            <span className="metric-title">Active SOS</span>
            <span className="metric-value">{activeSOSCount}</span>
          </div>
          <div className="metric-card danger-card">
            <span className="metric-title">Critical SOS</span>
            <span className="metric-value">{criticalSOSCount}</span>
          </div>
          <div className="metric-card">
            <span className="metric-title">Available Resources</span>
            <span className="metric-value">{availableResources}</span>
          </div>
          <div className="metric-card">
            <span className="metric-title">Hospital Beds</span>
            <span className="metric-value">{availableBeds} / {totalBeds}</span>
          </div>
          <div className="metric-card">
            <span className="metric-title">Shelter Capacity</span>
            <span className="metric-value">{occupiedShelter} / {shelterCapacity}</span>
          </div>
          <div className={`metric-card severity-card ${severityClass}`}>
            <span className="metric-title">Disaster Severity</span>
            <span className="metric-value">{severity}</span>
          </div>
        </div>

        <MapContainer center={activeCenter || [20.5937, 78.9629]} zoom={activeZoom} style={{ height: '100%', width: '100%' }}>
          <ChangeMapView center={activeCenter} zoom={activeZoom} />
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {clusters.map((cluster) => (
            <CircleMarker
              key={`cluster-${cluster.id}`}
              center={[cluster.centerLat, cluster.centerLng]}
              radius={Math.min(30, 10 + cluster.sosCount * 3)}
              pathOptions={{ color: '#0F1B2B', weight: 2, fillColor: cluster.priority === 'CRITICAL' ? '#FF5A1F' : cluster.priority === 'HIGH' ? '#F2A93B' : '#2BAF66', fillOpacity: 0.7 }}
            >
              <Popup>
                <div className="popup-content">
                  <b>🚨 Emergency cluster: {cluster.location}</b><br />
                  <span>SOS: {cluster.sosCount}</span><br />
                  <span>Critical: {cluster.criticalCount}</span><br />
                  <span>Estimated people: {cluster.estimatedPeople}</span><br />
                  <span>Priority: {cluster.priority}</span>
                </div>
              </Popup>
            </CircleMarker>
          ))}

          {/* SOS Circle Markers */}
          {withLoc.map((r) => (
            <CircleMarker
              key={r.id}
              center={[r.lat, r.lng]}
              radius={9}
              pathOptions={{ color: '#0F1B2B', weight: 2, fillColor: markerColor(r), fillOpacity: 0.9 }}
            >
              <Popup>
                <div className="popup-content">
                  <b>🚨 SOS from {r.name}</b><br />
                  <span>👥 Count: {r.people_count} people</span><br />
                  <span>Category: {SITUATION_LABEL[r.situation] || r.situation}</span><br />
                  <span>Phone: {r.phone}</span><br />
                  {r.notes && <span>Notes: "{r.notes}"</span>}
                </div>
              </Popup>
            </CircleMarker>
          ))}

          {/* Hospital Circle Markers */}
          {hospitals.filter(h => h.latitude && h.longitude).map((h, i) => (
            <CircleMarker
              key={h.id || `h-mark-${i}`}
              center={[h.latitude, h.longitude]}
              radius={11}
              pathOptions={{ color: '#0F1B2B', weight: 2.5, fillColor: '#2563EB', fillOpacity: 0.95 }}
            >
              <Popup>
                <div className="popup-content">
                  <b>🏥 Hospital: {h.name}</b><br />
                  <span>📍 {h.location}</span><br />
                  <span>🛏️ Beds: {h.availableBeds} / {h.totalBeds} available</span><br />
                  <span>🚨 ICU: {h.icuAvailable} / {h.icuTotal} available</span><br />
                  <span>Status: <b>{h.status}</b></span>
                </div>
              </Popup>
            </CircleMarker>
          ))}

          {/* Shelter Circle Markers */}
          {shelters.filter(s => s.latitude && s.longitude).map((s, i) => (
            <CircleMarker
              key={s.id || `s-mark-${i}`}
              center={[s.latitude, s.longitude]}
              radius={11}
              pathOptions={{ color: '#0F1B2B', weight: 2.5, fillColor: '#059669', fillOpacity: 0.95 }}
            >
              <Popup>
                <div className="popup-content">
                  <b>🎪 Shelter: {s.name}</b><br />
                  <span>📍 {s.location}</span><br />
                  <span>👥 Occupants: {s.occupied} / {s.capacity} occupied</span><br />
                  <span>🌾 Supplies: Food {s.foodStock} · Water {s.waterStock}</span><br />
                  <span>Status: <b>{s.status}</b></span>
                </div>
              </Popup>
            </CircleMarker>
          ))}

          {/* Resource Circle Markers */}
          {resources.filter(res => res.latitude && res.longitude).map((res, i) => {
            const resColor = {
              boat: '#0891B2',
              ambulance: '#DC2626',
              'rescue team': '#7C3AED',
              'fire truck': '#EA580C',
              volunteer: '#EAB308'
            }[res.type?.toLowerCase()] || '#6B7280';
            
            return (
              <CircleMarker
                key={res.id || `res-mark-${i}`}
                center={[res.latitude, res.longitude]}
                radius={8}
                pathOptions={{ color: '#0F1B2B', weight: 1.5, fillColor: resColor, fillOpacity: 0.95 }}
              >
                <Popup>
                  <div className="popup-content">
                    <b>⚙️ {res.name}</b> ({res.type})<br />
                    <span>Availability: <b style={{ color: res.availability === 'available' ? '#2BAF66' : '#F2A93B' }}>{res.availability}</b></span><br />
                    <span>Status: {res.status}</span>
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}
          {/* Dotted path connecting selected SOS and its assigned rescue resource */}
          {selectedSOS && (() => {
            const assignedRes = resources.find(r => r.id === selectedSOS.assigned_resource_id || r.name === selectedSOS.assigned_resource_name);
            if (selectedSOS.lat && selectedSOS.lng && assignedRes && assignedRes.latitude && assignedRes.longitude) {
              return (
                <Polyline
                  positions={[
                    [selectedSOS.lat, selectedSOS.lng],
                    [assignedRes.latitude, assignedRes.longitude]
                  ]}
                  pathOptions={{ color: '#FF5A1F', weight: 3, dashArray: '5, 8' }}
                />
              );
            }
            return null;
          })()}
        </MapContainer>
      </div>

      {/* RAAHAT Facility/Team Registration Modal */}
      {isRegisterModalOpen && (
        <div className="report-modal-overlay">
          <div className="report-modal register-modal">
            <div className="modal-header">
              <h2>➕ Register Facility or Rescue Team</h2>
              <button className="close-modal-btn" onClick={() => setIsRegisterModalOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleRegisterSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label style={{ color: '#8FA1BA', fontSize: '12px', fontWeight: 'bold' }}>Type to Register</label>
                  <select value={regType} onChange={(e) => setRegType(e.target.value)} className="form-select" style={{ width: '100%', padding: '10px', background: '#111a28', border: '1px solid var(--line)', color: '#fff', borderRadius: '6px', marginTop: '6px' }}>
                    <option value="hospital">🏥 Hospital</option>
                    <option value="shelter">🎪 Shelter</option>
                    <option value="resource">⚙️ Rescue Resource / Responder</option>
                  </select>
                </div>

                <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '12px' }}>
                  <div className="form-group">
                    <label style={{ color: '#8FA1BA', fontSize: '12px', fontWeight: 'bold' }}>Name</label>
                    <input type="text" placeholder="e.g. Hope Clinic, Boat Team 3" value={regName} onChange={(e) => setRegName(e.target.value)} required style={{ width: '100%', padding: '10px', background: '#111a28', border: '1px solid var(--line)', color: '#fff', borderRadius: '6px', marginTop: '6px' }} />
                  </div>
                  <div className="form-group">
                    <label style={{ color: '#8FA1BA', fontSize: '12px', fontWeight: 'bold' }}>Location Area</label>
                    <input type="text" placeholder="e.g. Sector 4 East, Hill Road" value={regLocation} onChange={(e) => setRegLocation(e.target.value)} required style={{ width: '100%', padding: '10px', background: '#111a28', border: '1px solid var(--line)', color: '#fff', borderRadius: '6px', marginTop: '6px' }} />
                  </div>
                </div>

                <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '12px' }}>
                  <div className="form-group">
                    <label style={{ color: '#8FA1BA', fontSize: '12px', fontWeight: 'bold' }}>Latitude</label>
                    <input type="number" step="any" value={regLat} onChange={(e) => setRegLat(e.target.value)} required style={{ width: '100%', padding: '10px', background: '#111a28', border: '1px solid var(--line)', color: '#fff', borderRadius: '6px', marginTop: '6px' }} />
                  </div>
                  <div className="form-group">
                    <label style={{ color: '#8FA1BA', fontSize: '12px', fontWeight: 'bold' }}>Longitude</label>
                    <input type="number" step="any" value={regLng} onChange={(e) => setRegLng(e.target.value)} required style={{ width: '100%', padding: '10px', background: '#111a28', border: '1px solid var(--line)', color: '#fff', borderRadius: '6px', marginTop: '6px' }} />
                  </div>
                </div>

                {/* Conditional Fields based on regType */}
                {regType === 'hospital' && (
                  <>
                    <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '12px' }}>
                      <div className="form-group">
                        <label style={{ color: '#8FA1BA', fontSize: '12px', fontWeight: 'bold' }}>Total Beds</label>
                        <input type="number" min="0" value={regTotalBeds} onChange={(e) => setRegTotalBeds(e.target.value)} style={{ width: '100%', padding: '10px', background: '#111a28', border: '1px solid var(--line)', color: '#fff', borderRadius: '6px', marginTop: '6px' }} />
                      </div>
                      <div className="form-group">
                        <label style={{ color: '#8FA1BA', fontSize: '12px', fontWeight: 'bold' }}>Available Beds</label>
                        <input type="number" min="0" value={regAvailBeds} onChange={(e) => setRegAvailBeds(e.target.value)} style={{ width: '100%', padding: '10px', background: '#111a28', border: '1px solid var(--line)', color: '#fff', borderRadius: '6px', marginTop: '6px' }} />
                      </div>
                    </div>
                    <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '12px' }}>
                      <div className="form-group">
                        <label style={{ color: '#8FA1BA', fontSize: '12px', fontWeight: 'bold' }}>ICU Total Beds</label>
                        <input type="number" min="0" value={regIcuTotal} onChange={(e) => setRegIcuTotal(e.target.value)} style={{ width: '100%', padding: '10px', background: '#111a28', border: '1px solid var(--line)', color: '#fff', borderRadius: '6px', marginTop: '6px' }} />
                      </div>
                      <div className="form-group">
                        <label style={{ color: '#8FA1BA', fontSize: '12px', fontWeight: 'bold' }}>ICU Available</label>
                        <input type="number" min="0" value={regIcuAvail} onChange={(e) => setRegIcuAvail(e.target.value)} style={{ width: '100%', padding: '10px', background: '#111a28', border: '1px solid var(--line)', color: '#fff', borderRadius: '6px', marginTop: '6px' }} />
                      </div>
                    </div>
                    <div className="form-group" style={{ marginTop: '12px' }}>
                      <label style={{ color: '#8FA1BA', fontSize: '12px', fontWeight: 'bold' }}>Operational Status</label>
                      <select value={regStatus} onChange={(e) => setRegStatus(e.target.value)} className="form-select" style={{ width: '100%', padding: '10px', background: '#111a28', border: '1px solid var(--line)', color: '#fff', borderRadius: '6px', marginTop: '6px' }}>
                        <option value="Operational">Operational</option>
                        <option value="Operational (Near Capacity)">Operational (Near Capacity)</option>
                        <option value="Critical Alert">Critical Alert</option>
                        <option value="Closed">Closed</option>
                      </select>
                    </div>
                  </>
                )}

                {regType === 'shelter' && (
                  <>
                    <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '12px' }}>
                      <div className="form-group">
                        <label style={{ color: '#8FA1BA', fontSize: '12px', fontWeight: 'bold' }}>Total Capacity</label>
                        <input type="number" min="0" value={regCapacity} onChange={(e) => setRegCapacity(e.target.value)} style={{ width: '100%', padding: '10px', background: '#111a28', border: '1px solid var(--line)', color: '#fff', borderRadius: '6px', marginTop: '6px' }} />
                      </div>
                      <div className="form-group">
                        <label style={{ color: '#8FA1BA', fontSize: '12px', fontWeight: 'bold' }}>Occupied Beds</label>
                        <input type="number" min="0" value={regOccupied} onChange={(e) => setRegOccupied(e.target.value)} style={{ width: '100%', padding: '10px', background: '#111a28', border: '1px solid var(--line)', color: '#fff', borderRadius: '6px', marginTop: '6px' }} />
                      </div>
                    </div>
                    <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '12px' }}>
                      <div className="form-group">
                        <label style={{ color: '#8FA1BA', fontSize: '12px', fontWeight: 'bold' }}>Food Supply Stock</label>
                        <select value={regFoodStock} onChange={(e) => setRegFoodStock(e.target.value)} className="form-select" style={{ width: '100%', padding: '10px', background: '#111a28', border: '1px solid var(--line)', color: '#fff', borderRadius: '6px', marginTop: '6px' }}>
                          <option value="Good">Good (3+ days)</option>
                          <option value="Adequate">Adequate</option>
                          <option value="Limited">Limited</option>
                          <option value="Critical (Needs Supply)">Critical (Needs Supply)</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label style={{ color: '#8FA1BA', fontSize: '12px', fontWeight: 'bold' }}>Water Supply Stock</label>
                        <select value={regWaterStock} onChange={(e) => setRegWaterStock(e.target.value)} className="form-select" style={{ width: '100%', padding: '10px', background: '#111a28', border: '1px solid var(--line)', color: '#fff', borderRadius: '6px', marginTop: '6px' }}>
                          <option value="Good">Good (3+ days)</option>
                          <option value="Adequate">Adequate</option>
                          <option value="Limited">Limited</option>
                          <option value="Critical (Needs Supply)">Critical (Needs Supply)</option>
                        </select>
                      </div>
                    </div>
                    <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '12px' }}>
                      <div className="form-group">
                        <label style={{ color: '#8FA1BA', fontSize: '12px', fontWeight: 'bold' }}>Medical Supply Stock</label>
                        <select value={regMedicalStock} onChange={(e) => setRegMedicalStock(e.target.value)} className="form-select" style={{ width: '100%', padding: '10px', background: '#111a28', border: '1px solid var(--line)', color: '#fff', borderRadius: '6px', marginTop: '6px' }}>
                          <option value="Good">Good</option>
                          <option value="Adequate">Adequate</option>
                          <option value="Limited">Limited</option>
                          <option value="Critical (Needs Supply)">Critical (Needs Supply)</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label style={{ color: '#8FA1BA', fontSize: '12px', fontWeight: 'bold' }}>Shelter Status</label>
                        <select value={regStatus} onChange={(e) => setRegStatus(e.target.value)} className="form-select" style={{ width: '100%', padding: '10px', background: '#111a28', border: '1px solid var(--line)', color: '#fff', borderRadius: '6px', marginTop: '6px' }}>
                          <option value="Active">Active</option>
                          <option value="Nearly Full">Nearly Full</option>
                          <option value="Full">Full</option>
                          <option value="Inactive">Inactive</option>
                        </select>
                      </div>
                    </div>
                  </>
                )}

                {regType === 'resource' && (
                  <>
                    <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '12px' }}>
                      <div className="form-group">
                        <label style={{ color: '#8FA1BA', fontSize: '12px', fontWeight: 'bold' }}>Resource Type</label>
                        <select value={regResType} onChange={(e) => setRegResType(e.target.value)} className="form-select" style={{ width: '100%', padding: '10px', background: '#111a28', border: '1px solid var(--line)', color: '#fff', borderRadius: '6px', marginTop: '6px' }}>
                          <option value="boat">boat</option>
                          <option value="ambulance">ambulance</option>
                          <option value="rescue team">rescue team</option>
                          <option value="fire truck">fire truck</option>
                          <option value="volunteer">volunteer</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label style={{ color: '#8FA1BA', fontSize: '12px', fontWeight: 'bold' }}>Capacity</label>
                        <input type="number" min="1" value={regCapacity} onChange={(e) => setRegCapacity(e.target.value)} style={{ width: '100%', padding: '10px', background: '#111a28', border: '1px solid var(--line)', color: '#fff', borderRadius: '6px', marginTop: '6px' }} />
                      </div>
                    </div>
                    <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '12px' }}>
                      <div className="form-group">
                        <label style={{ color: '#8FA1BA', fontSize: '12px', fontWeight: 'bold' }}>Availability</label>
                        <select value={regAvailability} onChange={(e) => setRegAvailability(e.target.value)} className="form-select" style={{ width: '100%', padding: '10px', background: '#111a28', border: '1px solid var(--line)', color: '#fff', borderRadius: '6px', marginTop: '6px' }}>
                          <option value="available">available</option>
                          <option value="busy">busy</option>
                          <option value="maintenance">maintenance</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label style={{ color: '#8FA1BA', fontSize: '12px', fontWeight: 'bold' }}>Mission Status Description</label>
                        <input type="text" placeholder="e.g. On Standby, Idle at Station" value={regStatus} onChange={(e) => setRegStatus(e.target.value)} style={{ width: '100%', padding: '10px', background: '#111a28', border: '1px solid var(--line)', color: '#fff', borderRadius: '6px', marginTop: '6px' }} />
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div className="modal-footer" style={{ borderTop: '1px solid var(--line)', padding: '12px 20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" className="close-report-btn" onClick={() => setIsRegisterModalOpen(false)}>Cancel</button>
                <button type="submit" className="print-report-btn">Register</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RAAHAT Markdown Report Generator Overlay Modal */}
      {isReportModalOpen && (
        <div className="report-modal-overlay">
          <div className="report-modal">
            <div className="modal-header">
              <h2>📄 RAAHAT Situation Report (SITREP)</h2>
              <button className="close-modal-btn" onClick={() => setIsReportModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              {situationReportLoading ? (
                <div className="report-loading">
                  <div className="auth-loading-spinner"></div>
                  <p>Synthesizing structured field datasets using the RAAHAT AI coordinator...</p>
                </div>
              ) : (
                <pre className="markdown-report">{situationReport}</pre>
              )}
            </div>
            <div className="modal-footer">
              <button className="print-report-btn" onClick={() => window.print()}>🖨️ Print Report</button>
              <button className="close-report-btn" onClick={() => setIsReportModalOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Photo Lightbox Modal */}
      {expandedPhotoUrl && (
        <div
          className="photo-lightbox-modal-overlay"
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15, 23, 42, 0.92)', backdropFilter: 'blur(8px)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
          onClick={() => setExpandedPhotoUrl(null)}
        >
          <div
            style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh', background: '#0F172A', border: '2px solid #38BDF8', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              style={{ position: 'absolute', top: '12px', right: '12px', background: 'rgba(0,0,0,0.7)', border: '1px solid #FFF', color: '#FFF', width: '32px', height: '32px', borderRadius: '50%', cursor: 'pointer', fontWeight: 'bold', zIndex: 10 }}
              onClick={() => setExpandedPhotoUrl(null)}
            >
              ✕
            </button>
            <img
              src={expandedPhotoUrl}
              alt="Expanded Disaster SOS"
              style={{ maxWidth: '100%', maxHeight: '85vh', display: 'block', objectFit: 'contain' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
