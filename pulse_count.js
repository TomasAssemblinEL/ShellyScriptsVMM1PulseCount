// Shelly Script: VMM1 Pulse Count
// Counts pulses on input and publishes count via MQTT
// MQTT broker: 192.168.1.82:1883

// ---- Configuration ----
var MQTT_BROKER = "192.168.1.82";
var MQTT_PORT   = 1883;
var MQTT_TOPIC  = "shelly/vmm1/pulsecount";
var DEVICE_ID   = "FCB467A6AF80";
var INPUT_ID    = 2;          // Shelly input index to monitor
var PUBLISH_INTERVAL_MS = 5000; // Publish every 5 seconds
var UNIT_PER_PULSE = 1.0;     // Measured unit per pulse (example: liters or Wh)
var MEASURE_UNIT = "liters"; // Example: "liters" or "Wh"
var FLOW_TIMEOUT_MS = 30000;  // If no pulse for this long, report flow as 0

// ---- State ----
var pulseCount = 0;
var previousPulseMs = 0;
var lastPulseMs = 0;
var lastPublishMs = Date.now();
var lastPublishPulseCount = 0;

function getStatusSafe(component) {
  try {
    return Shelly.getComponentStatus(component);
  } catch (e) {
    return null;
  }
}

function getBatteryPercent() {
  var battery = getStatusSafe("battery");
  if (!battery) return null;
  if (typeof battery.percent === "number") return battery.percent;
  if (typeof battery.value === "number") return battery.value;
  return null;
}

function getWifiRssi() {
  var wifi = getStatusSafe("wifi");
  if (!wifi) return null;
  if (typeof wifi.rssi === "number") return wifi.rssi;
  return null;
}

function getUptimeSeconds() {
  var sys = getStatusSafe("sys");
  if (!sys) return null;
  if (typeof sys.uptime === "number") return sys.uptime;
  return null;
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function getPulseFrequencyHz(nowMs) {
  if (lastPulseMs === 0 || previousPulseMs === 0) return 0;
  if (nowMs - lastPulseMs > FLOW_TIMEOUT_MS) return 0;

  var dtMs = lastPulseMs - previousPulseMs;
  if (dtMs <= 0) return 0;

  return 1000 / dtMs;
}

function getAverageFlowPerHour(nowMs) {
  var dtMs = nowMs - lastPublishMs;
  if (dtMs <= 0) return 0;

  var pulseDelta = pulseCount - lastPublishPulseCount;
  if (pulseDelta < 0) pulseDelta = 0;

  var quantityDelta = pulseDelta * UNIT_PER_PULSE;
  return (quantityDelta * 3600000) / dtMs;
}

function publishPulseCount(source) {
  var nowMs = Date.now();
  var pulseFrequencyHz = getPulseFrequencyHz(nowMs);
  var instantFlowPerHour = pulseFrequencyHz * UNIT_PER_PULSE * 3600;
  var averageFlowPerHour = getAverageFlowPerHour(nowMs);

  var payload = JSON.stringify({
    device: DEVICE_ID,
    input: INPUT_ID,
    pulse_count: pulseCount,
    total_quantity: round3(pulseCount * UNIT_PER_PULSE),
    quantity_unit: MEASURE_UNIT,
    pulse_frequency_hz: round3(pulseFrequencyHz),
    flow_rate_per_hour: round3(instantFlowPerHour),
    avg_flow_rate_per_hour: round3(averageFlowPerHour),
    battery: getBatteryPercent(),
    rssi: getWifiRssi(),
    uptime: getUptimeSeconds(),
    source: source,
    ts: Math.floor(Date.now() / 1000)
  });

  lastPublishMs = nowMs;
  lastPublishPulseCount = pulseCount;

  MQTT.publish(MQTT_TOPIC, payload, 0, false);
  print("Published: " + payload);
}

// ---- Count pulses on input event ----
Shelly.addEventHandler(function (event) {
  if (event.component === "input:" + INPUT_ID && event.info.event === "toggle") {
    pulseCount++;
    previousPulseMs = lastPulseMs;
    lastPulseMs = Date.now();
    print("Pulse detected. Total: " + pulseCount);
    publishPulseCount("pulse");
  }
});

// ---- Periodic MQTT publish ----
Timer.set(PUBLISH_INTERVAL_MS, true, function () {
  publishPulseCount("interval");
});

// ---- MQTT connect handler ----
MQTT.setConnectHandler(function () {
  print("MQTT connected to " + MQTT_BROKER + ":" + MQTT_PORT);
});

MQTT.setDisconnectHandler(function () {
  print("MQTT disconnected");
});

var startupMessage = "Shelly Plus Uni pulse counter started for " + DEVICE_ID + ", input " + INPUT_ID + ".";
print(startupMessage);
