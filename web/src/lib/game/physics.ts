/**
 * KC Blue Wall — Matter.js physics setup.
 *
 * Creates the world, ground, walls, ragdoll factory, and brick factory.
 * The physics runs at 60fps and produces body positions/angles that the
 * renderer draws each frame.
 */

import Matter from "matter-js";

const {
  Engine,
  World,
  Bodies,
  Body,
  Composite,
  Constraint,
  Events,
  Vector,
} = Matter;

// ─── Constants ──────────────────────────────────────────────────────────

export const WORLD_WIDTH = 1200;
export const WORLD_HEIGHT = 800;
export const GROUND_Y = WORLD_HEIGHT - 40;
export const BRICK_W = 40;
export const BRICK_H = 20;
export const WALL_ZONE_X = WORLD_WIDTH / 2;

// ─── Category bitmasks for collision filtering ──────────────────────────
const CAT_GROUND = 0x0001;
const CAT_BRICK = 0x0002;
const CAT_PLAYER = 0x0004;

// ─── World setup ────────────────────────────────────────────────────────

export function createWorld() {
  const engine = Engine.create({
    gravity: { x: 0, y: 1.2, scale: 0.001 },
  });

  // Ground
  const ground = Bodies.rectangle(
    WORLD_WIDTH / 2,
    GROUND_Y + 20,
    WORLD_WIDTH + 200,
    40,
    {
      isStatic: true,
      friction: 0.8,
      label: "ground",
      render: { fillStyle: "#0A1428" },
      collisionFilter: { category: CAT_GROUND },
    }
  );

  // Side walls (invisible)
  const wallL = Bodies.rectangle(-10, WORLD_HEIGHT / 2, 20, WORLD_HEIGHT * 3, {
    isStatic: true,
    label: "wallL",
  });
  const wallR = Bodies.rectangle(
    WORLD_WIDTH + 10,
    WORLD_HEIGHT / 2,
    20,
    WORLD_HEIGHT * 3,
    { isStatic: true, label: "wallR" }
  );

  Composite.add(engine.world, [ground, wallL, wallR]);

  return engine;
}

// ─── Ragdoll factory ────────────────────────────────────────────────────

export interface Ragdoll {
  id: string;
  composite: Matter.Composite;
  head: Matter.Body;
  torso: Matter.Body;
  armL: Matter.Body;
  armR: Matter.Body;
  legL: Matter.Body;
  legR: Matter.Body;
  isRagdolling: boolean;
  ragdollTimer: number;
  score: number;
  heldBrick: Matter.Body | null;
}

export function createRagdoll(
  x: number,
  y: number,
  id: string
): Ragdoll {
  const scale = 0.8;
  const headR = 10 * scale;
  const torsoW = 16 * scale;
  const torsoH = 24 * scale;
  const limbW = 6 * scale;
  const limbH = 18 * scale;

  const group = Body.nextGroup(true); // parts don't collide with each other

  const head = Bodies.circle(x, y - torsoH - headR, headR, {
    label: "head",
    collisionFilter: { group, category: CAT_PLAYER },
    friction: 0.3,
    restitution: 0.2,
    density: 0.002,
  });

  const torso = Bodies.rectangle(x, y, torsoW, torsoH, {
    label: "torso",
    collisionFilter: { group, category: CAT_PLAYER },
    friction: 0.5,
    density: 0.003,
  });

  const armL = Bodies.rectangle(
    x - torsoW / 2 - limbW,
    y - torsoH / 4,
    limbW,
    limbH,
    {
      label: "armL",
      collisionFilter: { group, category: CAT_PLAYER },
      density: 0.001,
    }
  );

  const armR = Bodies.rectangle(
    x + torsoW / 2 + limbW,
    y - torsoH / 4,
    limbW,
    limbH,
    {
      label: "armR",
      collisionFilter: { group, category: CAT_PLAYER },
      density: 0.001,
    }
  );

  const legL = Bodies.rectangle(
    x - torsoW / 4,
    y + torsoH / 2 + limbH / 2,
    limbW,
    limbH,
    {
      label: "legL",
      collisionFilter: { group, category: CAT_PLAYER },
      density: 0.001,
    }
  );

  const legR = Bodies.rectangle(
    x + torsoW / 4,
    y + torsoH / 2 + limbH / 2,
    limbW,
    limbH,
    {
      label: "legR",
      collisionFilter: { group, category: CAT_PLAYER },
      density: 0.001,
    }
  );

  // Joints
  const stiffness = 0.6;
  const joints = [
    // Neck
    Constraint.create({
      bodyA: head,
      bodyB: torso,
      pointA: { x: 0, y: headR },
      pointB: { x: 0, y: -torsoH / 2 },
      stiffness,
      length: 2,
      label: "neck",
    }),
    // Left shoulder
    Constraint.create({
      bodyA: torso,
      bodyB: armL,
      pointA: { x: -torsoW / 2, y: -torsoH / 4 },
      pointB: { x: limbW / 2, y: -limbH / 2 },
      stiffness: stiffness * 0.8,
      length: 2,
      label: "shoulderL",
    }),
    // Right shoulder
    Constraint.create({
      bodyA: torso,
      bodyB: armR,
      pointA: { x: torsoW / 2, y: -torsoH / 4 },
      pointB: { x: -limbW / 2, y: -limbH / 2 },
      stiffness: stiffness * 0.8,
      length: 2,
      label: "shoulderR",
    }),
    // Left hip
    Constraint.create({
      bodyA: torso,
      bodyB: legL,
      pointA: { x: -torsoW / 4, y: torsoH / 2 },
      pointB: { x: 0, y: -limbH / 2 },
      stiffness,
      length: 2,
      label: "hipL",
    }),
    // Right hip
    Constraint.create({
      bodyA: torso,
      bodyB: legR,
      pointA: { x: torsoW / 4, y: torsoH / 2 },
      pointB: { x: 0, y: -limbH / 2 },
      stiffness,
      length: 2,
      label: "hipR",
    }),
  ];

  const composite = Composite.create({ label: `ragdoll-${id}` });
  Composite.add(composite, [head, torso, armL, armR, legL, legR, ...joints]);

  return {
    id,
    composite,
    head,
    torso,
    armL,
    armR,
    legL,
    legR,
    isRagdolling: false,
    ragdollTimer: 0,
    score: 0,
    heldBrick: null,
  };
}

// ─── Brick factory ──────────────────────────────────────────────────────

export function createBrick(x: number, y: number, isGolden = false): Matter.Body {
  return Bodies.rectangle(x, y, BRICK_W, BRICK_H, {
    label: isGolden ? "golden_brick" : "brick",
    friction: 0.6,
    restitution: 0.1,
    density: 0.004,
    collisionFilter: { category: CAT_BRICK },
    render: {
      fillStyle: isGolden ? "#C8AA6E" : "#0057FF",
    },
  });
}

// ─── Ragdoll activation ─────────────────────────────────────────────────

export function activateRagdoll(ragdoll: Ragdoll) {
  ragdoll.isRagdolling = true;
  ragdoll.ragdollTimer = 120; // 2 seconds at 60fps

  // Make joints soft
  const constraints = Composite.allConstraints(ragdoll.composite);
  for (const c of constraints) {
    (c as { stiffness: number }).stiffness = 0.05;
  }

  // Drop held brick
  if (ragdoll.heldBrick) {
    ragdoll.heldBrick = null;
  }
}

export function deactivateRagdoll(ragdoll: Ragdoll) {
  ragdoll.isRagdolling = false;

  // Restore stiff joints
  const constraints = Composite.allConstraints(ragdoll.composite);
  for (const c of constraints) {
    const label = (c as { label?: string }).label ?? "";
    (c as { stiffness: number }).stiffness = label.includes("shoulder") ? 0.48 : 0.6;
  }
}

// ─── Player movement ────────────────────────────────────────────────────

export function movePlayer(
  ragdoll: Ragdoll,
  direction: -1 | 0 | 1,
  jump: boolean
) {
  if (ragdoll.isRagdolling) return;

  const force = 0.003;
  const jumpForce = -0.06;

  if (direction !== 0) {
    Body.applyForce(ragdoll.torso, ragdoll.torso.position, {
      x: force * direction,
      y: 0,
    });
  }

  if (jump && Math.abs(ragdoll.torso.velocity.y) < 0.5) {
    Body.applyForce(ragdoll.torso, ragdoll.torso.position, {
      x: 0,
      y: jumpForce,
    });
  }
}

// ─── Throw brick ────────────────────────────────────────────────────────

export function throwBrick(
  ragdoll: Ragdoll,
  targetX: number,
  targetY: number,
  engine: Matter.Engine
) {
  if (!ragdoll.heldBrick) return null;

  const brick = ragdoll.heldBrick;
  ragdoll.heldBrick = null;

  const pos = ragdoll.torso.position;
  const dir = Vector.normalise(
    Vector.sub({ x: targetX, y: targetY }, pos)
  );
  const throwForce = 0.015;

  Body.setVelocity(brick, {
    x: dir.x * throwForce * 1000,
    y: dir.y * throwForce * 1000,
  });

  return brick;
}

// ─── Grab nearest brick ─────────────────────────────────────────────────

export function grabNearestBrick(
  ragdoll: Ragdoll,
  engine: Matter.Engine
): boolean {
  if (ragdoll.heldBrick || ragdoll.isRagdolling) return false;

  const pos = ragdoll.torso.position;
  const bodies = Composite.allBodies(engine.world);
  let nearest: Matter.Body | null = null;
  let nearestDist = 80; // grab radius

  for (const body of bodies) {
    if (
      body.label === "brick" ||
      body.label === "golden_brick"
    ) {
      const dist = Vector.magnitude(Vector.sub(body.position, pos));
      if (dist < nearestDist) {
        nearest = body;
        nearestDist = dist;
      }
    }
  }

  if (nearest) {
    ragdoll.heldBrick = nearest;
    return true;
  }
  return false;
}
