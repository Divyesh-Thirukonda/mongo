/** The physical placement is stable across scenarios and incident replays. */
export const FLOOR_DEFS = [
  { id: 0, label: "Perimeter & workstations", short: "L1" },
  { id: 1, label: "Security operations", short: "L2" },
  { id: 2, label: "Core infrastructure", short: "L3" },
] as const;

export type BuildingPlacement = { floor: number; x: number; z: number };

const PLACEMENTS: Record<string, BuildingPlacement> = {
  gateway: { floor: 0, x: -3.8, z: -2.7 },
  firewall: { floor: 0, x: 3.8, z: -2.7 },
  "workstation-01": { floor: 0, x: -3.8, z: 2.7 },
  "workstation-02": { floor: 0, x: 3.8, z: 2.7 },
  "web-server": { floor: 1, x: -3.8, z: -2.7 },
  identity: { floor: 1, x: 3.8, z: -2.7 },
  "build-server": { floor: 1, x: -3.8, z: 2.7 },
  "file-server": { floor: 1, x: 3.8, z: 2.7 },
  "api-server": { floor: 2, x: -3.8, z: -2.7 },
  database: { floor: 2, x: 3.8, z: -2.7 },
  "data-vault": { floor: 2, x: -3.8, z: 2.7 },
  backup: { floor: 2, x: 3.8, z: 2.7 },
};

export function getPlacement(nodeId: string): BuildingPlacement {
  return PLACEMENTS[nodeId] ?? { floor: 0, x: 0, z: 0 };
}

export function getFloorHeight(floor: number, exploded: boolean): number {
  return 0.4 + floor * (exploded ? 4.05 : 2.5);
}
