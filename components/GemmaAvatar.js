"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, useGLTF } from "@react-three/drei";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  Box3,
  Color,
  MathUtils,
  Vector3,
} from "three";
import {
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { getGemmaAudioLevel } from "./gemmaAudioLevel";

const BLOUSE_MATERIAL =
  "Alda.camicetta.rosa_cipria.v4";
const BLOUSE_COLOR = new Color("#287b70");

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
    if (normalizeNodeName(object.name) === wanted) {
      match = object;
    }
  });

  return match;
}

function tintBlouse(scene) {
  scene.traverse((object) => {
    if (!object.isMesh || !object.material) return;

    const original = Array.isArray(object.material)
      ? object.material
      : [object.material];

    const materials = original.map((material) => {
      const copy = material.clone();
      const name = String(copy.name || "");

      if (
        name === BLOUSE_MATERIAL ||
        name.toLowerCase().includes("camicetta")
      ) {
        copy.color?.copy(BLOUSE_COLOR);
        copy.needsUpdate = true;
      }

      return copy;
    });

    object.material = Array.isArray(object.material)
      ? materials
      : materials[0];
  });
}

function frameShoulderPortrait(
  model,
  camera,
  head,
  leftEye,
  rightEye,
) {
  model.updateMatrixWorld(true);

  const avatarBox = new Box3().setFromObject(model);
  if (avatarBox.isEmpty()) return;

  const avatarSize =
    avatarBox.getSize(new Vector3());
  const headPosition =
    head?.getWorldPosition(new Vector3());

  if (!headPosition) {
    const center =
      avatarBox.getCenter(new Vector3());
    camera.position.set(
      center.x,
      center.y,
      center.z + 3.8,
    );
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
  let eyeCenterY =
    headPosition.y + headTopSpan * 0.25;
  let eyeCenterZ = headPosition.z;

  if (leftEye && rightEye) {
    const left =
      leftEye.getWorldPosition(new Vector3());
    const right =
      rightEye.getWorldPosition(new Vector3());

    eyeDistance = left.distanceTo(right);
    eyeCenterY = (left.y + right.y) * 0.5;
    eyeCenterZ = (left.z + right.z) * 0.5;
  }

  camera.fov = 32;
  const fov = MathUtils.degToRad(camera.fov);

  const portraitHeight = Math.max(
    headTopSpan * 3.45,
    avatarSize.y * 0.295,
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
    (2 *
      Math.tan(fov / 2) *
      Math.max(camera.aspect, 0.01));

  const distance =
    Math.max(
      distanceForHeight,
      distanceForWidth,
    ) * 1.045;

  const target = new Vector3(
    headPosition.x,
    eyeCenterY - portraitHeight * 0.075,
    MathUtils.lerp(
      headPosition.z,
      eyeCenterZ,
      0.35,
    ),
  );

  camera.near = Math.max(
    distance * 0.02,
    0.005,
  );

  camera.far = Math.max(
    distance + avatarSize.z * 6,
    camera.near + 10,
  );

  camera.position.set(
    target.x,
    target.y,
    target.z + distance,
  );

  camera.lookAt(target);
  camera.updateProjectionMatrix();
}

function GemmaModel({ status }) {
  const gltf = useGLTF("/models/gemma.glb");

  const scene = useMemo(() => {
    const cloned = clone(gltf.scene);
    tintBlouse(cloned);
    return cloned;
  }, [gltf.scene]);

  const group = useRef();
  const { camera, size } = useThree();

  const head = useMemo(
    () => findBone(scene, "head"),
    [scene],
  );

  const leftEye = useMemo(
    () =>
      findBone(scene, "eye.L") ||
      findBone(scene, "eyeL"),
    [scene],
  );

  const rightEye = useMemo(
    () =>
      findBone(scene, "eye.R") ||
      findBone(scene, "eyeR"),
    [scene],
  );

  const faceMeshes = useMemo(() => {
    const refs = [];

    scene.traverse((object) => {
      if (
        object.morphTargetDictionary &&
        object.morphTargetInfluences
      ) {
        refs.push(object);
      }
    });

    return refs;
  }, [scene]);

  useLayoutEffect(() => {
    const model = group.current;
    if (!model) return;

    model.position.set(0, 0, 0);
    model.scale.setScalar(1);

    if (!camera?.isPerspectiveCamera) return;

    frameShoulderPortrait(
      model,
      camera,
      head,
      leftEye,
      rightEye,
    );
  }, [
    camera,
    size.width,
    size.height,
    head,
    leftEye,
    rightEye,
  ]);

  useFrame(({ clock }) => {
    if (!group.current) return;

    const t = clock.getElapsedTime();
    const audioLevel =
      status === "speaking"
        ? getGemmaAudioLevel()
        : 0;

    group.current.rotation.y =
      Math.sin(t * 0.45) * 0.018;

    group.current.rotation.x =
      Math.sin(t * 0.34) * 0.006;

    for (const object of faceMeshes) {
      const dictionary =
        object.morphTargetDictionary;

      const influences =
        object.morphTargetInfluences;

      const jaw = dictionary.jawOpen;
      const smileLeft =
        dictionary.mouthSmileLeft;
      const smileRight =
        dictionary.mouthSmileRight;
      const funnel = dictionary.mouthFunnel;
      const pucker = dictionary.mouthPucker;

      if (jaw !== undefined) {
        influences[jaw] =
          Math.min(audioLevel * 0.52, 0.48);
      }

      if (funnel !== undefined) {
        influences[funnel] =
          audioLevel > 0.03
            ? Math.min(
                audioLevel *
                  (0.12 +
                    0.035 * Math.sin(t * 12)),
                0.16,
              )
            : 0;
      }

      if (pucker !== undefined) {
        influences[pucker] =
          audioLevel > 0.04
            ? Math.min(
                audioLevel *
                  (0.08 +
                    0.025 * Math.cos(t * 10)),
                0.11,
              )
            : 0;
      }

      const smile =
        status === "idle" ? 0.09 : 0;

      if (smileLeft !== undefined) {
        influences[smileLeft] = smile;
      }

      if (smileRight !== undefined) {
        influences[smileRight] = smile;
      }
    }
  });

  return (
    <group ref={group}>
      <primitive object={scene} />
    </group>
  );
}

export default function GemmaAvatar({ status }) {
  return (
    <Canvas
      camera={{
        position: [0, 0, 3],
        fov: 32,
      }}
      dpr={[1, 1.6]}
    >
      <ambientLight intensity={1.5} />
      <directionalLight
        position={[2, 3, 4]}
        intensity={2.4}
      />
      <directionalLight
        position={[-3, 1, 2]}
        intensity={1.2}
      />
      <GemmaModel status={status} />
      <Environment preset="studio" />
    </Canvas>
  );
}

useGLTF.preload("/models/gemma.glb");
