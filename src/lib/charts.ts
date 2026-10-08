// Helpers SVG compartidos para los donuts de la app (antes vivían solo
// dentro de ProjectsDashboard.tsx) -- los reusan ParticipationChart y
// cualquier otro donut nuevo para no duplicar la trigonometría.
export function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

export function donutSlicePath(cx: number, cy: number, rOuter: number, rInner: number, startAngle: number, endAngle: number) {
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  const p0 = polarToCartesian(cx, cy, rOuter, endAngle);
  const p1 = polarToCartesian(cx, cy, rOuter, startAngle);
  const p2 = polarToCartesian(cx, cy, rInner, startAngle);
  const p3 = polarToCartesian(cx, cy, rInner, endAngle);
  return [
    `M ${p0.x} ${p0.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 0 ${p1.x} ${p1.y}`,
    `L ${p2.x} ${p2.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 1 ${p3.x} ${p3.y}`,
    'Z',
  ].join(' ');
}

const SLICE_COLORS = [
  'var(--blue)', 'var(--gold)', 'var(--rust)', 'var(--green)',
  'var(--slate)', 'var(--brand)', 'var(--ink-soft)', 'var(--brand-strong)',
];

export function colorForIndex(i: number): string {
  return SLICE_COLORS[i % SLICE_COLORS.length];
}
