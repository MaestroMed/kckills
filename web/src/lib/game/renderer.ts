/**
 * KC Blue Wall — Canvas 2D renderer.
 *
 * Draws ragdoll players, bricks, ground, wall zone, score, and effects.
 * All rendering is done via Canvas 2D for performance (60fps with 500+ bodies).
 */

import type { Ragdoll } from "./physics";
import { WORLD_WIDTH, WORLD_HEIGHT, GROUND_Y, BRICK_W, BRICK_H } from "./physics";
import Matter from "matter-js";

const KC_BLUE = "#0057FF";
const KC_GOLD = "#C8AA6E";
const KC_DARK = "#010A13";
const KC_SURFACE = "#0A1428";
const BRICK_BLUE = "#0057FF";
const BRICK_GOLDEN = "#C8AA6E";
const PLAYER_JERSEY = "#0057FF";
const PLAYER_SKIN = "#F0D5A0";

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  engine: Matter.Engine,
  player: Ragdoll,
  wallHeight: number,
  cameraY: number,
) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const scaleX = w / WORLD_WIDTH;
  const scaleY = h / WORLD_HEIGHT;
  const scale = Math.min(scaleX, scaleY);

  ctx.save();
  ctx.clearRect(0, 0, w, h);

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#000511");
  grad.addColorStop(0.7, KC_SURFACE);
  grad.addColorStop(1, KC_DARK);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Apply camera
  ctx.translate(w / 2, h / 2);
  ctx.scale(scale, scale);
  ctx.translate(-WORLD_WIDTH / 2, -WORLD_HEIGHT / 2 + cameraY);

  // Wall zone indicator
  ctx.fillStyle = "rgba(0, 87, 255, 0.05)";
  ctx.fillRect(WORLD_WIDTH / 2 - 150, 0, 300, GROUND_Y);
  ctx.strokeStyle = "rgba(0, 87, 255, 0.15)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(WORLD_WIDTH / 2 - 150, 0, 300, GROUND_Y);
  ctx.setLineDash([]);

  // 257 line
  const line257Y = GROUND_Y - 257 * (BRICK_H + 1);
  if (line257Y > -500) {
    ctx.strokeStyle = KC_GOLD + "40";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, line257Y);
    ctx.lineTo(WORLD_WIDTH, line257Y);
    ctx.stroke();
    ctx.fillStyle = KC_GOLD + "60";
    ctx.font = "10px monospace";
    ctx.fillText("257 — BLUE WALL", WORLD_WIDTH / 2 - 50, line257Y - 4);
  }

  // Ground
  ctx.fillStyle = KC_SURFACE;
  ctx.fillRect(-100, GROUND_Y, WORLD_WIDTH + 200, 80);
  ctx.fillStyle = KC_GOLD + "30";
  ctx.fillRect(-100, GROUND_Y, WORLD_WIDTH + 200, 2);

  // All bodies
  const bodies = Matter.Composite.allBodies(engine.world);
  for (const body of bodies) {
    if (body.isStatic && body.label !== "ground") continue;

    if (body.label === "brick" || body.label === "golden_brick") {
      drawBrick(ctx, body);
    }
  }

  // Player ragdoll
  drawRagdoll(ctx, player);

  // Held brick follows player
  if (player.heldBrick) {
    const hb = player.heldBrick;
    const headPos = player.head.position;
    Matter.Body.setPosition(hb, { x: headPos.x, y: headPos.y - 20 });
    Matter.Body.setVelocity(hb, { x: 0, y: 0 });
    drawBrick(ctx, hb);
  }

  ctx.restore();

  // ─── UI overlay (not affected by camera) ──────────────────────
  ctx.fillStyle = KC_GOLD;
  ctx.font = "bold 14px monospace";
  ctx.fillText(`Score: ${player.score}`, 20, 30);
  ctx.fillText(`Wall: ${wallHeight}`, 20, 50);

  if (player.isRagdolling) {
    ctx.fillStyle = "#E84057";
    ctx.font = "bold 24px sans-serif";
    ctx.fillText("RAGDOLL!", w / 2 - 60, 40);
  }

  // Controls hint
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.font = "11px monospace";
  ctx.fillText("← → move  |  SPACE jump  |  E grab  |  CLICK throw", w / 2 - 180, h - 15);
}

function drawBrick(ctx: CanvasRenderingContext2D, body: Matter.Body) {
  const { x, y } = body.position;
  const angle = body.angle;
  const isGolden = body.label === "golden_brick";

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // Brick body
  ctx.fillStyle = isGolden ? BRICK_GOLDEN : BRICK_BLUE;
  ctx.fillRect(-BRICK_W / 2, -BRICK_H / 2, BRICK_W, BRICK_H);

  // Brick outline
  ctx.strokeStyle = isGolden ? "#785A28" : "#003399";
  ctx.lineWidth = 1;
  ctx.strokeRect(-BRICK_W / 2, -BRICK_H / 2, BRICK_W, BRICK_H);

  // Brick line detail
  ctx.strokeStyle = isGolden ? "#FFD700" + "40" : "#4488FF" + "40";
  ctx.beginPath();
  ctx.moveTo(0, -BRICK_H / 2);
  ctx.lineTo(0, BRICK_H / 2);
  ctx.stroke();

  ctx.restore();
}

function drawRagdoll(ctx: CanvasRenderingContext2D, ragdoll: Ragdoll) {
  const alpha = ragdoll.isRagdolling ? 0.6 : 1;
  ctx.globalAlpha = alpha;

  // Limbs (behind torso)
  drawLimb(ctx, ragdoll.armL, PLAYER_JERSEY);
  drawLimb(ctx, ragdoll.armR, PLAYER_JERSEY);
  drawLimb(ctx, ragdoll.legL, "#1a1a2e");
  drawLimb(ctx, ragdoll.legR, "#1a1a2e");

  // Torso (KC jersey)
  const { x: tx, y: ty } = ragdoll.torso.position;
  const ta = ragdoll.torso.angle;
  ctx.save();
  ctx.translate(tx, ty);
  ctx.rotate(ta);
  ctx.fillStyle = PLAYER_JERSEY;
  ctx.fillRect(-8, -12, 16, 24);
  // KC text on jersey
  ctx.fillStyle = "white";
  ctx.font = "bold 7px sans-serif";
  ctx.fillText("KC", -6, 2);
  ctx.restore();

  // Head
  const { x: hx, y: hy } = ragdoll.head.position;
  ctx.beginPath();
  ctx.arc(hx, hy, 10, 0, Math.PI * 2);
  ctx.fillStyle = PLAYER_SKIN;
  ctx.fill();

  // Eyes
  ctx.fillStyle = ragdoll.isRagdolling ? "#E84057" : "#333";
  ctx.beginPath();
  ctx.arc(hx - 3, hy - 2, 1.5, 0, Math.PI * 2);
  ctx.arc(hx + 3, hy - 2, 1.5, 0, Math.PI * 2);
  ctx.fill();

  // Mouth
  if (ragdoll.isRagdolling) {
    ctx.beginPath();
    ctx.arc(hx, hy + 3, 3, 0, Math.PI);
    ctx.strokeStyle = "#E84057";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}

function drawLimb(
  ctx: CanvasRenderingContext2D,
  body: Matter.Body,
  color: string
) {
  const { x, y } = body.position;
  const a = body.angle;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.fillStyle = color;
  ctx.fillRect(-3, -9, 6, 18);
  ctx.restore();
}
