"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, useGLTF } from "@react-three/drei";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import * as THREE from "three";
import { useEffect, useMemo, useRef } from "react";

function GemmaModel({ status }) {
  const gltf = useGLTF("/api/avatar");
  const scene = useMemo(() => clone(gltf.scene), [gltf.scene]);
  const group = useRef();

  useEffect(() => {
    scene.traverse((object) => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const replacements = materials.map((material) => {
        if (!material) return material;
        const copy = material.clone();
        if ((copy.name || "").toLowerCase().includes("long01")) {
          copy.map = null;
          copy.color = new THREE.Color("#d8b86a");
          copy.roughness = 0.72;
          copy.metalness = 0.02;
          copy.needsUpdate = true;
        }
        return copy;
      });
      object.material = Array.isArray(object.material) ? replacements : replacements[0];
    });
  }, [scene]);

  useFrame(({ clock }) => {
    if (!group.current) return;
    const t = clock.getElapsedTime();
    group.current.rotation.y = Math.sin(t * 0.45) * 0.018;
    group.current.rotation.x = Math.sin(t * 0.34) * 0.006;

    scene.traverse((object) => {
      if (!object.morphTargetDictionary || !object.morphTargetInfluences) return;
      const jaw = object.morphTargetDictionary.jawOpen;
      const smileLeft = object.morphTargetDictionary.mouthSmileLeft;
      const smileRight = object.morphTargetDictionary.mouthSmileRight;

      if (jaw !== undefined) {
        object.morphTargetInfluences[jaw] =
          status === "speaking" ? 0.05 + Math.abs(Math.sin(t * 9)) * 0.20 : 0;
      }

      const smile = status === "idle" ? 0.09 : 0;
      if (smileLeft !== undefined) object.morphTargetInfluences[smileLeft] = smile;
      if (smileRight !== undefined) object.morphTargetInfluences[smileRight] = smile;
    });
  });

  return (
    <group ref={group} position={[0, -1.72, 0]} scale={1.66}>
      <primitive object={scene} />
    </group>
  );
}

export default function GemmaAvatar({ status }) {
  return (
    <Canvas camera={{ position: [0, 0.18, 4.6], fov: 26 }} dpr={[1, 1.6]}>
      <ambientLight intensity={1.5} />
      <directionalLight position={[2, 3, 4]} intensity={2.4} />
      <directionalLight position={[-3, 1, 2]} intensity={1.2} />
      <GemmaModel status={status} />
      <Environment preset="studio" />
    </Canvas>
  );
}
