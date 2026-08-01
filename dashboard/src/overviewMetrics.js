export function calculateSituationOverviewMetrics(requests = [], hospitals = [], shelters = [], resources = [], clusters = []) {
  const activeRequests = (requests || []).filter((request) => request.status === 'pending' || request.status === 'dispatched');
  const criticalRequests = activeRequests.filter((request) => request.ai_priority === 'critical' || request.ai_priority === 'high' || request.situation === 'injured' || request.situation === 'stranded');
  const medicalEmergencies = activeRequests.filter((request) => (request.ai_flags || []).includes('medical_emergency') || request.situation === 'injured');

  const estimatedPeopleAffected = activeRequests.reduce((total, request) => total + Number(request.people_count || 0), 0);
  const availableHospitalCapacity = (hospitals || []).reduce((total, hospital) => total + Number(hospital.availableBeds || 0), 0);
  const availableShelterCapacity = (shelters || []).reduce((total, shelter) => total + Math.max(0, Number(shelter.capacity || 0) - Number(shelter.occupied || 0)), 0);
  const availableRescueResources = (resources || []).filter((resource) => resource.availability?.toLowerCase() === 'available').length;

  return {
    activeSOSCount: activeRequests.length,
    criticalSOSCount: criticalRequests.length,
    estimatedPeopleAffected,
    activeClusterCount: (clusters || []).length,
    medicalEmergencyCount: medicalEmergencies.length,
    availableHospitalCapacity,
    availableShelterCapacity,
    availableRescueResources
  };
}

export function getOverallSeverity(criticalSOSCount, activeSOSCount) {
  if (criticalSOSCount > 0) return 'CRITICAL';
  if (activeSOSCount > 6) return 'HIGH';
  return 'STABLE';
}
