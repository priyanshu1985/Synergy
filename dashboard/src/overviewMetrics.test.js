import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSituationOverviewMetrics, getOverallSeverity } from './overviewMetrics.js';

test('calculates live overview metrics from request and infrastructure data', () => {
  const metrics = calculateSituationOverviewMetrics(
    [
      { status: 'pending', people_count: 4, situation: 'injured', ai_flags: ['medical_emergency'] },
      { status: 'dispatched', people_count: 2, situation: 'supplies' },
      { status: 'rescued', people_count: 1, situation: 'stranded' }
    ],
    [
      { availableBeds: 5, totalBeds: 10 },
      { availableBeds: 3, totalBeds: 8 }
    ],
    [
      { capacity: 100, occupied: 40 },
      { capacity: 80, occupied: 20 }
    ],
    [
      { availability: 'available' },
      { availability: 'busy' }
    ],
    [{ id: 'cluster-1' }, { id: 'cluster-2' }]
  );

  assert.equal(metrics.activeSOSCount, 2);
  assert.equal(metrics.criticalSOSCount, 1);
  assert.equal(metrics.estimatedPeopleAffected, 6);
  assert.equal(metrics.activeClusterCount, 2);
  assert.equal(metrics.medicalEmergencyCount, 1);
  assert.equal(metrics.availableHospitalCapacity, 8);
  assert.equal(metrics.availableShelterCapacity, 120);
  assert.equal(metrics.availableRescueResources, 1);
  assert.equal(getOverallSeverity(1, 2), 'CRITICAL');
});
