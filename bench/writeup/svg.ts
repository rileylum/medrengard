// Two kinds of chart, as standalone SVG with no dependency: rows of points with intervals, and
// small multiples of lines. Colours are Okabe–Ito, safe for colour-blind readers; each chart
// carries a title and a description for screen readers.

/** One configuration's colour, the same in every chart. */
export const colours: Record<string, string> = {
  baseline: "#777777",
  "code-review": "#0072B2",
  "code-review before its review": "#56B4E9",
  verification: "#E69F00",
};

type Point = { series: string; value: number; low?: number; high?: number };

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const round = (value: number) => Math.round(value * 10) / 10;

function frame(width: number, height: number, title: string, description: string, body: string[]) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" font-family="system-ui, sans-serif" font-size="12">`,
    `<title>${escape(title)}</title>`,
    `<desc>${escape(description)}</desc>`,
    `<rect width="${width}" height="${height}" fill="white"/>`,
    `<text x="12" y="20" font-size="14" font-weight="600">${escape(title)}</text>`,
    ...body,
    "</svg>",
    "",
  ].join("\n");
}

function legend(series: readonly string[], x: number, y: number) {
  return series.map((name, index) => {
    const left = x + index * 150;

    return `<circle cx="${left}" cy="${y - 4}" r="4" fill="${colours[name] ?? "black"}"/><text x="${left + 8}" y="${y}">${escape(name)}</text>`;
  });
}

const ticks = (min: number, max: number, step: number) =>
  Array.from({ length: Math.round((max - min) / step) + 1 }, (_, index) => min + index * step);

/**
 * Rows of points, each with its interval when it has one, on one horizontal axis: a forest plot of
 * differences, or each problem's configurations with their range over runs.
 */
export function intervals(chart: {
  title: string;
  description: string;
  axis: { min: number; max: number; step: number; label: string; zero?: boolean };
  rows: readonly { label: string; points: readonly Point[] }[];
}) {
  const series = [...new Set(chart.rows.flatMap((row) => row.points.map((point) => point.series)))];
  const left = 170;
  const plot = 420;
  const rowHeight = 14 + series.length * 10;
  const top = 50;
  const height = top + chart.rows.length * rowHeight + 50;
  const { min, max, step } = chart.axis;
  const x = (value: number) => round(left + ((value - min) / (max - min)) * plot);
  const body: string[] = legend(series, left, 40);

  for (const tick of ticks(min, max, step)) {
    body.push(
      `<line x1="${x(tick)}" x2="${x(tick)}" y1="${top}" y2="${height - 40}" stroke="${tick === 0 && chart.axis.zero ? "#333" : "#e5e5e5"}"/>`,
      `<text x="${x(tick)}" y="${height - 26}" text-anchor="middle">${round(tick * 100) / 100}</text>`,
    );
  }

  body.push(`<text x="${left + plot / 2}" y="${height - 8}" text-anchor="middle">${escape(chart.axis.label)}</text>`);

  chart.rows.forEach((row, index) => {
    const y0 = top + index * rowHeight;

    body.push(`<text x="${left - 8}" y="${y0 + rowHeight / 2 + 4}" text-anchor="end">${escape(row.label)}</text>`);

    for (const point of row.points) {
      const y = y0 + 12 + series.indexOf(point.series) * 10;
      const colour = colours[point.series] ?? "black";

      if (point.low !== undefined && point.high !== undefined) {
        body.push(`<line x1="${x(point.low)}" x2="${x(point.high)}" y1="${y}" y2="${y}" stroke="${colour}" stroke-width="2"/>`);
      }

      body.push(`<circle cx="${x(point.value)}" cy="${y}" r="4" fill="${colour}"/>`);
    }
  });

  return frame(left + plot + 30, height, chart.title, chart.description, body);
}

/** Small multiples: one panel per label, each with a line per series over whole-number x. */
export function panels(chart: {
  title: string;
  description: string;
  y: { min: number; max: number; label: string };
  x: { label: string };
  panels: readonly { label: string; lines: readonly { series: string; points: readonly (readonly [number, number])[] }[] }[];
}) {
  const series = [...new Set(chart.panels.flatMap((panel) => panel.lines.map((line) => line.series)))];
  const columns = 4;
  const width = 190;
  const height = 120;
  const gap = 34;
  const top = 50;
  const rows = Math.ceil(chart.panels.length / columns);
  const body: string[] = legend(series, 50, 40);

  chart.panels.forEach((panel, index) => {
    const left = 40 + (index % columns) * (width + gap);
    const top0 = top + Math.floor(index / columns) * (height + gap + 6);
    const xs = panel.lines.flatMap((line) => line.points.map(([value]) => value));
    const [xMin, xMax] = [Math.min(...xs), Math.max(...xs)];
    const x = (value: number) => round(left + (xMax === xMin ? width / 2 : ((value - xMin) / (xMax - xMin)) * width));
    const y = (value: number) => round(top0 + 16 + (1 - (value - chart.y.min) / (chart.y.max - chart.y.min)) * (height - 16));

    body.push(
      `<text x="${left}" y="${top0 + 10}" font-weight="600">${escape(panel.label)}</text>`,
      `<rect x="${left}" y="${top0 + 16}" width="${width}" height="${height - 16}" fill="none" stroke="#ccc"/>`,
      `<text x="${left - 4}" y="${y(chart.y.max) + 4}" text-anchor="end" font-size="10">${chart.y.max}</text>`,
      `<text x="${left - 4}" y="${y(chart.y.min)}" text-anchor="end" font-size="10">${chart.y.min}</text>`,
      ...Array.from({ length: xMax - xMin + 1 }, (_, step) => xMin + step).map(
        (value) => `<text x="${x(value)}" y="${top0 + height + 12}" text-anchor="middle" font-size="10">${value}</text>`,
      ),
    );

    for (const line of panel.lines) {
      const colour = colours[line.series] ?? "black";
      const path = line.points.map(([px, py]) => `${x(px)},${y(py)}`).join(" ");

      body.push(
        `<polyline points="${path}" fill="none" stroke="${colour}" stroke-width="2" stroke-opacity="0.85"/>`,
        ...line.points.map(([px, py]) => `<circle cx="${x(px)}" cy="${y(py)}" r="2.5" fill="${colour}"/>`),
      );
    }
  });

  const total = top + rows * (height + gap + 6) + 20;

  body.push(
    `<text x="${40 + (columns * (width + gap)) / 2}" y="${total - 8}" text-anchor="middle">${escape(chart.x.label)}</text>`,
    `<text x="12" y="${top + (rows * (height + gap)) / 2}" transform="rotate(-90 12 ${top + (rows * (height + gap)) / 2})" text-anchor="middle">${escape(chart.y.label)}</text>`,
  );

  return frame(40 + columns * (width + gap), total, chart.title, chart.description, body);
}
