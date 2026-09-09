/**
 * Sample data library for blog post visualizations
 * Contains realistic patterns for various health metrics
 */

// Heart Rate - Daily Pattern (24-hour cycle)
export const heartRateDailyPattern = [
  { time: "12 AM", bpm: 56 },
  { time: "1 AM", bpm: 54 },
  { time: "2 AM", bpm: 52 },
  { time: "3 AM", bpm: 51 },
  { time: "4 AM", bpm: 52 },
  { time: "5 AM", bpm: 55 },
  { time: "6 AM", bpm: 58 },
  { time: "7 AM", bpm: 68 },
  { time: "8 AM", bpm: 75 },
  { time: "9 AM", bpm: 82 },
  { time: "10 AM", bpm: 85 },
  { time: "11 AM", bpm: 88 },
  { time: "12 PM", bpm: 85 },
  { time: "1 PM", bpm: 78 },
  { time: "2 PM", bpm: 82 },
  { time: "3 PM", bpm: 85 },
  { time: "4 PM", bpm: 92 },
  { time: "5 PM", bpm: 105 },
  { time: "6 PM", bpm: 118 },
  { time: "7 PM", bpm: 95 },
  { time: "8 PM", bpm: 82 },
  { time: "9 PM", bpm: 72 },
  { time: "10 PM", bpm: 65 },
  { time: "11 PM", bpm: 60 },
];

// Heart Rate - Weekly Resting Pattern
export const restingHeartRateWeekly = [
  { day: "Mon", bpm: 62 },
  { day: "Tue", bpm: 60 },
  { day: "Wed", bpm: 58 },
  { day: "Thu", bpm: 61 },
  { day: "Fri", bpm: 63 },
  { day: "Sat", bpm: 65 },
  { day: "Sun", bpm: 64 },
];

// Heart Rate Variability (HRV) - Weekly Recovery Pattern
export const hrvWeeklyPattern = [
  { day: "Mon", hrv: 42, label: "Post-weekend" },
  { day: "Tue", hrv: 48, label: "Recovering" },
  { day: "Wed", hrv: 55, label: "Good recovery" },
  { day: "Thu", hrv: 52, label: "Mid-week" },
  { day: "Fri", hrv: 45, label: "Accumulated fatigue" },
  { day: "Sat", hrv: 58, label: "Rest day" },
  { day: "Sun", hrv: 62, label: "Well rested" },
];

// HRV - Monthly Trend (showing improvement)
export const hrvMonthlyTrend = [
  { week: "Week 1", hrv: 35 },
  { week: "Week 2", hrv: 38 },
  { week: "Week 3", hrv: 42 },
  { week: "Week 4", hrv: 45 },
  { week: "Week 5", hrv: 48 },
  { week: "Week 6", hrv: 52 },
  { week: "Week 7", hrv: 50 },
  { week: "Week 8", hrv: 55 },
];

// Sleep Stages - Single Night
export const sleepStagesNight = [
  { time: "10 PM", stage: "Awake", value: 4 },
  { time: "10:30 PM", stage: "Light", value: 2 },
  { time: "11 PM", stage: "Deep", value: 1 },
  { time: "11:30 PM", stage: "Deep", value: 1 },
  { time: "12 AM", stage: "REM", value: 3 },
  { time: "12:30 AM", stage: "Light", value: 2 },
  { time: "1 AM", stage: "Deep", value: 1 },
  { time: "1:30 AM", stage: "Deep", value: 1 },
  { time: "2 AM", stage: "Light", value: 2 },
  { time: "2:30 AM", stage: "REM", value: 3 },
  { time: "3 AM", stage: "REM", value: 3 },
  { time: "3:30 AM", stage: "Light", value: 2 },
  { time: "4 AM", stage: "Light", value: 2 },
  { time: "4:30 AM", stage: "REM", value: 3 },
  { time: "5 AM", stage: "REM", value: 3 },
  { time: "5:30 AM", stage: "Light", value: 2 },
  { time: "6 AM", stage: "Awake", value: 4 },
];

// Sleep Duration - Weekly
export const sleepDurationWeekly = [
  { day: "Mon", hours: 6.5, quality: 72 },
  { day: "Tue", hours: 7.2, quality: 78 },
  { day: "Wed", hours: 7.8, quality: 85 },
  { day: "Thu", hours: 6.8, quality: 75 },
  { day: "Fri", hours: 6.2, quality: 68 },
  { day: "Sat", hours: 8.5, quality: 88 },
  { day: "Sun", hours: 8.0, quality: 82 },
];

// VO2 Max - Age-Related Decline
export const vo2MaxByAge = [
  { age: "20-29", male: 44, female: 38 },
  { age: "30-39", male: 42, female: 36 },
  { age: "40-49", male: 40, female: 34 },
  { age: "50-59", male: 36, female: 31 },
  { age: "60-69", male: 32, female: 28 },
  { age: "70+", male: 28, female: 24 },
];

// VO2 Max - Training Improvement
export const vo2MaxTrainingProgress = [
  { month: "Jan", vo2max: 32 },
  { month: "Feb", vo2max: 33 },
  { month: "Mar", vo2max: 35 },
  { month: "Apr", vo2max: 37 },
  { month: "May", vo2max: 39 },
  { month: "Jun", vo2max: 41 },
  { month: "Jul", vo2max: 42 },
  { month: "Aug", vo2max: 43 },
];

// Walking Speed - By Age Group
export const walkingSpeedByAge = [
  { age: "20-29", speed: 1.36 },
  { age: "30-39", speed: 1.34 },
  { age: "40-49", speed: 1.32 },
  { age: "50-59", speed: 1.28 },
  { age: "60-69", speed: 1.20 },
  { age: "70-79", speed: 1.10 },
  { age: "80+", speed: 0.94 },
];

// Steps - Weekly Pattern
export const stepsWeeklyPattern = [
  { day: "Mon", steps: 8500 },
  { day: "Tue", steps: 10200 },
  { day: "Wed", steps: 7800 },
  { day: "Thu", steps: 9500 },
  { day: "Fri", steps: 6200 },
  { day: "Sat", steps: 12500 },
  { day: "Sun", steps: 11000 },
];

// Active Energy - Weekly Pattern
export const activeEnergyWeekly = [
  { day: "Mon", calories: 450 },
  { day: "Tue", calories: 520 },
  { day: "Wed", calories: 380 },
  { day: "Thu", calories: 490 },
  { day: "Fri", calories: 320 },
  { day: "Sat", calories: 680 },
  { day: "Sun", calories: 590 },
];

// Blood Oxygen (SpO2) - Night Pattern
export const bloodOxygenNight = [
  { time: "10 PM", spo2: 98 },
  { time: "11 PM", spo2: 97 },
  { time: "12 AM", spo2: 96 },
  { time: "1 AM", spo2: 95 },
  { time: "2 AM", spo2: 94 },
  { time: "3 AM", spo2: 95 },
  { time: "4 AM", spo2: 96 },
  { time: "5 AM", spo2: 97 },
  { time: "6 AM", spo2: 98 },
];

// Respiratory Rate - Sleep Pattern
export const respiratoryRateSleep = [
  { time: "10 PM", rate: 16 },
  { time: "11 PM", rate: 14 },
  { time: "12 AM", rate: 12 },
  { time: "1 AM", rate: 11 },
  { time: "2 AM", rate: 11 },
  { time: "3 AM", rate: 12 },
  { time: "4 AM", rate: 13 },
  { time: "5 AM", rate: 14 },
  { time: "6 AM", rate: 15 },
];

// Wrist Temperature - Ovulation Cycle (14-day window)
export const wristTemperatureCycle = [
  { day: "Day 1", temp: 36.2 },
  { day: "Day 2", temp: 36.1 },
  { day: "Day 3", temp: 36.2 },
  { day: "Day 4", temp: 36.1 },
  { day: "Day 5", temp: 36.0 },
  { day: "Day 6", temp: 36.1 },
  { day: "Day 7", temp: 36.0 }, // Ovulation dip
  { day: "Day 8", temp: 36.4 }, // Post-ovulation rise
  { day: "Day 9", temp: 36.5 },
  { day: "Day 10", temp: 36.6 },
  { day: "Day 11", temp: 36.5 },
  { day: "Day 12", temp: 36.6 },
  { day: "Day 13", temp: 36.5 },
  { day: "Day 14", temp: 36.4 },
];

// Caffeine Half-Life Simulation
export const caffeineHalfLife = [
  { hour: "8 AM", caffeine: 200 },
  { hour: "10 AM", caffeine: 170 },
  { hour: "12 PM", caffeine: 140 },
  { hour: "2 PM", caffeine: 115 },
  { hour: "4 PM", caffeine: 95 },
  { hour: "6 PM", caffeine: 78 },
  { hour: "8 PM", caffeine: 65 },
  { hour: "10 PM", caffeine: 53 },
  { hour: "12 AM", caffeine: 44 },
];

// Time in Daylight - Weekly Pattern
export const daylightExposureWeekly = [
  { day: "Mon", minutes: 45 },
  { day: "Tue", minutes: 30 },
  { day: "Wed", minutes: 55 },
  { day: "Thu", minutes: 35 },
  { day: "Fri", minutes: 25 },
  { day: "Sat", minutes: 120 },
  { day: "Sun", minutes: 95 },
];

// Workout Heart Rate Zones
export const workoutHeartRateZones = [
  { zone: "Zone 1 (50-60%)", minutes: 5, color: "#22c55e" },
  { zone: "Zone 2 (60-70%)", minutes: 15, color: "#84cc16" },
  { zone: "Zone 3 (70-80%)", minutes: 20, color: "#eab308" },
  { zone: "Zone 4 (80-90%)", minutes: 12, color: "#f97316" },
  { zone: "Zone 5 (90-100%)", minutes: 3, color: "#ef4444" },
];

// Clinical Ranges - Resting Heart Rate
export const restingHeartRateClinicalRanges = [
  { population: "Adults (18-65)", low: "<60", normal: "60-100", high: ">100" },
  { population: "Well-trained Athletes", low: "<40", normal: "40-60", high: ">60" },
  { population: "Children (6-15)", low: "<70", normal: "70-100", high: ">100" },
  { population: "Seniors (65+)", low: "<60", normal: "60-100", high: ">100" },
];

// Clinical Ranges - HRV (RMSSD)
export const hrvClinicalRanges = [
  { population: "Adults (20-29)", values: "Poor: <25, Fair: 25-45, Good: 45-70, Excellent: >70" },
  { population: "Adults (30-39)", values: "Poor: <20, Fair: 20-40, Good: 40-60, Excellent: >60" },
  { population: "Adults (40-49)", values: "Poor: <15, Fair: 15-35, Good: 35-50, Excellent: >50" },
  { population: "Adults (50-59)", values: "Poor: <12, Fair: 12-30, Good: 30-45, Excellent: >45" },
  { population: "Adults (60+)", values: "Poor: <10, Fair: 10-25, Good: 25-40, Excellent: >40" },
];

// Device Comparison - Heart Rate Accuracy
export const heartRateDeviceComparison = [
  { device: "Apple Watch Series 9", accuracy: "±2 BPM", rating: 5, notes: "Best-in-class optical sensor" },
  { device: "Fitbit Charge 6", accuracy: "±3 BPM", rating: 4, notes: "Good for most activities" },
  { device: "Garmin Forerunner 265", accuracy: "±3 BPM", rating: 4, notes: "Excellent for running" },
  { device: "Whoop 4.0", accuracy: "±2 BPM", rating: 5, notes: "24/7 monitoring optimized" },
  { device: "Oura Ring Gen 3", accuracy: "±3 BPM", rating: 4, notes: "Best during sleep" },
  { device: "Chest Strap (Polar H10)", accuracy: "±1 BPM", rating: 5, notes: "Gold standard for exercise" },
];

// Feature Comparison - Wearables
export const wearableFeatureComparison = {
  columns: ["Apple Watch", "Fitbit", "Garmin", "Whoop", "Oura"],
  features: [
    { feature: "Heart Rate", "Apple Watch": true, Fitbit: true, Garmin: true, Whoop: true, Oura: true },
    { feature: "HRV", "Apple Watch": true, Fitbit: true, Garmin: true, Whoop: true, Oura: true },
    { feature: "Blood Oxygen", "Apple Watch": true, Fitbit: true, Garmin: true, Whoop: true, Oura: true },
    { feature: "ECG", "Apple Watch": true, Fitbit: true, Garmin: false, Whoop: false, Oura: false },
    { feature: "Skin Temperature", "Apple Watch": true, Fitbit: true, Garmin: true, Whoop: true, Oura: true },
    { feature: "Sleep Stages", "Apple Watch": true, Fitbit: true, Garmin: true, Whoop: true, Oura: true },
    { feature: "VO2 Max", "Apple Watch": true, Fitbit: true, Garmin: true, Whoop: false, Oura: false },
    { feature: "Fall Detection", "Apple Watch": true, Fitbit: false, Garmin: true, Whoop: false, Oura: false },
    { feature: "GPS", "Apple Watch": true, Fitbit: "Some", Garmin: true, Whoop: false, Oura: false },
  ],
};
