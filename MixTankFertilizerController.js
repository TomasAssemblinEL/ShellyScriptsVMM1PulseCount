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
var FERTILIZER_TIMEOUT_MS = 15000;
var WATER_FILL_WINDOW_START_HOUR = 0;
var WATER_FILL_WINDOW_END_HOUR = 3;
var WINDOW_ENFORCE_INTERVAL_MS = 60000;
var NTFY_URL = "https://ntfy.sh/berg_rud_vaxthus";
var STATE_KVS_KEY = "mix_tank_fertilizer_controller_state";

var STATE_IDLE = 0;
var STATE_FILLING_WATER = 1;
var STATE_DOSING_FERTILIZER = 2;

var state = STATE_IDLE;
var dosingTimer = null;
var dosingEndsAtUnix = null;
var startupRestored = false;

function stateName(s) {
  if (s === STATE_IDLE) return "IDLE";
  if (s === STATE_FILLING_WATER) return "FILLING_WATER";
  if (s === STATE_DOSING_FERTILIZER) return "DOSING_FERTILIZER";
  return "UNKNOWN";
}

function logTransition(trigger, nextState, reason) {
  print("[MixTank]", trigger, "state", stateName(state), "->", stateName(nextState), "|", reason);
}

function callRpc(method, params, context, onSuccess, onError) {
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

function getLocalMinutesOfDay() {
  try {
    var sys = Shelly.getComponentStatus("sys");
    if (!sys || typeof sys.time !== "string") {
      return -1;
    }

    var parts = sys.time.split(":");
    if (parts.length !== 2) {
      return -1;
    }

    var hour = parseInt(parts[0], 10);
    var minute = parseInt(parts[1], 10);
    if (isNaN(hour) || isNaN(minute)) {
      return -1;
    }

    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return -1;
    }

    return hour * 60 + minute;
  } catch (e) {}

  return -1;
}

function isWithinWaterFillWindow() {
  var nowMinutes = getLocalMinutesOfDay();
  if (nowMinutes < 0) {
    return false;
  }

  var startMinutes = WATER_FILL_WINDOW_START_HOUR * 60;
  var endMinutes = WATER_FILL_WINDOW_END_HOUR * 60;
  return nowMinutes >= startMinutes && nowMinutes < endMinutes;
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
  persistState(trigger);
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

  if (!isWithinWaterFillWindow()) {
    print("[MixTank] Ignoring low-level trigger outside allowed fill window 00:00-03:00");
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
    if (!isWithinWaterFillWindow()) {
      print("[MixTank] Recovered filling state outside allowed window, forcing idle");
      setSwitch(WATER_VALVE_SWITCH_ID, false, "restore_filling_outside_window_water_off");
      setSwitch(FERTILIZER_PUMP_SWITCH_ID, false, "restore_filling_outside_window_pump_off");
      transitionTo(STATE_IDLE, "startup_outside_fill_window", "Recovered filling state not allowed by time window");
      return;
    }

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

function enforceWaterFillWindow() {
  if (!startupRestored) {
    return;
  }

  if (state !== STATE_FILLING_WATER) {
    return;
  }

  if (isWithinWaterFillWindow()) {
    return;
  }

  print("[MixTank] Fill window closed while filling, stopping water and resetting to IDLE");
  setSwitch(WATER_VALVE_SWITCH_ID, false, "window_close_stop_water");
  setSwitch(FERTILIZER_PUMP_SWITCH_ID, false, "window_close_ensure_pump_off");
  transitionTo(STATE_IDLE, "fill_window_closed", "Outside allowed fill window 00:00-03:00");
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

restoreStateFromKvs(function () {
  applyRecoveredState();
  startupRestored = true;
  print("[MixTank] Startup recovery complete, event handling enabled");
});

Timer.set(WINDOW_ENFORCE_INTERVAL_MS, true, function () {
  enforceWaterFillWindow();
});