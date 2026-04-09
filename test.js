// Shelly test: print counts.total for input component id 2
var INPUT_ID = 2;
var MQTT_BROKER = "192.168.1.82";
var MQTT_PORT = 1883;
var MQTT_TOPIC = "shelly/vmm1/daily_consumption";
var STATE_KVS_KEY = "daily_consumption_state_input_2";

// ---- Daily consumption tracking ----
var lastXTotal = null;             // most recent xtotal received
var startTodayXTotal = null;       // xtotal at today's 00:00
var startYesterdayXTotal = null;   // xtotal at yesterday's 00:00
var startDayBeforeXTotal = null;   // xtotal at day-before-yesterday 00:00
var lastSnapDay = -1;              // calendar day when snapshot was taken

function savePersistentState() {
  var state = JSON.stringify({
    lastXTotal: lastXTotal,
    startTodayXTotal: startTodayXTotal,
    startYesterdayXTotal: startYesterdayXTotal,
    startDayBeforeXTotal: startDayBeforeXTotal,
    lastSnapDay: lastSnapDay
  });

  Shelly.call("KVS.Set", {
    key: STATE_KVS_KEY,
    value: state
  }, function (result, errorCode, errorMessage) {
    if (errorCode !== 0) {
      print("Failed to save state: " + errorMessage);
    }
  });
}

function loadPersistentState() {
  Shelly.call("KVS.Get", {
    key: STATE_KVS_KEY
  }, function (result, errorCode, errorMessage) {
    if (errorCode !== 0 || !result || typeof result.value !== "string") {
      print("No saved state found");
      return;
    }

    try {
      var state = JSON.parse(result.value);
      lastXTotal = state.lastXTotal;
      startTodayXTotal = state.startTodayXTotal;
      startYesterdayXTotal = state.startYesterdayXTotal;
      startDayBeforeXTotal = state.startDayBeforeXTotal;
      lastSnapDay = typeof state.lastSnapDay === "number" ? state.lastSnapDay : -1;
      print("Loaded saved state from KVS");
    } catch (e) {
      print("Failed to parse saved state");
    }
  });
}

function getStatusSafe(component) {
  try {
    return Shelly.getComponentStatus(component);
  } catch (e) {
    return null;
  }
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

function round1(value) {
  return Math.round(value * 10) / 10;
}

function calculateDeltaPreviousDayToday(todayXTotal, previousDayXTotal) {
  return todayXTotal - previousDayXTotal;
}

function compareYesterdayAndDayBefore() {
  if (startTodayXTotal === null || startYesterdayXTotal === null || startDayBeforeXTotal === null) {
    return;
  }

  var yesterday = startTodayXTotal - startYesterdayXTotal;
  var dayBefore = startYesterdayXTotal - startDayBeforeXTotal;
  var direction = "same";

  if (yesterday > dayBefore) direction = "more";
  if (yesterday < dayBefore) direction = "less";

  var msg = "Compare yesterday vs day-before: " + direction +
    " (yesterday:" + round1(yesterday) + " day_before:" + round1(dayBefore) + ")";

  print(msg);
  if (isMqttConnected()) {
    MQTT.publish(MQTT_TOPIC, msg, 0, false);
  }
}

function publishDailyConsumption(delta, xtotal, start) {
  var line = "Delta previous day -> today: " + round1(delta) + " (today:" + round1(xtotal) + " previous_day:" + round1(start) + ")";
  print(line);

  if (!isMqttConnected()) {
    print("MQTT offline, skipped publish");
    return;
  }

  MQTT.publish(MQTT_TOPIC, line, 0, false);
}

function getSysTime() {
  try {
    var sys = Shelly.getComponentStatus("sys");
    if (sys && sys.time) return sys.time; // "HH:MM"
  } catch (e) {}
  return null;
}

// Check every minute; snapshot xtotal at 00:00 and run daily comparisons
Timer.set(60000, true, function () {
  var t = getSysTime();
  if (!t) return;

  var hour   = parseInt(t.split(":")[0], 10);
  var minute = parseInt(t.split(":")[1], 10);

  var sys      = getStatusSafe("sys");
  var unixSecs = sys && sys.unixtime ? sys.unixtime : 0;
  var today    = Math.floor(unixSecs / 86400);

  // Snapshot once at 00:00 on each new day
  if (hour === 0 && minute === 0 && today !== lastSnapDay) {
    startDayBeforeXTotal = startYesterdayXTotal;
    startYesterdayXTotal = startTodayXTotal;
    startTodayXTotal = lastXTotal;
    lastSnapDay = today;
    savePersistentState();
    print("Snapshot at 00:00 startTodayXTotal:" + startTodayXTotal);
    compareYesterdayAndDayBefore();
  }

  // Print daily consumption every minute if we have both values
  if (startTodayXTotal !== null && lastXTotal !== null) {
    var delta = calculateDeltaPreviousDayToday(lastXTotal, startTodayXTotal);
    publishDailyConsumption(delta, lastXTotal, startTodayXTotal);
  }
});

Shelly.addStatusHandler(function (status) {
  if (status.component !== "input:" + INPUT_ID) return;

  if (status.delta && status.delta.counts && typeof status.delta.counts.total === "number") {
    print("id:" + INPUT_ID + " counts.total:" + status.delta.counts.total);
  }

  if (status.delta && status.delta.counts && typeof status.delta.counts.xtotal === "number") {
    lastXTotal = status.delta.counts.xtotal;
    savePersistentState();
    print("id:" + INPUT_ID + " counts.xtotal:" + lastXTotal);

    if (startTodayXTotal !== null) {
      var delta = calculateDeltaPreviousDayToday(lastXTotal, startTodayXTotal);
      publishDailyConsumption(delta, lastXTotal, startTodayXTotal);
    }
  }
});

MQTT.setConnectHandler(function () {
  print("MQTT connected to " + MQTT_BROKER + ":" + MQTT_PORT);
});

MQTT.setDisconnectHandler(function () {
  print("MQTT disconnected");
});

loadPersistentState();
print("Listening for status changes on input:" + INPUT_ID);
