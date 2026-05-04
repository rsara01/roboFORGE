// Visual mesh for the quadrotor: a body, four arms with rotating prop discs,
// a small camera lens, and an LED ring whose color reflects state. Returns a
// Three.js Group that can be added to a scene and re-oriented with .quaternion
// + .position from the physics state each frame.

import * as THREE from 'three';

export function buildDroneMesh() {
  const grp = new THREE.Group();
  grp.name = 'drone';

  // Body.
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.06, 0.22),
    new THREE.MeshStandardMaterial({ color: 0x2c3340, roughness: 0.5, metalness: 0.4 })
  );
  body.castShadow = true;
  grp.add(body);

  // Four arms + prop nacelles.
  const armMat = new THREE.MeshStandardMaterial({ color: 0x394150, roughness: 0.6, metalness: 0.3 });
  const propMat = new THREE.MeshStandardMaterial({
    color: 0x1f242c, roughness: 0.9, metalness: 0.0,
    transparent: true, opacity: 0.55,
  });
  const offsets = [
    { x:  0.18, z:  0.18, ccw: true },
    { x: -0.18, z:  0.18, ccw: false },
    { x:  0.18, z: -0.18, ccw: false },
    { x: -0.18, z: -0.18, ccw: true },
  ];
  const props = [];
  for (const o of offsets) {
    const arm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.26, 8),
      armMat,
    );
    arm.rotation.z = Math.PI / 2;
    arm.rotation.y = Math.atan2(o.z, o.x);
    arm.position.set(o.x * 0.55, 0.0, o.z * 0.55);
    grp.add(arm);

    const motor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.04, 12),
      armMat,
    );
    motor.position.set(o.x, 0.04, o.z);
    grp.add(motor);

    const prop = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.085, 0.005, 24),
      propMat,
    );
    prop.position.set(o.x, 0.07, o.z);
    grp.add(prop);
    props.push({ mesh: prop, dir: o.ccw ? 1 : -1 });
  }

  // Camera lens (front).
  const lens = new THREE.Mesh(
    new THREE.SphereGeometry(0.020, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.2, metalness: 0.8, emissive: 0x002233, emissiveIntensity: 0.4 }),
  );
  lens.position.set(0, 0.005, 0.115);
  grp.add(lens);

  // LED status ring (under the body, glows green/red).
  const led = new THREE.Mesh(
    new THREE.TorusGeometry(0.06, 0.006, 8, 24),
    new THREE.MeshStandardMaterial({ color: 0x66ff99, emissive: 0x33aa66, emissiveIntensity: 1.2 }),
  );
  led.rotation.x = Math.PI / 2;
  led.position.y = -0.04;
  grp.add(led);

  return {
    group: grp,
    spinProps(dt, intensity) {
      for (const p of props) p.mesh.rotation.y += p.dir * (10 + intensity * 60) * dt;
    },
    setStatus(state) {
      const m = led.material;
      if (state === 'wrecked') { m.color.setHex(0xff4444); m.emissive.setHex(0xaa1111); }
      else if (state === 'hit') { m.color.setHex(0xffaa44); m.emissive.setHex(0xaa6611); }
      else { m.color.setHex(0x66ff99); m.emissive.setHex(0x33aa66); }
    },
  };
}
