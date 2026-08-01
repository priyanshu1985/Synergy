import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { db, auth } from './firebaseClient';
import { collection, query, orderBy, onSnapshot, doc, updateDoc, limit, getDocs, addDoc } from 'firebase/firestore';
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
    notes: 'Kurla East, near Metro station',
    lat: 20.5933,
    lng: 78.9628,
    captured_at: Date.now() - 60000,
    status: 'pending'
  },
  {
    id: 'demo-cluster-2',
    name: 'Vikram Das',
    phone: '9876543211',
    people_count: 6,
    situation: 'injured',
    notes: 'Kurla East, lane 4',
    lat: 20.5940,
    lng: 78.9635,
    captured_at: Date.now() - 120000,
    status: 'pending'
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
        (snapshot) => {
          const list = snapshot.docs.map((d) => ({
            id: d.id,
            ...d.data()
          }));
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
      const score = (capacityRatio * 0.4) + ((1 / (dist + 0.01)) * 0.6);
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
      const score = (typeWeight * 0.6) + (distScore * 0.4);
      if (score > bestScore) {
        bestScore = score;
        bestRes = r;
        bestBreakdown = {
          typeWeight,
          distScore,
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

  const updateStatus = async (id, status) => {
    const timestampKey = status === 'dispatched' ? 'dispatched_at' : status === 'rescued' ? 'rescued_at' : null;
    const timestampVal = new Date().toISOString();

    setRequests((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
            ...r,
            status,
            ...(timestampKey ? { [timestampKey]: timestampVal } : {})
          }
          : r
      )
    );

    // Sync selectedSOS if it is the one being updated
    if (selectedSOS && selectedSOS.id === id) {
      setSelectedSOS(prev => ({
        ...prev,
        status,
        ...(timestampKey ? { [timestampKey]: timestampVal } : {})
      }));
    }

    if (!db) return;

    try {
      const updates = { status };
      if (timestampKey) {
        updates[timestampKey] = timestampVal;
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
  const sorted = [...filtered].sort((a, b) => {
    const aCrit = isCritical(a) ? 0 : 1;
    const bCrit = isCritical(b) ? 0 : 1;
    if (aCrit !== bCrit) return aCrit - bCrit;
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

                  <div className="actions">
                    <button
                      className="primary"
                      disabled={selectedSOS.status === 'dispatched' || selectedSOS.status === 'rescued'}
                      onClick={() => updateStatus(selectedSOS.id, 'dispatched')}
                    >
                      Mark Dispatched
                    </button>
                    <button
                      className="done"
                      disabled={selectedSOS.status === 'rescued'}
                      onClick={() => updateStatus(selectedSOS.id, 'rescued')}
                    >
                      Mark Rescued
                    </button>
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
                  {['all', 'pending', 'dispatched', 'rescued'].map((f) => (
                    <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
                      {f === 'all' ? 'All' : f[0].toUpperCase() + f.slice(1)}
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
                      <div className="row1">
                        <span className="name">{r.name} · {r.people_count} people</span>
                        <span className="time">{new Date(r.captured_at).toLocaleTimeString()}</span>
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
        </MapContainer>
      </div>

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
    </div>
  );
}
