
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

function downloadCandidateUrl(sharedUrl) {
  const url = new URL(sharedUrl);
  url.searchParams.set("download", "1");
  return url.toString();
}

function isExcel(buffer, contentType = "") {
  const type = contentType.toLowerCase();
  if (
    type.includes("spreadsheetml") ||
    type.includes("ms-excel") ||
    type.includes("application/octet-stream")
  ) return true;

  // XLSX files are ZIP containers and normally begin with PK.
  return buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

export default async (request) => {
  try {
    const requestUrl = new URL(request.url);
    const team = String(requestUrl.searchParams.get("team") || "").toLowerCase();
    const source = SOURCES[team];

    if (!source) {
      return Response.json(
        { ok: false, message: "Equipo no permitido." },
        { status: 400 }
      );
    }

    const targetUrl = downloadCandidateUrl(source.url);
    const response = await fetch(targetUrl, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 Portal-Iniciativas/1.0",
        "Accept": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/octet-stream;q=0.9,*/*;q=0.1"
      }
    });

    if (!response.ok) {
      return Response.json(
        { ok: false, message: `Microsoft respondió ${response.status}.` },
        { status: 502 }
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const contentType = response.headers.get("content-type") || "";

    if (!isExcel(bytes, contentType)) {
      return Response.json(
        {
          ok: false,
          message: "El enlace no devolvió un archivo Excel descargable. Revise que el vínculo siga siendo público."
        },
        { status: 422 }
      );
    }

    const disposition = response.headers.get("content-disposition") || "";
    const match = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
    const fileName = match
      ? decodeURIComponent(match[1].replace(/"/g, ""))
      : `${team}.xlsx`;

    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
        "X-Source-File": fileName,
        "X-Source-Team": team,
        "X-Source-Modified": response.headers.get("last-modified") || "",
        "Access-Control-Expose-Headers": "X-Source-File,X-Source-Team,X-Source-Modified"
      }
    });
  } catch (error) {
    console.error("load-source error", error);
    return Response.json(
      { ok: false, message: "No fue posible descargar la fuente configurada." },
      { status: 500 }
    );
  }
};

export const config = {
  path: "/.netlify/functions/load-source"
};
