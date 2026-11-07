function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

const WIDTH = 1200;
const HEIGHT = 720;

const CROWD = (() => {
  const random = seededRandom(19);
  const heads = [];
  for (let row = 0; row < 5; row += 1) {
    const count = 18 + row * 2;
    for (let i = 0; i < count; i += 1) {
      heads.push({
        x: (i + 0.3 + random() * 0.4) * (WIDTH / count) + (row % 2) * 12,
        y: 520 + row * 28 + random() * 8,
        r: 7 + random() * 5 + row * 0.4,
        shade: 18 + Math.floor(random() * 28),
      });
    }
  }
  return heads;
})();

const LIGHTSTICKS = Array.from({ length: 32 }, (_, i) => {
  const random = seededRandom(40 + i);
  return {
    x: 40 + ((i * 97 + 13) % 1120),
    y: 560 + (i % 5) * 22 + random() * 10,
    color: i % 2 === 0 ? "#ff4fd8" : "#3de0ff",
    delay: `${-((i * 0.11) % 2.4).toFixed(2)}s`,
    dur: `${1.6 + (i % 5) * 0.18}s`,
    scale: 0.75 + (i % 4) * 0.08,
  };
});

const CONFETTI = Array.from({ length: 28 }, (_, i) => ({
  x: `${8 + ((i * 37) % 84)}%`,
  delay: `${-((i * 0.23) % 4).toFixed(2)}s`,
  dur: `${3.2 + (i % 6) * 0.35}s`,
  color: i % 3 === 0 ? "#e8eef8" : i % 3 === 1 ? "#3de0ff" : "#c0c8d8",
  w: 3 + (i % 4),
  h: 6 + (i % 5),
  rot: (i * 47) % 360,
}));

const TICKER_TEXT =
  "Trending Fan Topics  ·  lightstick wave  ·  encore chants  ·  fancam night  ·  crown glow sync  ·  pit energy  ·  blue-pink ocean  ·  ";

function Lightstick({ x, y, color, delay, dur, scale }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <g className="concert-lightstick" style={{ "--delay": delay, "--dur": dur }}>
        <rect x="-2" y="10" width="4" height="22" rx="1.5" fill="#1a1a24" />
        <rect x="-1" y="10" width="2" height="22" fill={color} opacity="0.55" />
        <circle cx="0" cy="4" r="8" fill={color} opacity="0.95" />
        <circle cx="0" cy="4" r="11" fill={color} opacity="0.22" />
        <path
          d="M-3.5 1 L0 -2.5 L3.5 1 L2 1 L2 4 L-2 4 L-2 1 Z"
          fill="#fff8"
        />
      </g>
    </g>
  );
}

function Performer({ kind, x, y }) {
  const outfit = kind === "vocal" ? "#2a1a3a" : kind === "drums" ? "#1a2238" : "#182030";
  const accent = kind === "vocal" ? "#ff4fd8" : "#3de0ff";

  return (
    <g transform={`translate(${x} ${y})`}>
      <g className={`concert-performer concert-${kind}`}>
        <path d="M-10 52 L-6 78 L-2 78 L2 52 L6 78 L10 78 L14 52 Z" fill="#12121c" />
        <path
          d="M-16 18 Q-18 48 -12 52 L12 52 Q18 48 16 18 Z"
          fill={outfit}
        />
        <path d="M-14 22 L14 22 L12 28 L-12 28 Z" fill={accent} opacity="0.85" />
        {kind === "guitar-l" && (
          <>
            <path d="M-28 28 L-10 34 L-8 40 L-26 36 Z" fill="#c4a574" />
            <ellipse cx="-32" cy="30" rx="10" ry="14" fill="#1e2430" stroke={accent} strokeWidth="1.5" />
            <rect x="-34" y="8" width="4" height="28" rx="1" fill="#8899aa" />
          </>
        )}
        {kind === "guitar-r" && (
          <>
            <path d="M10 34 L28 28 L26 36 L8 40 Z" fill="#c4a574" />
            <ellipse cx="32" cy="30" rx="10" ry="14" fill="#1e2430" stroke="#ff4fd8" strokeWidth="1.5" />
            <rect x="30" y="8" width="4" height="28" rx="1" fill="#8899aa" />
          </>
        )}
        {kind === "keytar" && (
          <>
            <rect x="-22" y="28" width="36" height="12" rx="3" fill="#151820" stroke={accent} strokeWidth="1.5" />
            <rect x="-18" y="31" width="4" height="6" fill="#fff" opacity="0.7" />
            <rect x="-10" y="31" width="4" height="6" fill="#fff" opacity="0.5" />
            <rect x="-2" y="31" width="4" height="6" fill="#fff" opacity="0.7" />
            <rect x="6" y="31" width="4" height="6" fill="#fff" opacity="0.5" />
            <circle cx="16" cy="34" r="3" fill={accent} />
          </>
        )}
        {kind === "drums" && (
          <>
            <ellipse cx="0" cy="48" rx="28" ry="10" fill="#0e1218" stroke={accent} strokeWidth="2" />
            <rect x="-22" y="30" width="8" height="18" rx="2" fill="#1a2230" stroke={accent} strokeWidth="1" />
            <rect x="14" y="30" width="8" height="18" rx="2" fill="#1a2230" stroke="#ff4fd8" strokeWidth="1" />
            <circle cx="-18" cy="28" r="6" fill="#222a38" stroke={accent} strokeWidth="1.5" />
            <circle cx="18" cy="28" r="6" fill="#222a38" stroke="#ff4fd8" strokeWidth="1.5" />
          </>
        )}
        {kind === "vocal" && (
          <>
            <line x1="8" y1="20" x2="18" y2="8" stroke="#c0c8d4" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="20" cy="4" r="7" fill="#1a1a24" stroke={accent} strokeWidth="2" />
            <circle cx="20" cy="4" r="3" fill={accent} opacity="0.8" />
          </>
        )}
        <circle cx="0" cy="6" r="12" fill="#f0c9a8" />
        <path d="M-11 -2 Q0 -14 11 -2 Q8 4 0 2 Q-8 4 -11 -2" fill="#1a1520" />
        <ellipse cx="-4" cy="6" rx="1.4" ry="1.8" fill="#2a1a18" />
        <ellipse cx="4" cy="6" rx="1.4" ry="1.8" fill="#2a1a18" />
        <ellipse cx="0" cy="30" rx="20" ry="6" fill={accent} opacity="0.12" />
      </g>
    </g>
  );
}

export default function ConcertScene() {
  return (
    <>
    <div className="concert-scene" aria-hidden="true">
      <div className="concert-scene-art">
      <div className="concert-atmosphere" />
      <div className="concert-spotlights" />

      <svg
        className="concert-stage-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient id="concert-led" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ff4fd8" />
            <stop offset="50%" stopColor="#3de0ff" />
            <stop offset="100%" stopColor="#ff4fd8" />
          </linearGradient>
          <linearGradient id="concert-stage-floor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2a2a38" />
            <stop offset="100%" stopColor="#0c0c14" />
          </linearGradient>
          <radialGradient id="concert-haze" cx="50%" cy="40%" r="55%">
            <stop offset="0%" stopColor="#ff4fd8" stopOpacity="0.18" />
            <stop offset="60%" stopColor="#3de0ff" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#000" stopOpacity="0" />
          </radialGradient>
          <filter id="concert-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* arena dark */}
        <rect width={WIDTH} height={HEIGHT} fill="#06060c" />
        <rect width={WIDTH} height={HEIGHT} fill="url(#concert-haze)" />

        {/* LED wall */}
        <g className="concert-led-wall">
          <rect x="180" y="40" width="840" height="220" rx="8" fill="#0a0a14" stroke="#3a3a50" strokeWidth="3" />
          <rect className="concert-led-layer a" x="190" y="50" width="820" height="200" rx="4" fill="url(#concert-led)" opacity="0.35" />
          <g className="concert-led-viz" filter="url(#concert-glow)">
            {Array.from({ length: 18 }, (_, i) => (
              <rect
                key={i}
                className="concert-viz-bar"
                x={220 + i * 42}
                y={220}
                width="18"
                height={40 + ((i * 37) % 120)}
                fill={i % 2 === 0 ? "#ff4fd8" : "#3de0ff"}
                opacity="0.75"
                style={{ "--i": i }}
              />
            ))}
          </g>
          <g className="concert-led-geo">
            <polygon points="600,70 640,130 560,130" fill="none" stroke="#fff" strokeWidth="2" opacity="0.35" />
            <circle cx="480" cy="140" r="36" fill="none" stroke="#3de0ff" strokeWidth="2" opacity="0.45" />
            <circle cx="720" cy="140" r="28" fill="none" stroke="#ff4fd8" strokeWidth="2" opacity="0.45" />
            <rect x="300" y="90" width="60" height="60" fill="none" stroke="#c0c8d8" strokeWidth="1.5" opacity="0.3" transform="rotate(20 330 120)" />
          </g>
        </g>

        {/* stage platform */}
        <path
          d="M80 430 L1120 430 L1180 520 L20 520 Z"
          fill="url(#concert-stage-floor)"
        />
        <path d="M80 430 L1120 430 L1100 438 L100 438 Z" fill="#3de0ff" opacity="0.35" />
        <path d="M100 448 L1100 448" stroke="#ff4fd8" strokeWidth="2" opacity="0.4" />

        {/* spotlights cones */}
        <polygon className="concert-cone" points="350,40 280,430 420,430" fill="#3de0ff" opacity="0.07" />
        <polygon className="concert-cone alt" points="600,40 520,430 680,430" fill="#ff4fd8" opacity="0.08" />
        <polygon className="concert-cone" points="850,40 780,430 920,430" fill="#3de0ff" opacity="0.07" />

        {/* band */}
        <Performer kind="guitar-l" x={340} y={340} />
        <Performer kind="keytar" x={460} y={350} />
        <Performer kind="vocal" x={600} y={330} />
        <Performer kind="guitar-r" x={740} y={350} />
        <Performer kind="drums" x={880} y={320} />

        {/* crowd */}
        <g className="concert-crowd" opacity="0.9">
          {CROWD.map((head, i) => (
            <g key={i}>
              <ellipse cx={head.x} cy={head.y + head.r * 1.4} rx={head.r * 1.6} ry={head.r * 1.1} fill={`rgb(${head.shade},${head.shade},${head.shade + 10})`} />
              <circle cx={head.x} cy={head.y} r={head.r} fill={`rgb(${head.shade + 20},${head.shade + 16},${head.shade + 28})`} />
            </g>
          ))}
        </g>

        {LIGHTSTICKS.map((stick, i) => (
          <Lightstick key={i} {...stick} />
        ))}
      </svg>

      <div className="concert-confetti">
        {CONFETTI.map((piece, i) => (
          <span
            key={i}
            style={{
              left: piece.x,
              background: piece.color,
              width: piece.w,
              height: piece.h,
              "--delay": piece.delay,
              "--dur": piece.dur,
              "--rot": `${piece.rot}deg`,
            }}
          />
        ))}
      </div>
      </div>
    </div>

    <div className="concert-ticker" aria-hidden="true">
      <div className="concert-ticker-track">
        <span>{TICKER_TEXT}</span>
        <span>{TICKER_TEXT}</span>
      </div>
    </div>
    </>
  );
}
