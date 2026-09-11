const DEFAULT_SHEET_URL = "https://docs.google.com/spreadsheets/d/1xWa4c5XvasIwUpemXtWNZWxVNRcdPXFCsmEPN_JN_Ys/edit";
const DEFAULT_SHEET_NAME = "gantt_gpp";

function clean(value) {
  return String(value ?? "").trim();
}

function extractGoogleFileId(value) {
  const text = clean(value);
  const match = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/i) || text.match(/[?&]id=([a-zA-Z0-9_-]+)/i);
  if (match) return match[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(text)) return text;
  return "";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some(value => clean(value) !== "")) rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some(value => clean(value) !== "")) rows.push(row);
  return rows;
}

function normalizeHeader(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(clean(value));
}

function normalizeColor(value) {
  const color = clean(value).toLowerCase();
  return ["navy", "steel", "gold"].includes(color) ? color : "navy";
}

function rowToPhase(row, headers, index) {
  const get = name => clean(row[headers.indexOf(name)]);
  const start = get("inicio");
  const end = get("fin");
  if (!get("fase") || !isIsoDate(start) || !isIsoDate(end)) return null;
  return {
    id: get("fase").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `fase_${index + 1}`,
    name: get("fase"),
    meta: get("subtitulo"),
    start,
    end,
    color: normalizeColor(get("color")),
    order: Number(get("orden")) || index + 1
  };
}

function buildPlan(rows) {
  const [headerRow, ...dataRows] = rows;
  if (!headerRow) throw new Error("La hoja gantt_gpp no tiene encabezados.");

  const headers = headerRow.map(normalizeHeader);
  for (const required of ["fase", "subtitulo", "inicio", "fin", "color", "orden"]) {
    if (!headers.includes(required)) throw new Error(`Falta la columna ${required} en gantt_gpp.`);
  }

  const phases = dataRows
    .map((row, index) => rowToPhase(row, headers, index))
    .filter(Boolean)
    .sort((a, b) => a.order - b.order);

  if (!phases.length) throw new Error("La hoja gantt_gpp no tiene fases válidas.");

  return {
    phases,
    milestones: [
      {
        id: "finLevantamientos",
        label: "Fin de levantamientos",
        date: phases[0]?.end || phases[0]?.start,
        type: "dashed"
      },
      {
        id: "cierre",
        label: "Cierre del programa",
        date: phases[phases.length - 1]?.end || phases[phases.length - 1]?.start,
        type: "final"
      }
    ]
  };
}

export default async () => {
  try {
    const sheetUrl = clean(process.env.GPP_GANTT_SHEET_URL) || DEFAULT_SHEET_URL;
    const sheetName = clean(process.env.GPP_GANTT_SHEET_NAME) || DEFAULT_SHEET_NAME;
    const fileId = extractGoogleFileId(sheetUrl);

    if (!fileId) throw new Error("No se pudo identificar el ID de la Google Sheet del Gantt.");

    const url =
      `https://docs.google.com/spreadsheets/d/${encodeURIComponent(fileId)}` +
      `/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}` +
      `&cacheBust=${encodeURIComponent(Date.now())}`;

    const response = await fetch(url, { cache: "no-store" });
    const text = await response.text();

    if (!response.ok || /<html/i.test(text.slice(0, 300))) {
      throw new Error(`Google Sheets respondió ${response.status}. Revise permisos de enlace.`);
    }

    const plan = buildPlan(parseCsv(text));

    return Response.json(
      {
        ok: true,
        source: "Google Sheet gantt_gpp",
        sheetUrl,
        sheetName,
        generatedAt: new Date().toISOString(),
        ...plan
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (error) {
    console.error("load-gantt error", error);
    return Response.json(
      {
        ok: false,
        message: error?.message || "No fue posible cargar el Gantt compartido."
      },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
};

export const config = {
  path: "/.netlify/functions/load-gantt"
};
