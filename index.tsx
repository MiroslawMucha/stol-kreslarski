import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";

// -- Types --

type ComparisonMode = 'overlay' | 'blink' | 'difference' | 'sequence' | 'slider';
type ToolMode = 'pan_view' | 'move_layer' | 'match_points' | 'adjust_anchor';
type ColorTint = 'none' | 'red' | 'blue' | 'green' | 'yellow';
type ActiveLayerId = 'A' | 'B';

interface Point { x: number; y: number; }

interface LayerState {
  file: File | null;
  pdfPage: any | null; // PDFJS page proxy
  imageData: string | null; // Data URL
  scale: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  opacity: number; // Base opacity (max)
  pageNumber: number;
  totalPages: number;
  name: string;
  originalWidth?: number;
  originalHeight?: number;
  renderScale: number; // To track quality level
  tint: ColorTint;
  tintIntensity: number; // 0 to 1
  
  // Anchor system for point matching
  anchorLocal?: Point | null; // The point on the image relative to center (unrotated/unscaled)
  anchorTarget?: Point | null; // The world coordinates where this point must stay
}

interface HistoryStep {
  a: LayerState;
  b: LayerState;
}

const INITIAL_LAYER: LayerState = {
  file: null,
  pdfPage: null,
  imageData: null,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  opacity: 1.0,
  pageNumber: 1,
  totalPages: 1,
  name: 'Warstwa',
  renderScale: 2, // Default crispness (Retina like)
  tint: 'none',
  tintIntensity: 0.8,
  anchorLocal: null,
  anchorTarget: null
};

const MAX_HISTORY_STEPS = 50; // Limit cofania

// -- Knowledge Base (60 Tips) --
const APP_TIPS = [
  "Użyj nowego Miksera A/B w panelu, aby płynnie przenikać między warstwami.",
  "Strzałki ręcznego przesuwania mają teraz ogromną precyzję (0.1 px) - idealne do detali.",
  "Po dopasowaniu punktów pojawi się niebieska szpilka - to Twoja kotwica obrotu.",
  "Możesz chwycić i przesunąć niebieską szpilkę, aby skorygować dopasowanie.",
  "Przełączaj 'Aktywną Warstwę' (A lub B) w panelu, aby edytować też podkład.",
  "Rolka myszy przybliża i oddala widok w miejscu kursora.",
  "Przytrzymaj lewy przycisk myszy na tle, aby przesuwać cały widok (Panning).",
  "Skrót Ctrl+Z cofa ostatnią operację (do 50 kroków).",
  "Skrót Ctrl+Y (lub Ctrl+Shift+Z) ponawia cofniętą operację.",
  "Narzędzie 'Dopasuj Punkty' wbija wirtualną szpilkę - warstwa B będzie obracać się wokół tego punktu!",
  "W trybie dopasowania punktów najpierw kliknij punkt na Planie A (Bazowym).",
  "Po wybraniu punktu na A, kliknij ten sam punkt na Planie B (Nakładce).",
  "Tryb 'Mruganie' świetnie nadaje się do wykrywania minimalnych przesunięć ścian.",
  "Kliknij 'Znajdź Zmiany (AI)', aby sztuczna inteligencja opisała różnice.",
  "Eksport do PNG zapisuje dokładnie to, co widzisz na ekranie (WYSIWYG).",
  "Tryb 'Suwak' pozwala 'zdrapywać' stary plan, odkrywając nowy.",
  "Zmień kolor Planu B na czerwony, aby drastycznie zwiększyć kontrast.",
  "Zmień kolor Planu B na niebieski, jeśli pracujesz na ciemnych rzutach.",
  "Jeśli plany mają inną orientację, użyj przycisku 'Obrót 90' w panelu bocznym.",
  "Dla precyzyjnego dopasowania używaj strzałek w sekcji 'Ręczne Przesuwanie'.",
  "Tryb 'Pętla' tworzy płynną animację przenikania – idealne do prezentacji klientowi.",
  "Jeśli plany mają inną skalę (np. 1:50 vs 1:100), użyj przycisków Skala +/-.",
  "Możesz ukryć panel boczny strzałką '<' u góry, aby mieć pełny obszar roboczy.",
  "Wgraj ten sam plik jako A i B, a potem 'Duplikuj', aby porównać wersje tego samego rzutu.",
  "Tryb 'Różnica' (Difference) pokazuje zmiany jako jaskrawe linie na czarnym tle.",
  "Logowanie jest wymagane TYLKO do funkcji AI. Cała reszta jest darmowa i bez konta.",
  "Renderowanie x8 (UHD) zapewnia ostre linie przy dużym przybliżeniu.",
  "Kliknij dwukrotnie na suwak (Slider), aby ustawić go precyzyjnie.",
  "Przyciski Zoom +/- na górnym pasku działają tak samo jak kółko myszy.",
  "Narzędzie 'Łapka' to bezpieczny tryb – nie przesuniesz w nim przypadkiem warstw.",
  "Narzędzie 'Przesuń Warstwę' (ikona ze strzałkami) pozwala ręcznie przesuwać aktywną warstwę.",
  "Znaczniki dopasowania punktów znikają automatycznie po udanym połączeniu.",
  "Panel boczny zawiera historię ostatnich analiz AI.",
  "Aplikacja działa w przeglądarce – Twoje pliki są bezpieczne.",
  "W trybie 'Mruganie' możesz regulować szybkość przełączania suwakiem.",
  "Jeśli zgubisz widok, spróbuj maksymalnie oddalić widok rolką.",
  "Wyszukuj porady wpisując słowa kluczowe w dymku asystenta.",
  "Możesz eksportować widok z włączonym trybem 'Różnica' dla wykonawcy.",
  "Użyj trybu 'Nakład' (Overlay) z opcją Multiply dla klasycznego efektu kalki.",
  "Pliki PDF są renderowane lokalnie – szybkość zależy od Twojego komputera.",
  "Dla bardzo dużych map geodezyjnych użyj renderowania x2 (SD) dla płynności.",
  "Przycisk 'Reset' przy obrocie przywraca kąt 0 stopni.",
  "Analiza AI potrafi wykryć przesunięte drzwi i nowe ścianki działowe.",
  "Podczas eksportu, czerwona ramka mignie, potwierdzając zrzut ekranu.",
  "Możesz używać klawiszy strzałek do przewijania listy porad w dymku.",
  "Kliknięcie 'Pełny Ekran' ukrywa paski przeglądarki dla lepszej widoczności.",
  "Jeśli AI nie odpowiada, sprawdź czy jesteś zalogowany poprawnymi danymi.",
  "Tryb 'Sequence' (Pętla) pomaga zauważyć zmiany w instalacjach.",
  "Suwak 'Moc Koloru' pozwala na subtelne lub agresywne barwienie planu.",
  "Narzędzie Przesuń Warstwę działa na warstwę wybraną w panelu (A lub B).",
  "Możesz wgrać dwa zupełnie różne pliki, by zobaczyć jak bardzo się różnią.",
  "Cofnij (Undo) zapamiętuje też zmiany koloru i przezroczystości.",
  "Jeśli zrobisz błąd przy dopasowaniu punktów, wciśnij Ctrl+Z.",
  "Asystent (Ja!) mrugam, żebyś o mnie nie zapomniał.",
  "Podświetlenie 'Aktywna' w panelu informuje, którą warstwę edytujesz.",
  "Możesz używać aplikacji na tablecie, ale myszka jest zalecana.",
  "Przyciski skali zmieniają rozmiar o 1% - dla precyzji.",
  "W trybie 'Suwak' lewa strona to zawsze Warstwa A, prawa to B.",
  "Jeśli wgrasz zły plik, po prostu wgraj nowy w to samo miejsce.",
  "Historia zmian czyści się po wgraniu nowego pliku bazowego (A).",
  "Użyj 'Duplikuj Plan Bazowy', by sprawdzić symetrię budynku (obracając kopię).",
  "Analiza AI działa najlepiej na czystych rzutach architektonicznych.",
  "Eksportowany plik PNG ma nazwę z dzisiejszą datą.",
  "Dymek porady znika po kliknięciu 'X' lub kliknięciu w tło."
];

// -- Helpers --

declare const pdfjsLib: any;

const renderPageToDataURL = async (pdfPage: any, scale: number = 2): Promise<{ dataUrl: string, width: number, height: number }> => {
  const viewport = pdfPage.getViewport({ scale });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.height = viewport.height;
  canvas.width = viewport.width;
  await pdfPage.render({ canvasContext: context!, viewport: viewport }).promise;
  return { dataUrl: canvas.toDataURL('image/png'), width: viewport.width, height: viewport.height };
};

const loadPdfFile = async (file: File): Promise<any> => {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  return loadingTask.promise;
};

const getColorFilter = (color: ColorTint, intensity: number): string => {
  if (color === 'none') return '';
  let hue = 0, sat = 300; 
  switch (color) {
    case 'red': hue = -50; break;
    case 'blue': hue = 190; break;
    case 'green': hue = 80; break;
    case 'yellow': hue = 20; sat = 600; break;
  }
  return `sepia(${intensity}) hue-rotate(${hue}deg) saturate(${sat}%)`;
};

// Math Helper for Rotation/Scaling around a point
const degToRad = (deg: number) => (deg * Math.PI) / 180;
const rotatePoint = (x: number, y: number, angleDeg: number) => {
  const rad = degToRad(angleDeg);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
};

// -- Components --

// Professional Animated Compass
const CompassAssistant = ({ onClick, isAutoTriggered }: { onClick: () => void, isAutoTriggered: boolean }) => {
  const [isBlinking, setIsBlinking] = useState(false);
  
  useEffect(() => {
    const blinkLoop = () => {
      setIsBlinking(true);
      setTimeout(() => setIsBlinking(false), 150);
      const nextBlink = Math.random() * 4000 + 3000;
      setTimeout(blinkLoop, nextBlink);
    };
    const timer = setTimeout(blinkLoop, 3000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <button 
      onClick={onClick}
      className={`group relative w-24 h-24 transition-transform hover:scale-105 active:scale-95 focus:outline-none ${isAutoTriggered ? 'animate-bounce' : ''}`}
      title="Asystent Projektowy"
    >
      <svg viewBox="0 0 120 120" className="w-full h-full drop-shadow-2xl">
        <defs>
          <linearGradient id="metalGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#94a3b8" />
            <stop offset="50%" stopColor="#e2e8f0" />
            <stop offset="100%" stopColor="#64748b" />
          </linearGradient>
          <filter id="shadow">
             <feDropShadow dx="1" dy="1" stdDeviation="2" floodOpacity="0.3"/>
          </filter>
        </defs>
        <g className="origin-[60px_30px] animate-[wiggle_6s_ease-in-out_infinite]">
          <path d="M60 30 L35 100" stroke="url(#metalGrad)" strokeWidth="8" strokeLinecap="round" filter="url(#shadow)" />
          <path d="M60 30 L85 100" stroke="url(#metalGrad)" strokeWidth="8" strokeLinecap="round" filter="url(#shadow)" />
          <path d="M35 100 L35 110" stroke="#475569" strokeWidth="2" />
          <path d="M85 100 L85 110 L89 108" fill="#fca5a5" />
          <circle cx="60" cy="30" r="16" fill="#cbd5e1" stroke="#475569" strokeWidth="2" />
          <circle cx="60" cy="30" r="10" fill="#3b82f6" opacity="0.8" />
          <g transform={`scale(1, ${isBlinking ? 0.1 : 1})`} style={{ transformOrigin: '60px 30px', transition: 'transform 0.1s' }}>
             <circle cx="55" cy="28" r="3" fill="#1e293b" />
             <path d="M54 27 L56 29 M56 27 L54 29" stroke="#64748b" strokeWidth="0.5" />
             <circle cx="65" cy="28" r="3" fill="#1e293b" />
             <path d="M64 27 L66 29 M66 27 L64 29" stroke="#64748b" strokeWidth="0.5" />
          </g>
          <path d="M54 36 Q60 40 66 36" stroke="#1e293b" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.7" />
        </g>
      </svg>
      {isAutoTriggered && (
        <span className="absolute -top-1 right-2 flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
        </span>
      )}
    </button>
  );
};

const App = () => {
  // Application State
  const [layerA, setLayerA] = useState<LayerState>({ ...INITIAL_LAYER, name: 'Plan Bazowy (A)', opacity: 1 });
  const [layerB, setLayerB] = useState<LayerState>({ ...INITIAL_LAYER, name: 'Plan Nowy (B)', opacity: 1 });
  const [activeLayerId, setActiveLayerId] = useState<ActiveLayerId>('B');
  
  // Crossfader State (0 = A only, 50 = Both, 100 = B only)
  const [crossfader, setCrossfader] = useState(50);
  
  // History
  const [history, setHistory] = useState<HistoryStep[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  // Auth
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  
  // Refs
  const stateRef = useRef({ a: layerA, b: layerB });
  useEffect(() => { stateRef.current = { a: layerA, b: layerB }; }, [layerA, layerB]);

  // Viewport
  const [viewX, setViewX] = useState(0);
  const [viewY, setViewY] = useState(0);
  const [viewScale, setViewScale] = useState(1);
  
  const [mode, setMode] = useState<ComparisonMode>('overlay');
  const [tool, setTool] = useState<ToolMode>('pan_view');
  
  // Point Match State
  const [matchStep, setMatchStep] = useState<0 | 1 | 2>(0);
  const [matchPointA, setMatchPointA] = useState<Point | null>(null);

  // Help/Tips
  const [showTip, setShowTip] = useState(false);
  const [currentTipIndex, setCurrentTipIndex] = useState(0);
  const [tipSearch, setTipSearch] = useState('');
  const [isAutoTriggered, setIsAutoTriggered] = useState(false);

  // Animation
  const [blinkState, setBlinkState] = useState(false); 
  const [animationPhase, setAnimationPhase] = useState(0); 
  const [animSpeed, setAnimSpeed] = useState(500); 
  const [sliderVal, setSliderVal] = useState(50); 
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [highResLevel, setHighResLevel] = useState<number>(2); 
  const [isHighResLoading, setIsHighResLoading] = useState(false);
  const [exportFlash, setExportFlash] = useState(false);

  const [showUI, setShowUI] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [startVals, setStartVals] = useState({ viewX: 0, viewY: 0, layerX: 0, layerY: 0 }); // Generalized for active layer
  const [hasMovedDuringDrag, setHasMovedDuringDrag] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeLayer = activeLayerId === 'A' ? layerA : layerB;

  // -- Helpers for Anchor Logic --
  const calculateOffsetForAnchor = (target: Point, localAnchor: Point, scale: number, rotation: number) => {
    const rotated = rotatePoint(localAnchor.x, localAnchor.y, rotation);
    const scaledX = rotated.x * scale;
    const scaledY = rotated.y * scale;
    return { offsetX: target.x - scaledX, offsetY: target.y - scaledY };
  };

  const updateActiveLayer = (updates: Partial<LayerState>, commitToHistory = false) => {
    const layer = activeLayerId === 'A' ? layerA : layerB;
    let newLayer = { ...layer, ...updates };

    // Anchor Lock Logic (Applies to B usually, but generic enough if A had anchor)
    if (newLayer.anchorLocal && newLayer.anchorTarget && (updates.scale !== undefined || updates.rotation !== undefined)) {
       const fixedOffsets = calculateOffsetForAnchor(newLayer.anchorTarget, newLayer.anchorLocal, newLayer.scale, newLayer.rotation);
       newLayer.offsetX = fixedOffsets.offsetX;
       newLayer.offsetY = fixedOffsets.offsetY;
    }

    if (activeLayerId === 'A') {
      setLayerA(newLayer);
      if (commitToHistory) pushHistory({ a: newLayer, b: layerB });
    } else {
      setLayerB(newLayer);
      if (commitToHistory) pushHistory({ a: layerA, b: newLayer });
    }
  };

  // Specific update for B when doing point matching
  const updateLayerB = (updates: Partial<LayerState>, commitToHistory = false) => {
    const newB = { ...stateRef.current.b, ...updates };
    setLayerB(newB);
    if (commitToHistory) pushHistory({ a: stateRef.current.a, b: newB });
  };

  // -- History Logic --
  const pushHistory = useCallback((overrideState?: HistoryStep) => {
    const currentState = overrideState || stateRef.current;
    setHistory(prev => {
      const upToCurrent = prev.slice(0, historyIndex + 1);
      const newHistory = [...upToCurrent, currentState];
      if (newHistory.length > MAX_HISTORY_STEPS) newHistory.shift();
      return newHistory;
    });
    setHistoryIndex(prev => Math.min(prev + 1, MAX_HISTORY_STEPS - 1));
  }, [historyIndex]);

  useEffect(() => { setHistoryIndex(history.length - 1); }, [history.length]);
  const undo = useCallback(() => { if (historyIndex > 0) { const prev = history[historyIndex - 1]; setLayerA(prev.a); setLayerB(prev.b); setHistoryIndex(historyIndex - 1); } }, [history, historyIndex]);
  const redo = useCallback(() => { if (historyIndex < history.length - 1) { const next = history[historyIndex + 1]; setLayerA(next.a); setLayerB(next.b); setHistoryIndex(historyIndex + 1); } }, [history, historyIndex]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showLoginModal) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); } 
      else if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, showLoginModal]);

  useEffect(() => { if (history.length === 0 && layerA.imageData) pushHistory({ a: layerA, b: layerB }); }, [layerA.imageData, history.length]);

  // -- Tip Logic --
  useEffect(() => { const timer = setInterval(() => { if (!showTip && !tipSearch) { handleNextTip(); setIsAutoTriggered(true); } }, 60000); return () => clearInterval(timer); }, [showTip, tipSearch]);
  useEffect(() => { if (showTip && isAutoTriggered) { const timer = setTimeout(() => { setShowTip(false); }, 6000); return () => clearTimeout(timer); } }, [showTip, isAutoTriggered]);
  const handleNextTip = () => { let nextIdx; do { nextIdx = Math.floor(Math.random() * APP_TIPS.length); } while (nextIdx === currentTipIndex && APP_TIPS.length > 1); setCurrentTipIndex(nextIdx); setTipSearch(''); setShowTip(true); };
  const handlePrevTip = () => setCurrentTipIndex(prev => (prev - 1 + APP_TIPS.length) % APP_TIPS.length);
  const handleForwardTip = () => setCurrentTipIndex(prev => (prev + 1) % APP_TIPS.length);
  const handleAssistantClick = () => { setIsAutoTriggered(false); if (showTip) { if (tipSearch === '') handleNextTip(); } else { setShowTip(true); handleNextTip(); } };
  const filteredTips = tipSearch ? APP_TIPS.filter(t => t.toLowerCase().includes(tipSearch.toLowerCase())) : [];

  // -- Handlers --
  const handleLogin = (e: React.FormEvent) => { e.preventDefault(); if (loginEmail.trim() === 'muchaelectric@gmail.com' && loginPassword === 'Mucha2025!') { setIsLoggedIn(true); setShowLoginModal(false); setLoginError(''); } else { setLoginError('Nieprawidłowy email lub hasło.'); } };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, layer: 'A' | 'B') => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const pdf = await loadPdfFile(file);
      const page = await pdf.getPage(1);
      const { dataUrl, width, height } = await renderPageToDataURL(page, 2);
      const update = { file, pdfPage: page, imageData: dataUrl, totalPages: pdf.numPages, pageNumber: 1, scale: 1, offsetX: 0, offsetY: 0, rotation: 0, originalWidth: width, originalHeight: height, renderScale: 2, anchorLocal: null, anchorTarget: null };
      if (layer === 'A') { const newA = { ...layerA, ...update }; setLayerA(newA); setViewX(0); setViewY(0); setHistory([{ a: newA, b: layerB }]); setHistoryIndex(0); }
      else { const newB = { ...layerB, ...update }; setLayerB(newB); pushHistory({ a: layerA, b: newB }); }
      setHighResLevel(2);
    } catch (err) { console.error("Error loading PDF", err); alert("Nie udało się wczytać pliku PDF."); }
  };

  const handleQualityRender = async (targetScale: number) => {
    if (!layerA.pdfPage && !layerB.pdfPage) return;
    setIsHighResLoading(true);
    try {
      let newA = layerA, newB = layerB;
      if (layerA.pdfPage) { const resA = await renderPageToDataURL(layerA.pdfPage, targetScale); newA = { ...layerA, imageData: resA.dataUrl, renderScale: targetScale }; setLayerA(newA); }
      if (layerB.pdfPage) { const resB = await renderPageToDataURL(layerB.pdfPage, targetScale); newB = { ...layerB, imageData: resB.dataUrl, renderScale: targetScale }; setLayerB(newB); }
      setHighResLevel(targetScale); pushHistory({ a: newA, b: newB });
    } catch (e) { console.error(e); alert("Błąd renderowania."); } finally { setIsHighResLoading(false); }
  };

  const handleSplitSingleFile = () => {
    if (!layerA.file || !layerA.imageData) { alert("Najpierw wgraj Plan Bazowy (A)."); return; }
    const newB = { ...layerA, name: 'Kopia Planu (B)', opacity: 0.7, offsetX: 50, offsetY: 50, anchorLocal: null, anchorTarget: null };
    setLayerB(newB); setTool('move_layer'); setMode('overlay'); setActiveLayerId('B');
    pushHistory({ a: layerA, b: newB });
  };

  const activatePointMatch = () => {
    if (!layerA.imageData || !layerB.imageData) { alert("Wymagane obie warstwy."); return; }
    setTool('match_points'); setMatchStep(1); setMatchPointA(null); setShowTip(false);
  };

  const getCanvasCoordinates = (clientX: number, clientY: number) => {
      if (!containerRef.current) return { x: 0, y: 0 };
      const rect = containerRef.current.getBoundingClientRect();
      const centerX = rect.width / 2; const centerY = rect.height / 2;
      return { x: (clientX - rect.left - centerX - viewX) / viewScale, y: (clientY - rect.top - centerY - viewY) / viewScale };
  };

  // -- Interaction --

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault(); if (!containerRef.current || showLoginModal) return;
    const zoomIntensity = 0.001; const delta = -e.deltaY * zoomIntensity;
    const newScale = Math.min(Math.max(0.1, viewScale + delta), 10);
    const scaleRatio = newScale / viewScale;
    const rect = containerRef.current.getBoundingClientRect();
    const centerX = rect.width / 2; const centerY = rect.height / 2;
    const mouseX = e.clientX - rect.left - centerX; const mouseY = e.clientY - rect.top - centerY;
    setViewScale(newScale); setViewX(mouseX - (mouseX - viewX) * scaleRatio); setViewY(mouseY - (mouseY - viewY) * scaleRatio);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (showLoginModal) return;
    if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('input')) return;
    e.preventDefault();

    const coords = getCanvasCoordinates(e.clientX, e.clientY);

    // Anchor Drag Logic
    if (layerB.anchorTarget && tool !== 'match_points') {
      const dist = Math.sqrt(Math.pow(coords.x - layerB.anchorTarget.x, 2) + Math.pow(coords.y - layerB.anchorTarget.y, 2));
      // If clicking near anchor (approx 10px radius in screen space / scale)
      if (dist < 15 / viewScale) {
        setTool('adjust_anchor');
        setIsDragging(true);
        setDragStart({ x: e.clientX, y: e.clientY });
        setStartVals({ viewX: 0, viewY: 0, layerX: layerB.offsetX, layerY: layerB.offsetY });
        return;
      }
    }

    if (tool === 'match_points') {
       if (matchStep === 1) {
          setMatchPointA(coords); setMatchStep(2);
       } else if (matchStep === 2 && matchPointA) {
          const vecWorldX = coords.x - layerB.offsetX;
          const vecWorldY = coords.y - layerB.offsetY;
          const vecUnscaledX = vecWorldX / layerB.scale;
          const vecUnscaledY = vecWorldY / layerB.scale;
          const localAnchor = rotatePoint(vecUnscaledX, vecUnscaledY, -layerB.rotation);
          const offsets = calculateOffsetForAnchor(matchPointA, localAnchor, layerB.scale, layerB.rotation);

          updateLayerB({ offsetX: offsets.offsetX, offsetY: offsets.offsetY, anchorLocal: localAnchor, anchorTarget: matchPointA }, true);
          setMatchStep(0); setMatchPointA(null); setTool('pan_view'); setActiveLayerId('B');
       }
       return;
    }

    setIsDragging(true); setHasMovedDuringDrag(false);
    setDragStart({ x: e.clientX, y: e.clientY });
    const currentActive = activeLayerId === 'A' ? layerA : layerB;
    setStartVals({ viewX, viewY, layerX: currentActive.offsetX, layerY: currentActive.offsetY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.x; const dy = e.clientY - dragStart.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) setHasMovedDuringDrag(true);

    if (tool === 'pan_view') {
      setViewX(startVals.viewX + dx); setViewY(startVals.viewY + dy);
    } else if (tool === 'move_layer') {
      const newOffsetX = startVals.layerX + (dx / viewScale);
      const newOffsetY = startVals.layerY + (dy / viewScale);
      updateActiveLayer({ offsetX: newOffsetX, offsetY: newOffsetY });
      // Moving manually breaks anchor for that layer (only B has anchor logic for now)
      if (activeLayerId === 'B') setLayerB(prev => ({ ...prev, anchorLocal: null, anchorTarget: null }));
    } else if (tool === 'adjust_anchor') {
       // Dragging the anchor target point essentially moves the layer B
       // We calculate the new target position in world space
       const coords = getCanvasCoordinates(e.clientX, e.clientY);
       
       // Update Layer B so that its local anchor matches this new world coord
       if (layerB.anchorLocal) {
         const offsets = calculateOffsetForAnchor(coords, layerB.anchorLocal, layerB.scale, layerB.rotation);
         setLayerB(prev => ({ ...prev, offsetX: offsets.offsetX, offsetY: offsets.offsetY, anchorTarget: coords }));
       }
    }
  };

  const handleMouseUp = () => {
    if (isDragging && (tool === 'move_layer' || tool === 'adjust_anchor') && hasMovedDuringDrag) pushHistory();
    setIsDragging(false);
    if (tool === 'adjust_anchor') setTool('pan_view');
  };

  const handleExport = async () => {
    if (!containerRef.current || !layerA.imageData) return;
    setExportFlash(true); setTimeout(() => setExportFlash(false), 500);
    const canvas = document.createElement('canvas');
    canvas.width = containerRef.current.clientWidth; canvas.height = containerRef.current.clientHeight;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const loadImg = (src: string) => new Promise<HTMLImageElement>((resolve) => { const img = new Image(); img.onload = () => resolve(img); img.src = src; });
    const imgA = await loadImg(layerA.imageData); const imgB = layerB.imageData ? await loadImg(layerB.imageData) : null;
    const cx = canvas.width / 2; const cy = canvas.height / 2;
    ctx.save(); ctx.translate(cx + viewX, cy + viewY); ctx.scale(viewScale, viewScale);

    const getMixedOpacity = (layerId: 'A' | 'B', baseOp: number) => {
        // Crossfader logic: 0 = A(1), B(0). 50 = A(1), B(1). 100 = A(0), B(1).
        if (layerId === 'A') return crossfader > 50 ? baseOp * ((100 - crossfader) / 50) : baseOp;
        if (layerId === 'B') return crossfader < 50 ? baseOp * (crossfader / 50) : baseOp;
        return baseOp;
    };

    const drawLayer = (img: HTMLImageElement, layer: LayerState, id: 'A' | 'B', composite: GlobalCompositeOperation, clipRight: boolean = false) => {
      ctx.save();
      const filterStr = getColorFilter(layer.tint, layer.tintIntensity);
      if (filterStr) ctx.filter = filterStr; else ctx.filter = 'none';
      
      let finalAlpha = layer.opacity;
      // APPLY CROSSFADER FOR ALL MODES
      finalAlpha = getMixedOpacity(id, finalAlpha);

      if (mode === 'blink') {
         if (id === 'A') finalAlpha = blinkState ? finalAlpha : 0;
         else finalAlpha = !blinkState ? finalAlpha : 0;
      }
      else if (mode === 'sequence') {
         if (id === 'A') finalAlpha = finalAlpha * (1 - animationPhase);
         else finalAlpha = finalAlpha * animationPhase;
      }

      ctx.globalAlpha = finalAlpha; ctx.globalCompositeOperation = composite;
      ctx.translate(layer.offsetX, layer.offsetY); ctx.rotate(degToRad(layer.rotation));
      const visualScaleCorrection = 2 / layer.renderScale;
      ctx.scale(layer.scale * visualScaleCorrection, layer.scale * visualScaleCorrection);
      if (mode === 'slider' && clipRight) {
          ctx.beginPath(); const w = img.width; const h = img.height; const splitX = -w/2 + (w * (sliderVal/100));
          ctx.rect(splitX, -h/2, w, h); ctx.clip();
      }
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.restore();
    };

    if (mode === 'overlay') { drawLayer(imgA, layerA, 'A', 'multiply'); if (imgB && layerB.imageData) drawLayer(imgB, layerB, 'B', 'multiply'); }
    else if (mode === 'blink') { if (blinkState) drawLayer(imgA, layerA, 'A', 'multiply'); else if (imgB && layerB.imageData) drawLayer(imgB, layerB, 'B', 'multiply'); }
    else if (mode === 'sequence') { drawLayer(imgA, layerA, 'A', 'source-over'); if (imgB && layerB.imageData) drawLayer(imgB, layerB, 'B', 'source-over'); }
    else if (mode === 'difference') { drawLayer(imgA, layerA, 'A', 'source-over'); if (imgB && layerB.imageData) drawLayer(imgB, layerB, 'B', 'difference'); }
    else if (mode === 'slider') { drawLayer(imgA, layerA, 'A', 'source-over'); if (imgB && layerB.imageData) drawLayer(imgB, layerB, 'B', 'source-over', true); }
    ctx.restore();
    const link = document.createElement('a'); link.download = `plan-widok-${new Date().toISOString().slice(0,10)}.png`;
    link.href = canvas.toDataURL('image/png'); link.click();
  };

  useEffect(() => {
    let interval: any, animationFrameId: number;
    if (mode === 'blink') interval = setInterval(() => setBlinkState(p => !p), animSpeed);
    else if (mode === 'sequence') {
      const startTime = Date.now();
      const loop = () => { const t = ((Date.now() - startTime) % (animSpeed * 4)) / (animSpeed * 4); setAnimationPhase((Math.sin(t * Math.PI * 2) + 1) / 2); animationFrameId = requestAnimationFrame(loop); };
      loop();
    } else { setBlinkState(true); setAnimationPhase(0); }
    return () => { clearInterval(interval); cancelAnimationFrame(animationFrameId); };
  }, [mode, animSpeed]);

  const getContainerStyle = (): React.CSSProperties => ({
    transform: `translate(${viewX}px, ${viewY}px) scale(${viewScale})`,
    transformOrigin: 'center center',
    transition: isDragging ? 'none' : 'transform 0.05s linear',
    position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  });
  const getVisualScaleFix = (layer: LayerState) => 2 / layer.renderScale;

  // Render logic for layers considering opacity/crossfader
  const getLayerStyle = (layer: LayerState, id: 'A' | 'B'): React.CSSProperties => {
    const visualFix = getVisualScaleFix(layer);
    const transform = `translate(${layer.offsetX}px, ${layer.offsetY}px) rotate(${layer.rotation}deg) scale(${layer.scale * visualFix})`;
    const colorFilter = getColorFilter(layer.tint, layer.tintIntensity);
    
    let opacity = layer.opacity;
    let mixBlend: any = 'multiply';

    // APPLY CROSSFADER FOR ALL MODES
    if (id === 'A') opacity = crossfader > 50 ? layer.opacity * ((100 - crossfader) / 50) : layer.opacity;
    else opacity = crossfader < 50 ? layer.opacity * (crossfader / 50) : layer.opacity;

    if (mode === 'overlay') {
       mixBlend = 'multiply';
    } else if (mode === 'blink') {
       mixBlend = 'multiply';
       opacity = ((id === 'A' && blinkState) || (id === 'B' && !blinkState)) ? opacity : 0;
    } else if (mode === 'difference') {
       mixBlend = id === 'A' ? 'source-over' : 'difference';
       // Crossfader already applied to opacity
    } else if (mode === 'sequence') {
       mixBlend = 'normal';
       opacity = id === 'A' ? opacity * (1 - animationPhase) : opacity * animationPhase;
    } else if (mode === 'slider') {
       mixBlend = 'normal';
    }

    const style: React.CSSProperties = { position: 'absolute', transform, transition: (mode === 'sequence' || isDragging) ? 'none' : 'opacity 0.2s', filter: colorFilter, mixBlendMode: mixBlend, opacity, zIndex: id === 'A' ? 1 : 10, pointerEvents: 'none' };
    
    if (mode === 'difference' && id === 'B') style.filter = `${colorFilter} invert(0)`;
    if (mode === 'slider' && id === 'B') style.clipPath = `polygon(${sliderVal}% 0, 100% 0, 100% 100%, ${sliderVal}% 100%)`;

    return style;
  };

  const performAIAnalysis = async () => {
    if (!layerA.imageData || !layerB.imageData) return;
    if (!isLoggedIn) { setShowLoginModal(true); return; }
    setIsAnalyzing(true); setAiAnalysis(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = "Jestem architektem porównującym te dwa rysunki. Pierwszy obraz to Plan Bazowy. Drugi to Nowy Plan. Zidentyfikuj kluczowe zmiany, modyfikacje lub różnice między nimi. Skup się na ścianach, drzwiach, oknach i zmianach układu. Odpowiedz krótko i konkretnie w języku polskim.";
      const response = await ai.models.generateContent({ model: "gemini-2.5-flash-image", contents: { parts: [{ text: prompt }, { inlineData: { mimeType: 'image/png', data: layerA.imageData.split(',')[1] } }, { inlineData: { mimeType: 'image/png', data: layerB.imageData.split(',')[1] } }] } });
      setAiAnalysis(response.text || "Brak odpowiedzi");
    } catch (error) { console.error(error); setAiAnalysis("Błąd analizy. Sprawdź klucz API."); } 
    finally { setIsAnalyzing(false); }
  };

  return (
    <div className="flex h-screen w-screen bg-gray-900 text-white overflow-hidden font-sans select-none relative">
      <div className={`absolute inset-0 border-[10px] border-red-500 z-[100] pointer-events-none transition-opacity duration-200 ${exportFlash ? 'opacity-100' : 'opacity-0'}`}></div>

      {showLoginModal && (
        <div className="absolute inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-800 border border-gray-600 p-6 rounded-xl shadow-2xl max-w-sm w-full animate-in fade-in zoom-in duration-200">
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2"><span className="material-icons text-purple-500">lock</span> Autoryzacja AI</h2>
            <p className="text-gray-400 text-xs mb-6">Funkcja analizy AI wymaga zalogowania.</p>
            <form onSubmit={handleLogin} className="space-y-4">
              <div><label className="block text-xs font-bold text-gray-500 mb-1 uppercase">Email</label><input type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-sm text-white focus:border-purple-500 outline-none transition-colors" placeholder="name@example.com" /></div>
              <div><label className="block text-xs font-bold text-gray-500 mb-1 uppercase">Hasło</label><input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-sm text-white focus:border-purple-500 outline-none transition-colors" placeholder="••••••••" /></div>
              {loginError && <div className="text-red-400 text-xs flex items-center gap-1 bg-red-400/10 p-2 rounded"><span className="material-icons text-sm">error</span> {loginError}</div>}
              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => setShowLoginModal(false)} className="flex-1 py-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded text-sm transition-colors">Anuluj</button>
                <button type="submit" className="flex-1 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded font-bold text-sm shadow-lg shadow-purple-900/20 transition-all transform active:scale-95">Zaloguj</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="absolute top-4 right-4 z-50 flex flex-col items-end">
        <CompassAssistant onClick={handleAssistantClick} isAutoTriggered={isAutoTriggered} />
        {showTip && (
          <div className="mt-2 mr-2 bg-white text-gray-800 p-4 rounded-xl rounded-tr-none shadow-2xl w-64 border-2 border-blue-500 animate-in fade-in slide-in-from-top-2 relative">
             <div className="absolute -top-2 right-6 w-4 h-4 bg-white border-t-2 border-l-2 border-blue-500 transform rotate-45"></div>
             <div className="flex justify-between items-start mb-3">
               <h3 className="font-bold text-blue-600 text-sm flex items-center gap-1"><span className="material-icons text-sm">lightbulb</span> Asystent</h3>
               <button onClick={() => setShowTip(false)} className="text-gray-400 hover:text-red-500"><span className="material-icons text-sm">close</span></button>
             </div>
             <div className="relative mb-3">
               <input type="text" value={tipSearch} onChange={(e) => setTipSearch(e.target.value)} placeholder="Szukaj porady..." className="w-full bg-gray-100 border border-gray-300 rounded px-2 py-1 text-xs outline-none focus:border-blue-400" />
               <span className="material-icons absolute right-2 top-1.5 text-gray-400 text-xs">search</span>
             </div>
             {tipSearch ? (
               <div className="max-h-40 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 pr-1">
                 {filteredTips.length > 0 ? (<ul className="space-y-2">{filteredTips.map((tip, idx) => (<li key={idx} className="text-xs bg-gray-50 p-2 rounded border border-gray-100">{tip}</li>))}</ul>) : (<div className="text-center text-xs text-gray-500 py-2">Brak wyników.</div>)}
               </div>
             ) : (
               <>
                 <p className="text-sm leading-relaxed mb-3 min-h-[3em]">{APP_TIPS[currentTipIndex]}</p>
                 <div className="flex justify-between items-center text-xs text-gray-500">
                   <div className="flex gap-1"><button onClick={handlePrevTip} className="hover:text-blue-600 p-1"><span className="material-icons text-sm">chevron_left</span></button><button onClick={handleForwardTip} className="hover:text-blue-600 p-1"><span className="material-icons text-sm">chevron_right</span></button></div>
                   <button onClick={handleNextTip} className="text-blue-500 hover:underline">Losuj</button>
                 </div>
               </>
             )}
          </div>
        )}
      </div>

      <div className={`absolute top-0 left-0 h-full w-80 bg-gray-800 border-r border-gray-700 flex flex-col shadow-xl z-40 transition-transform duration-300 ease-in-out ${showUI ? 'translate-x-0' : '-translate-x-80'}`}>
        <div className="p-4 border-b border-gray-700 bg-gray-800 flex justify-between items-center">
          <div><h1 className="text-xl font-bold text-blue-400 flex items-center gap-2"><span className="material-icons">architecture</span> Porównywarka</h1><p className="text-xs text-gray-400 mt-1">Nakładka Cyfrowa</p></div>
          <button onClick={() => setShowUI(false)} className="text-gray-400 hover:text-white" title="Ukryj Panel"><span className="material-icons">chevron_left</span></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-thin scrollbar-thumb-gray-600">
          <div className="space-y-4">
            <div className={`p-3 rounded-lg border border-gray-600 transition-colors ${activeLayerId === 'A' ? 'bg-blue-900/40 border-blue-500' : 'bg-gray-700'}`}>
              <div className="flex justify-between items-center mb-2">
                 <label className="text-xs font-bold text-gray-300 uppercase tracking-wider">Plan Bazowy (A)</label>
                 <button onClick={() => setActiveLayerId('A')} className={`text-[10px] px-2 py-0.5 rounded border ${activeLayerId === 'A' ? 'bg-blue-500 text-white border-blue-500' : 'border-gray-500 text-gray-400 hover:bg-gray-600'}`}>EDYTUJ</button>
              </div>
              <input type="file" accept="application/pdf" onChange={(e) => handleFileUpload(e, 'A')} className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700 cursor-pointer" />
              {layerA.imageData && <div className="mt-2 text-xs text-gray-400 flex items-center gap-2"><span className="material-icons text-sm text-green-400">check_circle</span> Wczytano pomyślnie</div>}
            </div>
            
            <div className="flex items-center justify-center"><div className="h-px bg-gray-600 flex-1"></div><span className="px-2 text-gray-500 text-xs">LUB</span><div className="h-px bg-gray-600 flex-1"></div></div>
            
            <div className={`p-3 rounded-lg border border-gray-600 transition-colors ${activeLayerId === 'B' ? 'bg-orange-900/40 border-orange-500' : 'bg-gray-700'}`}>
               <div className="flex justify-between items-center mb-2">
                 <label className="text-xs font-bold text-gray-300 uppercase tracking-wider pl-2 border-l-4 border-orange-500">Nakładka (B)</label>
                 <button onClick={() => setActiveLayerId('B')} className={`text-[10px] px-2 py-0.5 rounded border ${activeLayerId === 'B' ? 'bg-orange-500 text-white border-orange-500' : 'border-gray-500 text-gray-400 hover:bg-gray-600'}`}>EDYTUJ</button>
               </div>
              <div className="flex flex-col gap-2">
                <input type="file" accept="application/pdf" onChange={(e) => handleFileUpload(e, 'B')} className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-orange-600 file:text-white hover:file:bg-orange-700 cursor-pointer" />
                <button onClick={handleSplitSingleFile} className="mt-1 flex items-center gap-1 text-xs text-orange-300 hover:text-orange-200 underline text-left"><span className="material-icons text-[14px]">content_copy</span> Duplikuj Plan Bazowy (Podział)</button>
              </div>
            </div>
          </div>
          <div className="space-y-3 pt-2 border-t border-gray-700">
             <label className="block text-xs font-bold text-gray-300 uppercase tracking-wider">Tryb Porównania</label>
             <div className="grid grid-cols-5 gap-1 bg-gray-900 p-1 rounded-lg">
                {[{ id: 'overlay', icon: 'layers', label: 'Nakład' }, { id: 'slider', icon: 'view_column', label: 'Suwak' }, { id: 'blink', icon: 'flaky', label: 'Mrug.' }, { id: 'sequence', icon: 'loop', label: 'Pętla' }, { id: 'difference', icon: 'contrast', label: 'Różn.' }].map(m => (
                  <button key={m.id} onClick={() => setMode(m.id as ComparisonMode)} title={m.label} className={`py-2 px-1 text-xs rounded-md flex flex-col items-center gap-1 ${mode === m.id ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800'}`}><span className="material-icons text-sm">{m.icon}</span> {m.label}</button>
                ))}
             </div>
          </div>
          {(layerA.imageData || layerB.imageData) && (
            <div className="space-y-4 pt-2 border-t border-gray-700">
               <label className="block text-xs font-bold text-gray-300 uppercase tracking-wider flex justify-between"><span>Dostosuj Aktywną ({activeLayerId})</span><span className={`text-[10px] px-1 rounded ${activeLayerId === 'A' ? 'bg-blue-400/20 text-blue-400' : 'bg-orange-400/20 text-orange-400'}`}>Edytujesz: {activeLayer.name}</span></label>
               
               {/* Crossfader for ALL modes */}
               <div className="bg-gray-900 p-2 rounded">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>Mikser A / B</span>
                    <span className="text-[10px]">{crossfader === 0 ? 'Tylko A' : crossfader === 100 ? 'Tylko B' : crossfader === 50 ? 'Mix 50/50' : `${100-crossfader}/${crossfader}`}</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-blue-500">A</span>
                    <input type="range" min="0" max="100" step="1" value={crossfader} onChange={(e) => setCrossfader(parseInt(e.target.value))} className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-white" />
                    <span className="text-[10px] font-bold text-orange-500">B</span>
                </div>
               </div>

               <div className="bg-gray-900 p-2 rounded">
                 <div className="flex justify-between text-xs text-gray-400 mb-2"><span>Kolorowanie</span><span className="uppercase text-[10px]">{activeLayer.tint}</span></div>
                 <div className="flex gap-2 mb-2">
                    {[{ c: 'none', bg: 'bg-white' }, { c: 'red', bg: 'bg-red-500' }, { c: 'blue', bg: 'bg-blue-500' }, { c: 'green', bg: 'bg-green-500' }, { c: 'yellow', bg: 'bg-yellow-400' }].map((opt) => (
                      <button key={opt.c} onClick={() => updateActiveLayer({ tint: opt.c as ColorTint }, true)} className={`w-6 h-6 rounded-full border-2 ${opt.bg} ${activeLayer.tint === opt.c ? 'border-white scale-110 shadow-lg' : 'border-gray-600 opacity-60 hover:opacity-100'} transition-all`} title={opt.c}></button>
                    ))}
                 </div>
                 {activeLayer.tint !== 'none' && (<div><div className="flex justify-between text-[10px] text-gray-500 mb-1">Moc Koloru</div><input type="range" min="0.1" max="1" step="0.1" value={activeLayer.tintIntensity} onChange={(e) => updateActiveLayer({ tintIntensity: parseFloat(e.target.value) })} onMouseUp={() => pushHistory()} className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-gray-400" /></div>)}
               </div>
               {(mode === 'blink' || mode === 'sequence') && (<div><div className="flex justify-between text-xs text-gray-400 mb-1"><span>Szybkość</span><span>{animSpeed}ms</span></div><input type="range" min="100" max="2000" step="100" value={animSpeed} onChange={(e) => setAnimSpeed(parseInt(e.target.value))} className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-orange-500" /></div>)}
               {mode === 'slider' && (<div><div className="flex justify-between text-xs text-gray-400 mb-1"><span>Pozycja Suwaka</span><span>{sliderVal}%</span></div><input type="range" min="0" max="100" step="1" value={sliderVal} onChange={(e) => setSliderVal(parseInt(e.target.value))} className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-500" /><p className="text-[10px] text-gray-500 mt-1">Lewo: Plan A | Prawo: Plan B</p></div>)}
               <div className="bg-gray-900 p-2 rounded">
                 <div className="text-xs text-gray-500 mb-2">Ręczne Przesuwanie (Precyzja 0.1px)</div>
                 <div className="grid grid-cols-3 gap-1 mb-2">
                    <div></div><button onClick={() => updateActiveLayer({ offsetY: activeLayer.offsetY - 0.1 }, true)} className="bg-gray-700 hover:bg-gray-600 rounded p-1"><span className="material-icons text-sm block">keyboard_arrow_up</span></button><div></div>
                    <button onClick={() => updateActiveLayer({ offsetX: activeLayer.offsetX - 0.1 }, true)} className="bg-gray-700 hover:bg-gray-600 rounded p-1"><span className="material-icons text-sm block">keyboard_arrow_left</span></button><button onClick={() => updateActiveLayer({ offsetY: activeLayer.offsetY + 0.1 }, true)} className="bg-gray-700 hover:bg-gray-600 rounded p-1"><span className="material-icons text-sm block">keyboard_arrow_down</span></button><button onClick={() => updateActiveLayer({ offsetX: activeLayer.offsetX + 0.1 }, true)} className="bg-gray-700 hover:bg-gray-600 rounded p-1"><span className="material-icons text-sm block">keyboard_arrow_right</span></button>
                 </div>
               </div>
               <div className="flex gap-2 text-xs"><button onClick={() => updateActiveLayer({ scale: activeLayer.scale + 0.01 }, true)} className="flex-1 bg-gray-700 py-1 rounded hover:bg-gray-600">Skala +</button><button onClick={() => updateActiveLayer({ scale: activeLayer.scale - 0.01 }, true)} className="flex-1 bg-gray-700 py-1 rounded hover:bg-gray-600">Skala -</button></div>
               <div className="flex gap-2 text-xs"><button onClick={() => updateActiveLayer({ rotation: activeLayer.rotation + 90 }, true)} className="flex-1 bg-gray-700 py-1 rounded hover:bg-gray-600 flex items-center justify-center gap-1"><span className="material-icons text-[10px]">rotate_right</span> Obrót 90</button><button onClick={() => updateActiveLayer({ rotation: 0 }, true)} className="flex-1 bg-gray-700 py-1 rounded hover:bg-gray-600">Reset</button></div>
               <div className="pt-4 border-t border-gray-700 space-y-2">
                  <h3 className="text-xs font-bold text-gray-300 uppercase mb-2">Jakość Renderowania</h3>
                  <div className="grid grid-cols-4 gap-1">{[2, 4, 8, 16].map(scale => (<button key={scale} disabled={isHighResLoading || highResLevel === scale} onClick={() => handleQualityRender(scale)} className={`py-1 text-[10px] rounded border ${highResLevel === scale ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'}`}>x{scale} {scale === 2 ? '(SD)' : scale === 4 ? '(HD)' : scale === 8 ? '(UHD)' : '(MAX)'}</button>))}</div>
                  {isHighResLoading && <div className="text-[10px] text-yellow-400 text-center animate-pulse">Przetwarzanie w toku...</div>}
                  <h3 className="text-xs font-bold text-gray-300 uppercase mt-4 mb-2">Akcje</h3>
                  <button onClick={handleExport} className="w-full py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm flex items-center justify-center gap-2 transition-colors text-gray-200"><span className="material-icons text-sm">crop_free</span> Eksportuj Widok (PNG)</button>
                 <button onClick={performAIAnalysis} disabled={isAnalyzing} className={`w-full py-2 rounded-lg font-bold text-sm flex items-center justify-center gap-2 ${isAnalyzing ? 'bg-gray-700 text-gray-500' : 'bg-purple-600 hover:bg-purple-500 text-white'}`}>{isAnalyzing ? <span className="material-icons animate-spin text-sm">autorenew</span> : <span className="material-icons text-sm">auto_awesome</span>}{isAnalyzing ? 'Analizuję...' : 'Znajdź Zmiany (AI)'}</button>
               </div>
               {aiAnalysis && <div className="bg-gray-900 border border-purple-900/50 p-3 rounded text-xs text-gray-300 leading-relaxed max-h-40 overflow-y-auto"><h4 className="font-bold text-purple-400 mb-1">Raport AI:</h4>{aiAnalysis}</div>}
            </div>
          )}
          <div className="mt-4 pt-4 border-t border-gray-700 text-center"><button onClick={() => setShowUI(false)} className="text-gray-400 hover:text-white flex items-center justify-center gap-2 mx-auto text-xs"><span className="material-icons">fullscreen</span> Pełny Ekran</button></div>
        </div>
      </div>

      {!showUI && <button onClick={() => setShowUI(true)} className="absolute top-4 left-4 z-50 bg-gray-800 text-white p-2 rounded-full shadow-lg hover:bg-gray-700 border border-gray-600" title="Pokaż Narzędzia"><span className="material-icons">menu</span></button>}

      <div className={`flex-1 relative overflow-hidden flex flex-col transition-all duration-300 ${showUI ? 'ml-80' : 'ml-0'} ${(!layerA.imageData && !layerB.imageData) ? 'checkered-bg' : 'bg-white'}`}>
        
        <div className={`absolute top-4 left-1/2 -translate-x-1/2 z-30 flex gap-2 transition-opacity duration-300 ${showUI ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
           <div className="bg-white/90 backdrop-blur text-black p-1 rounded-full shadow-lg border border-gray-300 flex items-center gap-1">
              <button onClick={() => setTool('pan_view')} title="Przesuń Widok" className={`p-2 rounded-full transition-colors ${tool === 'pan_view' ? 'bg-gray-900 text-white shadow' : 'text-gray-500 hover:bg-gray-200'}`}><span className="material-icons text-sm block">hand_gesture</span></button>
              <button onClick={() => setTool('move_layer')} title={`Przesuń Aktywną Warstwę (${activeLayerId})`} disabled={!activeLayer.imageData} className={`p-2 rounded-full transition-colors ${tool === 'move_layer' ? 'bg-orange-600 text-white shadow' : 'text-gray-500 hover:bg-gray-200'} ${!activeLayer.imageData && 'opacity-30 cursor-not-allowed'}`}><span className="material-icons text-sm block">open_with</span></button>
              <div className="w-px h-6 bg-gray-300 mx-1"></div>
              <button onClick={activatePointMatch} title="Dopasuj Punkty (Kliknij A, potem B)" disabled={!layerB.imageData || !layerA.imageData} className={`p-2 rounded-full transition-colors flex items-center justify-center ${tool === 'match_points' ? 'bg-red-600 text-white shadow animate-pulse' : 'text-gray-500 hover:bg-gray-200'} ${(!layerB.imageData || !layerA.imageData) && 'opacity-30 cursor-not-allowed'}`}><span className="material-icons text-sm block">center_focus_strong</span></button>
           </div>
           
           <div className="bg-white/90 backdrop-blur text-black p-1 rounded-full shadow-lg border border-gray-300 flex items-center px-2 gap-1">
              <button onClick={undo} disabled={historyIndex <= 0} title="Cofnij (Ctrl+Z)" className={`p-2 rounded-full ${historyIndex > 0 ? 'text-gray-800 hover:bg-gray-200' : 'text-gray-300 cursor-default'}`}><span className="material-icons text-sm block">undo</span></button>
              <button onClick={redo} disabled={historyIndex >= history.length - 1} title="Ponów (Ctrl+Y)" className={`p-2 rounded-full ${historyIndex < history.length - 1 ? 'text-gray-800 hover:bg-gray-200' : 'text-gray-300 cursor-default'}`}><span className="material-icons text-sm block">redo</span></button>
           </div>

           <div className="bg-white/90 backdrop-blur text-black p-1 rounded-full shadow-lg border border-gray-300 flex items-center px-3 gap-2">
              <button onClick={() => setViewScale(s => Math.max(0.1, s * 0.9))} className="text-gray-600 hover:text-black"><span className="material-icons text-sm">remove</span></button>
              <span className="text-xs font-mono w-12 text-center">{Math.round(viewScale * 100)}%</span>
              <button onClick={() => setViewScale(s => Math.min(10, s * 1.1))} className="text-gray-600 hover:text-black"><span className="material-icons text-sm">add</span></button>
           </div>
        </div>

        {tool === 'match_points' && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 bg-black/70 backdrop-blur text-white px-4 py-2 rounded-full shadow-xl pointer-events-none transition-all flex items-center gap-3">
            {matchStep === 1 ? (<><span className="w-3 h-3 rounded-full bg-red-500 animate-pulse"></span><span className="text-xs font-bold">KROK 1: Kliknij punkt na PLANIE BAZOWYM (A)</span></>) : (<><span className="w-3 h-3 rounded-full bg-green-500 animate-pulse"></span><span className="text-xs font-bold">KROK 2: Kliknij ten sam punkt na NAKŁADCE (B)</span></>)}
            <div className="text-[10px] text-gray-300 border-l border-gray-500 pl-3">ESC aby anulować</div>
          </div>
        )}

        <div className={`absolute bottom-10 right-4 z-20 pointer-events-none transition-opacity duration-300 ${showUI ? 'opacity-100' : 'opacity-0'}`}>
          <div className="bg-white/90 backdrop-blur p-2 rounded-lg shadow-lg border border-gray-300 text-[10px] font-medium text-gray-900 flex flex-col gap-1">
             <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-blue-500/50 border border-blue-500"></span><span>Plan A (Baza)</span></div>
             <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-orange-500/50 border border-orange-500"></span><span>Plan B (Nakładka)</span></div>
          </div>
        </div>

        <div ref={containerRef} className={`flex-1 relative overflow-hidden ${tool === 'pan_view' ? 'cursor-grab active:cursor-grabbing' : tool === 'match_points' ? 'cursor-crosshair' : tool === 'adjust_anchor' ? 'cursor-move' : 'cursor-default'}`} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp} onWheel={handleWheel}>
          {!layerA.imageData && !layerB.imageData && (
             <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center p-8 bg-white/80 rounded-xl shadow-xl backdrop-blur-sm max-w-md pointer-events-none z-10">
                <span className="material-icons text-6xl text-gray-400 mb-4">layers</span><h2 className="text-xl font-bold text-gray-800 mb-2">Rozpocznij Porównywanie</h2><p className="text-gray-600 mb-6">Wgraj plik PDF z planem bazowym (po lewej), aby rozpocząć.</p>
             </div>
          )}
          <div style={getContainerStyle()}>
             {layerA.imageData && <div style={getLayerStyle(layerA, 'A')}><img src={layerA.imageData} alt="Layer A" draggable={false} className="max-w-none shadow-lg bg-white" /></div>}
             {layerB.imageData && <div style={getLayerStyle(layerB, 'B')} className={tool === 'move_layer' && activeLayerId === 'B' ? 'cursor-move' : ''}>{tool === 'move_layer' && activeLayerId === 'B' && <div className="absolute -inset-1 border-2 border-orange-400 border-dashed pointer-events-none z-50"></div>}<img src={layerB.imageData} alt="Layer B" draggable={false} className={`max-w-none shadow-lg ${mode === 'difference' ? 'bg-transparent' : 'bg-white'}`} /></div>}
             {tool === 'move_layer' && activeLayerId === 'A' && layerA.imageData && <div className="absolute z-50 border-2 border-blue-400 border-dashed pointer-events-none" style={{ ...getLayerStyle(layerA, 'A'), border: 'none' }}><div className="absolute inset-0 border-2 border-blue-400 border-dashed"></div></div>}

             {/* Moved Pins to END of container to ensure visibility over layers */}
             
             {/* Match Point A Indicator */}
             {tool === 'match_points' && matchPointA && (
                <div className="absolute w-0 h-0 z-[100] pointer-events-none" style={{ left: matchPointA.x, top: matchPointA.y }}>
                  <div className="absolute -left-2 -top-2 w-4 h-4 border-2 border-red-500 rounded-full bg-red-500/30 animate-ping"></div>
                  <div className="absolute -left-2 -top-2 w-4 h-4 border-2 border-red-500 rounded-full bg-red-500/30"></div>
                  <div className="absolute -left-3 top-0 w-6 h-px bg-red-500"></div>
                  <div className="absolute left-0 -top-3 w-px h-6 bg-red-500"></div>
                  <div className="absolute left-3 -top-4 text-xs bg-red-600 text-white px-1 rounded shadow">A</div>
                </div>
             )}
             
             {/* Anchor Pin Visualization */}
             {layerB.anchorTarget && (
               <div 
                  className={`absolute z-[100] transform -translate-x-1/2 -translate-y-full cursor-pointer hover:scale-110 transition-transform ${tool === 'adjust_anchor' ? 'scale-125' : ''}`}
                  style={{ left: layerB.anchorTarget.x, top: layerB.anchorTarget.y }}
                  title="Kotwica obrotu (Chwyć aby przesunąć)"
               >
                 <span className="material-icons text-blue-600 text-3xl drop-shadow-md">push_pin</span>
               </div>
             )}

          </div>
        </div>
        
        <div className={`h-6 bg-white border-t border-gray-300 flex items-center justify-between px-4 text-[10px] text-gray-500 z-20 transition-all duration-300 ${showUI ? 'opacity-100' : 'h-0 opacity-0 overflow-hidden border-none'}`}>
           <div>{layerA.file ? `A: ${layerA.file.name}` : 'A: Pusty'}  {layerB.file && ` / B: ${layerB.file.name}`}</div>
           <div>{tool === 'move_layer' ? `PRZESUWANIE WARSTWY ${activeLayerId}` : tool === 'match_points' ? 'DOPASOWYWANIE PUNKTÓW...' : 'PRZESUWANIE WIDOKU (SCROLL BY ZBLIŻYĆ DO KURSORA)'}</div>
        </div>
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);