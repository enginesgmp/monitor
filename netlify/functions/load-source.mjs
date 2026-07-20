
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

function extractGoogleSpreadsheetId(value) {
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

  // También permite guardar directamente el ID en Netlify.
  if (/^[a-zA-Z0-9_-]{20,}$/.test(text)) return text;

  return null;
}

function buildGoogleExportUrl(fileId) {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(fileId)}/export?format=xlsx`;
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

async function downloadSpreadsheet(source) {
  const fileId = extractGoogleSpreadsheetId(source.url);

  if (!fileId) {
    throw new Error(
      `El enlace configurado para ${source.label} no corresponde a una hoja de cálculo de Google válida.`
    );
  }

  const exportUrl = buildGoogleExportUrl(fileId);

  const response = await fetch(exportUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 Portal-Iniciativas/1.0",
      "Accept":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet," +
        "application/octet-stream;q=0.9,*/*;q=0.1"
    }
  });

  if (!response.ok) {
    throw new Error(
      `Google respondió ${response.status} al intentar exportar ${source.label}.`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const contentType = response.headers.get("content-type") || "";

  if (!isExcel(bytes, contentType)) {
    const textPreview = new TextDecoder("utf-8")
      .decode(bytes.slice(0, 500))
      .replace(/\s+/g, " ")
      .slice(0, 160);

    if (
      /sign in|accounts\.google|request access|you need access|acceso/i.test(
        textPreview
      )
    ) {
      throw new Error(
        `La hoja de ${source.label} no permite exportación pública. Compártala como “Cualquier persona con el enlace · Lector”.`
      );
    }

    throw new Error(
      `Google no devolvió un archivo Excel válido para ${source.label}.`
    );
  }

  return {
    arrayBuffer,
    response,
    fileId
  };
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

    const result = await downloadSpreadsheet(source);
    const fileName = `${team}.xlsx`;

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
        "X-Google-File-Id": result.fileId,
        "Access-Control-Expose-Headers":
          "X-Source-File,X-Source-Team,X-Source-Modified,X-Google-File-Id"
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
