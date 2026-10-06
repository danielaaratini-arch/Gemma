"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, useGLTF } from "@react-three/drei";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  Box3,
  MathUtils,
  PerspectiveCamera,
  Vector3,
} from "three";
import { useLayoutEffect, useMemo, useRef } from "react";

function normalizeNodeName(name) {
  return String(name || "")
    .replace(/_\d+$/, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

function findBone(root, sourceName) {
  const wanted = normalizeNodeName(sourceName);
  let match;

  root.traverse((object) => {
    if (match || object.type !== "Bone") return;
    if (normalizeNodeName(object.name) === wanted) match = object;
  });

  return match;
}

function frameShoulderPortrait(model, camera, head, leftEye, rightEye) {
  model.updateMatrixWorld(true);

  const avatarBox = new Box3().setFromObject(model);
  if (avatarBox.isEmpty()) return;

  const avatarSize = avatarBox.getSize(new Vector3());
  const headPosition = head?.getWorldPosition(new Vector3());

  if (!headPosition) {
    const center = avatarBox.getCenter(new Vector3());
    camera.position.set(center.x, center.y, center.z + 3.8);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    return;
  }

  const headTopSpan = Math.max(
    avatarBox.max.y - headPosition.y,
    avatarSize.y * 0.07,
    0.01,
  );

  let eyeDistance = 0;
  let eyeCenterY = headPosition.y + headTopSpan * 0.25;
  let eyeCenterZ = headPosition.z;

  if (leftEye && rightEye) {
    const left = leftEye.getWorldPosition(new Vector3());
    const right = rightEye.getWorldPosition(new Vector3());
    eyeDistance = left.distanceTo(right);
    eyeCenterY = (left.y + right.y) * 0.5;
    eyeCenterZ = (left.z + right.z) * 0.5;
  }

  camera.fov = 32;
  const fov = MathUtils.degToRad(camera.fov);

  // Stesso criterio portrait di Alda: inquadratura testa + spalle,
  // evitando busto intero e tagli della sommità della testa.
  const portraitHeight = Math.max(
    headTopSpan * 3.45,
    avatarSize.y * 0.285,
    eyeDistance * 8.6,
  );

  const portraitWidth = Math.max(
    portraitHeight * 0.66,
    eyeDistance * 5.2,
  );

  const distanceForHeight =
    portraitHeight / (2 * Math.tan(fov / 2));
  const distanceForWidth =
    portraitWidth /
    (2 * Math.tan(fov / 2) * Math.max(camera.aspect, 0.01));

  const distance = Math.max(distanceForHeight, distanceForWidth) * 1.055;
  const target = new Vector3(
    headPosition.x,
    eyeCenterY - portraitHeight * 0.085,
    MathUtils.lerp(headPosition.z, eyeCenterZ, 0.35),
  );

  camera.near = Math.max(distance * 0.02, 0.005);
  camera.far = Math.max(distance + avatarSize.z * 6, camera.near + 10);
  camera.position.set(target.x, target.y, target.z + distance);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
}

function GemmaModel({ status }) {
  const gltf = useGLTF("/models/gemma.glb");
  const scene = useMemo(() => clone(gltf.scene), [gltf.scene]);
  const group = useRef();
  const { camera, size } = useThree();

  const head = useMemo(() => findBone(scene, "head"), [scene]);
  const leftEye = useMemo(
    () => findBone(scene, "eye.L") || findBone(scene, "eyeL"),
    [scene],
  );
  const rightEye = useMemo(
    () => findBone(scene, "eye.R") || findBone(scene, "eyeR"),
    [scene],
  );

  useLayoutEffect(() => {
    const model = group.current;
    if (!model) return;

    model.position.set(0, 0, 0);
    model.scale.setScalar(1);

    const perspectiveCamera = camera;
    if (!perspectiveCamera?.isPerspectiveCamera) return;

    frameShoulderPortrait(
      model,
      perspectiveCamera,
      head,
      leftEye,
      rightEye,
    );
  }, [camera, size.width, size.height, head, leftEye, rightEye]);

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
          status === "speaking"
            ? 0.05 + Math.abs(Math.sin(t * 9)) * 0.20
            : 0;
      }

      const smile = status === "idle" ? 0.09 : 0;
      if (smileLeft !== undefined) object.morphTargetInfluences[smileLeft] = smile;
      if (smileRight !== undefined) object.morphTargetInfluences[smileRight] = smile;
    });
  });

  return <group ref={group}><primitive object={scene} /></group>;
}

export default function GemmaAvatar({ status }) {
  return (
    <Canvas camera={{ position: [0, 0, 3], fov: 32 }} dpr={[1, 1.6]}>
      <ambientLight intensity={1.5} />
      <directionalLight position={[2, 3, 4]} intensity={2.4} />
      <directionalLight position={[-3, 1, 2]} intensity={1.2} />
      <GemmaModel status={status} />
      <Environment preset="studio" />
    </Canvas>
  );
}

useGLTF.preload("/models/gemma.glb");
