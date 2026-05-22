import { useEffect, useRef, useState } from "react";
import { FilesetResolver, HandLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";

const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const PINCH_ENTER = 0.06;
const PINCH_EXIT = 0.085;
const FIST_CURL_THRESHOLD = 3; // 3+ fingers curled = fist

export type HandStatus = "idle" | "loading" | "running" | "error";
export type HandMode = "none" | "open" | "pinch" | "fist" | "two-hand";

export interface HandSignal {
  hasHand: boolean;
  cursor: { x: number; y: number };
  pinching: boolean;
  pinchDistance: number;
  fist: boolean;
  hasSecondHand: boolean;
  twoHandSpan: number; // normalized image-space distance between two palm centers
  mode: HandMode;
  lastUpdate: number;
}

const INITIAL_SIGNAL: HandSignal = {
  hasHand: false,
  cursor: { x: 0.5, y: 0.5 },
  pinching: false,
  pinchDistance: 1,
  fist: false,
  hasSecondHand: false,
  twoHandSpan: 0,
  mode: "none",
  lastUpdate: 0,
};

export interface UseHandLandmarker {
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  signalRef: React.MutableRefObject<HandSignal>;
  status: HandStatus;
  error: string;
}

function distXY(a: NormalizedLandmark, b: NormalizedLandmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

// 4 non-thumb fingers are curled if tip is closer to wrist than its PIP joint.
function curledFingerCount(lm: NormalizedLandmark[]): number {
  const wrist = lm[0];
  const pairs: Array<[number, number]> = [
    [8, 6], // index
    [12, 10], // middle
    [16, 14], // ring
    [20, 18], // pinky
  ];
  let count = 0;
  for (const [tip, pip] of pairs) {
    if (distXY(lm[tip], wrist) < distXY(lm[pip], wrist)) count++;
  }
  return count;
}

export function useHandLandmarker(): UseHandLandmarker {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const signalRef = useRef<HandSignal>({ ...INITIAL_SIGNAL });
  const [status, setStatus] = useState<HandStatus>("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    let landmarker: HandLandmarker | null = null;
    let stream: MediaStream | null = null;
    let raf = 0;
    let cancelled = false;
    let pinching = false;

    async function start() {
      try {
        setStatus("loading");
        const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
        landmarker = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 2,
        });

        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240 },
          audio: false,
        });
        if (cancelled || !videoRef.current || !canvasRef.current) return;

        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();
        setStatus("running");

        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d")!;

        const drawLandmarks = (lm: NormalizedLandmark[], color: string) => {
          ctx.fillStyle = color;
          for (const p of lm) {
            ctx.beginPath();
            ctx.arc((1 - p.x) * canvas.width, p.y * canvas.height, 2.5, 0, Math.PI * 2);
            ctx.fill();
          }
        };

        const loop = () => {
          if (cancelled || !landmarker) return;
          const result = landmarker.detectForVideo(video, performance.now());
          ctx.save();
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          ctx.restore();

          const hands = result.landmarks;
          if (hands.length === 0) {
            if (signalRef.current.hasHand) {
              signalRef.current = { ...INITIAL_SIGNAL };
              pinching = false;
            }
            raf = requestAnimationFrame(loop);
            return;
          }

          // Sort by palm.x to keep "primary" hand stable across frames (left = first)
          const sorted = [...hands].sort((a, b) => a[9].x - b[9].x);
          const primary = sorted[0];
          const second = sorted[1];

          const palm = primary[9];
          const thumb = primary[4];
          const idx = primary[8];
          const dx = thumb.x - idx.x;
          const dy = thumb.y - idx.y;
          const dz = (thumb.z ?? 0) - (idx.z ?? 0);
          const pinchDistance = Math.hypot(dx, dy, dz);

          const curledCount = curledFingerCount(primary);
          const fist = curledCount >= FIST_CURL_THRESHOLD;

          if (!pinching && pinchDistance < PINCH_ENTER) pinching = true;
          else if (pinching && pinchDistance > PINCH_EXIT) pinching = false;

          const hasSecondHand = !!second;
          const twoHandSpan = hasSecondHand ? distXY(primary[9], second[9]) : 0;

          let mode: HandMode;
          if (hasSecondHand) mode = "two-hand";
          else if (fist) mode = "fist";
          else if (pinching) mode = "pinch";
          else mode = "open";

          signalRef.current = {
            hasHand: true,
            cursor: { x: 1 - palm.x, y: palm.y },
            pinching: pinching && !fist && !hasSecondHand,
            pinchDistance,
            fist: fist && !hasSecondHand,
            hasSecondHand,
            twoHandSpan,
            mode,
            lastUpdate: performance.now(),
          };

          // Render landmarks: distinct color per mode
          const primaryColor =
            mode === "fist"
              ? "#f06060"
              : mode === "two-hand"
                ? "#a78bfa"
                : pinching
                  ? "#f0a050"
                  : "#4ad6a6";
          drawLandmarks(primary, primaryColor);
          if (second) drawLandmarks(second, "#a78bfa");

          // Span line for two-hand mode
          if (hasSecondHand) {
            ctx.strokeStyle = "rgba(167,139,250,0.65)";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo((1 - primary[9].x) * canvas.width, primary[9].y * canvas.height);
            ctx.lineTo((1 - second[9].x) * canvas.width, second[9].y * canvas.height);
            ctx.stroke();
          }

          raf = requestAnimationFrame(loop);
        };
        loop();
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    }
    start();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      landmarker?.close();
    };
  }, []);

  return { videoRef, canvasRef, signalRef, status, error };
}
