/**
 * AERO-DRIVE 3D Ego Vehicle Layer (Three.js Custom WebGL 3D Layer for Mapbox GL JS v3)
 *
 * Renders a sculpted 3D sports-sedan directly inside Mapbox's WebGL 3D world space:
 *  - Metallic pearl body, tinted panoramic cabin/windshield glass, 4 wheels + rims, LED headlights & tail-light bar
 *  - Origin pivot mathematically clamped to tire ground-contact plane (bottom Y=0 -> road surface Z=0)
 *  - Base altitude strictly uses `map.queryTerrainElevation(lngLat, { exaggerated: false }) || 0`
 *  - Supports real-time user height fine-tuning offset (`heightOffsetM`: -5m .. +20m) from Settings
 *  - Translucent X-Ray silhouette pass when driving under an overpass (underpass see-through mode)
 *  - Amber tail-light accent when operating in Dead Reckoning (自律航法中)
 */
(function (root) {
  'use strict';

  function createCar3DLayer(options = {}) {
    const layerId = options.id || 'ego-car-3d-layer';

    const pose = {
      lng: (options.initialCoords && options.initialCoords[0]) || 139.701636,
      lat: (options.initialCoords && options.initialCoords[1]) || 35.658034,
      heading: Number.isFinite(options.initialHeading) ? options.initialHeading : 0,
      terrainElevationM: 0,
      heightOffsetM: Number.isFinite(options.initialHeightOffsetM) ? options.initialHeightOffsetM : 0,
      altitudeM: 0,
      isDeadReckoning: false,
      underpassSeeThrough: false,
    };

    let mapRef = null;
    let camera = null;
    let scene = null;
    let xrayScene = null;
    let renderer = null;
    let carGroup = null;
    let xrayGroup = null;
    let tailLightMat = null;
    let initialized = false;

    /**
     * Build the 3D sedan mesh and shift its vertical pivot so the lowest tire
     * contact point rests strictly on local Y = 0.000 (road surface Z = 0).
     */
    function buildDetailedSedanGroup(THREE, isXray) {
      const rootGroup = new THREE.Group();
      const vehicleMesh = new THREE.Group();

      const bodyMat = isXray
        ? new THREE.MeshBasicMaterial({
            color: 0x60a5fa,
            transparent: true,
            opacity: 0.36,
            depthTest: false,
            depthWrite: false,
            side: THREE.DoubleSide,
          })
        : new THREE.MeshStandardMaterial({
            color: 0xe6ecf5,
            metalness: 0.55,
            roughness: 0.28,
            side: THREE.DoubleSide,
          });

      const chassisMat = isXray
        ? bodyMat
        : new THREE.MeshStandardMaterial({
            color: 0x161922,
            metalness: 0.3,
            roughness: 0.7,
            side: THREE.DoubleSide,
          });

      const glassMat = isXray
        ? new THREE.MeshBasicMaterial({
            color: 0x93c5fd,
            transparent: true,
            opacity: 0.48,
            depthTest: false,
            depthWrite: false,
            side: THREE.DoubleSide,
          })
        : new THREE.MeshStandardMaterial({
            color: 0x0f172a,
            metalness: 0.85,
            roughness: 0.14,
            side: THREE.DoubleSide,
          });

      const wheelMat = isXray
        ? bodyMat
        : new THREE.MeshStandardMaterial({
            color: 0x141519,
            roughness: 0.85,
            metalness: 0.15,
            side: THREE.DoubleSide,
          });

      const rimMat = isXray
        ? bodyMat
        : new THREE.MeshStandardMaterial({
            color: 0x94a3b8,
            metalness: 0.75,
            roughness: 0.25,
            side: THREE.DoubleSide,
          });

      const headlightMat = new THREE.MeshBasicMaterial({
        color: 0xf8fafc,
        depthTest: !isXray,
        side: THREE.DoubleSide,
      });

      const localTailMat = new THREE.MeshBasicMaterial({
        color: 0xef4444,
        depthTest: !isXray,
        side: THREE.DoubleSide,
      });
      if (!isXray) {
        tailLightMat = localTailMat;
      }

      // Local dimensions in meters (tire ground contact bottom strictly clamped to Y = 0):
      //  X = width (-0.98..+0.98)
      //  Y = height above road surface (0.00 tire bottom .. 1.42 roof)
      //  Z = length (-2.35 front .. +2.35 rear)

      // 1. Lower chassis skirt / splitter
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.26, 4.62), chassisMat);
      skirt.position.set(0, 0.34, 0);
      vehicleMesh.add(skirt);

      // 2. Main sculpted lower body hull
      const mainBody = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.50, 4.52), bodyMat);
      mainBody.position.set(0, 0.66, 0);
      vehicleMesh.add(mainBody);

      // 3. Tapered front nose / hood section
      const frontHood = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.24, 1.38), bodyMat);
      frontHood.position.set(0, 0.88, -1.50);
      frontHood.rotation.x = 0.08;
      vehicleMesh.add(frontHood);

      // 4. Rear deck / trunk lip
      const rearDeck = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.22, 0.96), bodyMat);
      rearDeck.position.set(0, 0.92, 1.66);
      rearDeck.rotation.x = -0.05;
      vehicleMesh.add(rearDeck);

      // 5. Cabin greenhouse (panoramic tinted glass block)
      const cabinGlass = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.48, 2.24), glassMat);
      cabinGlass.position.set(0, 1.12, 0.08);
      vehicleMesh.add(cabinGlass);

      // 6. Sloped windshield wedge (front)
      const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.54, 0.44, 0.78), glassMat);
      windshield.position.set(0, 1.07, -1.04);
      windshield.rotation.x = 0.44;
      vehicleMesh.add(windshield);

      // 7. Sloped fastback rear glass
      const rearGlass = new THREE.Mesh(new THREE.BoxGeometry(1.54, 0.42, 0.82), glassMat);
      rearGlass.position.set(0, 1.08, 1.18);
      rearGlass.rotation.x = -0.40;
      vehicleMesh.add(rearGlass);

      // 8. Metallic roof cap
      const roof = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.08, 1.66), bodyMat);
      roof.position.set(0, 1.38, 0.08);
      vehicleMesh.add(roof);

      // 9. Side mirrors
      const mirrorGeo = new THREE.BoxGeometry(0.24, 0.12, 0.16);
      const mirrorL = new THREE.Mesh(mirrorGeo, bodyMat);
      mirrorL.position.set(-1.05, 0.96, -0.68);
      const mirrorR = new THREE.Mesh(mirrorGeo, bodyMat);
      mirrorR.position.set(1.05, 0.96, -0.68);
      vehicleMesh.add(mirrorL, mirrorR);

      // 10. Four 3D Wheels + Rims (tire radius 0.34 centered at Y = 0.34 -> bottom at exact Y = 0.00)
      const wheelRadius = 0.34;
      const wheelGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.26, 16);
      const rimGeo = new THREE.CylinderGeometry(0.20, 0.20, 0.28, 12);
      const wheelPositions = [
        [-0.94, wheelRadius, -1.42],
        [0.94, wheelRadius, -1.42],
        [-0.94, wheelRadius, 1.42],
        [0.94, wheelRadius, 1.42],
      ];
      wheelPositions.forEach(([wx, wy, wz]) => {
        const tire = new THREE.Mesh(wheelGeo, wheelMat);
        tire.rotation.z = Math.PI / 2;
        tire.position.set(wx, wy, wz);
        const rim = new THREE.Mesh(rimGeo, rimMat);
        rim.rotation.z = Math.PI / 2;
        rim.position.set(wx, wy, wz);
        vehicleMesh.add(tire, rim);
      });

      // 11. Dual LED Headlights (front -Z)
      const hlGeo = new THREE.BoxGeometry(0.44, 0.12, 0.08);
      const hlL = new THREE.Mesh(hlGeo, headlightMat);
      hlL.position.set(-0.66, 0.72, -2.28);
      const hlR = new THREE.Mesh(hlGeo, headlightMat);
      hlR.position.set(0.66, 0.72, -2.28);
      vehicleMesh.add(hlL, hlR);

      // 12. Full-width LED Tail-light Bar (rear +Z)
      const tailBar = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.11, 0.08), localTailMat);
      tailBar.position.set(0, 0.79, 2.28);
      vehicleMesh.add(tailBar);

      // Mathematically clamp lowest vertex (tire contact bottom) strictly to local Y = 0.000
      vehicleMesh.updateMatrixWorld(true);
      const bbox = new THREE.Box3().setFromObject(vehicleMesh);
      if (Number.isFinite(bbox.min.y)) {
        vehicleMesh.position.y = -bbox.min.y;
      }
      rootGroup.add(vehicleMesh);

      // Ground contact shadow placed directly at road plane (1.5cm anti-z-fighting epsilon)
      if (!isXray) {
        const shadowGeo = new THREE.PlaneGeometry(2.35, 5.05);
        const shadowMat = new THREE.MeshBasicMaterial({
          color: 0x000000,
          transparent: true,
          opacity: 0.44,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const shadow = new THREE.Mesh(shadowGeo, shadowMat);
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.set(0, 0.015, 0);
        rootGroup.add(shadow);
      }

      return rootGroup;
    }

    function queryExactGroundElevation(lng, lat) {
      if (!mapRef || typeof mapRef.queryTerrainElevation !== 'function') {
        return 0;
      }
      try {
        return mapRef.queryTerrainElevation([lng, lat], { exaggerated: false }) || 0;
      } catch (_err) {
        return 0;
      }
    }

    const customLayer = {
      id: layerId,
      type: 'custom',
      renderingMode: '3d',

      onAdd: function (map, gl) {
        mapRef = map;
        if (!root.THREE) return;
        const THREE = root.THREE;

        camera = new THREE.Camera();
        scene = new THREE.Scene();
        xrayScene = new THREE.Scene();

        // Studio night-cockpit lighting for crisp metallic shading
        const ambient = new THREE.AmbientLight(0xdbeafe, 0.95);
        scene.add(ambient);

        const hemi = new THREE.HemisphereLight(0xe0f2fe, 0x1e293b, 0.85);
        scene.add(hemi);

        const keyLight = new THREE.DirectionalLight(0xffffff, 1.15);
        keyLight.position.set(18, 42, 26);
        scene.add(keyLight);

        const rimLight = new THREE.DirectionalLight(0x60a5fa, 0.75);
        rimLight.position.set(-22, 18, -30);
        scene.add(rimLight);

        carGroup = buildDetailedSedanGroup(THREE, false);
        scene.add(carGroup);

        xrayGroup = buildDetailedSedanGroup(THREE, true);
        xrayScene.add(xrayGroup);

        renderer = new THREE.WebGLRenderer({
          canvas: map.getCanvas(),
          context: gl,
          antialias: true,
        });
        renderer.autoClear = false;
        initialized = true;
      },

      render: function (_gl, matrix) {
        if (!initialized || !root.THREE || !renderer || !scene || !camera) return;
        const THREE = root.THREE;

        // Exact terrain elevation + user fine-tune height offset slider (-5m .. +20m)
        const terrainElev = queryExactGroundElevation(pose.lng, pose.lat);
        const totalElevation = terrainElev + pose.heightOffsetM;
        pose.terrainElevationM = terrainElev;
        pose.altitudeM = totalElevation;

        const merc = mapboxgl.MercatorCoordinate.fromLngLat([pose.lng, pose.lat], totalElevation);
        const meterScale = merc.meterInMercatorCoordinateUnits();

        // True-to-lane-scale at close zooms (19-20.4) and smoothly readable at highway zoom (16.8)
        // Because vehicle pivot is tire bottom (Y=0), scaling preserves exact road contact at Z=0
        const zoom = mapRef ? mapRef.getZoom() : 19.2;
        const visualScale = zoom >= 19.0 ? 1.12 : Math.min(2.8, Math.pow(2, (19.0 - zoom) * 0.52) * 1.12);
        const s = meterScale * visualScale;

        // Map car local space (+X right, +Y up from tire bottom Y=0, -Z front)
        // into Mercator space (+X East, -Y North, +Z Up from road elevation)
        const headingRad = (pose.heading * Math.PI) / 180;
        const rotX = new THREE.Matrix4().makeRotationAxis(
          new THREE.Vector3(1, 0, 0),
          Math.PI / 2
        );
        const rotZ = new THREE.Matrix4().makeRotationAxis(
          new THREE.Vector3(0, 0, 1),
          -headingRad
        );

        const modelMatrix = new THREE.Matrix4()
          .makeTranslation(merc.x, merc.y, merc.z)
          .scale(new THREE.Vector3(s, -s, s))
          .multiply(rotZ)
          .multiply(rotX);

        const m = new THREE.Matrix4().fromArray(matrix);
        camera.projectionMatrix = m.multiply(modelMatrix);

        if (tailLightMat) {
          tailLightMat.color.setHex(pose.isDeadReckoning ? 0xf59e0b : 0xef4444);
        }

        renderer.resetState();

        // When under an overpass, render subtle translucent X-Ray silhouette pass first (depthTest: false)
        if (pose.underpassSeeThrough && xrayScene) {
          renderer.render(xrayScene, camera);
          renderer.resetState();
        }

        renderer.render(scene, camera);
      },

      onRemove: function () {
        initialized = false;
        if (renderer) {
          try {
            renderer.dispose();
          } catch (_err) {}
          renderer = null;
        }
        scene = null;
        xrayScene = null;
        camera = null;
        carGroup = null;
        xrayGroup = null;
        tailLightMat = null;
      },
    };

    return {
      layer: customLayer,
      updatePose: function (next) {
        if (!next) return;
        let changed = false;
        if (Number.isFinite(next.lng) && next.lng !== pose.lng) {
          pose.lng = next.lng;
          changed = true;
        }
        if (Number.isFinite(next.lat) && next.lat !== pose.lat) {
          pose.lat = next.lat;
          changed = true;
        }
        if (Number.isFinite(next.heading) && next.heading !== pose.heading) {
          pose.heading = next.heading;
          changed = true;
        }
        if (Number.isFinite(next.heightOffsetM) && next.heightOffsetM !== pose.heightOffsetM) {
          pose.heightOffsetM = next.heightOffsetM;
          changed = true;
        }
        if (typeof next.isDeadReckoning === 'boolean' && next.isDeadReckoning !== pose.isDeadReckoning) {
          pose.isDeadReckoning = next.isDeadReckoning;
          changed = true;
        }
        if (
          typeof next.underpassSeeThrough === 'boolean' &&
          next.underpassSeeThrough !== pose.underpassSeeThrough
        ) {
          pose.underpassSeeThrough = next.underpassSeeThrough;
          changed = true;
        }
        if (changed && mapRef) {
          pose.terrainElevationM = queryExactGroundElevation(pose.lng, pose.lat);
          pose.altitudeM = pose.terrainElevationM + pose.heightOffsetM;
          mapRef.triggerRepaint();
        }
      },
      getPose: function () {
        return { ...pose };
      },
      getGroundOffsetStats: function () {
        if (!carGroup || !root.THREE) return null;
        const THREE = root.THREE;
        carGroup.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(carGroup);
        return { minY: Number(box.min.y.toFixed(4)), maxY: Number(box.max.y.toFixed(4)) };
      },
    };
  }

  root.Car3DLayer = { createCar3DLayer };
})(typeof self !== 'undefined' ? self : this);
