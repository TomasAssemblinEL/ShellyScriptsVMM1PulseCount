// Script: MixTankFertilizerController.js
// Purpose: Automatic water refill and fertilizer dosing cycle control.

// Switches
// out id0 = Ventil påfyllning vatten
// out id1 = Pump dosering gödning

// Inputs
// in id0 = Låg nivå i vattentank
// in id1 = Hög nivå i vattentank

var LOW_LEVEL_INPUT_ID = 0;
var HIGH_LEVEL_INPUT_ID = 1;
var WATER_VALVE_SWITCH_ID = 0;
var FERTILIZER_PUMP_SWITCH_ID = 1;
var FERTILIZER_TIMEOUT_MS = 20000;
var NTFY_URL = "https://ntfy.sh/berg_rud_vaxthus";
var STATE_KVS_KEY = "mix_tank_fertilizer_controller_state";
var ACTIVE_STATE_VC_KEY = "text:200";
var ACTIVE_STATE_VC_ID = 200;
var MQTT_LOG_ENABLED = true;
var MQTT_LOG_TOPIC_BASE = "shelly/mix_tank/log";
var MQTT_LOG_QOS = 0;
var MQTT_LOG_RETAIN = false;

var STATE_IDLE = 0;
var STATE_FILLING_WATER = 1;
var STATE_DOSING_FERTILIZER = 2;

var state = STATE_IDLE;
var dosingTimer = null;
var dosingEndsAtUnix = null;
var startupRestored = false;
var activeStateVc = null;
var nativePrint = print;
var mqttLogInProgress = false;
var mqttLogTopicResolved = MQTT_LOG_TOPIC_BASE + "/unknown";

function sanitizeTopicSegment(value) {
  if (typeof value !== "string" || value.length === 0) {
    return "";
  }

  var cleaned = value.toLowerCase();
  cleaned = cleaned.replace(/[^a-z0-9_-]+/g, "_");
  cleaned = cleaned.replace(/^_+|_+$/g, "");
  return cleaned;
}

function resolveDeviceSpecificMqttTopic() {
  var suffix = "";

  try {
    if (typeof Shelly.getDeviceInfo === "function") {
      var info = Shelly.getDeviceInfo();
      if (info) {
        suffix = sanitizeTopicSegment(info.name || "");
        if (!suffix) {
          suffix = sanitizeTopicSegment(info.id || "");
        }
        if (!suffix) {
          suffix = sanitizeTopicSegment(info.mac || "");
        }
      }
    }
  } catch (e) {}

  if (!suffix) {
    try {
      var sys = Shelly.getComponentConfig("sys");
      if (sys && sys.device) {
        suffix = sanitizeTopicSegment(sys.device.name || "");
      }
    } catch (e2) {}
  }

  if (!suffix) {
    suffix = "unknown";
  }

  mqttLogTopicResolved = MQTT_LOG_TOPIC_BASE + "/" + suffix;
  nativePrint("[MixTank] MQTT log topic:", mqttLogTopicResolved);
}

function formatLogMessage(args) {
  var parts = [];
  var i;
  for (i = 0; i < args.length; i++) {
    var value = args[i];
    if (typeof value === "string") {
      parts.push(value);
      continue;
    }

    if (value === null) {
      parts.push("null");
      continue;
    }

    if (typeof value === "undefined") {
      parts.push("undefined");
      continue;
    }

    if (typeof value === "object") {
      try {
        parts.push(JSON.stringify(value));
      } catch (e) {
        parts.push(String(value));
      }
      continue;
    }

    parts.push(String(value));
  }

  return parts.join(" ");
}

function publishLogToMqtt(message) {
  if (!MQTT_LOG_ENABLED || !message) {
    return;
  }

  try {
    Shelly.call("MQTT.Publish", {
      topic: mqttLogTopicResolved,
      message: message,
      qos: MQTT_LOG_QOS,
      retain: MQTT_LOG_RETAIN
    }, function (result, errorCode, errorMessage) {
      if (errorCode !== 0) {
        nativePrint("[MixTank][MQTT LOG ERROR]", "code=", errorCode, "message=", errorMessage);
      }
    });
  } catch (e) {
    nativePrint("[MixTank][MQTT LOG EXCEPTION]", e);
  }
}

print = function () {
  var args = Array.prototype.slice.call(arguments);
  nativePrint.apply(null, args);

  if (mqttLogInProgress) {
    return;
  }

  mqttLogInProgress = true;
  publishLogToMqtt(formatLogMessage(args));
  mqttLogInProgress = false;
};

resolveDeviceSpecificMqttTopic();

function stateName(s) {
  if (s === STATE_IDLE) return "IDLE";
  if (s === STATE_FILLING_WATER) return "FILLING_WATER";
  if (s === STATE_DOSING_FERTILIZER) return "DOSING_FERTILIZER";
  return "UNKNOWN";
}

function logTransition(trigger, nextState, reason) {
  print("[MixTank]", trigger, "state", stateName(state), "->", stateName(nextState), "|", reason);
}

function callRpc(method, params, context, onSuccess, onError, attempt) {
  if (typeof attempt !== "number") {
    attempt = 0;
  }

  try {
    Shelly.call(method, params, function (result, errorCode, errorMessage) {
      if (errorCode !== 0) {
        print("[MixTank][RPC ERROR]", context, "method=", method, "code=", errorCode, "message=", errorMessage);
        if (onError) {
          onError(errorCode, errorMessage);
        }
        return;
      }

      if (onSuccess) {
        onSuccess(result);
      }
    });
  } catch (e) {
    // Shelly can throw during call bursts on startup; retry shortly.
    if (attempt < 8) {
      print("[MixTank][RPC RETRY]", context, "method=", method, "attempt=", attempt + 1);
      Timer.set(200, false, function () {
        callRpc(method, params, context, onSuccess, onError, attempt + 1);
      });
      return;
    }

    print("[MixTank][RPC THROW]", context, "method=", method, "message=", e);
    if (onError) {
      onError(-1, "RPC exception: " + e);
    }
  }
}

function setSwitch(switchId, on, context, onSuccess) {
  callRpc("Switch.set", { id: switchId, on: on }, context, onSuccess);
}

function notify(message) {
  callRpc("HTTP.POST", { url: NTFY_URL, body: message }, "notify", function () {
    print("[MixTank] Notification sent:", message);
  });
}

function clearDosingTimer() {
  if (dosingTimer !== null) {
    Timer.clear(dosingTimer);
    dosingTimer = null;
  }
}

function getUnixTime() {
  try {
    var sys = Shelly.getComponentStatus("sys");
    if (sys && typeof sys.unixtime === "number" && sys.unixtime > 0) {
      return sys.unixtime;
    }
  } catch (e) {}

  return 0;
}

function persistState(reason) {
  var payload = JSON.stringify({
    state: state,
    dosingEndsAtUnix: dosingEndsAtUnix,
    savedAtUnix: getUnixTime()
  });

  callRpc("KVS.Set", { key: STATE_KVS_KEY, value: payload }, "persist_state:" + reason);
}

function transitionTo(nextState, trigger, reason) {
  logTransition(trigger, nextState, reason);
  state = nextState;
  publishActiveState(trigger);
  persistState(trigger);
}

function publishActiveState(source) {
  if (!activeStateVc) {
    return;
  }

  try {
    activeStateVc.setValue(stateName(state));
    print("[MixTank] Active state published:", stateName(state), "source=", source);
  } catch (e) {
    print("[MixTank] Failed to publish active state to", ACTIVE_STATE_VC_KEY, "error=", e);
  }
}

function initActiveStateVirtualComponent(onDone) {
  if (typeof Virtual === "undefined" || !Virtual || typeof Virtual.getHandle !== "function") {
    activeStateVc = null;
    print("[MixTank] Virtual API not available on this firmware, state export disabled");
    if (onDone) {
      onDone();
    }
    return;
  }

  try {
    activeStateVc = Virtual.getHandle(ACTIVE_STATE_VC_KEY);
    if (!activeStateVc) {
      print("[MixTank] Virtual component not found:", ACTIVE_STATE_VC_KEY, "(state export disabled)");
    }
  } catch (e) {
    activeStateVc = null;
    print("[MixTank] Failed to attach virtual component", ACTIVE_STATE_VC_KEY, "error=", e);
  }

  if (onDone) {
    onDone();
  }
}

function scheduleDosingTimeout(timeoutMs) {
  if (timeoutMs < 1) {
    timeoutMs = 1;
  }

  clearDosingTimer();
  dosingTimer = Timer.set(timeoutMs, false, function () {
    stopDosingAndReset("dosing_timeout");
  });
}

function stopDosingAndReset(reason) {
  clearDosingTimer();
  dosingEndsAtUnix = null;

  setSwitch(FERTILIZER_PUMP_SWITCH_ID, false, "stop_dosing", function () {
    transitionTo(STATE_IDLE, reason, "Dosing finished, resetting cycle");
  });
}

function startDosingCycle() {
  if (state !== STATE_FILLING_WATER) {
    print("[MixTank] Ignoring high-level trigger because state is", stateName(state));
    return;
  }

  setSwitch(WATER_VALVE_SWITCH_ID, false, "stop_water_fill");
  setSwitch(FERTILIZER_PUMP_SWITCH_ID, true, "start_dosing", function () {
    var now = getUnixTime();
    dosingEndsAtUnix = now > 0 ? now + Math.ceil(FERTILIZER_TIMEOUT_MS / 1000) : null;
    transitionTo(STATE_DOSING_FERTILIZER, "input:1=true", "Tank full, start fertilizer dosing");
  });

  if (dosingTimer !== null) {
    print("[MixTank] Dosing timer already active, skipping duplicate timer setup");
    return;
  }

  scheduleDosingTimeout(FERTILIZER_TIMEOUT_MS);

  notify("Fyllt på med gödning");
}

function startWaterFillCycle() {
  if (state !== STATE_IDLE) {
    print("[MixTank] Ignoring low-level trigger because state is", stateName(state));
    return;
  }

  setSwitch(WATER_VALVE_SWITCH_ID, true, "start_water_fill", function () {
    transitionTo(STATE_FILLING_WATER, "input:0=true", "Low level detected, filling water");
  });
}

function restoreStateFromKvs(onDone) {
  callRpc("KVS.Get", { key: STATE_KVS_KEY }, "load_state", function (result) {
    if (!result || typeof result.value !== "string") {
      print("[MixTank] No saved KVS state found, starting fresh");
      transitionTo(STATE_IDLE, "startup", "No persisted state");
      onDone();
      return;
    }

    try {
      var persisted = JSON.parse(result.value);
      if (typeof persisted.state === "number") {
        state = persisted.state;
      } else {
        state = STATE_IDLE;
      }

      if (typeof persisted.dosingEndsAtUnix === "number" && persisted.dosingEndsAtUnix > 0) {
        dosingEndsAtUnix = persisted.dosingEndsAtUnix;
      } else {
        dosingEndsAtUnix = null;
      }

      print("[MixTank] Loaded KVS state:", stateName(state), "dosingEndsAtUnix=", dosingEndsAtUnix);
    } catch (e) {
      print("[MixTank] Failed to parse KVS state, defaulting to IDLE");
      state = STATE_IDLE;
      dosingEndsAtUnix = null;
      persistState("startup_parse_error");
    }

    onDone();
  }, function () {
    print("[MixTank] Failed to load KVS state, defaulting to IDLE");
    state = STATE_IDLE;
    dosingEndsAtUnix = null;
    persistState("startup_load_error");
    onDone();
  });
}

function applyRecoveredState() {
  if (state === STATE_FILLING_WATER) {
    setSwitch(WATER_VALVE_SWITCH_ID, true, "restore_filling_water", function () {
      print("[MixTank] Restored water filling state");
    });
    setSwitch(FERTILIZER_PUMP_SWITCH_ID, false, "restore_filling_water_pump_off");
    persistState("startup_restore_filling");
    return;
  }

  if (state === STATE_DOSING_FERTILIZER) {
    var now = getUnixTime();
    if (now === 0 || dosingEndsAtUnix === null) {
      print("[MixTank] Missing valid time for dosing recovery, forcing safe reset");
      setSwitch(WATER_VALVE_SWITCH_ID, false, "restore_dosing_force_water_off");
      stopDosingAndReset("startup_missing_time");
      return;
    }

    var remainingMs = (dosingEndsAtUnix - now) * 1000;
    if (remainingMs <= 0) {
      print("[MixTank] Dosing window already elapsed during reboot, resetting");
      setSwitch(WATER_VALVE_SWITCH_ID, false, "restore_dosing_elapsed_water_off");
      stopDosingAndReset("startup_elapsed");
      return;
    }

    setSwitch(WATER_VALVE_SWITCH_ID, false, "restore_dosing_water_off");
    setSwitch(FERTILIZER_PUMP_SWITCH_ID, true, "restore_dosing_pump_on", function () {
      print("[MixTank] Resumed dosing, remaining ms:", remainingMs);
      scheduleDosingTimeout(remainingMs);
      persistState("startup_resume_dosing");
    });
    return;
  }

  state = STATE_IDLE;
  dosingEndsAtUnix = null;
  setSwitch(WATER_VALVE_SWITCH_ID, false, "restore_idle_water_off");
  setSwitch(FERTILIZER_PUMP_SWITCH_ID, false, "restore_idle_pump_off");
  persistState("startup_restore_idle");
}

function getInputState(inputId) {
  try {
    var input = Shelly.getComponentStatus("input:" + inputId);
    if (input && typeof input.state === "boolean") {
      return input.state;
    }
  } catch (e) {}

  return null;
}

function bootstrapFromCurrentInputs() {
  var lowLevelState = getInputState(LOW_LEVEL_INPUT_ID);
  var highLevelState = getInputState(HIGH_LEVEL_INPUT_ID);

  print("[MixTank] Bootstrap input states low=", lowLevelState, "high=", highLevelState, "state=", stateName(state));

  if (state === STATE_IDLE && lowLevelState === true) {
    // Script restarts can miss edge events; bootstrap from current level states.
    print("[MixTank] Startup bootstrap: low level active, starting water fill");
    notify("Startup bootstrap startar vattenpåfyllning");
    startWaterFillCycle();
    return;
  }

  if (state === STATE_FILLING_WATER && highLevelState === true) {
    startDosingCycle();
  }
}

Shelly.addStatusHandler(function (e) {
  if (!startupRestored) {
    return;
  }

  if (!e || !e.component || !e.delta || typeof e.delta.state === "undefined") {
    return;
  }

  if (e.component === "input:" + LOW_LEVEL_INPUT_ID) {
    if (e.delta.state === true) {
      startWaterFillCycle();
      return;
    }

    if (e.delta.state === false) {
      print("[MixTank] input:0=false observed (state:", stateName(state) + ")");
      return;
    }
  }

  if (e.component === "input:" + HIGH_LEVEL_INPUT_ID) {
    if (e.delta.state === true) {
      startDosingCycle();
      return;
    }

    if (e.delta.state === false) {
      print("[MixTank] input:1=false observed (state:", stateName(state) + ")");
    }
  }
});

initActiveStateVirtualComponent(function () {
  restoreStateFromKvs(function () {
    applyRecoveredState();
    publishActiveState("startup_recovery_complete");
    startupRestored = true;
    print("[MixTank] Startup recovery complete, event handling enabled");
    Timer.set(500, false, function () {
      bootstrapFromCurrentInputs();
    });
  });
});
