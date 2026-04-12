"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import Matter from "matter-js";
import {
  createWorld,
  createRagdoll,
  createBrick,
  activateRagdoll,
  deactivateRagdoll,
  movePlayer,
  throwBrick,
  grabNearestBrick,
  WORLD_WIDTH,
  GROUND_Y,
  BRICK_H,
  type Ragdoll,
} from "@/lib/game/physics";
import { renderFrame } from "@/lib/game/renderer";

/**
 * KC Blue Wall Builder — Main game canvas.
 *
 * Handles: physics loop, input, brick spawning, collision detection,
 * ragdoll state, scoring, and rendering. All in one component for the MVP.
 */
export function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Matter.Engine | null>(null);
  const playerRef = useRef<Ragdoll | null>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const mouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const frameRef = useRef<number>(0);
  const wallHeightRef = useRef(0);
  const [score, setScore] = useState(0);
  const [wallHeight, setWallHeight] = useState(0);

  // ─── Initialize engine + player ────────────────────────────────
  useEffect(() => {
    const engine = createWorld();
    engineRef.current = engine;

    const player = createRagdoll(200, GROUND_Y - 60, "local");
    playerRef.current = player;
    Matter.Composite.add(engine.world, player.composite);

    // Spawn some initial bricks
    for (let i = 0; i < 5; i++) {
      const bx = 100 + Math.random() * (WORLD_WIDTH - 200);
      const brick = createBrick(bx, GROUND_Y - 30 - i * 25);
      Matter.Composite.add(engine.world, brick);
    }

    // ─── Collision detection ────────────────────────────────────
    Matter.Events.on(engine, "collisionStart", (event) => {
      for (const pair of event.pairs) {
        const { bodyA, bodyB } = pair;

        // Brick hits player → ragdoll
        const isBrickA = bodyA.label === "brick" || bodyA.label === "golden_brick";
        const isBrickB = bodyB.label === "brick" || bodyB.label === "golden_brick";
        const isPlayerA = bodyA.label === "torso" || bodyA.label === "head";
        const isPlayerB = bodyB.label === "torso" || bodyB.label === "head";

        if ((isBrickA && isPlayerB) || (isBrickB && isPlayerA)) {
          const brick = isBrickA ? bodyA : bodyB;
          const speed = Matter.Vector.magnitude(brick.velocity);
          if (speed > 3 && player && !player.isRagdolling) {
            activateRagdoll(player);
          }
        }
      }
    });

    return () => {
      Matter.Engine.clear(engine);
    };
  }, []);

  // ─── Game loop ─────────────────────────────────────────────────
  useEffect(() => {
    let raf: number;

    function loop() {
      const engine = engineRef.current;
      const player = playerRef.current;
      const canvas = canvasRef.current;
      if (!engine || !player || !canvas) {
        raf = requestAnimationFrame(loop);
        return;
      }

      // Physics step
      Matter.Engine.update(engine, 1000 / 60);

      // Player input
      const keys = keysRef.current;
      const dir =
        keys.has("ArrowLeft") || keys.has("a") || keys.has("A")
          ? -1
          : keys.has("ArrowRight") || keys.has("d") || keys.has("D")
          ? 1
          : 0;
      const jump = keys.has(" ") || keys.has("ArrowUp") || keys.has("w") || keys.has("W");
      movePlayer(player, dir as -1 | 0 | 1, jump);

      // Ragdoll timer
      if (player.isRagdolling) {
        player.ragdollTimer--;
        if (player.ragdollTimer <= 0) {
          deactivateRagdoll(player);
        }
      }

      // Held brick follows head
      if (player.heldBrick && !player.isRagdolling) {
        Matter.Body.setPosition(player.heldBrick, {
          x: player.head.position.x,
          y: player.head.position.y - 20,
        });
        Matter.Body.setVelocity(player.heldBrick, { x: 0, y: 0 });
      }

      // Spawn bricks periodically
      frameRef.current++;
      if (frameRef.current % 120 === 0) {
        // Every 2 seconds
        const bx = 100 + Math.random() * (WORLD_WIDTH - 200);
        const brick = createBrick(bx, -50);
        Matter.Composite.add(engine.world, brick);
      }

      // Calculate wall height (bricks in wall zone)
      let maxWallY = GROUND_Y;
      const bodies = Matter.Composite.allBodies(engine.world);
      for (const body of bodies) {
        if (
          (body.label === "brick" || body.label === "golden_brick") &&
          Math.abs(body.position.x - WORLD_WIDTH / 2) < 160 &&
          body.position.y < maxWallY &&
          Math.abs(body.velocity.y) < 0.5 // settled
        ) {
          maxWallY = body.position.y;
        }
      }
      const height = Math.max(
        0,
        Math.floor((GROUND_Y - maxWallY) / (BRICK_H + 1))
      );
      if (height !== wallHeightRef.current) {
        wallHeightRef.current = height;
        setWallHeight(height);
      }

      // Camera follows wall height
      const cameraY = Math.max(0, (GROUND_Y - maxWallY - 300) * 0.3);

      // Render
      const ctx = canvas.getContext("2d");
      if (ctx) {
        renderFrame(ctx, engine, player, height, cameraY);
      }

      raf = requestAnimationFrame(loop);
    }

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ─── Input handlers ────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      keysRef.current.add(e.key);

      // E = grab
      if ((e.key === "e" || e.key === "E") && playerRef.current && engineRef.current) {
        const grabbed = grabNearestBrick(playerRef.current, engineRef.current);
        if (grabbed) {
          // Score for picking up
        }
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      keysRef.current.delete(e.key);
    }

    function onMouseMove(e: MouseEvent) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = {
        x: ((e.clientX - rect.left) / rect.width) * WORLD_WIDTH,
        y: ((e.clientY - rect.top) / rect.height) * 800,
      };
    }

    function onClick(e: MouseEvent) {
      const player = playerRef.current;
      const engine = engineRef.current;
      if (!player || !engine) return;

      if (player.heldBrick) {
        // Throw toward mouse position
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const mx = ((e.clientX - rect.left) / rect.width) * WORLD_WIDTH;
        const my = ((e.clientY - rect.top) / rect.height) * 800;
        throwBrick(player, mx, my, engine);
        player.score += 5;
        setScore(player.score);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("click", onClick);
    };
  }, []);

  // ─── Canvas resize ─────────────────────────────────────────────
  useEffect(() => {
    function resize() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-[70] bg-[#010A13] cursor-crosshair"
      style={{ touchAction: "none" }}
    />
  );
}
