"use client";

import { useEffect, useRef } from "react";

interface WaveformVisualizerProps {
  stream: MediaStream | null;
  className?: string;
}

export function WaveformVisualizer({ stream, className }: WaveformVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let frame = 0;
    let freq: Uint8Array | null = null;

    function resize() {
      if (!canvas || !container || !ctx) return { width: 0, height: 0 };
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(container.clientWidth, 260);
      const height = Math.max(container.clientHeight, 74);
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      return { width, height };
    }

    function drawIdle() {
      if (!ctx) return;
      const { width, height } = resize();
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = "#b8cfca";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(10, height / 2);
      ctx.lineTo(width - 10, height / 2);
      ctx.stroke();
    }

    function drawLive() {
      if (!ctx || !analyser || !freq) return;
      const { width, height } = resize();
      const centerY = height / 2;
      const barCount = Math.min(72, Math.max(34, Math.floor(width / 8)));
      const gap = 3;
      const barWidth = Math.max(2, (width - (barCount - 1) * gap) / barCount);

      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, "#00796b");
      gradient.addColorStop(0.52, "#12a38f");
      gradient.addColorStop(1, "#004d40");

      analyser.getByteFrequencyData(freq);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = gradient;

      for (let i = 0; i < barCount; i += 1) {
        const start = Math.floor((i / barCount) * freq.length);
        const end = Math.max(start + 1, Math.floor(((i + 1) / barCount) * freq.length));
        let total = 0;
        for (let b = start; b < end; b += 1) total += freq[b];
        const avg = total / (end - start);
        const shape = Math.sin((i / (barCount - 1)) * Math.PI);
        const heightRatio = 0.14 + (avg / 255) * 0.86;
        const barHeight = Math.max(4, heightRatio * shape * (height - 10));
        const x = i * (barWidth + gap);
        const y = centerY - barHeight / 2;
        ctx.fillRect(x, y, barWidth, barHeight);
      }
      frame = requestAnimationFrame(drawLive);
    }

    if (!stream) {
      drawIdle();
      return;
    }

    audioContext = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    audioContext
      .resume()
      .then(() => {
        if (!audioContext) return;
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.72;
        freq = new Uint8Array(analyser.frequencyBinCount);
        source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        drawLive();
      })
      .catch(() => {
        drawIdle();
      });

    const onResize = () => {
      if (analyser) resize();
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      if (frame) cancelAnimationFrame(frame);
      source?.disconnect();
      audioContext?.close().catch(() => undefined);
    };
  }, [stream]);

  return (
    <div
      ref={containerRef}
      className={`relative h-20 w-full rounded-md bg-slate-900/5 ${className ?? ""}`}
    >
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}
