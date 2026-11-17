// Orbit camera with inertia and a slow cinematic auto-rotation.

import { clamp, lookAt, multiply, perspective } from './math.js';

const DEG = Math.PI / 180;

export class Camera {
  constructor() {
    this.yaw = 0.55;
    this.pitch = 0.22;
    this.distance = 2.4;
    this.desiredDistance = 2.4;
    this.target = [0, 0, 0];
    this.velocityYaw = 0;
    this.velocityPitch = 0;
    this.idle = 10;
    this.autoRotate = true;
    this.dragging = false;
    this.zoomHold = 0;
    this.eye = [0, 0, 0];
    this.view = new Float32Array(16);
    this.projection = new Float32Array(16);
    this.viewProjection = new Float32Array(16);
    this.aspect = 1;
  }

  orbit(dx, dy) {
    const scale = 0.0045;
    this.yaw -= dx * scale;
    this.pitch = clamp(this.pitch + dy * scale, -1.32, 1.32);
    this.velocityYaw = -dx * 0.0011;
    this.velocityPitch = dy * 0.0009;
    this.idle = 0;
  }

  zoom(delta) {
    this.desiredDistance = clamp(this.desiredDistance * Math.exp(delta * 0.0011), 1.6, 8.5);
    this.zoomHold = 1.2;
    this.idle = 0;
  }

  frame(mode) {
    this.desiredDistance = mode === 'brain' ? 2.05 : 2.4;
    this.idle = 0;
  }

  update(dt) {
    if (this.dragging) {
      this.idle = 0;
    } else {
      this.yaw += this.velocityYaw;
      this.pitch = clamp(this.pitch + this.velocityPitch, -1.32, 1.32);
      this.velocityYaw *= 0.92;
      this.velocityPitch *= 0.92;
      this.idle += dt;
      if (this.autoRotate && this.idle > 5) {
        this.yaw += dt * 0.035;
      }
    }

    if (this.zoomHold > 0) this.zoomHold = Math.max(0, this.zoomHold - dt);
    if (!this.dragging && this.zoomHold === 0) {
      this.distance += (this.desiredDistance - this.distance) * Math.min(1, dt * 3.2);
    }

    // Narrow / portrait viewports need to back off so the universe is not
    // cropped at the sides.
    const aspectBoost = Math.pow(Math.max(0.35, Math.min(1, this.aspect)), -0.85);
    const distance = this.distance * aspectBoost;
    const cosPitch = Math.cos(this.pitch);
    this.eye[0] = this.target[0] + Math.sin(this.yaw) * cosPitch * distance;
    this.eye[1] = this.target[1] + Math.sin(this.pitch) * distance;
    this.eye[2] = this.target[2] + Math.cos(this.yaw) * cosPitch * distance;

    lookAt(this.view, this.eye, this.target, [0, 1, 0]);
    perspective(this.projection, 45 * DEG, this.aspect, 0.05, 100);
    multiply(this.viewProjection, this.projection, this.view);
  }
}
