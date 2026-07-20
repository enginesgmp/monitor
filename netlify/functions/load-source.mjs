
const SOURCES = {
  transformacion: {
    url: process.env.TRANSFORMATION_FILE_URL,
    label: "Transformación"
  },
  tecnologia: {
    url: process.env.TECHNOLOGY_FILE_URL,
    label: "Tecnología"
  }
};

const MAX_RESOLUTION_STEPS = 8;

function isExcel(buffer, contentType = "") {
  const type = String(contentType).toLowerCase();

  if (
    type.includes("spreadsheetml") ||
    type.includes("ms-excel") ||
    type.includes("application/octet-stream")
  ) {
    return true;
  }

  // XLSX es un contenedor ZIP y comienza normalmente con PK.
  return (
    buffer.length > 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b
  );
}

function withDownloadFlag(sharedUrl) {
  const url = new URL(sharedUrl);
  url.searchParams.set("download", "1");
  return url.toString();
}

function decodeEscapedUrl(value) {
  return String(value || "")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&")
    .replace(/&#38;/g, "&")
    .replace(/&quot;/g, '"')
    .trim();
}

function extractCandidateUrls(html, baseUrl) {
  const candidates = new Set();

  const patterns = [
    /"@microsoft\.graph\.downloadUrl"\s*:\s*"([^"]+)"/gi,
    /"downloadUrl"\s*:\s*"([^"]+)"/gi,
    /"downloadURL"\s*:\s*"([^"]+)"/gi,
    /"contentUrl"\s*:\s*"([^"]+)"/gi,
    /"downloadLink"\s*:\s*"([^"]+)"/gi,
    /https?:\\?\/\\?\/[^"'<> ]+(?:download|download\.aspx|fileget\.aspx)[^"'<> ]*/gi,
    /https?:\/\/[^"'<> ]+(?:download|download\.aspx|fileget\.aspx)[^"'<> ]*/gi
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const raw = match[1] || match[0];
      const decoded = decodeEscapedUrl(raw);
      try {
        candidates.add(new URL(decoded, baseUrl).toString());
      } catch (_) {}
    }
  }

  // Enlaces HTML tradicionales.
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const href = decodeEscapedUrl(match[1]);
    if (!/(download|download\.aspx|fileget\.aspx)/i.test(href)) continue;
    try {
      candidates.add(new URL(href, baseUrl).toString());
    } catch (_) {}
  }

  return [...candidates];
}

function deriveOneDriveDownloadUrl(finalUrl) {
  try {
    const url = new URL(finalUrl);
    const host = url.hostname.toLowerCase();

    if (!host.includes("onedrive.live.com")) return null;

    const resid =
      url.searchParams.get("resid") ||
      url.searchParams.get("id");

    if (!resid) return null;

    const download = new URL("https://onedrive.live.com/download");
    download.searchParams.set("resid", resid);

    const authKey =
      url.searchParams.get("authkey") ||
      url.searchParams.get("authKey");

    if (authKey) download.searchParams.set("authkey", authKey);

    return download.toString();
  } catch (_) {
    return null;
  }
}

async function fetchCandidate(url) {
  return fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 Chrome/150 Safari/537.36",
      "Accept":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet," +
        "application/vnd.ms-excel,application/octet-stream;q=0.9," +
        "text/html;q=0.8,*/*;q=0.5",
      "Accept-Language": "es-EC,es;q=0.9,en;q=0.7"
    }
  });
}

async function resolveExcel(sharedUrl) {
  const queue = [];
  const visited = new Set();

  queue.push(withDownloadFlag(sharedUrl));
  queue.push(sharedUrl);

  while (queue.length && visited.size < MAX_RESOLUTION_STEPS) {
    const candidate = queue.shift();
    if (!candidate || visited.has(candidate)) continue;
    visited.add(candidate);

    const response = await fetchCandidate(candidate);

    if (!response.ok) continue;

    const contentType = response.headers.get("content-type") || "";
    const disposition = response.headers.get("content-disposition") || "";
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    if (isExcel(bytes, contentType)) {
      return {
        arrayBuffer,
        response,
        contentType,
        disposition,
        resolvedUrl: response.url
      };
    }

    const looksLikeText =
      contentType.includes("text/") ||
      contentType.includes("html") ||
      contentType.includes("json");

    if (!looksLikeText) continue;

    const text = new TextDecoder("utf-8").decode(bytes);

    const derivedOneDriveUrl = deriveOneDriveDownloadUrl(response.url);
    if (derivedOneDriveUrl && !visited.has(derivedOneDriveUrl)) {
      queue.unshift(derivedOneDriveUrl);
    }

    const extracted = extractCandidateUrls(text, response.url);
    for (const found of extracted) {
      if (!visited.has(found)) queue.push(found);
    }

    // En SharePoint algunos vínculos solo funcionan al agregar download=1
    // sobre la URL final de redirección.
    try {
      const finalWithDownload = withDownloadFlag(response.url);
      if (!visited.has(finalWithDownload)) queue.push(finalWithDownload);
    } catch (_) {}
  }

  throw new Error(
    "Microsoft permitió visualizar el archivo, pero no entregó una URL pública de descarga. " +
    "Genere un vínculo que permita descargar el archivo o use Microsoft Graph."
  );
}

function getFileName(disposition, fallback) {
  const utfMatch = disposition.match(
    /filename\*=UTF-8''([^;]+)/i
  );
  if (utfMatch) {
    try {
      return decodeURIComponent(utfMatch[1].replace(/"/g, ""));
    } catch (_) {}
  }

  const normalMatch = disposition.match(/filename="?([^";]+)"?/i);
  return normalMatch ? normalMatch[1] : fallback;
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

    const result = await resolveExcel(source.url);

    const fileName = getFileName(
      result.disposition,
      `${team}.xlsx`
    );

    return new Response(result.arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control":
          "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
        "X-Source-File": fileName,
        "X-Source-Team": team,
        "X-Source-Modified":
          result.response.headers.get("last-modified") || "",
        "X-Resolved-Host": new URL(result.resolvedUrl).hostname,
        "Access-Control-Expose-Headers":
          "X-Source-File,X-Source-Team,X-Source-Modified,X-Resolved-Host"
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
      { status: 502 }
    );
  }
};

export const config = {
  path: "/.netlify/functions/load-source"
};
