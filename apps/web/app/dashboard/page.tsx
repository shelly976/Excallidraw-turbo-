'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import axios from 'axios';

type FabricModule = typeof import('fabric');

const STORAGE_KEY = 'whiteboard_data';

// A minimal valid blank canvas JSON — used after clear so backend never
// stores an empty/broken object that causes the reload hang.
const BLANK_CANVAS_JSON = {
  version: '6.0.0',
  objects: [],
  background: '#000000',
};

export default function Page() {
   const token = localStorage.getItem("token");
   const roomid = localStorage.getItem("roomid")
  
      const router=useRouter();
    useEffect(()=>{
      if(!token){
      router.push('/signup');
      return;
    }
    if(!roomid){
      router.push('/room');
      return;
    }
    },[]);

  const socketRef = useRef<WebSocket | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<import('fabric').Canvas | null>(null);

  const [activeTool, setActiveTool] = useState<'select' | 'pen' | 'rect' | 'ellipse' | 'text'>('select');
  const toolRef = useRef<'select' | 'pen' | 'rect' | 'ellipse' | 'text'>('select');

  const [zoom, setZoom] = useState(100);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const drawingShape = useRef<import('fabric').Rect | import('fabric').Ellipse | null>(null);
  const pointerStart = useRef({ x: 0, y: 0 });
  const isDraggingShape = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRemoteUpdate = useRef(false);
  const canvasReadyRef = useRef(false);
  const pendingDataRef = useRef<any>(null);

  // =========================
  // SAFE LOCALSTORAGE
  // Only used as render cache,
  // never as source of truth
  // =========================

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

  function safeLSRemove() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
  }

  // =========================
  // RENDER DATA ONTO CANVAS
  //
  // FIX: Always call setIsLoading(false)
  // via a safety timeout so we never
  // get stuck if loadFromJSON callback
  // doesn't fire (empty/minimal JSON).
  // =========================

  function renderOnCanvas(data: any) {
    // FIX: Guard against null/undefined/empty data
    if (!data) {
      setIsLoading(false);
      return;
    }

    const canvas = fabricRef.current;
    if (!canvas) {
      // Canvas not ready yet — store as pending
      pendingDataRef.current = data;
      return;
    }

    isRemoteUpdate.current = true;

    // Safety fallback: if loadFromJSON callback never fires (Fabric edge case
    // with empty objects array), force-clear the loading state after 1.5s.
    const safetyTimer = setTimeout(() => {
      isRemoteUpdate.current = false;
      setIsLoading(false);
    }, 1500);

    canvas.loadFromJSON(data, () => {
      clearTimeout(safetyTimer);
      canvas.backgroundColor = canvas.backgroundColor || '#000000';
      canvas.requestRenderAll();
      isRemoteUpdate.current = false;
      setIsLoading(false);
    });

    safeLSSet(data);
  }

  // =========================
  // SOCKET SETUP
  // =========================

  useEffect(() => {
    async function initSocket() {
      socketRef.current = new WebSocket('ws://localhost:8080');

      socketRef.current.onopen = () => {
        console.log('Socket Connected');
        setIsConnected(true);
      };

      socketRef.current.onclose = () => {
        setIsConnected(false);
      };

      socketRef.current.onmessage = async (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (!parsed?.data) return;
          renderOnCanvas(parsed.data);
        } catch (err) {
          console.log('socket message error', err);
        }
      };

      socketRef.current.onerror = (err) => {
        console.log('socket error', err);
        setIsConnected(false);
      };

      try {
        const response = await axios.post('http://localhost:3001', {
          roomid: roomid,
        });

        const savedData = response?.data?.data?.whiteboard_data;

        if (savedData) {
          renderOnCanvas(savedData);
        } else {
          setIsLoading(false);
        }
      } catch (err) {
        console.log('initial board load failed', err);
        const cached = safeLSGet();
        if (cached) {
          renderOnCanvas(cached);
        } else {
          setIsLoading(false);
        }
      }
    }

    initSocket();

    return () => {
      socketRef.current?.close();
    };
  }, []);

  // =========================
  // SAVE FUNCTION
  // =========================

  function scheduleSave(canvas: import('fabric').Canvas) {
    if (isRemoteUpdate.current) return;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {
      try {
        const canvasData = canvas.toJSON();

        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.send(
            JSON.stringify({
              roomid: roomid,
              data: canvasData,
            })
          );
        }

        safeLSSet(canvasData);
      } catch (err) {
        console.log('save failed', err);
      }
    }, 30);
  }

  // =========================
  // FABRIC SETUP
  // =========================

  useEffect(() => {
    const canvasEl = canvasElRef.current;
    if (!canvasEl) return;

    let canvas: import('fabric').Canvas;

    import('fabric').then((fabric: FabricModule) => {
      const { Canvas, Rect, Ellipse, PencilBrush, Point, IText } = fabric;

      canvas = new Canvas(canvasEl, {
        width: window.innerWidth,
        height: window.innerHeight,
        backgroundColor: '#000000',
        selection: true,
      });

      fabricRef.current = canvas;
      canvasReadyRef.current = true;

      const brush = new PencilBrush(canvas);
      brush.width = 3;
      brush.color = '#ffffff';
      canvas.freeDrawingBrush = brush;
      canvas.isDrawingMode = false;

      if (pendingDataRef.current) {
        isRemoteUpdate.current = true;

        const safetyTimer = setTimeout(() => {
          isRemoteUpdate.current = false;
          setIsLoading(false);
        }, 1500);

        canvas.loadFromJSON(pendingDataRef.current, () => {
          clearTimeout(safetyTimer);
          canvas.backgroundColor = canvas.backgroundColor || '#000000';
          canvas.requestRenderAll();
          isRemoteUpdate.current = false;
          setIsLoading(false);
        });
        pendingDataRef.current = null;
      } else {
        const cached = safeLSGet();
        if (cached) {
          canvas.loadFromJSON(cached, () => {
            canvas.requestRenderAll();
          });
        }
      }

      const saveEvents = [
        'object:added',
        'object:modified',
        'object:removed',
        'path:created',
      ] as const;

      saveEvents.forEach((ev) => {
        canvas.on(ev, () => {
          scheduleSave(canvas);
        });
      });

      canvas.on('mouse:down', (opt) => {
        const tool = toolRef.current;
        if (tool === 'select' || tool === 'pen') return;

        if (tool === 'text') {
          const p = canvas.getScenePoint(opt.e);
          const text = new IText('Type here...', {
            left: p.x,
            top: p.y,
            fill: '#ffffff',
            fontSize: 20,
            fontFamily: 'sans-serif',
            selectable: true,
            editable: true,
          });
          canvas.add(text);
          canvas.setActiveObject(text);
          text.enterEditing();
          text.selectAll();
          canvas.requestRenderAll();
          switchTool('select');
          return;
        }

        canvas.discardActiveObject();
        const p = canvas.getScenePoint(opt.e);
        pointerStart.current = { x: p.x, y: p.y };
        isDraggingShape.current = true;

        if (tool === 'rect') {
          const rect = new Rect({
            left: p.x, top: p.y, width: 1, height: 1,
            fill: 'rgba(255,255,255,0.05)', stroke: '#ffffff',
            strokeWidth: 2, originX: 'left', originY: 'top',
          });
          drawingShape.current = rect;
          canvas.add(rect);
        }

        if (tool === 'ellipse') {
          const ellipse = new Ellipse({
            left: p.x, top: p.y, rx: 1, ry: 1,
            fill: 'rgba(255,255,255,0.05)', stroke: '#ffffff',
            strokeWidth: 2, originX: 'left', originY: 'top',
          });
          drawingShape.current = ellipse;
          canvas.add(ellipse);
        }
      });

      canvas.on('mouse:move', (opt) => {
        if (!isDraggingShape.current || !drawingShape.current) return;
        const p = canvas.getScenePoint(opt.e);
        const s = pointerStart.current;

        if (drawingShape.current instanceof Rect) {
          drawingShape.current.set({
            left: Math.min(s.x, p.x), top: Math.min(s.y, p.y),
            width: Math.abs(p.x - s.x), height: Math.abs(p.y - s.y),
          });
        }
        if (drawingShape.current instanceof Ellipse) {
          drawingShape.current.set({
            rx: Math.abs(p.x - s.x) / 2, ry: Math.abs(p.y - s.y) / 2,
            left: Math.min(s.x, p.x), top: Math.min(s.y, p.y),
          });
        }
        canvas.requestRenderAll();
      });

      canvas.on('mouse:up', () => {
        isDraggingShape.current = false;
        if (drawingShape.current) canvas.setActiveObject(drawingShape.current);
        drawingShape.current = null;
        canvas.requestRenderAll();
      });

      const MIN_ZOOM = 0.1;
      const MAX_ZOOM = 10;

      canvas.on('mouse:wheel', (opt) => {
        let z = canvas.getZoom() * (0.999 ** opt.e.deltaY);
        z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
        canvas.zoomToPoint(new Point(opt.e.offsetX, opt.e.offsetY), z);
        setZoom(Math.round(z * 100));
        opt.e.preventDefault();
        opt.e.stopPropagation();
      });

      let lastDist = 0;

      const onTouchStart = (e: TouchEvent) => {
        if (e.touches.length === 2) {
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          lastDist = Math.sqrt(dx * dx + dy * dy);
        }
      };

      const onTouchMove = (e: TouchEvent) => {
        if (e.touches.length === 2) {
          e.preventDefault();
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (lastDist > 0) {
            let z = canvas.getZoom() * (dist / lastDist);
            z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
            const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            canvas.zoomToPoint({ x: midX, y: midY } as any, z);
            setZoom(Math.round(z * 100));
          }
          lastDist = dist;
        }
      };

      const onTouchEnd = () => { lastDist = 0; };

      const upperCanvas = (canvas as any).upperCanvasEl as HTMLElement;
      upperCanvas.addEventListener('touchstart', onTouchStart, { passive: false });
      upperCanvas.addEventListener('touchmove', onTouchMove, { passive: false });
      upperCanvas.addEventListener('touchend', onTouchEnd);

      const onKeyDown = (e: KeyboardEvent) => {
        const active = canvas.getActiveObject() as any;
        if (active && active.isEditing) return;
        if (e.key === 'Delete' || e.key === 'Backspace') {
          canvas.getActiveObjects().forEach((obj) => canvas.remove(obj));
          canvas.discardActiveObject();
          canvas.requestRenderAll();
          scheduleSave(canvas);
        }
      };

      const onResize = () => {
        canvas.setDimensions({ width: window.innerWidth, height: window.innerHeight });
        canvas.requestRenderAll();
      };

      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('resize', onResize);

      (canvas as any).__cleanup = () => {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('resize', onResize);
        upperCanvas.removeEventListener('touchstart', onTouchStart);
        upperCanvas.removeEventListener('touchmove', onTouchMove);
        upperCanvas.removeEventListener('touchend', onTouchEnd);
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      };
    });

    return () => {
      if (fabricRef.current) {
        (fabricRef.current as any).__cleanup?.();
        fabricRef.current.dispose();
        fabricRef.current = null;
        canvasReadyRef.current = false;
      }
    };
  }, []);

  // =========================
  // TOOL SWITCH
  // =========================

  function switchTool(tool: typeof activeTool) {
    setActiveTool(tool);
    toolRef.current = tool;
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.isDrawingMode = tool === 'pen';
    canvas.selection = tool === 'select';
    canvas.skipTargetFind = tool === 'rect' || tool === 'ellipse' || tool === 'text';
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    setIsMobileMenuOpen(false);
  }

  // =========================
  // REFRESH
  // =========================

  async function refreshBoard() {
    setIsLoading(true);
    try {
      const response = await axios.post('http://localhost:3001', { roomid: roomid });
      const savedData = response?.data?.data?.whiteboard_data;
      if (savedData) {
        renderOnCanvas(savedData);
      } else {
        setIsLoading(false);
      }
    } catch (err) {
      console.log('refresh failed', err);
      setIsLoading(false);
    }
    setIsMobileMenuOpen(false);
  }

  // =========================
  // ZOOM
  // =========================

  function zoomIn() {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const z = Math.min(10, canvas.getZoom() * 1.2);
    canvas.zoomToPoint({ x: window.innerWidth / 2, y: window.innerHeight / 2 } as any, z);
    setZoom(Math.round(z * 100));
  }

  function zoomOut() {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const z = Math.max(0.1, canvas.getZoom() / 1.2);
    canvas.zoomToPoint({ x: window.innerWidth / 2, y: window.innerHeight / 2 } as any, z);
    setZoom(Math.round(z * 100));
  }

  function resetZoom() {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    canvas.requestRenderAll();
    setZoom(100);
  }

  // =========================
  // CLEAR
  //
  // FIX: After clearing, explicitly
  // set backgroundColor back to black,
  // then save BLANK_CANVAS_JSON so the
  // backend never stores a broken empty
  // object that causes reload to hang.
  // =========================

  function clearBoard() {
    const canvas = fabricRef.current;
    if (!canvas) return;

    canvas.clear();
    canvas.backgroundColor = '#000000';
    canvas.requestRenderAll();

    // Remove local cache immediately
    safeLSRemove();

    // Save a clean known-good blank state — NOT canvas.toJSON() on an
    // empty canvas, which can produce a broken object in some Fabric versions.
    const blankData = { ...BLANK_CANVAS_JSON };

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    try {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(
          JSON.stringify({
            roomid: roomid,
            data: blankData,
          })
        );
      }
      safeLSSet(blankData);
    } catch (err) {
      console.log('clear save failed', err);
    }

    setIsMobileMenuOpen(false);
  }

  // =========================
  // TOOL DEFINITIONS
  // =========================

  const tools: { key: typeof activeTool; label: string; icon: string }[] = [
    { key: 'select', label: 'Select', icon: '↖' },
    { key: 'pen', label: 'Pen', icon: '✏️' },
    { key: 'rect', label: 'Rect', icon: '▭' },
    { key: 'ellipse', label: 'Circle', icon: '◯' },
    { key: 'text', label: 'Text', icon: 'T' },
  ];

  const btn = (name: typeof activeTool): React.CSSProperties => ({
    padding: '8px 14px',
    borderRadius: 8,
    border: `1px solid ${activeTool === name ? '#6b7280' : '#444'}`,
    background: activeTool === name ? '#1f2937' : '#111111',
    color: '#ffffff',
    cursor: 'pointer',
    fontWeight: activeTool === name ? 600 : 400,
    fontSize: 13,
    whiteSpace: 'nowrap',
  });

  const zoomBtn: React.CSSProperties = {
    padding: '6px 10px',
    borderRadius: 8,
    border: '1px solid #444',
    background: '#111',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 500,
    fontSize: 13,
  };

  const mobileBtnBase: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 16px',
    borderRadius: 8,
    border: '1px solid #333',
    background: '#111',
    color: '#fff',
    cursor: 'pointer',
    fontSize: 15,
    width: '100%',
    textAlign: 'left',
  };

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', background: '#000' }}>

      {isLoading && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 2000,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 12,
        }}>
          <div style={{
            width: 36, height: 36,
            border: '3px solid #333', borderTop: '3px solid #fff',
            borderRadius: '50%', animation: 'spin 0.8s linear infinite',
          }} />
          <span style={{ color: '#888', fontSize: 13 }}>Loading board...</span>
        </div>
      )}

      <div style={{
        position: 'fixed', top: 16, right: 16, zIndex: 1000,
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '5px 10px', background: '#111',
        border: `1px solid ${isConnected ? '#14532d' : '#7f1d1d'}`,
        borderRadius: 20, fontSize: 11,
        color: isConnected ? '#4ade80' : '#f87171',
      }}>
        <div style={{
          width: 7, height: 7, borderRadius: '50%',
          background: isConnected ? '#4ade80' : '#f87171',
        }} />
        {isConnected ? 'Live' : 'Offline'}
      </div>

      {/* DESKTOP TOOLBAR */}
      <div className="desktop-toolbar" style={{
        position: 'fixed', top: 16, left: 16, zIndex: 1000,
        display: 'flex', gap: 8, padding: 10, background: '#000',
        border: '1px solid #333', borderRadius: 12,
        boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
      }}>
        {tools.map((t) => (
          <button key={t.key} style={btn(t.key)} onClick={() => switchTool(t.key)}>
            {t.icon} {t.label}
          </button>
        ))}
        <button style={{ ...btn(activeTool), background: '#0c1a2e', borderColor: '#1d4ed8' }} onClick={refreshBoard}>
          ↺ Refresh
        </button>
        <button style={{ ...btn(activeTool), background: '#3b0000', borderColor: '#7f1d1d' }} onClick={clearBoard}>
          🗑 Clear
        </button>
      </div>

      {/* MOBILE HAMBURGER */}
      <div className="mobile-toolbar" style={{ position: 'fixed', top: 16, left: 16, zIndex: 1100, display: 'none' }}>
        <button
          onClick={() => setIsMobileMenuOpen((v) => !v)}
          style={{
            width: 44, height: 44, borderRadius: 10,
            border: '1px solid #444', background: '#111', color: '#fff',
            fontSize: 22, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {isMobileMenuOpen ? '✕' : '☰'}
        </button>
        {!isMobileMenuOpen && (
          <div style={{
            position: 'absolute', top: -6, right: -6,
            background: '#1d4ed8', borderRadius: '50%',
            width: 18, height: 18, fontSize: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 700,
          }}>
            {tools.find((t) => t.key === activeTool)?.icon}
          </div>
        )}
      </div>

      {/* MOBILE SLIDE-OUT MENU */}
      {isMobileMenuOpen && (
        <div className="mobile-toolbar" style={{
          position: 'fixed', top: 0, left: 0,
          width: '75vw', maxWidth: 280, height: '100vh',
          zIndex: 1050, background: '#0a0a0a',
          borderRight: '1px solid #222',
          boxShadow: '4px 0 24px rgba(0,0,0,0.8)',
          display: 'flex', flexDirection: 'column',
          padding: '70px 16px 24px', gap: 8, overflowY: 'auto',
        }}>
          <p style={{ color: '#555', fontSize: 11, fontWeight: 600, letterSpacing: 1, marginBottom: 4 }}>TOOLS</p>
          {tools.map((t) => (
            <button key={t.key} onClick={() => switchTool(t.key)} style={{
              ...mobileBtnBase,
              background: activeTool === t.key ? '#1f2937' : '#111',
              border: `1px solid ${activeTool === t.key ? '#6b7280' : '#333'}`,
              fontWeight: activeTool === t.key ? 700 : 400,
            }}>
              <span style={{ fontSize: 18, width: 24, textAlign: 'center' }}>{t.icon}</span>
              {t.label}
              {activeTool === t.key && (
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6b7280' }}>active</span>
              )}
            </button>
          ))}

          <div style={{ height: 1, background: '#222', margin: '8px 0' }} />
          <p style={{ color: '#555', fontSize: 11, fontWeight: 600, letterSpacing: 1, marginBottom: 4 }}>ACTIONS</p>

          <button onClick={refreshBoard} style={{ ...mobileBtnBase, background: '#0c1a2e', border: '1px solid #1d4ed8' }}>
            <span style={{ fontSize: 18, width: 24, textAlign: 'center' }}>↺</span>
            Refresh Board
          </button>
          <button onClick={clearBoard} style={{ ...mobileBtnBase, background: '#1a0000', border: '1px solid #7f1d1d' }}>
            <span style={{ fontSize: 18, width: 24, textAlign: 'center' }}>🗑</span>
            Clear Board
          </button>

          <div style={{ height: 1, background: '#222', margin: '8px 0' }} />
          <p style={{ color: '#555', fontSize: 11, fontWeight: 600, letterSpacing: 1, marginBottom: 4 }}>ZOOM</p>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={zoomOut} style={{ ...zoomBtn, flex: 1, fontSize: 20 }}>−</button>
            <button onClick={resetZoom} style={{ ...zoomBtn, flex: 2 }}>{zoom}%</button>
            <button onClick={zoomIn} style={{ ...zoomBtn, flex: 1, fontSize: 20 }}>+</button>
          </div>
        </div>
      )}

      {isMobileMenuOpen && (
        <div className="mobile-toolbar" onClick={() => setIsMobileMenuOpen(false)} style={{
          position: 'fixed', inset: 0, zIndex: 1040, background: 'rgba(0,0,0,0.5)',
        }} />
      )}

      {/* DESKTOP ZOOM */}
      <div className="desktop-toolbar" style={{
        position: 'fixed', bottom: 20, right: 20, zIndex: 1000,
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '8px 10px', background: '#000',
        border: '1px solid #333', borderRadius: 12,
        boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
      }}>
        <button onClick={zoomOut} style={{ ...zoomBtn, fontSize: 18 }}>−</button>
        <button onClick={resetZoom} style={{ ...zoomBtn, minWidth: 52 }}>{zoom}%</button>
        <button onClick={zoomIn} style={{ ...zoomBtn, fontSize: 18 }}>+</button>
      </div>

      <div ref={containerRef} style={{ width: '100vw', height: '100vh' }}>
        <canvas ref={canvasElRef} />
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }

        @media (max-width: 768px) {
          .desktop-toolbar { display: none !important; }
          .mobile-toolbar { display: flex !important; }
        }
        @media (min-width: 769px) {
          .mobile-toolbar { display: none !important; }
          .desktop-toolbar { display: flex !important; }
        }

        * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
        canvas { touch-action: none; }
      `}</style>
    </div>
  );
}

