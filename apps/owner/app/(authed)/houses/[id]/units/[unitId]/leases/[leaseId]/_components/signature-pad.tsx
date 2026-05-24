'use client';

import { useRef, useState } from 'react';

/**
 * Phase 12.3 — vanilla `<canvas>` signature pad mirror of the tenant
 * app's. Kept per-app rather than in `@repo/ui` so each PWA can skin
 * the canvas independently; lift to shared if a third caller appears.
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
