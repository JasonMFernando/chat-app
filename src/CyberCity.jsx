const WIDTH = 1200;
const HEIGHT = 320;
const WINDOW_COLORS = ["#f9f002", "#05d9e8", "#ff2a6d", "#ffb86b"];
const NEON_COLORS = ["#ff2a6d", "#05d9e8", "#f9f002", "#b967ff"];

function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function buildSkyline({ seed, minHeight, maxHeight, windowChance, signChance }) {
  const random = seededRandom(seed);
  const buildings = [];
  let x = -10;

  while (x < WIDTH) {
    const width = 34 + random() * 70;
    const height = minHeight + random() * (maxHeight - minHeight);
    const top = HEIGHT - height;
    const windows = [];

    for (let wy = top + 10; wy < HEIGHT - 8; wy += 12) {
      for (let wx = x + 6; wx < x + width - 8; wx += 9) {
        if (random() < windowChance) {
          windows.push({
            x: wx,
            y: wy,
            color: WINDOW_COLORS[Math.floor(random() * WINDOW_COLORS.length)],
            opacity: 0.35 + random() * 0.55,
            flicker: random() < 0.04,
          });
        }
      }
    }

    const sign =
      random() < signChance
        ? {
            x: x + width * (0.2 + random() * 0.5),
            y: top + 14 + random() * Math.max(10, height * 0.3),
            height: 26 + random() * 40,
            color: NEON_COLORS[Math.floor(random() * NEON_COLORS.length)],
          }
        : null;

    const antenna = random() < 0.3 ? { x: x + width / 2, height: 12 + random() * 30 } : null;

    buildings.push({ x, width, top, height, windows, sign, antenna });
    x += width + random() * 8;
  }

  return buildings;
}

const FAR = buildSkyline({
  seed: 7,
  minHeight: 120,
  maxHeight: 280,
  windowChance: 0.12,
  signChance: 0.15,
});

const NEAR = buildSkyline({
  seed: 42,
  minHeight: 60,
  maxHeight: 190,
  windowChance: 0.22,
  signChance: 0.35,
});

const RAIN = Array.from({ length: 70 }, (_, i) => ({
  x: `${(i * 53 + 7) % 100}%`,
  length: `${50 + ((i * 17) % 60)}px`,
  dur: `${0.55 + ((i * 7) % 6) * 0.08}s`,
  delay: `${-((i * 0.137) % 1.2).toFixed(2)}s`,
  opacity: 0.25 + ((i * 29) % 10) / 25,
}));

function Skyline({ buildings, fill, className }) {
  return (
    <svg
      className={className}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="xMidYMax slice"
    >
      <defs>
        <filter id={`${className}-glow`} x="-200%" y="-50%" width="500%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {buildings.map((building, i) => (
        <g key={i}>
          {building.antenna && (
            <rect
              x={building.antenna.x}
              y={building.top - building.antenna.height}
              width="2"
              height={building.antenna.height}
              fill={fill}
            />
          )}
          <rect
            x={building.x}
            y={building.top}
            width={building.width}
            height={building.height}
            fill={fill}
          />
          {building.windows.map((win, j) => (
            <rect
              key={j}
              className={win.flicker ? "city-flicker" : undefined}
              x={win.x}
              y={win.y}
              width="4"
              height="6"
              fill={win.color}
              opacity={win.opacity}
            />
          ))}
        </g>
      ))}
      <g filter={`url(#${className}-glow)`}>
        {buildings
          .filter((building) => building.sign)
          .map((building, i) => (
            <rect
              key={i}
              x={building.sign.x}
              y={building.sign.y}
              width="5"
              height={building.sign.height}
              rx="1"
              fill={building.sign.color}
            />
          ))}
      </g>
    </svg>
  );
}

export default function CyberCity() {
  return (
    <div className="cyber-city" aria-hidden="true">
      <div className="city-glow" />
      <Skyline buildings={FAR} fill="#1a1036" className="city-far" />
      <Skyline buildings={NEAR} fill="#0b0818" className="city-near" />
      <div className="rain">
        {RAIN.map((drop, i) => (
          <span
            key={i}
            style={{
              "--x": drop.x,
              "--len": drop.length,
              "--dur": drop.dur,
              "--delay": drop.delay,
              "--o": drop.opacity,
            }}
          />
        ))}
      </div>
    </div>
  );
}
