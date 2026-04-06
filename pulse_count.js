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

// ---- State ----
var pulseCount = 0;

// ---- Count pulses on input event ----
Shelly.addEventHandler(function (event) {
  if (event.component === "input:" + INPUT_ID && event.info.event === "toggle") {
    pulseCount++;
    print("Pulse detected. Total: " + pulseCount);
  }
});

// ---- Periodic MQTT publish ----
Timer.set(PUBLISH_INTERVAL_MS, true, function () {
  var payload = JSON.stringify({
    device: DEVICE_ID,
    input: INPUT_ID,
    pulse_count: pulseCount,
    ts: Math.floor(Date.now() / 1000)
  });
  MQTT.publish(MQTT_TOPIC, payload, 0, false);
  print("Published: " + payload);
});

// ---- MQTT connect handler ----
MQTT.setConnectHandler(function () {
  print("MQTT connected to " + MQTT_BROKER + ":" + MQTT_PORT);
});

MQTT.setDisconnectHandler(function () {
  print("MQTT disconnected");
});

print("Shelly Plus Uni pulse counter started for " + DEVICE_ID + " on input " + INPUT_ID + ".");
