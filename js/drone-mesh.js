// Visual mesh for the octocopter: a body, 8 radial arms with motors and
// rotating prop discs, a small camera lens, and an LED ring whose color
// reflects state. Returns a Three.js Group that can be added to a scene
// and re-oriented with .quaternion + .position from the physics state
// each frame.
//
// Layout matches drone-physics.js: 8 motors evenly spaced 45° apart in
// the body XZ plane, indexed CCW starting at +X. Even-indexed motors spin
// CCW (visual), odd-indexed CW.

import * as THREE from 'three';

export function buildDroneMesh() {
  const grp = new THREE.Group();
  grp.name = 'drone';

  // Geometry scale knob — keep this in step with physics.armLength so the
  // prop discs sit roughly where the physics motors live.
  const armReach = 0.40;          // matches DronePhysics.armLength
  const bodyW = 0.34;
  const bodyH = 0.10;
  const bodyD = 0.34;

  // ---- materials ------------------------------------------------------
  const RED       = 0xc41e1a;
  const RED_DARK  = 0x6e0e0c;
  const BLACK     = 0x141618;
  const STEEL     = 0x2a3038;
  const bodyMat = new THREE.MeshStandardMaterial({
    color: RED, roughness: 0.45, metalness: 0.45,
    emissive: RED_DARK, emissiveIntensity: 0.25,
  });
  const armMat = new THREE.MeshStandardMaterial({
    color: STEEL, roughness: 0.55, metalness: 0.4,
  });
  const motorMat = new THREE.MeshStandardMaterial({
    color: BLACK, roughness: 0.45, metalness: 0.7,
  });
  const propMat = new THREE.MeshStandardMaterial({
    color: 0x1a1f26, roughness: 0.85, metalness: 0.0,
    transparent: true, opacity: 0.55,
  });

  // ---- central body ---------------------------------------------------
  const body = new THREE.Mesh(new THREE.BoxGeometry(bodyW, bodyH, bodyD), bodyMat);
  body.castShadow = true;
  body.receiveShadow = true;
  grp.add(body);

  // Aerodynamic dome on top.
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(bodyW * 0.45, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    bodyMat,
  );
  dome.position.y = bodyH * 0.5;
  dome.castShadow = true;
  grp.add(dome);

  // Underbelly battery pack (dark).
  const belly = new THREE.Mesh(
    new THREE.BoxGeometry(bodyW * 0.55, 0.05, bodyD * 0.7),
    new THREE.MeshStandardMaterial({ color: 0x1c2026, roughness: 0.7 }),
  );
  belly.position.y = -bodyH * 0.5 - 0.025;
  belly.castShadow = true;
  grp.add(belly);

  // ---- 8 arms + motors + props ---------------------------------------
  const props = [];
  const armGeo = new THREE.CylinderGeometry(0.022, 0.022, armReach, 10);
  const motorGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.06, 14);
  const motorTopGeo = new THREE.CylinderGeometry(0.038, 0.05, 0.012, 14);
  const propGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.005, 28);

  for (let i = 0; i < 8; i++) {
    const theta = (i * Math.PI * 2) / 8;
    const dir = new THREE.Vector3(Math.cos(theta), 0, Math.sin(theta));

    // Arm — orient the cylinder's local +Y to point in `dir`, then push it
    // halfway out so the cylinder spans from body center to the motor.
    const arm = new THREE.Mesh(armGeo, armMat);
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    arm.position.copy(dir).multiplyScalar(armReach * 0.5);
    arm.castShadow = true;
    grp.add(arm);

    // Motor housing at the arm tip.
    const motorPos = dir.clone().multiplyScalar(armReach);
    const motor = new THREE.Mesh(motorGeo, motorMat);
    motor.position.copy(motorPos);
    motor.position.y += 0.04;
    motor.castShadow = true;
    grp.add(motor);

    // Red cap on the motor (color-coded so 8 motors are all visible).
    const cap = new THREE.Mesh(motorTopGeo, bodyMat);
    cap.position.copy(motor.position);
    cap.position.y += 0.04;
    grp.add(cap);

    // Prop disc.
    const prop = new THREE.Mesh(propGeo, propMat);
    prop.position.copy(motorPos);
    prop.position.y += 0.085;
    grp.add(prop);
    props.push({ mesh: prop, dir: (i % 2 === 0) ? 1 : -1 });
  }

  // ---- camera lens (forward, body +Z) --------------------------------
  const lens = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 14, 12),
    new THREE.MeshStandardMaterial({
      color: 0x111418, roughness: 0.2, metalness: 0.8,
      emissive: 0x002233, emissiveIntensity: 0.5,
    }),
  );
  lens.position.set(0, 0.01, bodyD * 0.5 + 0.015);
  grp.add(lens);

  // ---- LED status ring under the body --------------------------------
  const led = new THREE.Mesh(
    new THREE.TorusGeometry(0.12, 0.009, 8, 28),
    new THREE.MeshStandardMaterial({
      color: 0x66ff99, emissive: 0x33aa66, emissiveIntensity: 1.4,
    }),
  );
  led.rotation.x = Math.PI / 2;
  led.position.y = -bodyH * 0.5 - 0.06;
  grp.add(led);

  return {
    group: grp,
    spinProps(dt, intensity) {
      const rate = (12 + intensity * 80);
      for (const p of props) p.mesh.rotation.y += p.dir * rate * dt;
    },
    setStatus(state) {
      const m = led.material;
      if (state === 'wrecked')   { m.color.setHex(0xff4444); m.emissive.setHex(0xaa1111); }
      else if (state === 'hit')  { m.color.setHex(0xffaa44); m.emissive.setHex(0xaa6611); }
      else                       { m.color.setHex(0x66ff99); m.emissive.setHex(0x33aa66); }
    },
  };
}
