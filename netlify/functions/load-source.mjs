const SOURCES = {
  transformacion: {
    url: process.env.TRANSFORMATION_FILE_URL,
    label: "Transformación",
    format: "xlsx"
  },
  tecnologia: {
    url: process.env.TECHNOLOGY_FILE_URL,
    label: "Tecnología",
    format: "csv"
  }
};

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [600, 1400, 2600];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractGoogleFileId(value) {
  const text = String(value || "").trim();

  const patterns = [
    /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/i,
    /\/file\/d\/([a-zA-Z0-9_-]+)/i,
    /[?&]id=([a-zA-Z0-9_-]+)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }

  if (/^[a-zA-Z0-9_-]{20,}$/.test(text)) return text;
  return null;
}

function isGoogleSpreadsheetUrl(value) {
  return /\/spreadsheets\/d\//i.test(String(value || ""));
}

function buildGoogleExportUrl(fileId, format, attempt, sourceUrl = "") {
  const nonce = `${Date.now()}-${attempt}`;
  if (format === "csv") {
    const gidMatch = String(sourceUrl || "").match(/[?&]gid=([0-9]+)/i);
    const gid = gidMatch ? `&gid=${encodeURIComponent(gidMatch[1])}` : "";
    return (
      `https://docs.google.com/spreadsheets/d/${encodeURIComponent(fileId)}` +
      `/export?format=csv${gid}&cacheBust=${encodeURIComponent(nonce)}`
    );
  }
  return (
    `https://docs.google.com/spreadsheets/d/${encodeURIComponent(fileId)}` +
    `/export?format=xlsx&cacheBust=${encodeURIComponent(nonce)}`
  );
}

function isExcel(buffer, contentType = "") {
  const type = String(contentType).toLowerCase();

  if (
    type.includes("spreadsheetml") ||
    type.includes("ms-excel") ||
    type.includes("application/octet-stream")
  ) {
    return true;
  }

  return (
    buffer.length > 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b
  );
}

function isCsv(buffer, contentType = "") {
  const type = String(contentType).toLowerCase();
  if (type.includes("text/csv") || type.includes("application/csv")) return true;
  const preview = textPreview(buffer);
  return /N PROYECTO|ESTADO PROYECTO|MACRO|RESPONSABLE SISTEMAS/i.test(preview);
}

function textPreview(bytes) {
  try {
    return new TextDecoder("utf-8")
      .decode(bytes.slice(0, 1200))
      .replace(/\s+/g, " ")
      .slice(0, 360);
  } catch (_) {
    return "";
  }
}

async function fetchSourceUrl(source, attempt) {
  const fileId = extractGoogleFileId(source.url);
  const isSheet = isGoogleSpreadsheetUrl(source.url);
  const exportUrl = fileId && isSheet
    ? buildGoogleExportUrl(fileId, source.format, attempt, source.url)
    : source.url;

  return fetch(exportUrl, {
    redirect: "follow",
    cache: "no-store",
    headers: {
      "User-Agent": "Mozilla/5.0 Portal-Iniciativas/1.0",
      "Accept": source.format === "csv"
        ? "text/csv,text/plain,application/octet-stream;q=0.9,*/*;q=0.1"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet," +
          "application/octet-stream;q=0.9,*/*;q=0.1",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache"
    }
  });
}

async function downloadSource(source) {
  const fileId = extractGoogleFileId(source.url);

  if (!fileId && /docs\.google\.com/i.test(source.url)) {
    throw new Error(
      `El enlace configurado para ${source.label} no corresponde a una fuente de Google válida.`
    );
  }

  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetchSourceUrl(source, attempt);

      if (!response.ok) {
        throw new Error(
          `La fuente respondió ${response.status} al descargar ${source.label}.`
        );
      }

      const arrayBuffer = await response.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const contentType = response.headers.get("content-type") || "";
      const valid = source.format === "csv"
        ? isCsv(bytes, contentType)
        : isExcel(bytes, contentType);

      if (!valid) {
        const preview = textPreview(bytes);

        if (
          /sign in|accounts\.google|request access|you need access|acceso/i.test(
            preview
          )
        ) {
          throw new Error(
            `La fuente de ${source.label} no permite descarga pública. ` +
            `Compártala como “Cualquier persona con el enlace · Lector”.`
          );
        }

        throw new Error(
          source.format === "csv"
            ? `La fuente de ${source.label} no devolvió un CSV válido.`
            : `La fuente de ${source.label} no devolvió un Excel válido.`
        );
      }

      return {
        arrayBuffer,
        response,
        fileId,
        attempts: attempt
      };
    } catch (error) {
      lastError = error;

      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAYS_MS[attempt - 1]);
      }
    }
  }

  throw new Error(
    `${lastError?.message || `No fue posible descargar ${source.label}.`} ` +
    `Se realizaron ${MAX_ATTEMPTS} intentos.`
  );
}

export default async (request) => {
  try {
    const requestUrl = new URL(request.url);
    const team = String(
      requestUrl.searchParams.get("team") || ""
    ).toLowerCase();

    const source = SOURCES[team];

    if (!source) {
      return Response.json(
        { ok: false, message: "Equipo no permitido." },
        { status: 400 }
      );
    }

    if (!source.url) {
      return Response.json(
        {
          ok: false,
          message: `No se configuró la variable de entorno para ${source.label}.`
        },
        { status: 500 }
      );
    }

    const result = await downloadSource(source);
    const fileName = `${team}.${source.format}`;
    const contentType = source.format === "csv"
      ? "text/csv; charset=utf-8"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    return new Response(result.arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "no-store, max-age=0",
        "X-Source-File": fileName,
        "X-Source-Team": team,
        "X-Source-Modified":
          result.response.headers.get("last-modified") || "",
        "X-Google-File-Id": result.fileId || "",
        "X-Download-Attempts": String(result.attempts),
        "Access-Control-Expose-Headers":
          "X-Source-File,X-Source-Team,X-Source-Modified," +
          "X-Google-File-Id,X-Download-Attempts"
      }
    });
  } catch (error) {
    console.error("load-source error", error);

    return Response.json(
      {
        ok: false,
        message:
          error?.message ||
          "No fue posible descargar la fuente configurada."
      },
      {
        status: 502,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  }
};

export const config = {
  path: "/.netlify/functions/load-source"
};