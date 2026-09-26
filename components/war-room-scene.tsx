"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Canvas, events as pointerEvents, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import type { Line2, OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import type { AgentState, NetworkNode } from "@/lib/types";
import { FLOOR_DEFS, getFloorHeight, getPlacement } from "@/lib/building-layout";

export type WarRoomSceneProps = {
  nodes: NetworkNode[];
  agents: AgentState[];
  tick: number;
  running: boolean;
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  exploded: boolean;
  cutaway: boolean;
  activeFloor: number | null;
  layer: "all" | "network" | "agents" | "threats";
  cameraMode: "orbit" | "top";
  resetKey: number;
};

type V3 = [number, number, number];
type FloorPositions = RefObject<number[]>;
type LabelRefs = RefObject<Map<string, HTMLButtonElement>>;

function scenePointerEvents(state: Parameters<typeof pointerEvents>[0]) {
  return {
    ...pointerEvents(state),
    // Raycaster deliberately ignores Object3D.visible. Hidden floors must not
    // intercept the room or agent that the user can actually see underneath.
    filter: (hits: THREE.Intersection[]) => hits.filter((hit) => {
      let object: THREE.Object3D | null = hit.object;
      while (object) {
        if (!object.visible) return false;
        object = object.parent;
      }
      return true;
    }),
  };
}

const STATUS_COLORS = {
  healthy: "#6c9279",
  exposed: "#cba45d",
  compromised: "#da765e",
  isolated: "#8d91a6",
};
const AGENT_COLORS = ["#518f81", "#9680aa", "#c99460", "#6a91ab", "#b87884"];
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYLINDER = new THREE.CylinderGeometry(1, 1, 1, 12);
const SPHERE = new THREE.SphereGeometry(1, 12, 10);
const materialCache = new Map<string, THREE.MeshStandardMaterial>();
function surface(color: string) {
  let material = materialCache.get(color);
  if (!material) {
    material = new THREE.MeshStandardMaterial({ color, roughness: 0.86 });
    materialCache.set(color, material);
  }
  return material;
}
const GLASS = new THREE.MeshStandardMaterial({ color: "#9ebdb6", transparent: true, opacity: 0.23, roughness: 0.4, depthWrite: false, side: THREE.DoubleSide });
const SCREEN = new THREE.MeshStandardMaterial({ color: "#6f9b94", emissive: "#598f81", emissiveIntensity: 0.3, roughness: 0.6 });

function Block({ position = [0, 0, 0], size, color = "#ecede4", material, rotation, castShadow = true }: {
  position?: V3; size: V3; color?: string; material?: THREE.Material; rotation?: V3; castShadow?: boolean;
}) {
  return <mesh geometry={BOX} material={material ?? surface(color)} position={position} scale={size} rotation={rotation} castShadow={castShadow} receiveShadow />;
}

function Cylinder({ position, size, color, rotation }: { position: V3; size: V3; color: string; rotation?: V3 }) {
  return <mesh geometry={CYLINDER} material={surface(color)} position={position} scale={size} rotation={rotation} castShadow receiveShadow />;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  return reduced;
}

const Tree = memo(function Tree({ position, scale = 1 }: { position: V3; scale?: number }) {
  return <group position={position} scale={scale}>
    <Block position={[0, 0.08, 0]} size={[1.3, 0.16, 1.3]} color="#bcc7af" />
    <Cylinder position={[0, 0.6, 0]} size={[0.075, 1.1, 0.075]} color="#a3a28b" />
    <mesh position={[0, 1.6, 0]} scale={[0.68, 0.9, 0.68]} material={surface("#a8bca2")} castShadow>
      <icosahedronGeometry args={[1, 1]} />
    </mesh>
  </group>;
});

const ContextTower = memo(function ContextTower({ position, size, stories }: { position: V3; size: [number, number]; stories: number }) {
  const height = stories * 0.95;
  return <group position={position}>
    <Block position={[0, height / 2, 0]} size={[size[0], height, size[1]]} color="#d8dcdb" />
    <Block position={[0, height + 0.13, 0]} size={[size[0] + 0.18, 0.26, size[1] + 0.18]} color="#e4e6e1" />
    <Block position={[0.3, height + 0.43, 0]} size={[size[0] * 0.5, 0.35, size[1] * 0.45]} color="#d9ddda" />
    {Array.from({ length: stories }, (_, i) => <group key={i} position={[0, i * 0.95 + 0.55, 0]}>
      <Block position={[0, 0, size[1] / 2 + 0.012]} size={[size[0] - 0.3, 0.49, 0.04]} color="#adbec0" castShadow={false} />
      <Block position={[size[0] / 2 + 0.012, 0, 0]} size={[0.04, 0.49, size[1] - 0.3]} color="#9fb1b4" castShadow={false} />
      <Block position={[-size[0] / 2 - 0.012, 0, 0]} size={[0.04, 0.49, size[1] - 0.3]} color="#b1c0c1" castShadow={false} />
    </group>)}
    {Array.from({ length: Math.floor(size[0]) + 1 }, (_, i) => <Block key={`m${i}`} position={[-size[0] / 2 + i, height / 2, size[1] / 2 + 0.05]} size={[0.08, height, 0.05]} color="#d7ddda" castShadow={false} />)}
  </group>;
});

const Campus = memo(function Campus() {
  return <group dispose={null}>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.2, 0]} receiveShadow>
      <planeGeometry args={[180, 180]} />
      <meshStandardMaterial color="#e5e8e6" roughness={1} />
    </mesh>
    <Block position={[0, -0.04, -0.5]} size={[22, 0.22, 17]} color="#dce0d8" />
    <Block position={[0, 0.07, 0]} size={[18.8, 0.2, 13.4]} color="#efefe7" />
    <Block position={[0, -0.05, 10.8]} size={[70, 0.07, 5.4]} color="#bec5c5" />
    <Block position={[14, -0.045, -1]} size={[5.3, 0.08, 45]} color="#bec5c5" />
    <Block position={[17.8, -0.045, -0.8]} size={[1.8, 0.08, 45]} color="#d9dfd9" />
    <Block position={[24.5, -0.07, -1]} size={[11.5, 0.07, 65]} color="#b1c6c7" />
    {Array.from({ length: 20 }, (_, i) => <Block key={`r${i}`} position={[-33 + i * 3.5, 0.003, 10.8]} size={[1.55, 0.015, 0.09]} color="#e4e8e3" castShadow={false} />)}
    {Array.from({ length: 14 }, (_, i) => <Block key={`s${i}`} position={[14, 0.005, -22 + i * 3.5]} size={[0.09, 0.015, 1.55]} color="#e4e8e3" castShadow={false} />)}
    {Array.from({ length: 10 }, (_, i) => <Block key={`c${i}`} position={[9.4 + i * 0.45, 0.01, 8.9]} size={[0.2, 0.02, 2.1]} color="#edf0ea" castShadow={false} />)}
    {Array.from({ length: 7 }, (_, i) => <Tree key={i} position={[-10, 0.1, -6.3 + i * 2.1]} scale={0.65} />)}
    {[-6.6, -2.2, 2.2, 6.6].map((x) => <group key={x}>
      <Block position={[x, 0.2, 7.2]} size={[1.5, 0.18, 0.55]} color="#afbea3" />
      <Block position={[x + 0.15, 0.34, 7.2]} size={[1.15, 0.14, 0.34]} color="#bac5af" />
    </group>)}
    <ContextTower position={[-15.8, 0, -6]} size={[6.4, 6]} stories={7} />
    <ContextTower position={[-5.3, 0, -15.8]} size={[5.5, 5.7]} stories={12} />
    <ContextTower position={[4.2, 0, -19.5]} size={[5.5, 4.2]} stories={5} />
    <Block position={[-10.9, -0.02, -16]} size={[2.5, 0.15, 17]} color="#d5dbd5" />
    <Block position={[7, 0.02, -12]} size={[6.5, 0.15, 3]} color="#cbd5c6" />
    {[3.4, 5.6, 7.8, 10].map((x) => <Tree key={x} position={[x, 0.13, -12]} scale={0.9} />)}
    <group position={[13.2, 0.18, 5.2]}>
      <Block size={[0.7, 0.42, 1.5]} color="#efede3" />
      <Block position={[0, 0.32, -0.1]} size={[0.62, 0.27, 0.78]} color="#bdccc6" />
    </group>
    <group position={[-5, 0.18, 11.7]} rotation={[0, Math.PI / 2, 0]}>
      <Block size={[0.7, 0.42, 1.5]} color="#99ada5" />
      <Block position={[0, 0.32, -0.1]} size={[0.62, 0.27, 0.78]} color="#d8e0db" />
    </group>
  </group>;
});

function Plant({ position }: { position: V3 }) {
  return <group position={position}>
    <Cylinder position={[0, 0.14, 0]} size={[0.16, 0.28, 0.16]} color="#d3d5c8" />
    <mesh geometry={SPHERE} material={surface("#94ad8d")} position={[0, 0.39, 0]} scale={[0.23, 0.3, 0.23]} castShadow />
  </group>;
}

function Chair({ position, rotation = 0 }: { position: V3; rotation?: number }) {
  return <group position={position} rotation={[0, rotation, 0]}>
    <Cylinder position={[0, 0.13, 0]} size={[0.18, 0.055, 0.18]} color="#aab5ac" />
    <Cylinder position={[0, 0.26, 0]} size={[0.035, 0.24, 0.035]} color="#aab5ac" />
    <Block position={[0, 0.39, 0]} size={[0.42, 0.1, 0.43]} color="#9bb1a1" />
    <Block position={[0, 0.61, 0.19]} size={[0.42, 0.43, 0.09]} color="#9bb1a1" />
  </group>;
}

function Desk({ position, rotation = 0, double = false }: { position: V3; rotation?: number; double?: boolean }) {
  return <group position={position} rotation={[0, rotation, 0]}>
    <Block position={[0, 0.68, 0]} size={[double ? 2.7 : 1.4, 0.09, 0.8]} color="#e1dbc8" />
    {[-1, 1].map((s) => <Block key={s} position={[s * (double ? 1.15 : 0.54), 0.33, 0]} size={[0.075, 0.66, 0.62]} color="#d4dad3" />)}
    {(double ? [-0.68, 0.68] : [0]).map((x) => <group key={x} position={[x, 0, 0]}>
      <Block position={[0, 0.91, -0.2]} size={[0.62, 0.42, 0.055]} color="#a0ada7" />
      <Block position={[0, 0.92, -0.163]} size={[0.55, 0.32, 0.012]} material={SCREEN} />
      <Block position={[0, 0.75, 0.13]} size={[0.48, 0.025, 0.17]} color="#becac0" />
      <Block position={[0.45, 0.77, 0]} size={[0.19, 0.04, 0.26]} color="#f4f1df" />
      <Chair position={[0, 0, 0.72]} />
    </group>)}
  </group>;
}

type BoxSpec = { position: V3; size: V3; color: string };

/** Furniture with repeated parts shares one GPU draw call, including per-part colors. */
function InstancedBoxes({ boxes }: { boxes: BoxSpec[] }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const transform = new THREE.Object3D();
    const color = new THREE.Color();
    boxes.forEach((box, index) => {
      transform.position.set(...box.position);
      transform.scale.set(...box.size);
      transform.updateMatrix();
      mesh.current!.setMatrixAt(index, transform.matrix);
      mesh.current!.setColorAt(index, color.set(box.color));
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [boxes]);
  return <instancedMesh ref={mesh} args={[BOX, surface("#ffffff"), boxes.length]} castShadow receiveShadow dispose={null} />;
}

function rackBoxes(position: V3, color: string, small = false): BoxSpec[] {
  const height = small ? 1.1 : 1.7;
  const box = (local: V3, size: V3, color: string): BoxSpec => ({ position: [position[0] + local[0], position[1] + local[1], position[2] + local[2]], size, color });
  return [
    box([0, height / 2, 0], [0.67, height, 0.76], "#6e8780"),
    box([0, height / 2, 0.391], [0.59, height - 0.13, 0.03], "#56716b"),
    box([0, height + 0.025, 0], [0.7, 0.05, 0.79], "#b2c3b7"),
    ...Array.from({ length: small ? 4 : 6 }, (_, i) => [
      box([-0.03, 0.18 + i * 0.245, 0.416], [0.39, 0.14, 0.019], "#819a8f"),
      box([0.22, 0.197 + i * 0.245, 0.42], [0.045, 0.045, 0.02], color),
    ]).flat(),
  ];
}

function ServerRack({ position, color, small = false }: { position: V3; color: string; small?: boolean }) {
  const boxes = useMemo(() => rackBoxes(position, color, small), [position, color, small]);
  return <InstancedBoxes boxes={boxes} />;
}

function ServerBank({ color }: { color: string }) {
  const boxes = useMemo(() => [-2.25, -1.35, -0.45, 0.45].flatMap((x) => [
    ...rackBoxes([x, 0.08, -0.75], color),
    ...rackBoxes([x, 0.08, 1], color, true),
  ]), [color]);
  return <InstancedBoxes boxes={boxes} />;
}

function WorkstationRoom() {
  return <group>
    <Desk position={[-1.5, 0.08, -0.8]} double />
    <Desk position={[1.5, 0.08, -0.8]} double />
    <Desk position={[-1.5, 0.08, 1.15]} double />
    <Desk position={[1.5, 0.08, 1.15]} double />
    <Plant position={[2.9, 0.08, -1.4]} />
  </group>;
}

function IdentityRoom() {
  return <group>
    <Block position={[-0.35, 0.7, 0]} size={[2.75, 0.1, 1.32]} color="#d9d3bc" />
    <Block position={[-0.35, 0.33, 0]} size={[1.8, 0.64, 0.75]} color="#dce1d8" />
    {[-1.3, -0.25, 0.8].map((x) => <group key={x}>
      <Chair position={[x, 0.08, 1.05]} />
      <Chair position={[x, 0.08, -1.05]} rotation={Math.PI} />
      <Block position={[x, 0.77, 0]} size={[0.45, 0.02, 0.3]} color="#f4f2e5" />
    </group>)}
    <Block position={[2.65, 1.05, -0.8]} size={[0.12, 1.5, 1.9]} color="#a8b6ab" />
    <Block position={[2.57, 1.15, -0.8]} size={[0.03, 0.95, 1.7]} material={SCREEN} />
    <Plant position={[-2.7, 0.08, -1.2]} />
    <Plant position={[2.7, 0.08, 1.2]} />
  </group>;
}

function GatewayRoom({ color }: { color: string }) {
  return <group>
    <Desk position={[-1.5, 0.08, 0.45]} double />
    <ServerRack position={[1.85, 0.08, -0.65]} color={color} />
    <ServerRack position={[2.7, 0.08, -0.65]} color={color} />
    <Block position={[-1.6, 1.06, -1.76]} size={[2.5, 0.87, 0.1]} color="#a4b6ab" />
    <Block position={[-1.6, 1.07, -1.7]} size={[2.32, 0.68, 0.02]} material={SCREEN} />
    <Plant position={[-2.9, 0.08, 1.1]} />
  </group>;
}

function InfrastructureRoom({ node }: { node: NetworkNode }) {
  const color = STATUS_COLORS[node.status];
  if (node.id === "data-vault") return <group>
    <Block position={[-0.6, 0.72, -0.3]} size={[2.9, 1.4, 2.05]} color="#b6c5b3" />
    <Block position={[-0.6, 0.76, 0.744]} size={[2.25, 1.19, 0.09]} color="#98ae9f" />
    <Cylinder position={[-0.6, 0.8, 0.825]} size={[0.29, 0.065, 0.29]} rotation={[Math.PI / 2, 0, 0]} color="#e3e6d9" />
    <Block position={[-0.6, 0.8, 0.87]} size={[0.43, 0.055, 0.07]} color="#879e8c" />
    <ServerRack position={[2.3, 0.08, -0.65]} color={color} />
    <Plant position={[2.75, 0.08, 1.3]} />
  </group>;
  if (node.type === "database") return <group>
    {[-1.65, 0, 1.65].map((x) => <group key={x} position={[x, 0.08, -0.45]}>
      <Cylinder position={[0, 0.72, 0]} size={[0.54, 1.43, 0.54]} color="#93ada1" />
      {[0.24, 0.55, 0.86, 1.18, 1.45].map((y) => <Cylinder key={y} position={[0, y, 0]} size={[0.56, 0.06, 0.56]} color="#d3dfcf" />)}
      <Block position={[0, 0.88, 0.54]} size={[0.15, 0.28, 0.02]} color={color} />
    </group>)}
    <Desk position={[0.25, 0.08, 1.33]} rotation={Math.PI} />
    <Plant position={[-2.9, 0.08, 1.4]} />
  </group>;
  return <group>
    <ServerBank color={color} />
    <Desk position={[2.25, 0.08, 0.65]} rotation={-Math.PI / 2} />
    <Plant position={[2.9, 0.08, -1.2]} />
  </group>;
}

function Room({ node, selected, hovered, onSelect, onHover, layer, running, reducedMotion }: {
  node: NetworkNode; selected: boolean; hovered: boolean; onSelect: (id: string) => void;
  onHover: (id: string | null) => void; layer: WarRoomSceneProps["layer"]; running: boolean; reducedMotion: boolean;
}) {
  const { x, z } = getPlacement(node.id);
  const warning = node.status === "compromised" || node.status === "exposed";
  const statusColor = STATUS_COLORS[node.status];
  const highlighted = selected || hovered || warning;
  const click = (event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); if (event.delta <= 4) onSelect(node.id); };
  return <group position={[x, 0.13, z]} onClick={click} onPointerOver={(event) => { event.stopPropagation(); onHover(node.id); }} onPointerOut={() => onHover(null)}>
    <Block position={[0, -0.015, 0]} size={[7.05, 0.055, 3.8]} color={warning ? "#e9d2bf" : node.type === "workstation" ? "#dce4d5" : "#d3dfd5"} castShadow={false} />
    <mesh position={[0, 0.019, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[7.05, 3.8]} />
      <meshBasicMaterial color={selected ? "#7ea481" : hovered ? "#b8cfa9" : statusColor} transparent opacity={selected ? 0.24 : hovered ? 0.18 : warning ? 0.12 : 0} depthWrite={false} />
    </mesh>
    {highlighted ? <Line points={[[-3.5, 0.07, -1.88], [3.5, 0.07, -1.88], [3.5, 0.07, 1.88], [-3.5, 0.07, 1.88], [-3.5, 0.07, -1.88]]} color={selected ? "#4f7655" : statusColor} lineWidth={selected ? 2 : 1.3} transparent opacity={0.8} /> : null}
    {node.type === "workstation" ? <WorkstationRoom /> : node.type === "identity" ? <IdentityRoom /> : node.type === "gateway" ? <GatewayRoom color={statusColor} /> : <InfrastructureRoom node={node} />}
    <Cylinder position={[-3.05, 0.065, z > 0 ? -1.57 : 1.57]} size={[0.09, 0.027, 0.09]} color={statusColor} />
    {node.status === "isolated" ? <Line points={[[-3.5, 0.08, -1.88], [3.5, 0.08, -1.88], [3.5, 0.08, 1.88], [-3.5, 0.08, 1.88], [-3.5, 0.08, -1.88]]} color={statusColor} dashed dashSize={0.22} gapSize={0.16} lineWidth={1.4} /> : null}
    {warning && layer !== "agents" ? <ThreatPulse compromised={node.status === "compromised"} running={running} reducedMotion={reducedMotion} /> : null}
  </group>;
}

function ThreatPulse({ compromised, running, reducedMotion }: { compromised: boolean; running: boolean; reducedMotion: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const elapsed = useRef(0);
  useFrame((_, delta) => {
    if (!ref.current) return;
    if (running && !reducedMotion) elapsed.current += delta;
    const scale = 0.8 + ((elapsed.current * 0.35) % 1) * 0.9;
    ref.current.scale.setScalar(scale);
    (ref.current.material as THREE.MeshBasicMaterial).opacity = 0.3 * (1.7 - scale);
  });
  return <group position={[0, 0.095, 0]}>
    <mesh rotation={[-Math.PI / 2, 0, 0]} ref={ref}>
      <ringGeometry args={[0.7, 0.75, 40]} />
      <meshBasicMaterial color={compromised ? "#cf795f" : "#c2a35b"} transparent opacity={0.3} depthWrite={false} />
    </mesh>
    <mesh position={[0, 2.02, 0]} rotation={[0, 0, Math.PI]}>
      <coneGeometry args={[0.14, 0.24, 3]} />
      <meshBasicMaterial color={compromised ? "#cf795f" : "#c2a35b"} />
    </mesh>
  </group>;
}

function Floor({ floor, nodes, exploded, cutaway, activeFloor, floorPositions, reducedMotion, selectedNodeId, hoveredNodeId, onSelectNode, onHover, layer, running }: {
  floor: number; nodes: NetworkNode[]; exploded: boolean; cutaway: boolean; activeFloor: number | null;
  floorPositions: FloorPositions; reducedMotion: boolean; selectedNodeId: string | null; hoveredNodeId: string | null;
  onSelectNode: (id: string) => void; onHover: (id: string | null) => void; layer: WarRoomSceneProps["layer"]; running: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const outerWalls = useRef<THREE.Group>(null);
  const targetHeight = getFloorHeight(floor, exploded);
  const initialHeight = useRef(targetHeight);
  const initialWallScale = useRef(cutaway ? 0.2 : 1);
  useFrame((_, delta) => {
    if (!group.current) return;
    group.current.position.y = reducedMotion ? targetHeight : THREE.MathUtils.damp(group.current.position.y, targetHeight, 5, delta);
    floorPositions.current[floor] = group.current.position.y;
    if (outerWalls.current) outerWalls.current.scale.y = reducedMotion ? (cutaway ? 0.2 : 1) : THREE.MathUtils.damp(outerWalls.current.scale.y, cutaway ? 0.2 : 1, 6, delta);
  });
  const visible = activeFloor === null || floor <= activeFloor;
  return <group ref={group} position={[0, initialHeight.current, 0]} visible={visible} dispose={null}>
    <Block position={[0, -0.13, 0]} size={[16.3, 0.25, 10.6]} color="#c9d5ca" />
    <Block position={[0, 0, 0]} size={[16.5, 0.11, 10.8]} color="#f1f0e5" />
    <Block position={[0, 0.075, 0]} size={[15.75, 0.09, 1.21]} color="#ebeade" castShadow={false} />
    <Block position={[0, 0.145, 0]} size={[0.12, 0.18, 9.85]} color="#f0efe4" />
    {[-1, 1].map((side) => <group key={side}>
      <Block position={[0, 0.42, side * 4.82]} size={[15.6, 0.66, 0.14]} color="#e8e9df" />
      <Block position={[0, 0.85, side * 5.14]} size={[16.05, 0.045, 0.045]} color="#8da69a" />
      <Block position={[0, 0.46, side * 5.14]} size={[16.05, 0.75, 0.02]} material={GLASS} castShadow={false} />
      {[-7.8, -5.2, -2.6, 0, 2.6, 5.2, 7.8].map((x) => <Block key={x} position={[x, 0.48, side * 5.14]} size={[0.035, 0.76, 0.035]} color="#a1b3a9" />)}
      <Block position={[side * 7.88, 0.85, 0]} size={[0.045, 0.045, 10.26]} color="#8da69a" />
      <Block position={[side * 7.88, 0.46, 0]} size={[0.02, 0.75, 10.26]} material={GLASS} castShadow={false} />
      {[-2.5, 0, 2.5].map((z) => <Block key={z} position={[side * 7.88, 0.48, z]} size={[0.035, 0.76, 0.035]} color="#a1b3a9" />)}
      <Block position={[side * 7.57, 0.37, 0]} size={[0.13, 0.58, 9.8]} color="#ecece0" />
      {/* Door openings connect each room to a shared center corridor. */}
      {[-1, 1].map((half) => <group key={half}>
        <Block position={[half * 4.75, 0.41, side * 0.8]} size={[4.5, 0.64, 0.12]} color="#e9eade" />
        <Block position={[half * 0.95, 0.41, side * 0.8]} size={[1.75, 0.64, 0.12]} color="#e9eade" />
        <Block position={[half * 2.22, 0.22, side * 0.78]} size={[0.07, 0.28, 0.5]} color="#a3b8aa" />
      </group>)}
    </group>)}
    <Block position={[0, 0.56, -2.8]} size={[0.12, 0.95, 4]} color="#e8eadd" />
    <Block position={[0, 0.56, 2.8]} size={[0.12, 0.95, 4]} color="#e8eadd" />
    <group ref={outerWalls} scale={[1, initialWallScale.current, 1]}>
      <Block position={[0, 1.23, -4.93]} size={[15.65, 2.32, 0.15]} color="#e1e5da" />
      <Block position={[-7.57, 1.23, 0]} size={[0.15, 2.32, 9.8]} color="#e1e5da" />
      <Block position={[7.57, 1.23, 0]} size={[0.06, 2.32, 9.8]} material={GLASS} castShadow={false} />
      <Block position={[0, 1.23, 4.88]} size={[15.3, 2.32, 0.06]} material={GLASS} castShadow={false} />
      {[-7.45, -3.8, 0, 3.8, 7.45].map((x) => <Block key={x} position={[x, 1.24, 4.89]} size={[0.1, 2.35, 0.13]} color="#c5d2c5" />)}
    </group>
    <Plant position={[-7.1, 0.12, 0]} />
    <Plant position={[7.1, 0.12, 0]} />
    {nodes.map((node) => <Room key={node.id} node={node} selected={selectedNodeId === node.id} hovered={hoveredNodeId === node.id} onSelect={onSelectNode} onHover={onHover} layer={layer} running={running} reducedMotion={reducedMotion} />)}
    <Block position={[-6.72, -0.045, 5.44]} size={[1.55, 0.24, 0.035]} color={["#8caa8f", "#85a496", "#9aa97d"][floor]} />
    <Block position={[-6.72, -0.04, 5.465]} size={[1.08, 0.035, 0.01]} color="#eaf0dd" castShadow={false} />
  </group>;
}

function AgentFigure({ agent, index, running, selected, onSelect, floorPositions, activeFloor, reducedMotion, dimmed, onHover }: {
  agent: AgentState; index: number; running: boolean; selected: boolean; onSelect: (id: string) => void;
  floorPositions: FloorPositions; activeFloor: number | null; reducedMotion: boolean; dimmed: boolean; onHover: (id: string | null) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const leftLeg = useRef<THREE.Group>(null);
  const rightLeg = useRef<THREE.Group>(null);
  const desired = useMemo(() => new THREE.Vector3(), []);
  const homeFloor = index % 3;
  const assignment = agent.targetNodeId ? getPlacement(agent.targetNodeId) : null;
  const floor = assignment?.floor ?? homeFloor;
  const color = AGENT_COLORS[index % AGENT_COLORS.length];
  const initialPosition = useRef<V3>([-4.9 + index * 2.35, floorPositions.current[floor] + 0.2, index % 2 ? 0.17 : -0.15]);
  const elapsed = useRef(0);
  const lastAssignment = useRef(agent.targetNodeId);
  useFrame((_, delta) => {
    if (!group.current) return;
    if (running) elapsed.current += delta;
    const time = elapsed.current;
    const patrol = !reducedMotion && !assignment ? Math.sin(time * 0.18 + index * 2) * 1.25 : 0;
    const x = assignment ? assignment.x + (index % 2 ? 1 : -1) * 0.75 : -4.9 + index * 2.35 + patrol;
    const z = assignment ? assignment.z + (assignment.z > 0 ? -1.48 : 1.48) : (index % 2 ? 0.17 : -0.15);
    desired.set(x, floorPositions.current[floor] + 0.2, z);
    const distance = Math.hypot(desired.x - group.current.position.x, desired.z - group.current.position.z);
    const assignmentChanged = lastAssignment.current !== agent.targetNodeId;
    if (reducedMotion || (assignmentChanged && !running)) group.current.position.copy(desired);
    else if (running) group.current.position.lerp(desired, Math.min(1, delta * 1.6));
    else group.current.position.y = THREE.MathUtils.damp(group.current.position.y, desired.y, 8, delta);
    lastAssignment.current = agent.targetNodeId;
    if (running && distance > 0.02) {
      const heading = Math.atan2(desired.x - group.current.position.x, desired.z - group.current.position.z);
      group.current.rotation.y = THREE.MathUtils.damp(group.current.rotation.y, heading, 8, delta);
    }
    const stride = running && !reducedMotion && distance > 0.08 ? Math.sin(time * 11 + index) * 0.28 : 0;
    if (leftLeg.current) leftLeg.current.rotation.x = stride;
    if (rightLeg.current) rightLeg.current.rotation.x = -stride;
  });
  return <group ref={group} position={initialPosition.current} visible={!dimmed && (activeFloor === null || floor <= activeFloor)} onClick={(event) => { event.stopPropagation(); if (event.delta <= 4) onSelect(agent.id); }} onPointerOver={(event) => { event.stopPropagation(); onHover(agent.id); }} onPointerOut={() => onHover(null)} dispose={null}>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
      <ringGeometry args={[selected ? 0.27 : 0.16, selected ? 0.33 : 0.23, 24]} />
      <meshBasicMaterial color={color} transparent opacity={selected ? 0.9 : 0.4} depthWrite={false} />
    </mesh>
    <group ref={leftLeg} position={[-0.075, 0.24, 0]}>
      <Block position={[0, -0.08, 0]} size={[0.09, 0.2, 0.1]} color="#6c7e70" />
      <Block position={[0, -0.19, 0.015]} size={[0.105, 0.04, 0.14]} color="#607164" />
    </group>
    <group ref={rightLeg} position={[0.075, 0.24, 0]}>
      <Block position={[0, -0.08, 0]} size={[0.09, 0.2, 0.1]} color="#6c7e70" />
      <Block position={[0, -0.19, 0.015]} size={[0.105, 0.04, 0.14]} color="#607164" />
    </group>
    <Cylinder position={[0, 0.37, 0]} size={[0.16, 0.28, 0.12]} color={color} />
    <Cylinder position={[-0.19, 0.33, 0.03]} size={[0.046, 0.24, 0.046]} color={color} rotation={[0.2, 0, -0.2]} />
    <Cylinder position={[0.19, 0.33, 0.03]} size={[0.046, 0.24, 0.046]} color={color} rotation={[-0.3, 0, 0.2]} />
    <mesh geometry={SPHERE} material={surface("#e5d7be")} position={[0, 0.63, 0]} scale={[0.105, 0.13, 0.105]} castShadow />
    <mesh geometry={SPHERE} material={surface("#687369")} position={[0, 0.702, -0.01]} scale={[0.108, 0.07, 0.105]} castShadow />
    <Block position={[0.15, 0.39, 0.12]} size={[0.13, 0.02, 0.16]} color="#e4e9dc" />
    <mesh position={[0, 0.4, 0.02]}>
      <sphereGeometry args={[0.4, 8, 8]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  </group>;
}

function DataLink({ from, to, index, floorPositions, running, selectedNodeId, layer, activeFloor, reducedMotion }: {
  from: NetworkNode; to: NetworkNode; index: number; floorPositions: FloorPositions; running: boolean;
  selectedNodeId: string | null; layer: WarRoomSceneProps["layer"]; activeFloor: number | null; reducedMotion: boolean;
}) {
  const lineRef = useRef<Line2>(null);
  const elapsed = useRef(0);
  const packetRef = useRef<THREE.Mesh>(null);
  const a = getPlacement(from.id);
  const b = getPlacement(to.id);
  const threatened = from.status === "compromised" || to.status === "compromised";
  const isolated = from.status === "isolated" || to.status === "isolated";
  const focused = selectedNodeId === from.id || selectedNodeId === to.id;
  const explicitLayer = layer === "network" || layer === "threats";
  const show = !isolated && layer !== "agents" && (layer === "network" || threatened || focused) && (activeFloor === null || (a.floor <= activeFloor && b.floor <= activeFloor));
  const color = threatened ? "#bf5d43" : explicitLayer ? "#4f8062" : "#739b84";
  const path = useMemo(() => ({ start: new THREE.Vector3(), end: new THREE.Vector3(), middleA: new THREE.Vector3(), middleB: new THREE.Vector3(), point: new THREE.Vector3() }), []);
  const initialPoints = useMemo<V3[]>(() => [[a.x, 0.4, a.z], [a.x, 0.4, 0], [b.x, 0.4, 0], [b.x, 0.4, b.z]], [a.x, a.z, b.x, b.z]);
  useFrame((_, delta) => {
    if (!show) return;
    if (running && !reducedMotion) elapsed.current += delta;
    const yA = floorPositions.current[a.floor] + 0.38;
    const yB = floorPositions.current[b.floor] + 0.38;
    path.start.set(a.x, yA, a.z);
    path.end.set(b.x, yB, b.z);
    path.middleA.set(a.x, yA, 0);
    path.middleB.set(b.x, yB, 0);
    if (lineRef.current) {
      const geometry = lineRef.current.geometry;
      const starts = geometry.getAttribute("instanceStart");
      const ends = geometry.getAttribute("instanceEnd");
      const points = [path.start, path.middleA, path.middleB, path.end];
      for (let segment = 0; segment < 3; segment++) {
        starts.setXYZ(segment, points[segment].x, points[segment].y, points[segment].z);
        ends.setXYZ(segment, points[segment + 1].x, points[segment + 1].y, points[segment + 1].z);
      }
      starts.needsUpdate = true;
      ends.needsUpdate = true;
      geometry.computeBoundingSphere();
    }
    if (packetRef.current && running && !reducedMotion) {
      const progress = ((elapsed.current * (threatened ? 0.4 : 0.17) + index * 0.12) % 1) * 3;
      const segment = Math.floor(progress);
      const points = [path.start, path.middleA, path.middleB, path.end];
      packetRef.current.position.lerpVectors(points[segment], points[segment + 1], progress - segment);
    }
  });
  return <group visible={show}>
    <Line ref={lineRef} points={initialPoints} color={color} lineWidth={explicitLayer ? 1.65 : threatened ? 1.25 : 0.9} transparent opacity={explicitLayer ? 0.83 : threatened || focused ? 0.68 : 0.35} depthTest={!explicitLayer} depthWrite={false} renderOrder={explicitLayer ? 5 : 0} />
    <mesh ref={packetRef} visible={running && !reducedMotion} renderOrder={explicitLayer ? 6 : 0}>
      <sphereGeometry args={[threatened ? 0.065 : 0.045, 8, 8]} />
      <meshBasicMaterial color={color} depthTest={!explicitLayer} depthWrite={false} />
    </mesh>
  </group>;
}

function CameraRig({ cameraMode, resetKey, controls, activeFloor, exploded, reducedMotion }: { cameraMode: WarRoomSceneProps["cameraMode"]; resetKey: number; controls: RefObject<OrbitControlsImpl | null>; activeFloor: number | null; exploded: boolean; reducedMotion: boolean }) {
  const { camera, size } = useThree();
  const desiredPosition = useMemo(() => new THREE.Vector3(), []);
  const desiredTarget = useMemo(() => new THREE.Vector3(), []);
  const transition = useRef(true);
  const desiredZoom = useRef(30);
  const previousSize = useRef("");
  useEffect(() => {
    const compact = size.width < 700;
    const targetY = cameraMode === "top" ? getFloorHeight(activeFloor ?? 2, exploded) : 5;
    desiredTarget.set(0, targetY, 0);
    desiredPosition.set(...(cameraMode === "top" ? [0, 42, 0.02] as V3 : [22, 21, 28] as V3));
    desiredZoom.current = cameraMode === "top" ? Math.min(size.width / 21.2, size.height / 15.2) : Math.min(size.width / (compact ? 26 : 28), size.height / 25);
    transition.current = true;
  }, [cameraMode, resetKey, size.width, size.height, activeFloor, exploded, desiredPosition, desiredTarget]);
  useEffect(() => {
    const orbitControls = controls.current;
    const stopTransition = () => { transition.current = false; };
    orbitControls?.addEventListener("start", stopTransition);
    return () => orbitControls?.removeEventListener("start", stopTransition);
  }, [controls]);
  useFrame((_, delta) => {
    if (!(camera instanceof THREE.OrthographicCamera) || !transition.current || !controls.current) return;
    const sizeKey = `${size.width}:${size.height}`;
    const immediate = previousSize.current !== sizeKey;
    const speed = immediate || reducedMotion ? 1 : Math.min(1, delta * 5);
    camera.position.lerp(desiredPosition, speed);
    controls.current.target.lerp(desiredTarget, speed);
    camera.zoom = THREE.MathUtils.lerp(camera.zoom, desiredZoom.current, speed);
    camera.updateProjectionMatrix();
    controls.current.update();
    previousSize.current = sizeKey;
    if (camera.position.distanceTo(desiredPosition) < 0.03 && Math.abs(camera.zoom - desiredZoom.current) < 0.05) transition.current = false;
  });
  return null;
}

function LabelProjector({ nodes, labels, floorPositions, activeFloor }: { nodes: NetworkNode[]; labels: LabelRefs; floorPositions: FloorPositions; activeFloor: number | null }) {
  const point = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const node of nodes) {
      const label = labels.current.get(node.id);
      if (!label) continue;
      const { floor, x, z } = getPlacement(node.id);
      point.set(x, floorPositions.current[floor] + 1.25, z).project(camera);
      const visible = (activeFloor === null || floor <= activeFloor) && point.z > -1 && point.z < 1;
      const left = THREE.MathUtils.clamp((point.x * 0.5 + 0.5) * size.width - label.offsetWidth / 2, 6, size.width - label.offsetWidth - 6);
      const top = (-point.y * 0.5 + 0.5) * size.height;
      label.style.transform = `translate3d(${left.toFixed(1)}px, ${top.toFixed(1)}px, 0)`;
      label.style.visibility = visible && top > 10 && top < size.height - 20 ? "visible" : "hidden";
    }
  });
  return null;
}

function Scene(props: WarRoomSceneProps & { labels: LabelRefs; hoveredNodeId: string | null; onHover: (id: string | null) => void; onHoverAgent: (id: string | null) => void }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const floorPositions = useRef([0, 1, 2].map((floor) => getFloorHeight(floor, props.exploded)));
  const reducedMotion = useReducedMotion();
  const byFloor = useMemo(() => FLOOR_DEFS.map(({ id }) => props.nodes.filter((node) => getPlacement(node.id).floor === id)), [props.nodes]);
  const links = useMemo(() => {
    const lookup = new Map(props.nodes.map((node) => [node.id, node]));
    const seen = new Set<string>();
    return props.nodes.flatMap((node) => node.connections.flatMap((id) => {
      const target = lookup.get(id);
      const key = [node.id, id].sort().join(":");
      if (!target || seen.has(key)) return [];
      seen.add(key);
      return [{ from: node, to: target, key }];
    }));
  }, [props.nodes]);
  return <>
    <color attach="background" args={["#e5e8e6"]} />
    <fog attach="fog" args={["#e5e8e6", 55, 110]} />
    <ambientLight intensity={1.05} />
    <hemisphereLight args={["#f7f6e9", "#a6b6ac", 1.3]} />
    <directionalLight castShadow position={[-12, 24, 12]} intensity={2.1} color="#fffbea" shadow-mapSize={[2048, 2048]} shadow-camera-left={-30} shadow-camera-right={30} shadow-camera-top={30} shadow-camera-bottom={-30} shadow-normalBias={0.055} shadow-bias={-0.0002} />
    <directionalLight position={[15, 10, -12]} intensity={0.6} color="#e8eeed" />
    <Campus />
    {FLOOR_DEFS.map(({ id }) => <Floor key={id} floor={id} nodes={byFloor[id]} exploded={props.exploded} cutaway={props.cutaway} activeFloor={props.activeFloor} floorPositions={floorPositions} reducedMotion={reducedMotion} selectedNodeId={props.selectedNodeId} hoveredNodeId={props.hoveredNodeId} onSelectNode={props.onSelectNode} onHover={props.onHover} layer={props.layer} running={props.running} />)}
    {links.map(({ key, ...link }, index) => <DataLink key={key} {...link} index={index} floorPositions={floorPositions} running={props.running} selectedNodeId={props.selectedNodeId} layer={props.layer} activeFloor={props.activeFloor} reducedMotion={reducedMotion} />)}
    {props.agents.map((agent, index) => <AgentFigure key={agent.id} agent={agent} index={index} running={props.running} selected={props.selectedAgentId === agent.id} onSelect={props.onSelectAgent} floorPositions={floorPositions} activeFloor={props.activeFloor} reducedMotion={reducedMotion} dimmed={props.layer === "threats"} onHover={props.onHoverAgent} />)}
    <LabelProjector nodes={props.nodes} labels={props.labels} floorPositions={floorPositions} activeFloor={props.activeFloor} />
    <CameraRig cameraMode={props.cameraMode} resetKey={props.resetKey} controls={controls} activeFloor={props.activeFloor} exploded={props.exploded} reducedMotion={reducedMotion} />
    <OrbitControls ref={controls} makeDefault target={[0, 5, 0]} enableDamping={!reducedMotion} dampingFactor={0.12} enablePan enableRotate={props.cameraMode === "orbit"} minPolarAngle={0.05} maxPolarAngle={Math.PI / 2.1} minZoom={12} maxZoom={90} rotateSpeed={0.65} zoomSpeed={0.8} />
  </>;
}

/** One React root owns the labels; the canvas only projects their positions. */
export default function WarRoomScene(props: WarRoomSceneProps) {
  const labels = useRef(new Map<string, HTMLButtonElement>());
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null);
  useEffect(() => {
    document.body.style.cursor = hoveredNodeId || hoveredAgentId ? "pointer" : "";
    return () => { document.body.style.cursor = ""; };
  }, [hoveredNodeId, hoveredAgentId]);
  return <div style={{ width: "100%", height: "100%", position: "relative", touchAction: "none" }} role="group" aria-label="Interactive 3D security operations building. Drag to orbit, scroll to zoom, and select a room or agent to inspect it.">
    <Canvas orthographic shadows events={scenePointerEvents} camera={{ position: [22, 21, 28], zoom: 32, near: 0.1, far: 180 }} dpr={[1, 1.5]} gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }} fallback={<div style={{ padding: 28, color: "#57745b" }}>The interactive building needs WebGL. Use the room inspector and simulation controls to explore the incident.</div>}>
      <Scene {...props} labels={labels} hoveredNodeId={hoveredNodeId} onHover={setHoveredNodeId} onHoverAgent={setHoveredAgentId} />
    </Canvas>
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
      {props.nodes.map((node) => {
        const selected = props.selectedNodeId === node.id;
        const warning = node.status === "compromised" || node.status === "exposed";
        const shown = selected || hoveredNodeId === node.id || warning || (props.layer === "network" && ["gateway", "identity", "database"].includes(node.id));
        return <button key={node.id} ref={(element) => { if (element) labels.current.set(node.id, element); else labels.current.delete(node.id); }} type="button" aria-label={`${node.label}, ${node.status}, ${node.health}% integrity`} aria-pressed={selected} onClick={() => props.onSelectNode(node.id)} onFocus={() => setHoveredNodeId(node.id)} onBlur={() => setHoveredNodeId(null)} style={{ position: "absolute", top: 0, left: 0, display: "flex", alignItems: "center", gap: 6, pointerEvents: shown ? "auto" : "none", opacity: shown ? 1 : 0, padding: "6px 9px", background: "#fcfcf4ed", border: `1px solid ${selected ? "#94ac7f" : warning ? "#d4a18a" : "#d6dece"}`, borderRadius: 5, boxShadow: "0 4px 12px #425b3c12", color: warning ? "#9a5947" : "#48634e", font: "500 10px var(--font-geist), Arial, sans-serif", letterSpacing: "0.045em", whiteSpace: "nowrap", cursor: "pointer", transition: "opacity 120ms ease" }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: STATUS_COLORS[node.status] }} />
          {node.label}
        </button>;
      })}
    </div>
  </div>;
}
