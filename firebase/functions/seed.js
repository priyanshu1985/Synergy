const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Initialize admin SDK (uses default project settings)
initializeApp({
  projectId: 'synergy-9cd4a'
});

const db = getFirestore();

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

async function seed() {
  console.log('Seeding hospitals...');
  for (const h of MOCK_HOSPITALS) {
    await db.collection('hospitals').add(h);
  }
  console.log('Seeding shelters...');
  for (const s of MOCK_SHELTERS) {
    await db.collection('shelters').add(s);
  }
  console.log('Seeding resources...');
  for (const r of MOCK_RESOURCES) {
    await db.collection('resources').add(r);
  }
  console.log('Seeding completed successfully!');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
