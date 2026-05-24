'use client';

import { useRef, useState } from 'react';

/**
 * Phase 12.3 — vanilla `<canvas>` signature pad. Captures touch + mouse
 * input, draws straight-line segments between consecutive points
 * (no bezier — keep it small + dependency-free), exports as a PNG
 * data URI on submit.
 *
 * Lifted-shared API: parent owns submission; this component owns the
 * drawing surface. `onChange` fires with `null` when the pad is
 * cleared so the parent can disable the submit button.
 */
export function SignaturePad({
  width = 320,
  height = 120,
  onChange,
  ariaLabel,
}: {
  width?: number;
  height?: number;
  onChange: (dataUri: string | null) => void;
  ariaLabel: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);

  function getCtx(): CanvasRenderingContext2D | null {
    const c = canvasRef.current;
    if (!c) return null;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#111';
    return ctx;
  }

  function pointFor(e: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const c = canvasRef.current;
    if (!c) return null;
    const rect = c.getBoundingClientRect();
    // Scale from CSS pixels to backing-store pixels so a hi-DPI device
    // captures a crisp stroke (we set canvas.width/height = CSS × dpr below).
    const scaleX = c.width / rect.width;
    const scaleY = c.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastRef.current = pointFor(e);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    e.preventDefault();
    const ctx = getCtx();
    const next = pointFor(e);
    if (!ctx || !next || !lastRef.current) return;
    ctx.beginPath();
    ctx.moveTo(lastRef.current.x, lastRef.current.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
    lastRef.current = next;
    if (!hasInk) {
      setHasInk(true);
      onChange(canvasRef.current?.toDataURL('image/png') ?? null);
    }
  }

  function end(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastRef.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
    if (hasInk) {
      // Re-emit on stroke-end so the parent gets the freshest data
      // URI (move() only emits once on the very first stroke).
      onChange(canvasRef.current?.toDataURL('image/png') ?? null);
    }
  }

  function clear() {
    const ctx = getCtx();
    const c = canvasRef.current;
    if (!ctx || !c) return;
    ctx.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
    onChange(null);
  }

  // Backing-store size = CSS × devicePixelRatio. Computed at mount so
  // hi-DPI screens get a crisp signature; below 1 dpr we still set the
  // explicit attribute to avoid the default 300×150 surprise.
  const dpr = typeof window !== 'undefined' ? Math.max(1, window.devicePixelRatio) : 1;

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={ariaLabel}
        width={width * dpr}
        height={height * dpr}
        style={{ width: `${width}px`, height: `${height}px`, touchAction: 'none' }}
        className="cursor-crosshair rounded-md border border-input bg-background"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
      />
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{hasInk ? '✓' : '—'}</p>
        <button
          type="button"
          className="text-xs underline disabled:opacity-50"
          onClick={clear}
          disabled={!hasInk}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
