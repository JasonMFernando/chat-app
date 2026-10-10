const WIDTH = 1000;
const HEIGHT = 620;
const MAX_DEPTH = 7;
const BLOSSOM_COLORS = ["#f7b6c8", "#f29bb5", "#fcd3df", "#e8819f", "#ffe4ec"];

function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function growTree(seed) {
  const random = seededRandom(seed);
  const branches = [];
  const blossoms = [];

  function addCluster(x, y, count, spread) {
    for (let i = 0; i < count; i++) {
      blossoms.push({
        x: x + (random() - 0.5) * spread * 2,
        y: y + (random() - 0.5) * spread * 1.6,
        r: 5 + random() * 10,
        color: BLOSSOM_COLORS[Math.floor(random() * BLOSSOM_COLORS.length)],
        opacity: 0.55 + random() * 0.4,
      });
    }
  }

  function grow(x, y, angle, length, width, depth) {
    const rad = (angle * Math.PI) / 180;
    const x2 = x + Math.cos(rad) * length;
    const y2 = y + Math.sin(rad) * length;
    const bend = (random() - 0.5) * length * 0.35;
    const cx = (x + x2) / 2 + Math.cos(rad + Math.PI / 2) * bend;
    const cy = (y + y2) / 2 + Math.sin(rad + Math.PI / 2) * bend;
    branches.push({ d: `M${x} ${y} Q${cx} ${cy} ${x2} ${y2}`, width });

    if (depth >= 5) addCluster(x2, y2, depth === MAX_DEPTH ? 6 : 3, depth === MAX_DEPTH ? 24 : 18);
    if (depth === MAX_DEPTH) return;

    const children = depth < 2 ? 2 : random() < 0.2 ? 3 : 2;
    for (let i = 0; i < children; i++) {
      const side = i === 0 ? -1 : i === 1 ? 1 : random() - 0.5;
      const spread = 18 + random() * 24;
      const nextAngle = Math.min(-6, Math.max(-174, angle + side * spread + 8));
      grow(x2, y2, nextAngle, length * (0.74 + random() * 0.12), width * 0.68, depth + 1);
    }
  }

  grow(180, HEIGHT + 10, -70, 165, 30, 0);
  return { branches, blossoms };
}

const TREE = growTree(11);

export default function SakuraTree() {
  return (
    <div className="sakura-scene" aria-hidden="true">
      <div className="sakura-moon" />
      <svg
        className="sakura-tree"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMinYMax meet"
      >
        <g className="sakura-sway">
          {TREE.branches.map((branch, i) => (
            <path
              key={i}
              d={branch.d}
              stroke="#5a3340"
              strokeWidth={branch.width}
              strokeLinecap="round"
              fill="none"
            />
          ))}
          {TREE.blossoms.map((blossom, i) => (
            <circle
              key={i}
              cx={blossom.x}
              cy={blossom.y}
              r={blossom.r}
              fill={blossom.color}
              opacity={blossom.opacity}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
