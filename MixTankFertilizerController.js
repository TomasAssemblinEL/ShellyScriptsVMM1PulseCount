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
var NTFY_URL = "https://ntfy.sh/berg_rud_vaxthus";

var STATE_IDLE = 0;
var STATE_FILLING_WATER = 1;
var STATE_DOSING_FERTILIZER = 2;

var state = STATE_IDLE;
var dosingTimer = null;

function stateName(s) {
  if (s === STATE_IDLE) return "IDLE";
  if (s === STATE_FILLING_WATER) return "FILLING_WATER";
  if (s === STATE_DOSING_FERTILIZER) return "DOSING_FERTILIZER";
  return "UNKNOWN";
}

function logTransition(trigger, nextState, reason) {
  print("[MixTank]", trigger, "state", stateName(state), "->", stateName(nextState), "|", reason);
}

function callRpc(method, params, context, onSuccess) {
  Shelly.call(method, params, function (result, errorCode, errorMessage) {
    if (errorCode !== 0) {
      print("[MixTank][RPC ERROR]", context, "method=", method, "code=", errorCode, "message=", errorMessage);
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

function stopDosingAndReset(reason) {
  clearDosingTimer();

  setSwitch(FERTILIZER_PUMP_SWITCH_ID, false, "stop_dosing", function () {
    logTransition(reason, STATE_IDLE, "Dosing finished, resetting cycle");
    state = STATE_IDLE;
  });
}

function startDosingCycle() {
  if (state !== STATE_FILLING_WATER) {
    print("[MixTank] Ignoring high-level trigger because state is", stateName(state));
    return;
  }

  setSwitch(WATER_VALVE_SWITCH_ID, false, "stop_water_fill");
  setSwitch(FERTILIZER_PUMP_SWITCH_ID, true, "start_dosing", function () {
    logTransition("input:1=true", STATE_DOSING_FERTILIZER, "Tank full, start fertilizer dosing");
    state = STATE_DOSING_FERTILIZER;
  });

  if (dosingTimer !== null) {
    print("[MixTank] Dosing timer already active, skipping duplicate timer setup");
    return;
  }

  dosingTimer = Timer.set(FERTILIZER_TIMEOUT_MS, false, function () {
    stopDosingAndReset("dosing_timeout");
  });

  notify("Fyllt på med gödning");
}

function startWaterFillCycle() {
  if (state !== STATE_IDLE) {
    print("[MixTank] Ignoring low-level trigger because state is", stateName(state));
    return;
  }

  setSwitch(WATER_VALVE_SWITCH_ID, true, "start_water_fill", function () {
    logTransition("input:0=true", STATE_FILLING_WATER, "Low level detected, filling water");
    state = STATE_FILLING_WATER;
  });
}

Shelly.addStatusHandler(function (e) {
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