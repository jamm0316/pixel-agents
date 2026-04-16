import { Graphics, Container } from 'pixi.js';
import { PALETTE, LAPTOP_W, LAPTOP_OPEN_SCREEN_H } from './constants';

export type AgentColors = { hair: number; skin: number; shirt: number; pants: number };

// Draw a 16x20 pixel human body into a Graphics.
// Frames: 0=idle A, 1=idle B (breathe), 2=walk A, 3=walk B, 4=type A, 5=type B
export function drawCharacter(g: Graphics, colors: AgentColors, frame: number) {
  g.clear();
  const { hair, skin, shirt, pants } = colors;
  const p = (x: number, y: number, w: number, h: number, c: number) =>
    g.rect(x, y, w, h).fill(c);

  // Breathing bob: idle B raises torso 1px
  const bob = frame === 1 ? -1 : 0;
  // Walking hop
  const hop = frame === 2 || frame === 3 ? (frame === 2 ? -1 : 0) : 0;
  const yOff = bob + hop;

  // Hair back
  p(4, 0 + yOff, 8, 3, hair);
  // Head
  p(4, 3 + yOff, 8, 5, skin);
  // Hair front
  p(4, 3 + yOff, 8, 1, hair);
  p(11, 4 + yOff, 1, 1, hair);
  // Eyes
  p(6, 5 + yOff, 1, 1, 0x1a1a22);
  p(9, 5 + yOff, 1, 1, 0x1a1a22);
  // Mouth
  p(7, 7 + yOff, 2, 1, 0xa36a50);

  // Neck
  p(7, 8 + yOff, 2, 1, skin);

  // Torso / shirt
  p(3, 9 + yOff, 10, 6, shirt);
  p(3, 14 + yOff, 10, 1, shadeDown(shirt));

  // Arms — position depends on frame
  if (frame === 4 || frame === 5) {
    // Typing: both arms forward/down onto keyboard
    const armY = 11 + yOff;
    const flick = frame === 4 ? 0 : 1;
    // Left arm
    p(2, armY, 2, 3, shirt);
    p(3, armY + 3 - flick, 2, 2, skin); // hand
    // Right arm
    p(12, armY, 2, 3, shirt);
    p(11, armY + 3 - (1 - flick), 2, 2, skin); // hand
  } else if (frame === 2 || frame === 3) {
    // Walking: arms swing
    const swing = frame === 2 ? -1 : 1;
    p(2, 9 + swing + yOff, 1, 5, shirt);
    p(13, 9 - swing + yOff, 1, 5, shirt);
    p(2, 14 + swing + yOff, 1, 1, skin);
    p(13, 14 - swing + yOff, 1, 1, skin);
  } else {
    // Idle: arms at side
    p(2, 9 + yOff, 1, 5, shirt);
    p(13, 9 + yOff, 1, 5, shirt);
    p(2, 14 + yOff, 1, 1, skin);
    p(13, 14 + yOff, 1, 1, skin);
  }

  // Pants
  p(4, 15 + yOff, 8, 3, pants);

  // Legs / feet — walking alternates
  if (frame === 2) {
    p(4, 18 + yOff, 3, 2, pants);
    p(10, 18 + yOff, 2, 2, pants);
  } else if (frame === 3) {
    p(5, 18 + yOff, 2, 2, pants);
    p(9, 18 + yOff, 3, 2, pants);
  } else {
    p(4, 18 + yOff, 3, 2, pants);
    p(9, 18 + yOff, 3, 2, pants);
  }
  // Shoes
  p(4, 19 + yOff, 3, 1, 0x1a1a22);
  p(9, 19 + yOff, 3, 1, 0x1a1a22);
}

function shadeDown(color: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return ((r * 0.75) << 16) | ((g * 0.75) << 8) | (b * 0.75);
}

// Room furniture

export function drawLaptopClosed(g: Graphics, x: number, y: number): void {
  g.rect(x, y + 1, LAPTOP_W, 9).fill(PALETTE.laptopBodyDark);
  g.rect(x, y, LAPTOP_W, 9).fill(PALETTE.laptopBody);
  g.rect(x, y, LAPTOP_W, 1).fill(PALETTE.monitor);
  g.rect(x + 1, y + 8, 12, 1).fill(PALETTE.laptopBodyDark);
}

export function drawLaptopOpen(g: Graphics, x: number, y: number): void {
  const screenH = LAPTOP_OPEN_SCREEN_H;
  // 화면 (위)
  g.rect(x, y - screenH, LAPTOP_W, screenH).fill(PALETTE.monitor);
  g.rect(x + 1, y - screenH + 1, 12, screenH - 2).fill(PALETTE.monitorOn);
  // 힌지
  g.rect(x, y - 1, LAPTOP_W, 1).fill(PALETTE.laptopBodyDark);
  // 베이스 (키보드)
  g.rect(x, y, LAPTOP_W, 6).fill(PALETTE.laptopBody);
  g.rect(x + 1, y + 5, 12, 1).fill(PALETTE.laptopBodyDark);
  // 키보드 점 (3×2 도트)
  for (let kx = 0; kx < 3; kx++) {
    for (let ky = 0; ky < 2; ky++) {
      g.rect(x + 3 + kx * 4, y + 1 + ky * 2, 2, 1).fill(PALETTE.laptopBodyDark);
    }
  }
}

export function drawSideTable(g: Graphics, x: number, y: number, w: number, h: number): void {
  // 그림자
  g.rect(x + 1, y + 1, w, h).fill(0x2a1a10);
  // 상판
  g.rect(x, y, w, h).fill(PALETTE.deskTop);
  // 가장자리 음영
  g.rect(x, y, 1, h).fill(PALETTE.desk);
  g.rect(x, y + h - 1, w, 1).fill(PALETTE.desk);
  g.rect(x + w - 1, y, 1, h).fill(PALETTE.desk);
}

export function drawCouch(g: Graphics, x: number, y: number) {
  const w = 70;
  const h = 22;
  // Shadow
  g.rect(x, y + h - 3, w, 3).fill(0x2a1010);
  // Base
  g.rect(x, y + 6, w, h - 8).fill(PALETTE.couch);
  // Back
  g.rect(x, y, w, 10).fill(PALETTE.couchDark);
  g.rect(x, y, w, 2).fill(PALETTE.couch);
  // Cushion separators
  g.rect(x + w / 3, y + 8, 1, 10).fill(PALETTE.couchDark);
  g.rect(x + (w * 2) / 3, y + 8, 1, 10).fill(PALETTE.couchDark);
  // Armrests
  g.rect(x - 2, y + 4, 4, h - 6).fill(PALETTE.couchDark);
  g.rect(x + w - 2, y + 4, 4, h - 6).fill(PALETTE.couchDark);
}

export function drawPlant(g: Graphics, x: number, y: number) {
  // Pot
  g.rect(x + 2, y + 14, 12, 6).fill(PALETTE.plantPot);
  g.rect(x + 2, y + 14, 12, 1).fill(0x8b5028);
  // Leaves
  g.rect(x + 4, y + 6, 8, 8).fill(PALETTE.plant);
  g.rect(x + 2, y + 8, 4, 6).fill(PALETTE.plant);
  g.rect(x + 10, y + 8, 4, 6).fill(PALETTE.plant);
  g.rect(x + 6, y + 2, 4, 6).fill(0x4f9044);
  // Highlight
  g.rect(x + 8, y + 4, 2, 4).fill(0x6cc159);
}

export type Rect = { x: number; y: number; w: number; h: number };
export type DoorSide = 'top' | 'bottom' | 'left' | 'right';

// Top-down room floor
export function drawRoomFloor(g: Graphics, bounds: Rect) {
  g.rect(bounds.x, bounds.y, bounds.w, bounds.h).fill(PALETTE.floor);
  const planks = 5;
  for (let i = 1; i < planks; i++) {
    const yy = bounds.y + (bounds.h / planks) * i;
    g.rect(bounds.x, yy, bounds.w, 1).fill(PALETTE.floorDark);
  }
}

// Top-down room walls with a door gap on one side.
// `door.center` is the X coord for top/bottom doors, Y coord for left/right doors.
export function drawRoomWalls(
  g: Graphics,
  bounds: Rect,
  door: { side: DoorSide; center: number; width: number }
) {
  const t = 2;
  const wallColor = PALETTE.wallTop;

  const horizWall = (side: 'top' | 'bottom') => {
    const y = side === 'top' ? bounds.y : bounds.y + bounds.h - t;
    if (door.side === side) {
      const gapL = door.center - door.width / 2;
      const gapR = door.center + door.width / 2;
      g.rect(bounds.x, y, gapL - bounds.x, t).fill(wallColor);
      g.rect(gapR, y, bounds.x + bounds.w - gapR, t).fill(wallColor);
      g.rect(gapL - 1, y, 1, t + 1).fill(PALETTE.door);
      g.rect(gapR, y, 1, t + 1).fill(PALETTE.door);
    } else {
      g.rect(bounds.x, y, bounds.w, t).fill(wallColor);
    }
  };
  const vertWall = (side: 'left' | 'right') => {
    const x = side === 'left' ? bounds.x : bounds.x + bounds.w - t;
    if (door.side === side) {
      const gapT = door.center - door.width / 2;
      const gapB = door.center + door.width / 2;
      g.rect(x, bounds.y, t, gapT - bounds.y).fill(wallColor);
      g.rect(x, gapB, t, bounds.y + bounds.h - gapB).fill(wallColor);
      g.rect(x, gapT - 1, t + 1, 1).fill(PALETTE.door);
      g.rect(x, gapB, t + 1, 1).fill(PALETTE.door);
    } else {
      g.rect(x, bounds.y, t, bounds.h).fill(wallColor);
    }
  };

  horizWall('top');
  horizWall('bottom');
  vertWall('left');
  vertWall('right');
}

export function drawCorridorFloor(g: Graphics, bounds: Rect) {
  g.rect(bounds.x, bounds.y, bounds.w, bounds.h).fill(PALETTE.corridor);
  // Tile pattern
  const cols = Math.max(1, Math.floor(bounds.w / 18));
  for (let i = 1; i < cols; i++) {
    const x = bounds.x + (bounds.w / cols) * i;
    g.rect(x, bounds.y, 1, bounds.h).fill(PALETTE.corridorDark);
  }
  g.rect(bounds.x, bounds.y + Math.floor(bounds.h / 2), bounds.w, 1).fill(PALETTE.corridorDark);
}

export function drawOfficeBackground(g: Graphics, bounds: Rect) {
  g.rect(bounds.x - 4, bounds.y - 4, bounds.w + 8, bounds.h + 8).fill(0x0f1115);
}

export function drawRoomDimOverlay(g: Graphics, bounds: Rect) {
  const inset = 2;
  g.rect(
    bounds.x + inset,
    bounds.y + inset,
    bounds.w - inset * 2,
    bounds.h - inset * 2
  ).fill({ color: 0x050607, alpha: 0.78 });
}

// A small 16x22 pixel tree — trunk + bushy crown
export function drawTree(g: Graphics, x: number, y: number) {
  // Trunk
  g.rect(x + 7, y + 14, 3, 8).fill(0x5a3820);
  g.rect(x + 7, y + 14, 1, 8).fill(0x3a2410);
  // Shadow base
  g.rect(x + 5, y + 21, 7, 1).fill(0x1a2410);
  // Crown back
  g.rect(x + 2, y + 1, 12, 14).fill(0x234d22);
  g.rect(x + 1, y + 4, 14, 8).fill(0x234d22);
  // Crown mid
  g.rect(x + 3, y + 2, 10, 12).fill(0x3a8233);
  g.rect(x + 2, y + 5, 12, 6).fill(0x3a8233);
  // Crown highlight
  g.rect(x + 5, y + 3, 5, 4).fill(0x58a74a);
  g.rect(x + 6, y + 4, 3, 2).fill(0x7bc060);
}

// Outdoor grass patch with a few trees — fills empty office corners
export function drawOutdoorPatch(g: Graphics, bounds: Rect) {
  const grass = 0x4a7f3c;
  const grassDark = 0x365f2c;
  const grassLight = 0x5d9749;

  g.rect(bounds.x, bounds.y, bounds.w, bounds.h).fill(grass);

  // Deterministic tuft sprinkle
  const seed = (bounds.x * 131 + bounds.y * 71) | 0;
  let rng = seed;
  const rand = () => {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    return rng / 0x7fffffff;
  };
  for (let i = 0; i < 18; i++) {
    const tx = Math.floor(bounds.x + 2 + rand() * (bounds.w - 4));
    const ty = Math.floor(bounds.y + 2 + rand() * (bounds.h - 4));
    g.rect(tx, ty, 1, 1).fill(grassDark);
    if (rand() < 0.5) g.rect(tx + 1, ty, 1, 1).fill(grassLight);
  }

  // Small path stones
  for (let i = 0; i < 4; i++) {
    const px = Math.floor(bounds.x + 4 + rand() * (bounds.w - 10));
    const py = Math.floor(bounds.y + 4 + rand() * (bounds.h - 6));
    g.rect(px, py, 3, 2).fill(0x8a8578);
    g.rect(px, py, 3, 1).fill(0xa6a090);
  }

  // Trees at a few fixed offsets (avoid the edges so crowns don't clip)
  const positions = [
    { dx: 8, dy: 10 },
    { dx: Math.max(24, bounds.w - 32), dy: 18 },
    { dx: 22, dy: Math.max(30, bounds.h - 40) },
    { dx: Math.max(40, bounds.w - 50), dy: Math.max(36, bounds.h - 30) },
  ];
  for (const p of positions) {
    drawTree(g, bounds.x + p.dx, bounds.y + p.dy);
  }

  // One bush
  const bx = bounds.x + bounds.w / 2 - 4;
  const by = bounds.y + bounds.h / 2 + 8;
  g.rect(bx, by, 8, 5).fill(grassDark);
  g.rect(bx + 1, by + 1, 6, 3).fill(0x3a8233);
  g.rect(bx + 3, by + 1, 2, 1).fill(grassLight);
}

// Bathroom: tiled floor + 2 toilet stalls along the outer wall + a sink
export function drawBathroom(g: Graphics, bounds: Rect) {
  const tile = 0xb4c9d3;
  const grout = 0x7f95a2;
  g.rect(bounds.x + 2, bounds.y + 2, bounds.w - 4, bounds.h - 4).fill(tile);
  const tileStep = 10;
  for (let y = bounds.y + 2 + tileStep; y < bounds.y + bounds.h - 2; y += tileStep) {
    g.rect(bounds.x + 2, y, bounds.w - 4, 1).fill(grout);
  }
  for (let x = bounds.x + 2 + tileStep; x < bounds.x + bounds.w - 2; x += tileStep) {
    g.rect(x, bounds.y + 2, 1, bounds.h - 4).fill(grout);
  }

  // 2 stalls along the outer (door-opposite) side
  const stallCount = 2;
  const stallW = 20;
  const stallH = 22;
  const stallMarginX = 6;
  const stallMarginY = 6;
  const stallX = bounds.x + stallMarginX;
  const stallSpan = stallH * stallCount + (stallCount - 1) * 3;
  const stallYStart = bounds.y + (bounds.h - stallSpan) / 2;
  for (let i = 0; i < stallCount; i++) {
    const sy = stallYStart + i * (stallH + 3);
    // stall backing
    g.rect(stallX, sy, stallW, stallH).fill(0xd6e2e8);
    // divider lines
    g.rect(stallX, sy, stallW, 1).fill(0x4a5560);
    g.rect(stallX, sy + stallH - 1, stallW, 1).fill(0x4a5560);
    g.rect(stallX + stallW - 1, sy, 1, stallH).fill(0x4a5560);
    // toilet: tank + bowl
    const tx = stallX + 4;
    const ty = sy + 3;
    g.rect(tx, ty, 8, 5).fill(0xeeeeee);            // tank
    g.rect(tx, ty, 8, 1).fill(0x9aa8b2);
    g.rect(tx - 1, ty + 6, 10, 8).fill(0xf7f7f7);    // bowl
    g.rect(tx, ty + 7, 8, 6).fill(0xd4dee4);         // bowl inner
    g.rect(tx + 3, ty + 2, 2, 1).fill(0x9aa8b2);     // flush button
    void stallMarginY;
  }

  // Sink on the opposite side (near door)
  const snW = 16;
  const snH = 8;
  const snX = bounds.x + bounds.w - snW - 6;
  const snY = bounds.y + (bounds.h - snH) / 2;
  g.rect(snX, snY, snW, snH).fill(0xececec);
  g.rect(snX, snY, snW, 1).fill(0x9aa8b2);
  g.rect(snX + 2, snY + 2, snW - 4, snH - 4).fill(0xbbd1dc);
  g.rect(snX + snW / 2 - 1, snY + snH - 2, 2, 2).fill(0x8a9ba5);
  // Mirror above the sink
  g.rect(snX, snY - 6, snW, 5).fill(0x223038);
  g.rect(snX + 1, snY - 5, snW - 2, 3).fill(0x8ab4c4);
}

// Ping-pong room: wood floor + central table with net
export function drawPingPong(g: Graphics, bounds: Rect) {
  const wood = 0xc48a52;
  const woodDark = 0xa8733d;
  g.rect(bounds.x + 2, bounds.y + 2, bounds.w - 4, bounds.h - 4).fill(wood);
  for (let i = 1; i < 6; i++) {
    const y = bounds.y + 2 + ((bounds.h - 4) / 6) * i;
    g.rect(bounds.x + 2, y, bounds.w - 4, 1).fill(woodDark);
  }

  // Table
  const tw = Math.min(bounds.w - 24, 56);
  const th = 22;
  const tx = bounds.x + (bounds.w - tw) / 2;
  const ty = bounds.y + (bounds.h - th) / 2;
  // Shadow
  g.rect(tx + 1, ty + th, tw, 2).fill(0x1a1510);
  // Top (green)
  g.rect(tx, ty, tw, th).fill(0x2a6f3a);
  g.rect(tx, ty, tw, 1).fill(0x5ca65e);
  // White border
  g.rect(tx + 1, ty + 1, tw - 2, 1).fill(0xeef5ee);
  g.rect(tx + 1, ty + th - 2, tw - 2, 1).fill(0xeef5ee);
  g.rect(tx + 1, ty + 1, 1, th - 2).fill(0xeef5ee);
  g.rect(tx + tw - 2, ty + 1, 1, th - 2).fill(0xeef5ee);
  // Center line along the length
  g.rect(tx + 1, ty + Math.floor(th / 2), tw - 2, 1).fill(0xeef5ee);
  // Net across middle (vertical)
  const netX = tx + Math.floor(tw / 2) - 1;
  g.rect(netX, ty - 2, 2, th + 4).fill(0xefefef);
  g.rect(netX, ty - 2, 2, 1).fill(0x4a4a4a);
  g.rect(netX, ty + th + 1, 2, 1).fill(0x4a4a4a);
  // Paddles on the table
  g.rect(tx + 4, ty + 4, 4, 5).fill(0x8a3a24);
  g.rect(tx + 4, ty + 9, 1, 2).fill(0x3a2010);
  g.rect(tx + tw - 8, ty + th - 9, 4, 5).fill(0x1a3a6a);
  g.rect(tx + tw - 8, ty + th - 4, 1, 2).fill(0x0a2040);
  // Ball
  g.rect(tx + tw / 2 + 4, ty + 3, 2, 2).fill(0xf5f5f5);

  // Scoreboard on wall
  const sbX = bounds.x + bounds.w - 22;
  const sbY = bounds.y + 4;
  g.rect(sbX, sbY, 16, 8).fill(0x1a1a22);
  g.rect(sbX + 1, sbY + 1, 14, 6).fill(0x222c1a);
  g.rect(sbX + 3, sbY + 2, 3, 4).fill(0x8ae83a);
  g.rect(sbX + 10, sbY + 2, 3, 4).fill(0x8ae83a);
}
