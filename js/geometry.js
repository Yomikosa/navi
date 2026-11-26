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
   * Hysteresis state transition for Highway Mode JCT/IC 1.0km auto 3D zoom.
   */
  function evaluateHighwayJctZoom(navProgress, currentlyActive, cfg) {
    const triggerM = (cfg && cfg.jctTriggerMeters) || 1000;
    const releaseM = (cfg && cfg.jctReleaseMeters) || 1180;
    const passClearM = (cfg && cfg.jctPassClearMeters) || -45;

    if (!navProgress || !navProgress.nextBranch) {
      return { active: false, branch: null, distMeters: Infinity };
    }

    const signedDist = navProgress.signedDistToBranchMeters;
    const distM = Math.max(0, signedDist);

    if (!currentlyActive) {
      const shouldActivate = signedDist <= triggerM && signedDist > passClearM;
      return {
        active: shouldActivate,
        branch: navProgress.nextBranch,
        distMeters: distM,
      };
    } else {
      // Stay active while passing through junction until passed or next branch is > releaseM away
      const shouldStayActive = signedDist <= releaseM && signedDist > passClearM;
      return {
        active: shouldStayActive,
        branch: navProgress.nextBranch,
        distMeters: distM,
      };
    }
  }

  /**
   * Speed-adaptive cruise zoom for Highway Mode (14.0–15.0) and City Mode (17.0–18.0).
   */
  function computeSpeedAdaptiveZoom(modeId, speedKmh, isJctZoomActive) {
    const v = clamp(Number.isFinite(speedKmh) ? speedKmh : 0, 0, 180);

    if (modeId === 'highway') {
      if (isJctZoomActive) return 17.5;
      // 0–50 km/h -> 15.0, 50–140 km/h -> smoothly eases 15.0 down to 14.0
      const t = clamp((v - 40) / 100, 0, 1);
      return Number((15.0 - t * 1.0).toFixed(3));
    }

    if (modeId === 'city') {
      // 0–60 km/h -> smoothly eases 17.9 down to 17.1 (strictly within 17–18)
      const t = clamp(v / 65, 0, 1);
      return Number((17.9 - t * 0.8).toFixed(3));
    }

    // mountain mode: slightly wider view at higher speeds
    const t = clamp((v - 25) / 80, 0, 1);
    return Number((16.2 - t * 0.6).toFixed(3));
  }

  /**
   * Real-Route Rally Pace Note Curvature Analyzer (Mountain / Winding Mode).
   *
   * Samples the real route LineString uniformly ahead of currentDistKm using Turf.js
   * (focusing on 100m–300m lookahead + 25m–100m active approach zone), calculates
   * bearing changes (azimuth deltas) and curvature radii, and outputs rally-style
   * pace note warnings (R1 Hairpin -> R4 Medium Curve + S-Curve chicane detection).
   */
  function analyzeMountainPaceNote(routeModel, currentDistKm, options = {}) {
    if (!routeModel || !routeModel.line || routeModel.totalKm < 0.08) {
      return null;
    }

    const stepMeters = options.sampleStepMeters || 15;
    const minTrackMeters = options.minTrackMeters || 25;
    const lookaheadMinMeters = options.lookaheadMinMeters || 100;
    const lookaheadMaxMeters = options.lookaheadMaxMeters || 300;
    const maxSampleMeters = lookaheadMaxMeters + 60; // extra buffer to finish measuring curves starting near 300m

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

    // Filter corners relevant to the forward window (entry between 25m and 300m)
    const evaluated = corners
      .filter((c) => c.startDistM >= minTrackMeters && c.startDistM <= lookaheadMaxMeters)
      .map((c) => {
        const absTurnDeg = Math.abs(c.totalTurnDeg);
        const arcLengthM = Math.max(stepMeters, c.endDistM - c.startDistM);
        const turnRad = (absTurnDeg * Math.PI) / 180;
        const radiusM = turnRad > 0.01 ? arcLengthM / turnRad : 999;
        // Max 30m local rate (sharpness proxy)
        const sharpLocalDeg = c.maxStepTurnDeg * 2;

        let grade = null;
        let severity = 0;
        let label = '';

        if (absTurnDeg >= 105 || (absTurnDeg >= 80 && radiusM <= 35) || sharpLocalDeg >= 68) {
          grade = 'R1';
          severity = 4;
          label = 'ヘアピン注意';
        } else if (absTurnDeg >= 68 || (absTurnDeg >= 52 && radiusM <= 65) || sharpLocalDeg >= 48) {
          grade = 'R2';
          severity = 3;
          label = '急カーブ注意';
        } else if (absTurnDeg >= 42 || (absTurnDeg >= 32 && radiusM <= 115) || sharpLocalDeg >= 32) {
          grade = 'R3';
          severity = 2;
          label = '急カーブ';
        } else if (absTurnDeg >= 26) {
          grade = 'R4';
          severity = 1;
          label = '中カーブ';
        }

        if (!grade) return null;

        const direction = c.sign > 0 ? 'right' : 'left';
        const directionJa = c.sign > 0 ? '右' : '左';
        const inPrimaryLookahead =
          c.startDistM >= lookaheadMinMeters && c.startDistM <= lookaheadMaxMeters;

        // Priority score favors severity & closeness
        const score = severity * 100 - c.startDistM * 0.25 + (inPrimaryLookahead ? 15 : 0);

        return {
          grade,
          severity,
          direction,
          directionJa,
          label,
          distanceMeters: Math.max(10, Math.round(c.startDistM / 10) * 10),
          rawDistanceMeters: c.startDistM,
          peakDistM: c.peakDistM,
          endDistM: c.endDistM,
          totalTurnDeg: Math.round(c.totalTurnDeg),
          absTurnDeg: Math.round(absTurnDeg),
          radiusMeters: Math.round(radiusM),
          inPrimaryLookahead,
          score,
        };
      })
      .filter(Boolean);

    if (evaluated.length === 0) return null;

    // Pick closest severe curve; if two curves exist, prefer the immediate hazard
    evaluated.sort((a, b) => {
      // If one is imminent (<120m) and severe, surface it first
      if (a.rawDistanceMeters < 120 && b.rawDistanceMeters >= 150 && a.severity >= 2) return -1;
      if (b.rawDistanceMeters < 120 && a.rawDistanceMeters >= 150 && b.severity >= 2) return 1;
      return b.score - a.score;
    });

    const primary = evaluated[0];

    // Check for S-Curve (opposite direction bend following closely within 130m)
    const followOpposite = evaluated.find(
      (c) =>
        c !== primary &&
        c.direction !== primary.direction &&
        c.rawDistanceMeters > primary.rawDistanceMeters &&
        c.rawDistanceMeters - primary.endDistM <= 130 &&
        c.absTurnDeg >= 32
    );

    const hasChicane = Boolean(followOpposite);
    const headline = `${primary.distanceMeters}m先 ${primary.directionJa}${primary.label}（${primary.grade}）`;
    const subline = hasChicane
      ? `連続S字（次:${followOpposite.directionJa}${followOpposite.grade}） · 曲角 ${primary.absTurnDeg}° · 推定R ${primary.radiusMeters}m`
      : `曲角 ${primary.absTurnDeg}° · 推定曲率半径 R≈${primary.radiusMeters}m`;

    return {
      ...primary,
      hasChicane,
      headline,
      subline,
    };
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
    getManeuverKey,
    buildRouteModel,
    getRouteHeadingAt,
    snapToRoute,
    getNavigationProgress,
    evaluateHighwayJctZoom,
    computeSpeedAdaptiveZoom,
    analyzeMountainPaceNote,
    advanceDeadReckoning,
    sliceRouteProgress,
  };
});
