/**
 * Shared Resource Matching Engine for RAAHAT
 * Computes deterministic weighted matching scores between citizen SOS requests and rescue resource fleets.
 */

function getDistance(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return 9999;
  const dLat = Number(lat2) - Number(lat1);
  const dLon = Number(lon2) - Number(lon1);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

function findBestResourceMatch(req, resources = [], clusters = []) {
  if (!resources || resources.length === 0) return { resource: null, score: 0, weightBreakdown: null };

  const eligible = resources.filter((r) => {
    const avail = (r.availability || '').toLowerCase();
    const stat = (r.status || '').toLowerCase();
    // Allow resource if explicitly available, or status indicates idle/standby
    return (
      avail === 'available' ||
      avail === '' ||
      stat.includes('idle') ||
      stat.includes('standby') ||
      stat.includes('available')
    );
  });

  if (eligible.length === 0) return { resource: null, score: 0, weightBreakdown: null };

  let bestRes = null;
  let bestScore = -1;
  let bestBreakdown = null;

  const cluster = clusters.find((c) =>
    c.requests?.some((r) => r.id === req.id || r.localId === req.id || r.id === req.local_id)
  );
  const inCluster = !!cluster;

  eligible.forEach((r) => {
    let typeWeight = 0.3; // Default baseline type weight so available resources are not rejected
    const sit = req.situation;
    const rType = (r.type || '').toLowerCase();

    if (sit === 'stranded' || sit === 'evacuate') {
      if (rType === 'boat') typeWeight = 1.0;
      else if (rType === 'rescue team') typeWeight = 0.8;
      else if (rType === 'fire truck') typeWeight = 0.6;
    } else if (sit === 'injured') {
      if (rType === 'ambulance') typeWeight = 1.0;
      else if (rType === 'rescue team') typeWeight = 0.7;
      else if (rType === 'volunteer') typeWeight = 0.5;
    } else if (sit === 'supplies') {
      if (rType === 'volunteer') typeWeight = 1.0;
      else if (rType === 'fire truck') typeWeight = 0.6;
    }

    const reqLat = req.lat ?? req.latitude;
    const reqLng = req.lng ?? req.longitude;
    const rLat = r.latitude ?? r.lat;
    const rLng = r.longitude ?? r.lng;

    const dist = getDistance(reqLat, reqLng, rLat, rLng);
    const distScore = 1 / (dist + 0.01);
    let score = typeWeight * 0.6 + distScore * 0.4;

    let clusterBoost = 0;
    if (inCluster && Number(r.capacity || 0) >= 6) {
      clusterBoost = 0.2;
      score += clusterBoost;
    }

    let priorityBoost = 0;
    const isHighPri =
      req.ai_priority === 'critical' ||
      req.ai_priority === 'high' ||
      sit === 'injured' ||
      sit === 'stranded';

    if (isHighPri && (rType === 'boat' || rType === 'ambulance' || rType === 'rescue team')) {
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
}

module.exports = { getDistance, findBestResourceMatch };
