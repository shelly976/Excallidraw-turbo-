'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import axios from 'axios';

type FabricModule = typeof import('fabric');

const STORAGE_KEY = 'whiteboard_data';

const BLANK_CANVAS_JSON = {
  version: '6.0.0',
  objects: [],
  background: '#000000',
};

export default function Page() {

  const router = useRouter();

  // ✅ FIXED SSR SAFE STORAGE ACCESS
  const [token, setToken] = useState<string | null>(null);
  const [roomid, setRoomid] = useState<string | null>(null);

  useEffect(() => {

    const savedToken = localStorage.getItem("token");
    const savedRoom = localStorage.getItem("roomid");

    setToken(savedToken);
    setRoomid(savedRoom);

    if (!savedToken) {
      router.push('/signup');
      return;
    }

    if (!savedRoom) {
      router.push('/room');
      return;
    }

  }, [router]);

  const socketRef = useRef<WebSocket | null>(null);
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<import('fabric').Canvas | null>(null);

  const [zoom, setZoom] = useState(100);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function safeLSSet(data: any) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (_) {}
  }

  function safeLSGet(): any | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw || raw === 'undefined') return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function renderOnCanvas(data: any) {

    if (!data) return;

    const canvas = fabricRef.current;

    if (!canvas) return;

    canvas.loadFromJSON(data, () => {
      canvas.backgroundColor = '#000000';
      canvas.requestRenderAll();
    });

    safeLSSet(data);
  }

  useEffect(() => {

    async function initSocket() {

      const wsUrl = process.env.WS_URL;
      if (!wsUrl) {
        throw new Error('WebSocket URL is not defined');
      }

      socketRef.current = new WebSocket(wsUrl);

      socketRef.current.onmessage = (event) => {

        try {

          const parsed = JSON.parse(event.data);

          if (!parsed?.data) return;

          renderOnCanvas(parsed.data);

        } catch (err) {
          console.log(err);
        }
      };

      try {

        const backendUrl = process.env.Backend_URL;
        if (!backendUrl) {
          throw new Error('Backend URL is not defined');
        }

        const response = await axios.post(backendUrl, {
          roomid: roomid,
        });

        const savedData = response?.data?.data?.whiteboard_data;

        if (savedData) {
          renderOnCanvas(savedData);
        }

      } catch (err) {
        console.log(err);

        const cached = safeLSGet();

        if (cached) {
          renderOnCanvas(cached);
        }
      }
    }

    initSocket();

    return () => {
      socketRef.current?.close();
    };

  }, [roomid]);

  function scheduleSave(canvas: import('fabric').Canvas) {

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {

      try {

        const canvasData = canvas.toJSON();

        if (
          socketRef.current &&
          socketRef.current.readyState === WebSocket.OPEN
        ) {

          socketRef.current.send(
            JSON.stringify({
              roomid,
              data: canvasData,
            })
          );
        }

        safeLSSet(canvasData);

      } catch (err) {
        console.log(err);
      }

    }, 50);
  }

  useEffect(() => {

    const canvasEl = canvasElRef.current;

    if (!canvasEl) return;

    let canvas: import('fabric').Canvas;

    import('fabric').then((fabric: FabricModule) => {

      const { Canvas, PencilBrush, Point } = fabric;

      canvas = new Canvas(canvasEl, {
        width: window.innerWidth,
        height: window.innerHeight,
        backgroundColor: '#000000',
      });

      fabricRef.current = canvas;

      const brush = new PencilBrush(canvas);

      brush.width = 3;
      brush.color = '#ffffff';

      canvas.freeDrawingBrush = brush;
      canvas.isDrawingMode = true;

      const cached = safeLSGet();

      if (cached) {
        renderOnCanvas(cached);
      }

      canvas.on('path:created', () => {
        scheduleSave(canvas);
      });

      // =========================
      // ZOOM
      // =========================

      const MIN_ZOOM = 0.1;
      const MAX_ZOOM = 10;

      canvas.on('mouse:wheel', (opt) => {

        let z = canvas.getZoom();

        z *= 0.999 ** opt.e.deltaY;

        z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

        canvas.zoomToPoint(
          new Point(opt.e.offsetX, opt.e.offsetY),
          z
        );

        setZoom(Math.round(z * 100));

        opt.e.preventDefault();
        opt.e.stopPropagation();
      });

      // =========================
      // MOBILE PINCH ZOOM
      // =========================

      let lastDist = 0;

      const onTouchStart = (e: TouchEvent) => {

        if (e.touches.length === 2) {

          const touch1 = e.touches[0];
          const touch2 = e.touches[1];

          if (!touch1 || !touch2) return;

          const dx = touch1.clientX - touch2.clientX;
          const dy = touch1.clientY - touch2.clientY;

          lastDist = Math.sqrt(dx * dx + dy * dy);
        }
      };

      const onTouchMove = (e: TouchEvent) => {

        if (e.touches.length === 2) {

          const touch1 = e.touches[0];
          const touch2 = e.touches[1];

          if (!touch1 || !touch2) return;

          e.preventDefault();

          const dx = touch1.clientX - touch2.clientX;
          const dy = touch1.clientY - touch2.clientY;

          const dist = Math.sqrt(dx * dx + dy * dy);

          if (lastDist > 0) {

            let z = canvas.getZoom() * (dist / lastDist);

            z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

            const midX =
              (touch1.clientX + touch2.clientX) / 2;

            const midY =
              (touch1.clientY + touch2.clientY) / 2;

            canvas.zoomToPoint(
              { x: midX, y: midY } as any,
              z
            );

            setZoom(Math.round(z * 100));
          }

          lastDist = dist;
        }
      };

      const onTouchEnd = () => {
        lastDist = 0;
      };

      const upperCanvas =
        (canvas as any).upperCanvasEl as HTMLElement;

      upperCanvas.addEventListener(
        'touchstart',
        onTouchStart,
        { passive: false }
      );

      upperCanvas.addEventListener(
        'touchmove',
        onTouchMove,
        { passive: false }
      );

      upperCanvas.addEventListener(
        'touchend',
        onTouchEnd
      );

      const onResize = () => {

        canvas.setDimensions({
          width: window.innerWidth,
          height: window.innerHeight,
        });

        canvas.requestRenderAll();
      };

      window.addEventListener('resize', onResize);

    });

    return () => {

      if (fabricRef.current) {

        fabricRef.current.dispose();

        fabricRef.current = null;
      }
    };

  }, []);

  function clearBoard() {

    const canvas = fabricRef.current;

    if (!canvas) return;

    canvas.clear();

    canvas.backgroundColor = '#000000';

    canvas.requestRenderAll();

    safeLSSet(BLANK_CANVAS_JSON);
  }

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        background: '#000000',
      }}
    >

      {/* TOP BAR */}

      <div
        style={{
          position: 'fixed',
          top: 20,
          left: 20,
          zIndex: 1000,
          display: 'flex',
          gap: 10,
          padding: 10,
          background: '#111111',
          border: '1px solid #333',
          borderRadius: 12,
        }}
      >

        <button
          onClick={() => {
            const canvas = fabricRef.current;
            if (!canvas) return;
            canvas.isDrawingMode = true;
          }}
          style={{
            padding: '10px 16px',
            borderRadius: 8,
            border: 'none',
            background: '#1f2937',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          Pen
        </button>

        <button
          onClick={clearBoard}
          style={{
            padding: '10px 16px',
            borderRadius: 8,
            border: 'none',
            background: '#3b0000',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          Clear
        </button>

      </div>

      {/* ZOOM */}

      <div
        style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          zIndex: 1000,
          background: '#111',
          border: '1px solid #333',
          borderRadius: 12,
          padding: '10px 16px',
          color: '#fff',
          fontSize: 14,
        }}
      >
        {zoom}%
      </div>

      {/* CANVAS */}

      <canvas ref={canvasElRef} />

    </div>
  );
}