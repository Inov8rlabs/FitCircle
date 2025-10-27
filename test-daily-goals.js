/**
 * Daily Progress Meter Testing Script
 *
 * Run this in your browser console at http://localhost:3002/dashboard
 * to quickly test the Daily Progress Meter feature
 */

console.log('🧪 Daily Progress Meter Testing Script Loaded');
console.log('================================================\n');

const API_BASE = 'http://localhost:3002';

// Helper function to make API calls
async function apiCall(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE}${endpoint}`, options);
  const data = await response.json();

  console.log(`${method} ${endpoint}:`, data);
  return data;
}

// Test 1: Check current goals
window.testGetGoals = async function() {
  console.log('\n📋 Test 1: Getting current daily goals...\n');
  const goals = await apiCall('/api/daily-goals');
  console.log(`Found ${goals.length} goals`);
  return goals;
};

// Test 2: Check today's progress
window.testGetProgress = async function() {
  console.log('\n📊 Test 2: Getting today\'s progress...\n');
  const progress = await apiCall('/api/daily-goals/progress');
  console.log(`Overall completion: ${progress.overall_completion}%`);
  console.log(`Completed goals: ${progress.goals.filter(g => g.is_completed).length}/${progress.goals.length}`);
  return progress;
};

// Test 3: Create sample goals
window.testCreateGoals = async function() {
  console.log('\n➕ Test 3: Creating sample daily goals...\n');

  const sampleGoals = [
    {
      goal_type: 'steps',
      target_value: 10000,
      unit: 'steps',
      frequency: 'daily'
    },
    {
      goal_type: 'weight_log',
      target_value: 1,
      unit: 'times',
      frequency: 'daily'
    },
    {
      goal_type: 'workout',
      target_value: 1,
      unit: 'sessions',
      frequency: 'daily'
    }
  ];

  const result = await apiCall('/api/daily-goals', 'POST', { goals: sampleGoals });
  console.log(`✓ Created ${result.length} goals`);
  console.log('Refresh the page to see them!');
  return result;
};

// Test 4: Get streak info
window.testGetStreak = async function() {
  console.log('\n🔥 Test 4: Getting streak information...\n');
  const progress = await apiCall('/api/daily-goals/progress');
  if (progress.streak) {
    console.log(`Current streak: ${progress.streak.current_streak} days`);
    console.log(`Longest streak: ${progress.streak.longest_streak} days`);
  } else {
    console.log('No streak data yet - complete all goals to start a streak!');
  }
  return progress.streak;
};

// Test 5: Get history
window.testGetHistory = async function(limit = 30) {
  console.log(`\n📅 Test 5: Getting ${limit} days of history...\n`);
  const history = await apiCall(`/api/daily-goals/history?limit=${limit}`);
  console.log(`Found ${history.length} completion records`);

  const completedDays = history.filter(h => h.all_goals_completed).length;
  console.log(`Days with all goals completed: ${completedDays}/${history.length}`);
  return history;
};

// Test 6: Update a goal
window.testUpdateGoal = async function(goalId, newTarget) {
  console.log(`\n✏️ Test 6: Updating goal ${goalId} to target ${newTarget}...\n`);
  const result = await apiCall(`/api/daily-goals/${goalId}`, 'PATCH', {
    target_value: newTarget
  });
  console.log('✓ Goal updated');
  return result;
};

// Test 7: Delete a goal
window.testDeleteGoal = async function(goalId) {
  console.log(`\n🗑️ Test 7: Deleting goal ${goalId}...\n`);
  const result = await apiCall(`/api/daily-goals/${goalId}`, 'DELETE');
  console.log('✓ Goal deleted');
  return result;
};

// Test 8: Simulate completing all goals (for testing celebration)
window.testCompleteAllGoals = async function() {
  console.log('\n🎉 Test 8: Simulating 100% goal completion...\n');
  console.log('This will update your tracking data to meet all goals.\n');

  // Get current goals
  const progress = await apiCall('/api/daily-goals/progress');
  const goals = progress.goals;

  console.log('Current goals:');
  goals.forEach(goal => {
    console.log(`- ${goal.goal_type}: ${goal.completion_percentage.toFixed(0)}%`);
  });

  // Get today's tracking entry
  const tracking = await apiCall('/api/mobile/tracking/daily');
  if (tracking && tracking.length > 0) {
    const todayEntry = tracking[0];

    // Update to meet all goals
    const updates = {
      steps: 10000,  // Assuming 10k step goal
      weight_kg: todayEntry.weight_kg || 70,  // Keep existing or default
    };

    console.log('\nUpdating tracking data...');
    const result = await apiCall(
      `/api/mobile/tracking/daily/${todayEntry.id}`,
      'PATCH',
      updates
    );

    console.log('✓ Tracking updated!');
    console.log('\n⏱️ Waiting 2 seconds for goal completion to process...');

    setTimeout(async () => {
      const newProgress = await apiCall('/api/daily-goals/progress');
      console.log('\n📊 New progress:');
      console.log(`Overall completion: ${newProgress.overall_completion}%`);

      if (newProgress.overall_completion === 100) {
        console.log('\n🎊 ALL GOALS COMPLETED! 🎊');
        console.log('🎉 The celebration animation should play now!');
        console.log('✨ Refresh the page if you don\'t see confetti');
      } else {
        console.log('\nNot all goals completed yet. Current status:');
        newProgress.goals.forEach(goal => {
          const status = goal.is_completed ? '✓' : '○';
          console.log(`${status} ${goal.goal_type}: ${goal.completion_percentage.toFixed(0)}%`);
        });
      }
    }, 2000);

  } else {
    console.log('❌ No tracking entry found for today.');
    console.log('Please log your weight and steps first using the Quick Entry cards.');
  }
};

// Run all tests
window.runAllTests = async function() {
  console.log('\n🚀 Running all Daily Progress Meter tests...\n');
  console.log('================================================\n');

  try {
    await testGetGoals();
    await testGetProgress();
    await testGetStreak();
    await testGetHistory(7);  // Last 7 days

    console.log('\n✅ All tests completed!');
    console.log('\n📝 Additional test functions available:');
    console.log('  - testCreateGoals() - Create sample goals');
    console.log('  - testCompleteAllGoals() - Trigger celebration 🎉');
    console.log('  - testUpdateGoal(goalId, newTarget)');
    console.log('  - testDeleteGoal(goalId)');
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
};

// Print instructions
console.log('Available test functions:');
console.log('========================\n');
console.log('Quick start:');
console.log('  runAllTests()           - Run all tests\n');
console.log('Individual tests:');
console.log('  testGetGoals()          - Get current goals');
console.log('  testGetProgress()       - Get today\'s progress');
console.log('  testCreateGoals()       - Create 3 sample goals');
console.log('  testGetStreak()         - Get streak info');
console.log('  testGetHistory(30)      - Get 30 days history');
console.log('  testCompleteAllGoals()  - Trigger celebration 🎉');
console.log('  testUpdateGoal(id, val) - Update a goal');
console.log('  testDeleteGoal(id)      - Delete a goal\n');
console.log('Try: runAllTests() to start testing!\n');
