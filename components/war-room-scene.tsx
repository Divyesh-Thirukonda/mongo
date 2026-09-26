"use client";

import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  Canvas,
  useFrame,
  useThree,
  type ThreeEvent,
} from "@react-three/fiber";
import { Edges, Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

export type WarRoomNode = {
  id: string;
  label: string;
  type: string;
  zone: string;
  position: [number, number, number];
  status: "healthy" | "exposed" | "compromised" | "isolated";
  health: number;
  connections?: string[];
};

export type WarRoomSceneProps = {
  nodes: WarRoomNode[];
  tick: number;
  running: boolean;
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
  view?: "network" | "threat";
  resetKey?: number;
};

type PlacedNode = WarRoomNode & { point: [number, number, number] };
type Connection = { from: PlacedNode; to: PlacedNode; index: number };

const COLORS = {
  healthy: "#62cdb7",
  exposed: "#ffc077",
  compromised: "#ff7166",
  isolated: "#969bb8",
};
const LIME = "#d4f495";
const CAMERA_POSITION: [number, number, number] = [12, 15, 24];
const CAMERA_TARGET: [number, number, number] = [0, 0.5, 0];

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

function placeNodes(nodes: WarRoomNode[]): PlacedNode[] {
  if (!nodes.length) return [];
  const xs = nodes.map((node) => node.position[0]);
  const zs = nodes.map((node) => node.position[2]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const scale = Math.min(
    16 / Math.max(maxX - minX, 1),
    10 / Math.max(maxZ - minZ, 1),
    1.4,
  );
  return nodes.map((node) => ({
    ...node,
    point: [
      (node.position[0] - (minX + maxX) / 2) * scale,
      0,
      (node.position[2] - (minZ + maxZ) / 2) * scale,
    ],
  }));
}

// A minimum spanning tree keeps every service connected. One local link per
// zone adds realistic redundancy without turning the network into a hairball.
function connectNodes(nodes: PlacedNode[]): Connection[] {
  if (nodes.length < 2) return [];
  const links: Connection[] = [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const suppliedKeys = new Set<string>();
  for (const from of nodes) {
    for (const target of from.connections ?? []) {
      const to = byId.get(target);
      const key = [from.id, target].sort().join(":");
      if (!to || to.id === from.id || suppliedKeys.has(key)) continue;
      suppliedKeys.add(key);
      links.push({ from, to, index: links.length });
    }
  }
  if (links.length) return links;
  const connected = new Set([nodes[0].id]);
  const linkKeys = new Set<string>();
  const keyFor = (a: PlacedNode, b: PlacedNode) =>
    [a.id, b.id].sort().join(":");
  const distance = (a: PlacedNode, b: PlacedNode) =>
    Math.hypot(a.point[0] - b.point[0], a.point[2] - b.point[2]);
  while (connected.size < nodes.length) {
    let closest:
      { from: PlacedNode; to: PlacedNode; distance: number } | undefined;
    for (const from of nodes) {
      if (!connected.has(from.id)) continue;
      for (const to of nodes) {
        if (connected.has(to.id)) continue;
        const length = distance(from, to);
        if (!closest || length < closest.distance)
          closest = { from, to, distance: length };
      }
    }
    if (!closest) break;
    links.push({ from: closest.from, to: closest.to, index: links.length });
    linkKeys.add(keyFor(closest.from, closest.to));
    connected.add(closest.to.id);
  }
  const zones = [...new Set(nodes.map((node) => node.zone))];
  for (const zone of zones) {
    const members = nodes.filter((node) => node.zone === zone);
    let candidate:
      { from: PlacedNode; to: PlacedNode; distance: number } | undefined;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const from = members[i];
        const to = members[j];
        if (linkKeys.has(keyFor(from, to))) continue;
        const length = distance(from, to);
        if (!candidate || length < candidate.distance)
          candidate = { from, to, distance: length };
      }
    }
    if (candidate) {
      links.push({
        from: candidate.from,
        to: candidate.to,
        index: links.length,
      });
      linkKeys.add(keyFor(candidate.from, candidate.to));
    }
  }
  return links;
}

function ResponsiveCamera({
  resetKey,
  controls,
}: {
  resetKey: number;
  controls: RefObject<OrbitControlsImpl | null>;
}) {
  const { camera, size } = useThree();
  useEffect(() => {
    if (camera instanceof THREE.OrthographicCamera) {
      camera.position.set(...CAMERA_POSITION);
      camera.zoom = Math.min(size.width / 21, size.height / 11.6);
      controls.current?.target.set(...CAMERA_TARGET);
      controls.current?.update();
      camera.updateProjectionMatrix();
    }
  }, [camera, size.width, size.height, resetKey, controls]);
  return null;
}

const Terrain = memo(function Terrain() {
  const divisions = useMemo(() => {
    const lines: [number, number, number][][] = [];
    for (let x = -10; x <= 10; x++)
      lines.push([
        [x, -0.11, -7],
        [x, -0.11, 7],
      ]);
    for (let z = -7; z <= 7; z++)
      lines.push([
        [-10, -0.11, z],
        [10, -0.11, z],
      ]);
    return lines;
  }, []);
  return (
    <group>
      <mesh position={[0, -0.3, 0]}>
        <boxGeometry args={[21, 0.32, 15]} />
        <meshStandardMaterial color="#0a191c" metalness={0.6} roughness={0.7} />
        <Edges color="#1c4548" threshold={20} />
      </mesh>
      {divisions.map((points, index) => (
        <Line
          key={index}
          points={points}
          color="#1c393b"
          transparent
          opacity={0.65}
          lineWidth={0.5}
        />
      ))}
      <Line
        points={[
          [-10.5, -0.11, -7.5],
          [10.5, -0.11, -7.5],
          [10.5, -0.11, 7.5],
          [-10.5, -0.11, 7.5],
          [-10.5, -0.11, -7.5],
        ]}
        color="#2a5554"
        lineWidth={0.75}
      />
      {[-1, 1].flatMap((x) =>
        [-1, 1].map((z) => (
          <group key={`${x}-${z}`} position={[x * 10.25, -0.08, z * 7.25]}>
            <Line
              points={[
                [-x * 0.7, 0, 0],
                [0, 0, 0],
                [0, 0, -z * 0.7],
              ]}
              color="#84bcb0"
              transparent
              opacity={0.55}
              lineWidth={1.5}
            />
          </group>
        )),
      )}
    </group>
  );
});

function NetworkZones({ nodes }: { nodes: PlacedNode[] }) {
  const zones = useMemo(
    () =>
      [...new Set(nodes.map((node) => node.zone))].map((name, index) => {
        const members = nodes.filter((node) => node.zone === name);
        const xs = members.map((node) => node.point[0]);
        const zs = members.map((node) => node.point[2]);
        const left = Math.min(...xs) - 1.12;
        const right = Math.max(...xs) + 1.12;
        const back = Math.min(...zs) - 1.12;
        const front = Math.max(...zs) + 1.12;
        return {
          name,
          left,
          right,
          back,
          front,
          color: ["#5aabb8", "#58af92", "#a0bd70"][index % 3],
        };
      }),
    [nodes],
  );
  return (
    <group>
      {zones.map((zone) => (
        <group key={zone.name}>
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[
              (zone.left + zone.right) / 2,
              -0.102,
              (zone.back + zone.front) / 2,
            ]}
          >
            <planeGeometry
              args={[zone.right - zone.left, zone.front - zone.back]}
            />
            <meshBasicMaterial
              color={zone.color}
              transparent
              opacity={0.055}
              depthWrite={false}
            />
          </mesh>
          <Line
            points={[
              [zone.left, -0.085, zone.back],
              [zone.right, -0.085, zone.back],
              [zone.right, -0.085, zone.front],
              [zone.left, -0.085, zone.front],
              [zone.left, -0.085, zone.back],
            ]}
            color={zone.color}
            transparent
            opacity={0.27}
            lineWidth={0.8}
            dashed
            dashSize={0.19}
            gapSize={0.18}
          />
        </group>
      ))}
    </group>
  );
}

function ServerTower({
  position,
  height,
  color,
  broad = false,
}: {
  position: [number, number, number];
  height: number;
  color: string;
  broad?: boolean;
}) {
  const width = broad ? 0.92 : 0.54;
  const depth = broad ? 0.78 : 0.6;
  return (
    <group position={position}>
      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial
          color="#315a59"
          emissive="#184c46"
          emissiveIntensity={0.22}
          metalness={0.15}
          roughness={0.48}
        />
        <Edges color={color} transparent opacity={0.88} />
      </mesh>
      {Array.from(
        { length: Math.max(2, Math.floor(height / 0.2)) },
        (_, index) => (
          <group
            key={index}
            position={[0, 0.15 + index * 0.19, depth / 2 + 0.006]}
          >
            <mesh position={[-width * 0.12, 0, 0]}>
              <boxGeometry args={[width * 0.5, 0.035, 0.014]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={0.4 + (index % 3) * 0.2}
              />
            </mesh>
            <mesh position={[width * 0.34, 0, 0.008]}>
              <boxGeometry args={[0.033, 0.033, 0.018]} />
              <meshBasicMaterial color={index % 3 === 0 ? LIME : color} />
            </mesh>
          </group>
        ),
      )}
      <mesh position={[0, height + 0.013, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width * 0.62, depth * 0.6]} />
        <meshBasicMaterial color={color} transparent opacity={0.22} />
      </mesh>
    </group>
  );
}

function DatabaseTower({ color }: { color: string }) {
  return (
    <group position={[0, 0.12, 0]}>
      {[0, 1, 2, 3].map((level) => (
        <group key={level} position={[0, level * 0.3 + 0.16, 0]}>
          <mesh>
            <cylinderGeometry args={[0.5, 0.5, 0.23, 24]} />
            <meshStandardMaterial
              color="#365b5b"
              emissive="#164f49"
              emissiveIntensity={0.25}
              metalness={0.18}
              roughness={0.42}
            />
          </mesh>
          <mesh position={[0, 0.118, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.5, 0.012, 4, 32]} />
            <meshBasicMaterial color={color} transparent opacity={0.85} />
          </mesh>
          <mesh position={[0, 0.02, 0.494]}>
            <boxGeometry args={[0.12, 0.025, 0.018]} />
            <meshBasicMaterial color={LIME} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function NodeBuilding({
  node,
  index,
  selected,
  onSelect,
  onHover,
  running,
  reducedMotion,
  threatView,
}: {
  node: PlacedNode;
  index: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  running: boolean;
  reducedMotion: boolean;
  threatView: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const pulse = useRef<THREE.Mesh>(null);
  const beacon = useRef<THREE.Mesh>(null);
  const color = selected ? LIME : COLORS[node.status];
  const warning = node.status === "compromised" || node.status === "exposed";
  const isDatabase = /database|storage|vault|data|mongo/i.test(
    `${node.type} ${node.label}`,
  );
  const isFirewall = /firewall|gateway|edge/i.test(
    `${node.type} ${node.label}`,
  );
  const top = isDatabase ? 1.48 : isFirewall ? 1.22 : 2.08 + (index % 3) * 0.18;

  useFrame(({ clock }) => {
    if (pulse.current) {
      const wave = reducedMotion
        ? 0.4
        : (Math.sin(clock.elapsedTime * (warning ? 2.3 : 0.85) + index) + 1) /
          2;
      pulse.current.scale.setScalar(
        selected ? 1.2 : 1 + wave * (warning ? 0.4 : 0.12),
      );
      (pulse.current.material as THREE.MeshBasicMaterial).opacity = selected
        ? 0.22
        : warning
          ? 0.09 + wave * 0.12
          : 0.055;
    }
    if (beacon.current && !reducedMotion) {
      beacon.current.rotation.y = clock.elapsedTime * (running ? 0.6 : 0.16);
    }
  });

  const onClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect(node.id);
  };
  const displayDimmed = threatView && !warning && !selected;

  return (
    <group position={node.point}>
      <mesh position={[0, -0.028, 0]}>
        <boxGeometry args={[1.85, 0.17, 1.7]} />
        <meshStandardMaterial
          color={selected ? "#35543f" : "#1c3c3d"}
          metalness={0.2}
          roughness={0.6}
        />
        <Edges
          color={color}
          transparent
          opacity={selected || warning ? 1 : 0.56}
        />
      </mesh>
      <mesh
        ref={pulse}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.112, 0]}
      >
        <ringGeometry args={[1.02, 1.16, 48]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.1}
          depthWrite={false}
        />
      </mesh>
      <group
        onClick={onClick}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
          onHover(node.id);
        }}
        onPointerOut={() => {
          setHovered(false);
          onHover(null);
        }}
      >
        <mesh position={[0, top / 2, 0]} visible={false}>
          <boxGeometry args={[1.9, top + 0.2, 1.7]} />
          <meshBasicMaterial />
        </mesh>
        {isDatabase ? (
          <DatabaseTower color={color} />
        ) : isFirewall ? (
          <group position={[0, 0.06, 0]}>
            <ServerTower
              position={[-0.36, 0, 0.1]}
              height={1.03}
              color={color}
              broad
            />
            <ServerTower
              position={[0.55, 0, -0.14]}
              height={0.64}
              color={color}
            />
            <Line
              points={[
                [-0.5, 1.2, 0.1],
                [0.4, 1.2, 0.1],
                [0.4, 1.2, -0.45],
              ]}
              color={color}
              lineWidth={1.4}
            />
          </group>
        ) : (
          <group position={[0, 0.065, 0]}>
            <ServerTower
              position={[-0.4, 0, -0.22]}
              height={top - 0.2}
              color={color}
            />
            <ServerTower
              position={[0.23, 0, -0.22]}
              height={top - 0.55}
              color={color}
            />
            <ServerTower
              position={[-0.1, 0, 0.42]}
              height={top - 0.95}
              color={color}
            />
          </group>
        )}
        <mesh
          ref={beacon}
          position={[0, top + 0.18, 0]}
          rotation={[0, Math.PI / 4, 0]}
        >
          <octahedronGeometry args={[selected ? 0.125 : 0.078, 0]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={displayDimmed ? 0.3 : 1}
          />
        </mesh>
      </group>
      {node.status === "isolated" ? (
        <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.18, 1.195, 4]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.7}
            side={THREE.DoubleSide}
          />
        </mesh>
      ) : null}
      {selected || hovered ? (
        <Line
          points={[
            [-1.03, 0.05, -0.98],
            [-1.03, 0.05, 0.98],
            [1.03, 0.05, 0.98],
            [1.03, 0.05, -0.98],
            [-1.03, 0.05, -0.98],
          ]}
          color={LIME}
          lineWidth={1.7}
        />
      ) : null}
    </group>
  );
}

function DataConnection({
  from,
  to,
  index,
  selectedNodeId,
  running,
  reducedMotion,
  threatView,
}: Connection & {
  selectedNodeId: string | null;
  running: boolean;
  reducedMotion: boolean;
  threatView: boolean;
}) {
  const packet = useRef<THREE.Mesh>(null);
  const secondPacket = useRef<THREE.Mesh>(null);
  const progress = useRef((index * 0.137) % 1);
  const point = useMemo(() => new THREE.Vector3(), []);
  const isolated = from.status === "isolated" || to.status === "isolated";
  const attacked = from.status === "compromised" || to.status === "compromised";
  const highlighted = selectedNodeId === from.id || selectedNodeId === to.id;
  const color = isolated
    ? "#626f81"
    : attacked
      ? COLORS.compromised
      : highlighted
        ? LIME
        : "#4c9c88";
  const curve = useMemo(() => {
    const start = new THREE.Vector3(from.point[0], 0.17, from.point[2]);
    const end = new THREE.Vector3(to.point[0], 0.17, to.point[2]);
    const middle = start.clone().lerp(end, 0.5);
    middle.y = 0.45 + start.distanceTo(end) * 0.18;
    return new THREE.QuadraticBezierCurve3(start, middle, end);
  }, [from.point, to.point]);
  const points = useMemo(() => curve.getPoints(28), [curve]);
  const dimmed = threatView && !attacked && !highlighted;

  useFrame((_, delta) => {
    if (!running || reducedMotion || isolated) return;
    progress.current =
      (progress.current + delta * (attacked ? 0.36 : 0.17)) % 1;
    if (packet.current)
      packet.current.position.copy(curve.getPoint(progress.current, point));
    if (secondPacket.current)
      secondPacket.current.position.copy(
        curve.getPoint((progress.current + 0.52) % 1, point),
      );
  });

  return (
    <group>
      <Line
        points={points}
        color={color}
        transparent
        opacity={dimmed ? 0.12 : highlighted ? 0.78 : attacked ? 0.62 : 0.36}
        lineWidth={highlighted || attacked ? 1.1 : 0.75}
        dashed={isolated}
        dashSize={0.15}
        gapSize={0.13}
      />
      {running && !isolated ? (
        <>
          <mesh ref={packet} position={curve.getPoint(progress.current)}>
            <sphereGeometry args={[attacked ? 0.06 : 0.045, 6, 6]} />
            <meshBasicMaterial
              color={attacked ? "#ffb8a1" : "#c8efba"}
              transparent
              opacity={dimmed ? 0.15 : 0.92}
            />
          </mesh>
          <mesh
            ref={secondPacket}
            position={curve.getPoint((progress.current + 0.52) % 1)}
          >
            <sphereGeometry args={[0.033, 6, 6]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={dimmed ? 0.1 : 0.75}
            />
          </mesh>
        </>
      ) : null}
    </group>
  );
}

function ThreatIndicator({
  node,
  running,
  reducedMotion,
  tick,
}: {
  node: PlacedNode;
  running: boolean;
  reducedMotion: boolean;
  tick: number;
}) {
  const marker = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!marker.current || reducedMotion) return;
    marker.current.position.y = 2.45 + Math.sin(clock.elapsedTime * 1.5) * 0.08;
    marker.current.rotation.y = clock.elapsedTime * (running ? 0.35 : 0.07);
  });
  return (
    <group position={node.point}>
      <group ref={marker} position={[0, 2.45, 0]}>
        <mesh rotation={[0, 0, Math.PI]}>
          <coneGeometry args={[0.17, 0.28, 3]} />
          <meshBasicMaterial color={COLORS.compromised} wireframe />
        </mesh>
        <Line
          points={[
            [0, -0.3, 0],
            [0, -0.62, 0],
          ]}
          color={COLORS.compromised}
          transparent
          opacity={0.5}
          dashed
          dashSize={0.045}
          gapSize={0.055}
        />
      </group>
      <mesh
        position={[0, -0.105, 0]}
        rotation={[-Math.PI / 2, 0, tick * 0.015]}
      >
        <ringGeometry args={[1.45, 1.465, 48, 1, 0, Math.PI * 1.7]} />
        <meshBasicMaterial
          color={COLORS.compromised}
          transparent
          opacity={0.55}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

function Scene({
  placed,
  tick,
  running,
  selectedNodeId,
  onSelectNode,
  view = "network",
  resetKey = 0,
  labels,
  onHoverNode,
}: WarRoomSceneProps & {
  placed: PlacedNode[];
  labels: RefObject<Map<string, HTMLButtonElement>>;
  onHoverNode: (id: string | null) => void;
}) {
  const controls = useRef<OrbitControlsImpl>(null);
  const connections = useMemo(() => connectNodes(placed), [placed]);
  const reducedMotion = useReducedMotion();
  const threatView = view === "threat";
  return (
    <>
      <ResponsiveCamera resetKey={resetKey} controls={controls} />
      <LabelProjector nodes={placed} labels={labels} />
      <ambientLight intensity={1.3} />
      <directionalLight
        position={[-8, 16, 5]}
        intensity={2.5}
        color="#b8e7d6"
      />
      <directionalLight
        position={[10, 4, -8]}
        intensity={1.5}
        color="#2c747d"
      />
      <fog attach="fog" args={["#081214", 42, 75]} />
      <Terrain />
      <NetworkZones nodes={placed} />
      {connections.map((connection) => (
        <DataConnection
          key={`${connection.from.id}:${connection.to.id}`}
          {...connection}
          selectedNodeId={selectedNodeId}
          running={running}
          reducedMotion={reducedMotion}
          threatView={threatView}
        />
      ))}
      {placed.map((node, index) => (
        <NodeBuilding
          key={node.id}
          node={node}
          index={index}
          selected={selectedNodeId === node.id}
          onSelect={onSelectNode}
          onHover={onHoverNode}
          running={running}
          reducedMotion={reducedMotion}
          threatView={threatView}
        />
      ))}
      {placed
        .filter((node) => node.status === "compromised")
        .map((node) => (
          <ThreatIndicator
            key={`threat-${node.id}`}
            node={node}
            running={running}
            reducedMotion={reducedMotion}
            tick={tick}
          />
        ))}
      <OrbitControls
        ref={controls}
        makeDefault
        target={CAMERA_TARGET}
        enableDamping
        dampingFactor={0.08}
        enablePan={false}
        minPolarAngle={Math.PI / 5}
        maxPolarAngle={Math.PI / 2.65}
        minAzimuthAngle={-Math.PI / 4}
        maxAzimuthAngle={Math.PI / 2}
        minZoom={18}
        maxZoom={75}
        rotateSpeed={0.45}
        zoomSpeed={0.65}
      />
    </>
  );
}

// Labels are owned by the app's existing React root. Projecting into an ordinary
// DOM overlay avoids nested ReactDOM roots (and their synchronous-unmount warnings).
function LabelProjector({
  nodes,
  labels,
}: {
  nodes: PlacedNode[];
  labels: RefObject<Map<string, HTMLButtonElement>>;
}) {
  const vector = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    const occupied: {
      left: number;
      right: number;
      top: number;
      bottom: number;
    }[] = [];
    const projected = nodes
      .map((node) => {
        vector.set(node.point[0], 0, node.point[2] + 1.1).project(camera);
        return {
          node,
          x: (vector.x * 0.5 + 0.5) * size.width,
          y: (-vector.y * 0.5 + 0.5) * size.height,
          visible: vector.z > -1 && vector.z < 1,
        };
      })
      .sort((a, b) => a.y - b.y);
    for (const { node, x, y, visible } of projected) {
      const element = labels.current.get(node.id);
      if (!element) continue;
      const width = element.offsetWidth;
      const left = Math.max(4, Math.min(size.width - width - 4, x - width / 2));
      let top = y;
      for (let attempt = 0; attempt < 5; attempt++) {
        if (
          !occupied.some(
            (box) =>
              left < box.right + 4 &&
              left + width > box.left - 4 &&
              top < box.bottom + 3 &&
              top + 19 > box.top - 3,
          )
        )
          break;
        top += 21;
      }
      if (element.dataset.labelVisible === "true")
        occupied.push({ left, right: left + width, top, bottom: top + 19 });
      element.style.transform = `translate3d(${left.toFixed(1)}px, ${top.toFixed(1)}px, 0)`;
      element.style.visibility =
        visible && top < size.height - 25 ? "visible" : "hidden";
    }
  });
  return null;
}

export default function WarRoomScene(props: WarRoomSceneProps) {
  const placed = useMemo(() => placeNodes(props.nodes), [props.nodes]);
  const labels = useRef(new Map<string, HTMLButtonElement>());
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        touchAction: "none",
      }}
      aria-label="Interactive 3D network. Select a service to inspect its status. Drag to orbit and scroll to zoom."
    >
      <Canvas
        orthographic
        camera={{ position: CAMERA_POSITION, zoom: 32, near: 0.1, far: 100 }}
        dpr={[1, 1.6]}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
        }}
        style={{
          background:
            "radial-gradient(ellipse at 50% 42%, #142a2b 0%, #0b171a 55%, #091214 100%)",
        }}
        fallback={
          <div style={{ color: "#91aaa3", padding: 28, fontSize: 13 }}>
            The 3D view needs WebGL. Network status and simulation controls are
            available in the surrounding panels.
          </div>
        }
      >
        <Scene
          {...props}
          placed={placed}
          labels={labels}
          onHoverNode={setHoveredNodeId}
        />
      </Canvas>
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          overflow: "hidden",
        }}
      >
        {placed.map((node) => {
          const selected = props.selectedNodeId === node.id;
          const warning =
            node.status === "compromised" || node.status === "exposed";
          const color = selected ? LIME : COLORS[node.status];
          const labelVisible =
            selected ||
            warning ||
            hoveredNodeId === node.id ||
            [
              "gateway",
              "workstation-01",
              "api-server",
              "database",
              "data-vault",
              "build-server",
            ].includes(node.id);
          return (
            <button
              key={node.id}
              ref={(element) => {
                if (element) labels.current.set(node.id, element);
                else labels.current.delete(node.id);
              }}
              type="button"
              aria-label={`${node.label}, ${node.status}, health ${node.health} percent`}
              aria-pressed={selected}
              onClick={() => props.onSelectNode(node.id)}
              onFocus={() => setHoveredNodeId(node.id)}
              onBlur={() => setHoveredNodeId(null)}
              data-label-visible={labelVisible}
              title={`${node.zone} · ${node.health}% integrity`}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                display: "flex",
                alignItems: "center",
                gap: 5,
                pointerEvents: labelVisible ? "auto" : "none",
                color: selected ? LIME : warning ? color : "#c1d5ce",
                background: selected ? "#233327f2" : "#091819e6",
                border: `1px solid ${selected ? "#718b4e" : "#36544b80"}`,
                borderRadius: 3,
                padding: "3px 6px",
                font: "9px ui-monospace, SFMono-Regular, Menlo, monospace",
                letterSpacing: ".2px",
                lineHeight: "12px",
                whiteSpace: "nowrap",
                cursor: "pointer",
                boxShadow: "0 3px 10px #020b0c60",
                opacity: !labelVisible
                  ? 0
                  : props.view === "threat" && !warning && !selected
                    ? 0.55
                    : 1,
              }}
            >
              <span
                style={{
                  width: 4,
                  height: 4,
                  background: color,
                  borderRadius: "50%",
                  flexShrink: 0,
                  boxShadow:
                    warning || selected ? `0 0 6px ${color}80` : "none",
                }}
              />
              {node.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
