export const SCALE = 2;

// Office grid: 3 columns × 2 rows = 6 room slots, with a horizontal corridor between rows.
export const OFFICE_COLS = 3;
export const OFFICE_ROWS = 2;
export const OFFICE_SLOTS = OFFICE_COLS * OFFICE_ROWS;

// Room interior dimensions (walls drawn inside these bounds, 2px thick)
export const ROOM_W = 220;
export const ROOM_H = 150;
export const CORRIDOR_H = 64;
export const DOOR_W = 28;

// Facility rooms (bathroom, ping-pong) flank the corridor at its left and right ends.
export const FACILITY_W = 108;

// Outer margin around the whole office
export const OFFICE_MARGIN = 10;

// Total world size
export const OFFICE_W = OFFICE_COLS * ROOM_W + FACILITY_W * 2 + OFFICE_MARGIN * 2;
export const OFFICE_H = OFFICE_ROWS * ROOM_H + CORRIDOR_H + OFFICE_MARGIN * 2;

export const DESK_W = 44;
export const DESK_H = 28;

export const WALK_SPEED = 48;

export const PALETTE = {
  bg: 0x0a0c10,
  floor: 0xd8bfa2,
  floorDark: 0xc3a883,
  wall: 0x3a2a1e,
  wallTop: 0x5a3e2a,
  wallInner: 0x8d6b4c,
  corridor: 0x8e8875,
  corridorDark: 0x6f6a5a,
  door: 0x4a311d,
  desk: 0x6a4527,
  deskTop: 0x8a5a34,
  monitor: 0x1a1a22,
  monitorOn: 0x4fb3bf,
  couch: 0x8d3a3a,
  couchDark: 0x5e2525,
  plant: 0x3f7a3a,
  plantPot: 0x6a3b1f,
  signBg: 0x2a2a36,
  signBgLit: 0x4a4438,
  signText: 0xffe9a8,
  signTextDim: 0x6a6458,
  label: 0xffffff,
};

// A palette of agent color schemes (hair, skin, shirt, pants)
export const AGENT_COLORS: Array<{ hair: number; skin: number; shirt: number; pants: number }> = [
  { hair: 0x3a2314, skin: 0xf2c29b, shirt: 0xc3413d, pants: 0x2a3042 }, // red shirt
  { hair: 0x5c3617, skin: 0xe8b58a, shirt: 0x3a6ea5, pants: 0x2a3042 }, // blue
  { hair: 0x1e1a16, skin: 0xe5b890, shirt: 0x6b8f3d, pants: 0x3e2818 }, // green
  { hair: 0xc7803c, skin: 0xf4cfa3, shirt: 0xd4a73d, pants: 0x3e2818 }, // yellow
  { hair: 0x2a1810, skin: 0xc28a66, shirt: 0x7a4ea8, pants: 0x22202a }, // purple
  { hair: 0x806040, skin: 0xf5d1af, shirt: 0x2a9d8f, pants: 0x2c3241 }, // teal
];
