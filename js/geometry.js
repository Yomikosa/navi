/**
 * AERO-DRIVE 3D Navigation Geometry & Analytics Engine (Turf.js powered)
 * Pure functional calculations for:
 *  - Route model indexing & monotonic step distance projection
 *  - Monotonic local-window route snapping (immune to overlapping JCT loops)
 *  - City / Highway maneuver & IC/JCT branch countdown tracking
 *  - Speed-adaptive camera zoom profiling
 *  - Mountain rally pace-note curvature analysis (100m–300m lookahead via Turf.js)
 *  - Route-snapped & vector Dead Reckoning (自律航法)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('@turf/turf'));
  } else {
    root.NaviGeometry = factory(root.turf);
  }
})(typeof self !== 'undefined' ? self : this, function (turf) {
  'use strict';

  function normalizeBearing(deg) {
    if (!Number.isFinite(deg)) return 0;
    return ((deg % 360) + 360) % 360;
  }

  /**
   * Signed shortest angle difference (toDeg - fromDeg) in [-180, 180].
   * Positive = clockwise (Right turn), Negative = counter-clockwise (Left turn).
   */
  function angleDiff(fromDeg, toDeg) {
    let d = normalizeBearing(toDeg) - normalizeBearing(fromDeg);
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  }

  function lerpBearing(fromDeg, toDeg, t) {
    const diff = angleDiff(fromDeg, toDeg);
    return normalizeBearing(fromDeg + diff * Math.max(0, Math.min(1, t)));
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function formatDistanceJa(meters) {
    const m = Math.max(0, Math.round(meters));
    if (m >= 10000) return `${(m / 1000).toFixed(0)} km`;
    if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
    if (m >= 100) return `${Math.round(m / 10) * 10} m`;
    if (m >= 20) return `${Math.round(m / 5) * 5} m`;
    return `${m} m`;
  }

  function formatDurationJa(seconds) {
    const s = Math.max(0, Math.round(seconds));
    const totalMin = Math.ceil(s / 60);
    if (totalMin < 60) return `${totalMin}分`;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return m > 0 ? `${h}時間${m}分` : `${h}時間`;
  }

  function bearingToCompass(deg) {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const idx = Math.round(normalizeBearing(deg) / 45) % 8;
    return dirs[idx];
  }

  /**
   * Classify whether a Directions API step represents a highway IC / JCT / branch.
   */
  function isHighwayBranchStep(step) {
    if (!step || !step.maneuver) return false;
    const type = (step.maneuver.type || '').toLowerCase();
    const highwayTypes = new Set([
      'off ramp',
      'fork',
      'merge',
      'on ramp',
      'exit roundabout',
      'exit rotary',
    ]);
    if (highwayTypes.has(type)) return true;

    const textBlob = [
      step.name || '',
      step.ref || '',
      step.exits || '',
      step.destinations || '',
      step.maneuver.instruction || '',
    ].join(' ');

    return /(JCT|IC|PA|SA|ジャンクション|インター|ランプ|分岐|出口|料金所|高速|自動車道|首都高|東名|名神|中央道|東北道|関越|常磐|阪神|湾岸)/i.test(
      textBlob
    );
  }

  /**
   * Build a clean Japanese title for highway branch / step banner.
   */
  function extractStepTitle(step) {
    if (!step) return '道なり直進';
    const bannerPrimary =
      step.bannerInstructions &&
      step.bannerInstructions[0] &&
      step.bannerInstructions[0].primary &&
      step.bannerInstructions[0].primary.text;
    if (bannerPrimary) return bannerPrimary;
    if (step.destinations) return step.destinations;
    if (step.exits && step.name) return `${step.exits} ${step.name}`;
    if (step.name) return step.name;
    if (step.ref) return step.ref;
    if (step.maneuver && step.maneuver.instruction) return step.maneuver.instruction;
    return '次の案内地点';
  }

  function getManeuverKey(maneuver) {
    if (!maneuver) return 'straight';
    const type = (maneuver.type || '').toLowerCase();
    const mod = (maneuver.modifier || '').toLowerCase();

    if (type === 'arrive') return 'arrive';
    if (type === 'depart') return 'straight';
    if (type === 'roundabout' || type === 'rotary' || type === 'exit roundabout' || type === 'exit rotary') {
      return 'roundabout';
    }
    if (type === 'merge') return mod.includes('left') ? 'merge-left' : 'merge-right';
    if (type === 'fork') return mod.includes('left') ? 'fork-left' : 'fork-right';
    if (type === 'off ramp' || type === 'on ramp') {
      return mod.includes('left') ? 'ramp-left' : 'ramp-right';
    }
    if (mod === 'uturn') return 'uturn';
    if (mod === 'sharp left') return 'sharp-left';
    if (mod === 'sharp right') return 'sharp-right';
    if (mod === 'left') return 'left';
    if (mod === 'right') return 'right';
    if (mod === 'slight left') return 'slight-left';
    if (mod === 'slight right') return 'slight-right';
    return 'straight';
  }

  function getBranchTypeTag(step) {
    if (!step || !step.maneuver) return '分岐';
    const type = (step.maneuver.type || '').toLowerCase();
    if (type === 'off ramp') return 'IC / 出口ランプ';
    if (type === 'on ramp') return '入口ランプ';
    if (type === 'fork') return 'JCT / 分岐';
    if (type === 'merge') return '合流';
    if (type === 'arrive') return '目的地';
    if (step.exits) return `出口 ${step.exits}`;
    return '分岐ポイント';
  }

  /**
   * Remove consecutive duplicate coordinates to avoid Turf zero-length artifacts.
   */
  function sanitizeCoords(coords) {
    const out = [];
    for (let i = 0; i < coords.length; i++) {
      const c = coords[i];
      if (!Array.isArray(c) || c.length < 2) continue;
      if (
        out.length === 0 ||
        Math.abs(out[out.length - 1][0] - c[0]) > 1e-7 ||
        Math.abs(out[out.length - 1][1] - c[1]) > 1e-7
      ) {
        out.push([c[0], c[1]]);
      }
    }
    return out;
  }

  /**
   * Build an indexed RouteModel from a Mapbox Directions API route object.
   */
  function buildRouteModel(route) {
    if (!route || !route.geometry || !Array.isArray(route.geometry.coordinates)) {
      throw new Error('Invalid route geometry');
    }

    const coords = sanitizeCoords(route.geometry.coordinates);
    if (coords.length < 2) {
      throw new Error('Route must contain at least 2 distinct points');
    }

    const line = turf.lineString(coords);
    const totalKm = turf.length(line, { units: 'kilometers' });
    const leg = (route.legs && route.legs[0]) || { steps: [], annotation: null };
    const rawSteps = Array.isArray(leg.steps) ? leg.steps : [];

    // Map each step monotonically along the full route LineString.
    // Directions step.distance is the distance from step[i] maneuver to step[i+1] maneuver.
    let expectedDistKm = 0;
    let prevMappedKm = 0;

    const steps = rawSteps.map((step, idx) => {
      let mappedKm = expectedDistKm;

      if (idx === 0) {
        mappedKm = 0;
      } else if (idx === rawSteps.length - 1) {
        mappedKm = totalKm;
      } else if (step.maneuver && Array.isArray(step.maneuver.location)) {
        const pt = turf.point(step.maneuver.location);
        const searchStart = Math.max(prevMappedKm, expectedDistKm - 0.35);
        const searchEnd = Math.min(totalKm, Math.max(searchStart + 0.05, expectedDistKm + 0.45));
        try {
          if (searchEnd - searchStart > 0.01 && totalKm > 0.05) {
            const subLine = turf.lineSliceAlong(line, searchStart, searchEnd, {
              units: 'kilometers',
            });
            const snapped = turf.nearestPointOnLine(subLine, pt, { units: 'kilometers' });
            if (snapped && snapped.properties && Number.isFinite(snapped.properties.location)) {
              const candidateKm = searchStart + snapped.properties.location;
              const offsetKm = snapped.properties.dist || 0;
              mappedKm = offsetKm <= 0.12 ? candidateKm : clamp(expectedDistKm, prevMappedKm, totalKm);
            }
          }
        } catch (_err) {
          mappedKm = clamp(expectedDistKm, prevMappedKm, totalKm);
        }
      }

      mappedKm = clamp(Math.max(prevMappedKm, mappedKm), 0, totalKm);
      prevMappedKm = mappedKm;
      expectedDistKm += (step.distance || 0) / 1000;

      const isBranch = isHighwayBranchStep(step);
      const classSet = new Set();
      if (Array.isArray(step.intersections)) {
        step.intersections.forEach((inter) => {
          if (inter && Array.isArray(inter.classes)) {
            inter.classes.forEach((c) => classSet.add(String(c).toLowerCase()));
          }
        });
      }
      const roadClasses = Array.from(classSet);
      const isMotorwayOrElevated =
        classSet.has('motorway') ||
        classSet.has('bridge') ||
        /(首都高|高速|自動車道|JCT|IC|ランプ|バイパス|高架)/i.test(
          `${step.name || ''} ${step.ref || ''} ${step.destinations || ''}`
        );

      return {
        index: idx,
        routeDistKm: mappedKm,
        distance: step.distance || 0,
        duration: step.duration || 0,
        name: step.name || '',
        ref: step.ref || '',
        exits: step.exits || '',
        destinations: step.destinations || '',
        maneuver: step.maneuver || {},
        maneuverKey: getManeuverKey(step.maneuver),
        title: extractStepTitle(step),
        instruction: (step.maneuver && step.maneuver.instruction) || extractStepTitle(step),
        isHighwayBranch: isBranch,
        branchTag: getBranchTypeTag(step),
        roadClasses,
        isMotorwayOrElevated,
      };
    });

    const annotation = leg.annotation || null;

    return {
      line,
      coords,
      totalKm,
      totalMeters: route.distance || totalKm * 1000,
      totalDurationSec: route.duration || 0,
      steps,
      annotation,
      raw: route,
    };
  }

  /**
   * Compute forward heading (degrees 0–360) along routeLine at distKm.
   */
  function getRouteHeadingAt(routeModel, distKm, lookaheadKm = 0.025) {
    if (!routeModel || !routeModel.line || routeModel.totalKm <= 0) return 0;
    const d1 = clamp(distKm, 0, Math.max(0, routeModel.totalKm - 0.002));
    const d2 = clamp(d1 + lookaheadKm, 0.001, routeModel.totalKm);
    if (d2 <= d1) {
      const pPrev = turf.along(routeModel.line, Math.max(0, routeModel.totalKm - 0.02), {
        units: 'kilometers',
      });
      const pEnd = turf.along(routeModel.line, routeModel.totalKm, { units: 'kilometers' });
      return normalizeBearing(turf.bearing(pPrev, pEnd));
    }
    const p1 = turf.along(routeModel.line, d1, { units: 'kilometers' });
    const p2 = turf.along(routeModel.line, d2, { units: 'kilometers' });
    return normalizeBearing(turf.bearing(p1, p2));
  }

  /**
   * Snap coordinates onto the RouteModel, preferring a local monotonic window
   * around hintDistKm to avoid jumping across overlapping highway/mountain loops.
   */
  function snapToRoute(routeModel, coords, hintDistKm = null, maxSnapMeters = 65) {
    if (!routeModel || !routeModel.line) return null;
    const pt = turf.point(coords);
    let snapped = null;
    let distAlongKm = 0;

    if (hintDistKm !== null && Number.isFinite(hintDistKm) && routeModel.totalKm > 0.6) {
      const winStart = clamp(hintDistKm - 0.15, 0, Math.max(0, routeModel.totalKm - 0.05));
      const winEnd = clamp(hintDistKm + 0.75, winStart + 0.05, routeModel.totalKm);
      try {
        const windowLine = turf.lineSliceAlong(routeModel.line, winStart, winEnd, {
          units: 'kilometers',
        });
        const localSnap = turf.nearestPointOnLine(windowLine, pt, { units: 'kilometers' });
        if (
          localSnap &&
          localSnap.properties &&
          localSnap.properties.dist * 1000 <= maxSnapMeters * 1.4
        ) {
          snapped = localSnap;
          distAlongKm = clamp(winStart + localSnap.properties.location, 0, routeModel.totalKm);
        }
      } catch (_err) {
        // fallback to full route below
      }
    }

    if (!snapped) {
      snapped = turf.nearestPointOnLine(routeModel.line, pt, { units: 'kilometers' });
      distAlongKm = clamp(snapped.properties.location || 0, 0, routeModel.totalKm);
    }

    const offsetMeters = (snapped.properties.dist || 0) * 1000;
    const isOnRoute = offsetMeters <= maxSnapMeters;
    const routeHeading = getRouteHeadingAt(routeModel, distAlongKm);

    return {
      snappedCoords: snapped.geometry.coordinates,
      distAlongKm,
      offsetMeters,
      isOnRoute,
      routeHeading,
    };
  }

  /**
   * Compute upcoming maneuver, next highway IC/JCT branch, and remaining totals.
   */
  function getNavigationProgress(routeModel, currentDistKm) {
    if (!routeModel || !routeModel.steps || routeModel.steps.length === 0) {
      return null;
    }

    const d = clamp(currentDistKm, 0, routeModel.totalKm);
    const remainingKm = Math.max(0, routeModel.totalKm - d);
    const remainingMeters = remainingKm * 1000;
    const progressRatio = routeModel.totalKm > 0 ? d / routeModel.totalKm : 0;
    const remainingSeconds = Math.max(0, routeModel.totalDurationSec * (1 - progressRatio));

    // Next active maneuver (skip initial 'depart' step once we have steps > 1)
    let nextStepIdx = routeModel.steps.findIndex(
      (s, i) => i > 0 && s.routeDistKm >= d - 0.015
    );
    if (nextStepIdx === -1) {
      nextStepIdx = routeModel.steps.length - 1;
    }

    const nextStep = routeModel.steps[nextStepIdx];
    const followingStep =
      nextStepIdx + 1 < routeModel.steps.length ? routeModel.steps[nextStepIdx + 1] : null;
    const distToStepMeters = Math.max(0, (nextStep.routeDistKm - d) * 1000);

    // Next highway IC / JCT / ramp / fork / merge step
    // Keep matching up to -45m past the maneuver so JCT 3D zoom clears smoothly after passing
    let branchStep = routeModel.steps.find(
      (s, i) => i > 0 && s.isHighwayBranch && (s.routeDistKm - d) * 1000 > -45
    );
    let isFallbackBranch = false;

    if (!branchStep) {
      // Fallback to next upcoming turn/arrive step so Highway HUD remains informative on any route
      branchStep =
        routeModel.steps.find(
          (s, i) =>
            i > 0 &&
            (s.maneuver.type === 'turn' ||
              s.maneuver.type === 'end of road' ||
              s.maneuver.type === 'roundabout' ||
              s.maneuver.type === 'arrive') &&
            (s.routeDistKm - d) * 1000 > -45
        ) || nextStep;
      isFallbackBranch = true;
    }

    const signedDistToBranchMeters = (branchStep.routeDistKm - d) * 1000;
    const distToBranchMeters = Math.max(0, signedDistToBranchMeters);

    return {
      currentDistKm: d,
      progressRatio,
      remainingMeters,
      remainingSeconds,
      nextStep,
      followingStep,
      distToStepMeters,
      nextBranch: branchStep,
      isFallbackBranch,
      distToBranchMeters,
      signedDistToBranchMeters,
      arrived: remainingMeters < 22,
    };
  }

  /**
   * Determine whether a step is an actionable City intersection turn maneuver.
   */
  function isCityTurnStep(step) {
    if (!step || !step.maneuver) return false;
    const type = (step.maneuver.type || '').toLowerCase();
    const mod = (step.maneuver.modifier || '').toLowerCase();
    if (type === 'depart') return false;
    const turnTypes = new Set([
      'turn',
      'end of road',
      'fork',
      'off ramp',
      'on ramp',
      'merge',
      'roundabout',
      'rotary',
      'exit roundabout',
      'exit rotary',
      'arrive',
    ]);
    if (turnTypes.has(type)) return true;
    return Boolean(mod && mod !== 'straight');
  }

  /**
   * Per-frame proximity auto-3D zoom evaluator using direct `turf.distance`
   * against every upcoming `routes[0].legs[0].steps[i].maneuver.location`.
   *
   * - City Mode: triggers <= 150m before intersection turn -> zoom 20.3, pitch 80
   * - Highway Mode: triggers <= 800m before JCT/IC/branch -> zoom 19.5, pitch 78
   * - Releases cleanly once passed (~30m City / ~45m Highway past maneuver).
   */
  function evaluateManeuverProximityZoom(
    routeModel,
    currentCoords,
    currentDistKm,
    modeId,
    currentlyActive,
    modeCfg,
    isSnappedToRoute = true
  ) {
    if (
      !routeModel ||
      !Array.isArray(routeModel.steps) ||
      routeModel.steps.length < 2 ||
      !Array.isArray(currentCoords) ||
      !modeCfg ||
      !modeCfg.closeZoomTriggerMeters
    ) {
      return {
        active: false,
        step: null,
        directDistMeters: Infinity,
        routeSignedMeters: Infinity,
        thresholdMeters: 0,
      };
    }

    const triggerM = modeCfg.closeZoomTriggerMeters;
    const releaseM = modeCfg.closeZoomReleaseMeters || triggerM * 1.15;
    const passClearM = modeCfg.closeZoomPassClearMeters || -35;
    const egoPt = turf.point(currentCoords);

    // Filter candidate steps from routes[0].legs[0].steps (skipping index 0 'depart')
    let candidates = [];
    for (let i = 1; i < routeModel.steps.length; i++) {
      const step = routeModel.steps[i];
      if (!step.maneuver || !Array.isArray(step.maneuver.location)) continue;

      const routeSignedMeters = (step.routeDistKm - currentDistKm) * 1000;
      // Skip maneuvers already passed when snapped to route
      if (isSnappedToRoute && routeSignedMeters <= passClearM) continue;

      const qualifies =
        modeId === 'highway' ? step.isHighwayBranch : isCityTurnStep(step);
      if (!qualifies) continue;

      const directDistMeters = turf.distance(
        egoPt,
        turf.point(step.maneuver.location),
        { units: 'meters' }
      );
      candidates.push({ step, directDistMeters, routeSignedMeters });
    }

    // Highway fallback: if route has no highway-tagged steps, use next turn/arrive step
    if (modeId === 'highway' && candidates.length === 0) {
      for (let i = 1; i < routeModel.steps.length; i++) {
        const step = routeModel.steps[i];
        if (!step.maneuver || !Array.isArray(step.maneuver.location)) continue;
        const routeSignedMeters = (step.routeDistKm - currentDistKm) * 1000;
        if (isSnappedToRoute && routeSignedMeters <= passClearM) continue;
        if (!isCityTurnStep(step)) continue;

        const directDistMeters = turf.distance(
          egoPt,
          turf.point(step.maneuver.location),
          { units: 'meters' }
        );
        candidates.push({ step, directDistMeters, routeSignedMeters });
      }
    }

    if (candidates.length === 0) {
      return {
        active: false,
        step: null,
        directDistMeters: Infinity,
        routeSignedMeters: Infinity,
        thresholdMeters: triggerM,
      };
    }

    // Pick the immediate upcoming maneuver (by route order if snapped, else closest direct distance)
    candidates.sort((a, b) =>
      isSnappedToRoute
        ? a.step.routeDistKm - b.step.routeDistKm
        : a.directDistMeters - b.directDistMeters
    );
    const nearest = candidates[0];

    // Use direct turf.distance for deterministic proximity triggering
    const effectiveDistM = nearest.directDistMeters;
    const isActive = currentlyActive
      ? effectiveDistM <= releaseM
      : effectiveDistM <= triggerM;

    return {
      active: isActive,
      step: nearest.step,
      directDistMeters: nearest.directDistMeters,
      routeSignedMeters: nearest.routeSignedMeters,
      thresholdMeters: triggerM,
    };
  }

  /**
   * Close-range dashcam/bumper camera zoom & pitch profiles:
   * - City:     normal 19.2 / 75°, intersection <=150m -> 20.3 / 80°
   * - Highway:  cruise 16.8 / 68° (subtle speed nuance), JCT <=800m -> 19.5 / 78°
   * - Mountain: normal 18.2 / 72°
   */
  function computeSpeedAdaptiveZoom(modeId, _speedKmh, isCloseZoomActive) {
    if (modeId === 'city') {
      return isCloseZoomActive ? 20.3 : 19.2;
    }

    if (modeId === 'highway') {
      return isCloseZoomActive ? 19.5 : 16.8;
    }

    // Mountain mode
    return isCloseZoomActive ? 19.5 : 18.2;
  }

  function computeTargetPitch(modeId, isCloseZoomActive) {
    if (modeId === 'city') return isCloseZoomActive ? 80 : 75;
    if (modeId === 'highway') return isCloseZoomActive ? 78 : 68;
    return isCloseZoomActive ? 78 : 72;
  }

  /**
   * Real-Route Rally Pace Note Curvature Analyzer (Mountain / Winding Mode).
   *
   * Samples the real route LineString uniformly ahead of currentDistKm using Turf.js
   * (100m–250m forward lookahead + active approach zone), calculates bearing changes
   * via turf.bearing and curvature radii, and outputs rally pace notes
   * (e.g. "HAIRPIN LEFT", "RIGHT R3").
   */
  function analyzeMountainPaceNote(routeModel, currentDistKm, options = {}) {
    if (!routeModel || !routeModel.line || routeModel.totalKm < 0.08) {
      return null;
    }

    const stepMeters = options.sampleStepMeters || 15;
    const minTrackMeters = options.minTrackMeters || 25;
    const lookaheadMinMeters = options.lookaheadMinMeters || 100;
    const lookaheadMaxMeters = options.lookaheadMaxMeters || 250;
    const maxSampleMeters = lookaheadMaxMeters + 60;

    const startKm = clamp(currentDistKm, 0, routeModel.totalKm);
    const availableAheadMeters = (routeModel.totalKm - startKm) * 1000;
    if (availableAheadMeters < 60) return null;

    const sampleLimitMeters = Math.min(maxSampleMeters, availableAheadMeters);
    const samples = [];

    for (let m = 0; m <= sampleLimitMeters; m += stepMeters) {
      const pt = turf.along(routeModel.line, startKm + m / 1000, { units: 'kilometers' });
      samples.push({ distM: m, point: pt });
    }
    if (samples.length < 4) return null;

    // Segment bearings & signed turning deltas between consecutive chords
    const bearings = [];
    for (let i = 0; i < samples.length - 1; i++) {
      bearings.push(normalizeBearing(turf.bearing(samples[i].point, samples[i + 1].point)));
    }

    const deltas = [];
    for (let i = 0; i < bearings.length - 1; i++) {
      deltas.push({
        distM: samples[i + 1].distM,
        deltaDeg: angleDiff(bearings[i], bearings[i + 1]),
      });
    }

    // Group contiguous same-sign turning deltas into physical corners
    const corners = [];
    let current = null;

    for (let i = 0; i < deltas.length; i++) {
      const { distM, deltaDeg } = deltas[i];
      const absD = Math.abs(deltaDeg);
      const sign = deltaDeg >= 0 ? 1 : -1;

      if (absD < 3.5) {
        if (current) {
          // Allow 1 small straightish sample inside a long sweeping bend
          current.gapCount += 1;
          if (current.gapCount > 1) {
            corners.push(current);
            current = null;
          }
        }
        continue;
      }

      if (!current) {
        current = {
          sign,
          startDistM: distM,
          endDistM: distM + stepMeters,
          totalTurnDeg: deltaDeg,
          maxStepTurnDeg: absD,
          peakDistM: distM,
          gapCount: 0,
        };
      } else if (current.sign === sign) {
        current.endDistM = distM + stepMeters;
        current.totalTurnDeg += deltaDeg;
        if (absD > current.maxStepTurnDeg) {
          current.maxStepTurnDeg = absD;
          current.peakDistM = distM;
        }
        current.gapCount = 0;
      } else {
        // Direction reversed (potential S-curve / chicane)
        corners.push(current);
        current = {
          sign,
          startDistM: distM,
          endDistM: distM + stepMeters,
          totalTurnDeg: deltaDeg,
          maxStepTurnDeg: absD,
          peakDistM: distM,
          gapCount: 0,
        };
      }
    }
    if (current) corners.push(current);

    // Filter corners relevant to the forward window (entry between 25m and 250m)
    // Strictly classifies into 4 Initial-D style tiers + direction:
    //   20° <= angle < 45°  -> EASY
    //   45° <= angle < 80°  -> MEDIUM
    //   80° <= angle < 130° -> HARD
    //   angle >= 130°       -> HAIRPIN
    //   angle < 20°         -> null (hidden)
    const evaluated = corners
      .filter((c) => c.startDistM >= minTrackMeters && c.startDistM <= lookaheadMaxMeters)
      .map((c) => {
        const absTurnDeg = Math.abs(c.totalTurnDeg);
        if (absTurnDeg < 20) return null;

        let tier = 'EASY';
        let severity = 1;
        if (absTurnDeg >= 130) {
          tier = 'HAIRPIN';
          severity = 4;
        } else if (absTurnDeg >= 80) {
          tier = 'HARD';
          severity = 3;
        } else if (absTurnDeg >= 45) {
          tier = 'MEDIUM';
          severity = 2;
        }

        const direction = c.sign > 0 ? 'right' : 'left';
        const dirEn = c.sign > 0 ? 'RIGHT' : 'LEFT';
        const inPrimaryLookahead =
          c.startDistM >= lookaheadMinMeters && c.startDistM <= lookaheadMaxMeters;

        const score = severity * 100 - c.startDistM * 0.25 + (inPrimaryLookahead ? 15 : 0);

        return {
          tier,
          grade: tier,
          severity,
          direction,
          dirEn,
          callout: `${dirEn} · ${tier}`,
          distanceMeters: Math.max(10, Math.round(c.startDistM / 10) * 10),
          rawDistanceMeters: c.startDistM,
          totalTurnDeg: Math.round(c.totalTurnDeg),
          absTurnDeg: Math.round(absTurnDeg),
          inPrimaryLookahead,
          score,
        };
      })
      .filter(Boolean);

    if (evaluated.length === 0) return null;

    evaluated.sort((a, b) => {
      if (a.rawDistanceMeters < 110 && b.rawDistanceMeters >= 150 && a.severity >= 2) return -1;
      if (b.rawDistanceMeters < 110 && a.rawDistanceMeters >= 150 && b.severity >= 2) return 1;
      return b.score - a.score;
    });

    return evaluated[0];
  }

  /**
   * Return the Directions API step the vehicle is currently traveling ON.
   */
  function getActiveRouteStep(routeModel, currentDistKm) {
    if (!routeModel || !Array.isArray(routeModel.steps) || routeModel.steps.length === 0) {
      return null;
    }
    let active = routeModel.steps[0];
    for (let i = 0; i < routeModel.steps.length; i++) {
      if (routeModel.steps[i].routeDistKm <= currentDistKm + 0.01) {
        active = routeModel.steps[i];
      } else {
        break;
      }
    }
    return active;
  }

  /**
   * Determine whether the vehicle is driving ON an elevated highway/bridge ('elevated'),
   * UNDER an overpass on a surface road ('underpass'), or on a regular surface road ('surface').
   *
   * Combines:
   *  - Active route step classes (`motorway`, `bridge`) & Highway mode
   *  - Rendered map features near ego position (`structure: 'bridge'`, `layer > 0`, bridge/viaduct layer IDs)
   *  - Manual debug override (`forceUnderpass`)
   */
  function classifyElevationState({ modeId, activeStep, renderedFeatures, forceUnderpass }) {
    if (forceUnderpass) {
      return { state: 'underpass', hasBridgeOverhead: true, isHighwayRoute: false };
    }

    const isHighwayRoute =
      modeId === 'highway' || Boolean(activeStep && activeStep.isMotorwayOrElevated);

    let hasBridgeFeature = false;
    if (Array.isArray(renderedFeatures)) {
      for (let i = 0; i < renderedFeatures.length; i++) {
        const f = renderedFeatures[i];
        if (!f) continue;
        const props = f.properties || {};
        const layerId = (f.layer && f.layer.id) || '';
        const structure = String(props.structure || '').toLowerCase();
        const roadClass = String(props.class || '').toLowerCase();
        const zLayer = Number(props.layer);

        if (
          structure === 'bridge' ||
          (Number.isFinite(zLayer) && zLayer > 0) ||
          /(bridge|elevated|viaduct|overpass)/i.test(layerId) ||
          (roadClass === 'motorway' && modeId !== 'highway')
        ) {
          hasBridgeFeature = true;
          break;
        }
      }
    }

    if (isHighwayRoute) {
      return { state: 'elevated', hasBridgeOverhead: hasBridgeFeature, isHighwayRoute: true };
    }

    if (hasBridgeFeature) {
      return { state: 'underpass', hasBridgeOverhead: true, isHighwayRoute: false };
    }

    return { state: 'surface', hasBridgeOverhead: false, isHighwayRoute: false };
  }

  /**
   * Advance vehicle pose during Dead Reckoning (自律航法) or Demo playback.
   * - With active snapped route: advances cleanly along the route GeoJSON via turf.along
   *   so curves inside tunnels never drift off the highway.
   * - Without route: extrapolates forward along last valid heading vector via turf.destination.
   */
  function advanceDeadReckoning(state, routeModel, dtSec) {
    const dt = clamp(dtSec || 0, 0, 1.5);
    const speedMps = Math.max(0, Number.isFinite(state.speedMps) ? state.speedMps : 0);
    const stepKm = (speedMps * dt) / 1000;

    if (routeModel && routeModel.line && state.isSnappedToRoute) {
      const baseDistKm = Number.isFinite(state.routeDistKm) ? state.routeDistKm : 0;
      const nextDistKm = clamp(baseDistKm + stepKm, 0, routeModel.totalKm);
      const nextPoint = turf.along(routeModel.line, nextDistKm, { units: 'kilometers' });
      const nextHeading = getRouteHeadingAt(routeModel, nextDistKm, 0.025);

      return {
        coords: nextPoint.geometry.coordinates,
        heading: nextHeading,
        routeDistKm: nextDistKm,
        mode: 'ROUTE_SNAP',
        movedMeters: stepKm * 1000,
        reachedEnd: nextDistKm >= routeModel.totalKm - 0.005,
      };
    }

    // Fallback: straight extrapolation along last valid heading
    const heading = normalizeBearing(state.heading || 0);
    const originPt = turf.point(state.coords);
    const nextPt =
      stepKm > 0
        ? turf.destination(originPt, stepKm, heading, { units: 'kilometers' })
        : originPt;

    return {
      coords: nextPt.geometry.coordinates,
      heading,
      routeDistKm: state.routeDistKm || 0,
      mode: 'VECTOR',
      movedMeters: stepKm * 1000,
      reachedEnd: false,
    };
  }

  /**
   * Build sliced remaining & traveled GeoJSON LineStrings for glowing progress route rendering.
   */
  function sliceRouteProgress(routeModel, currentDistKm) {
    if (!routeModel || !routeModel.line) return null;
    const d = clamp(currentDistKm, 0, routeModel.totalKm);

    const emptyLine = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [] },
      properties: {},
    };

    let traveled = emptyLine;
    let remaining = routeModel.line;

    try {
      if (d > 0.005 && d < routeModel.totalKm - 0.005) {
        traveled = turf.lineSliceAlong(routeModel.line, 0, d, { units: 'kilometers' });
        remaining = turf.lineSliceAlong(routeModel.line, d, routeModel.totalKm, {
          units: 'kilometers',
        });
      } else if (d >= routeModel.totalKm - 0.005) {
        traveled = routeModel.line;
        remaining = emptyLine;
      }
    } catch (_err) {
      remaining = routeModel.line;
    }

    return { traveled, remaining };
  }

  return {
    normalizeBearing,
    angleDiff,
    lerpBearing,
    clamp,
    formatDistanceJa,
    formatDurationJa,
    bearingToCompass,
    isHighwayBranchStep,
    isCityTurnStep,
    getManeuverKey,
    buildRouteModel,
    getRouteHeadingAt,
    snapToRoute,
    getNavigationProgress,
    evaluateManeuverProximityZoom,
    computeSpeedAdaptiveZoom,
    computeTargetPitch,
    analyzeMountainPaceNote,
    getActiveRouteStep,
    classifyElevationState,
    advanceDeadReckoning,
    sliceRouteProgress,
  };
});
