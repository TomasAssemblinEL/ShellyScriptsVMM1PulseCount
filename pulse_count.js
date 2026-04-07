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
var UNIT_PER_PULSE = 0.0025;     // Measured unit per pulse (example: liters or Wh)
var MEASURE_UNIT = "liters"; // Example: "liters" or "Wh"
var FLOW_TIMEOUT_MS = 30000;  // If no pulse for this long, report flow as 0
var STATUS_PUBLISH_DEBOUNCE_MS = 750; // Limit burst publishes from status updates

// ---- State ----
var pulseCount = 0;
var previousPulseMs = 0;
var lastPulseMs = 0;
var lastPublishMs = Date.now();
var lastPublishPulseCount = 0;
var lastStatusPublishMs = 0;

function getStatusSafe(component) {
  try {
    return Shelly.getComponentStatus(component);
  } catch (e) {
    return null;
  }
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

function isMqttConnected() {
  if (typeof MQTT.isConnected === "function") {
    return MQTT.isConnected();
  }

  var mqtt = getStatusSafe("mqtt");
  if (mqtt && typeof mqtt.connected === "boolean") {
    return mqtt.connected;
  }

  return true;
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
  if (!isMqttConnected()) {
    print("MQTT offline, skipped publish source:" + source);
    return;
  }

  var nowMs = Date.now();
  var pulseFrequencyHz = getPulseFrequencyHz(nowMs);
  var instantFlowPerHour = pulseFrequencyHz * UNIT_PER_PULSE * 3600;
  var averageFlowPerHour = getAverageFlowPerHour(nowMs);
  var xTotal = round3(pulseCount * UNIT_PER_PULSE);

  var payload = JSON.stringify({
    id: INPUT_ID,
    counts: {
      total: pulseCount,
      xtotal: xTotal
    },
    device: DEVICE_ID,
    quantity_unit: MEASURE_UNIT,
    pulse_frequency_hz: round3(pulseFrequencyHz),
    flow_rate_per_hour: round3(instantFlowPerHour),
    avg_flow_rate_per_hour: round3(averageFlowPerHour),
    rssi: getWifiRssi(),
    uptime: getUptimeSeconds(),
    source: source,
    ts: Math.floor(Date.now() / 1000)
  });

  lastPublishMs = nowMs;
  lastPublishPulseCount = pulseCount;

  MQTT.publish(MQTT_TOPIC, payload, 0, false);
  print(payload);
}

// ---- Track pulse counts from input status updates ----
Shelly.addStatusHandler(function (status) {
  if (status.component !== "input:" + INPUT_ID) return;

  if (status.delta && status.delta.counts && typeof status.delta.counts.total === "number") {
    var newTotal = status.delta.counts.total;

    if (newTotal !== pulseCount) {
      previousPulseMs = lastPulseMs;
      lastPulseMs = Date.now();
    }

    pulseCount = newTotal;
    print("id:" + INPUT_ID + " counts.total:" + pulseCount);

    var nowMs = Date.now();
    if (nowMs - lastStatusPublishMs >= STATUS_PUBLISH_DEBOUNCE_MS) {
      lastStatusPublishMs = nowMs;
      publishPulseCount("status_total");
    }

    return;
  }

  if (status.delta && status.delta.counts && typeof status.delta.counts.xtotal === "number") {
    print("id:" + INPUT_ID + " counts.xtotal:" + status.delta.counts.xtotal);
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

var inputStatus = getStatusSafe("input:" + INPUT_ID);
if (inputStatus && inputStatus.counts && typeof inputStatus.counts.total === "number") {
  pulseCount = inputStatus.counts.total;
  lastPublishPulseCount = pulseCount;
  print("Initial counts.total synced: " + pulseCount);
}

