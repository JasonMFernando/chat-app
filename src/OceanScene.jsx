const WAVE_WIDTH = 2880;
const WAVE_HEIGHT = 40;

function wavePath(amplitude, approxWavelength) {
  const loop = WAVE_WIDTH / 2;
  const wavelength = loop / Math.max(1, Math.round(loop / approxWavelength));
  const half = wavelength / 2;
  const repeats = Math.ceil(WAVE_WIDTH / half);
  return (
    `M0 ${amplitude} q ${wavelength / 4} ${-amplitude} ${half} 0 ` +
    `t ${half} 0 `.repeat(repeats - 1) +
    `V ${WAVE_HEIGHT} H 0 Z`
  );
}

const SHIPS = [
  { layer: "far", top: "-48px", size: 26, dur: "95s", delay: "-20s", sail: "#f6ecd2" },
  { layer: "far", top: "-43px", size: 20, dur: "130s", delay: "-85s", sail: "#e9dcc0", reverse: true },
  { layer: "near", top: "calc(30% - 69px)", size: 58, dur: "70s", delay: "-32s", sail: "#fbf3dd", stripe: true },
];

const GULLS = [
  { top: "14%", dur: "38s", delay: "-6s", scale: 1 },
  { top: "20%", dur: "46s", delay: "-25s", scale: 0.7 },
  { top: "10%", dur: "52s", delay: "-40s", scale: 0.55 },
];

const CLOUDS = [
  { top: "8%", width: 180, dur: "70s", delay: "-10s" },
  { top: "22%", width: 120, dur: "95s", delay: "-60s" },
  { top: "4%", width: 240, dur: "120s", delay: "-90s" },
  { top: "32%", width: 150, dur: "80s", delay: "-45s" },
  { top: "15%", width: 90, dur: "60s", delay: "-30s" },
];

const STARS = Array.from({ length: 48 }, (_, i) => ({
  left: `${(i * 47 + 13) % 100}%`,
  top: `${(i * 31 + 5) % 56}%`,
  size: 1 + ((i * 7) % 3) * 0.6,
  delay: `${-((i * 0.37) % 3).toFixed(2)}s`,
}));

function Ship({ sail, stripe }) {
  return (
    <svg viewBox="0 0 120 100" className="ship-svg">
      <rect x="58" y="10" width="3" height="58" fill="#3b2412" />
      <path d="M61 6 h16 l-3 5 l3 5 h-16 z" fill="#111" />
      <circle cx="68" cy="11" r="2.4" fill="#f4ead2" />
      <path d="M36 14 Q60 20 84 14 L82 32 Q60 37 38 32 Z" fill={sail} />
      <path d="M28 36 Q60 44 92 36 L89 60 Q60 66 31 60 Z" fill={sail} />
      {stripe && <path d="M30 46 Q60 54 90 46 L90 50 Q60 58 30 50 Z" fill="#e63b2e" />}
      <path d="M6 64 L114 64 L102 82 Q60 90 18 82 Z" fill="#6b4423" />
      <path d="M10 68 L110 68" stroke="#f2b632" strokeWidth="2" />
      <circle cx="112" cy="62" r="4" fill="#f2b632" />
    </svg>
  );
}

function ShipTrack({ ship }) {
  return (
    <div
      className={`ship-track${ship.reverse ? " reverse" : ""}`}
      style={{ top: ship.top, "--dur": ship.dur, "--delay": ship.delay }}
    >
      <div className="ship" style={{ height: ship.size, width: ship.size * 1.2 }}>
        <Ship sail={ship.sail} stripe={ship.stripe} />
        <span className="ship-lantern" />
      </div>
    </div>
  );
}

function WaveBand({ className, color, amplitude, wavelength }) {
  return (
    <div className={`wave-band ${className}`} style={{ background: color }}>
      <svg
        className="wave-crest"
        viewBox={`0 0 ${WAVE_WIDTH} ${WAVE_HEIGHT}`}
        preserveAspectRatio="none"
      >
        <path d={wavePath(amplitude, wavelength)} fill={color} />
      </svg>
    </div>
  );
}

export default function OceanScene() {
  return (
    <div className="ocean-scene" aria-hidden="true">
      <div className="sky-day" />
      <div className="sky-night" />
      <div className="ocean-stars">
        {STARS.map((star, i) => (
          <span
            key={i}
            style={{
              left: star.left,
              top: star.top,
              width: star.size,
              height: star.size,
              animationDelay: star.delay,
            }}
          />
        ))}
      </div>
      <div className="shooting-star" />
      <div className="ocean-sun" />
      <div className="ocean-moon" />
      {CLOUDS.map((cloud, i) => (
        <div
          key={i}
          className="ocean-cloud"
          style={{
            top: cloud.top,
            width: cloud.width,
            height: cloud.width * 0.32,
            "--dur": cloud.dur,
            "--delay": cloud.delay,
          }}
        />
      ))}
      {GULLS.map((gull, i) => (
        <div
          key={i}
          className="gull-track"
          style={{ top: gull.top, "--dur": gull.dur, "--delay": gull.delay }}
        >
          <svg
            className="gull"
            viewBox="0 0 24 10"
            style={{ width: 24 * gull.scale, height: 10 * gull.scale }}
          >
            <path d="M1 7 Q6 1 12 7 Q18 1 23 7" stroke="#2b2238" strokeWidth="1.8" fill="none" />
          </svg>
        </div>
      ))}
      <div className="sea">
        {SHIPS.filter((ship) => ship.layer === "far").map((ship, i) => (
          <ShipTrack key={i} ship={ship} />
        ))}
        <WaveBand className="back" color="#2a6a9c" amplitude={6} wavelength={160} />
        <div className="sun-glint" />
        {SHIPS.filter((ship) => ship.layer === "near").map((ship, i) => (
          <ShipTrack key={i} ship={ship} />
        ))}
        <WaveBand className="mid" color="#1c5283" amplitude={10} wavelength={240} />
        <WaveBand className="front" color="#123b63" amplitude={14} wavelength={320} />
        <div className="moon-glint" />
      </div>
    </div>
  );
}
