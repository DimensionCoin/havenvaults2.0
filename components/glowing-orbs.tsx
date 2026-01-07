"use client";

export function GlowingOrbs() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      {/* Orbiting elements */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <div
          className="absolute h-3 w-3 rounded-full bg-primary shadow-[0_0_20px_rgba(63,243,135,0.8)]"
          style={{ animation: "orbit 25s linear infinite" }}
        />
        <div
          className="absolute h-2 w-2 rounded-full bg-accent shadow-[0_0_15px_rgba(84,187,122,0.8)]"
          style={{ animation: "orbit 35s linear infinite reverse" }}
        />
        <div
          className="absolute h-4 w-4 rounded-full bg-primary/50 shadow-[0_0_25px_rgba(63,243,135,0.6)]"
          style={{ animation: "orbit 45s linear infinite" }}
        />
      </div>

      {/* Pulsing corner orbs */}
      <div className="absolute top-20 right-20 h-32 w-32 rounded-full bg-primary/10 blur-3xl animate-pulse-glow" />
      <div
        className="absolute bottom-40 left-20 h-24 w-24 rounded-full bg-accent/10 blur-2xl animate-pulse-glow"
        style={{ animationDelay: "2s" }}
      />
    </div>
  );
}
