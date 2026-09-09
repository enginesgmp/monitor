const RADAR_URL = "https://enginesgmp.github.io/sgmp/modulo-8.html";

function env(name) {
  return String(process.env[name] || "").trim();
}

function clean(value) {
  return String(value ?? "").trim();
}

function norm(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function isTrue(value) {
  if (value === true) return true;
  return ["TRUE", "SI", "S", "VERDADERO", "1"].includes(norm(value));
}

function isActiveProcess(row) {
  return norm(row?.activo || "SI") !== "NO";
}

function isActiveActivity(row) {
  return norm(row?.activo || "SI") !== "NO";
}

function pick(row, names) {
  for (const name of names) {
    const value = row?.[name];
    if (value != null && clean(value) !== "") return value;
  }
  return "";
}

function dateValue(value) {
  const text = clean(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function radarApi(apiUrl, action, payload = {}, sessionToken = "") {
  const body = { action, payload };
  if (action !== "login") body.session_token = sessionToken;

  const separator = apiUrl.includes("?") ? "&" : "?";
  const requestUrl =
    `${apiUrl}${separator}radar_request=${Date.now()}_` +
    Math.random().toString(36).slice(2);

  const response = await fetch(requestUrl, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
      "Accept": "application/json"
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`RADAR respondio contenido no JSON (${response.status}).`);
  }

  if (!response.ok || !json?.ok) {
    throw new Error(json?.error || json?.message || `RADAR respondio ${response.status}.`);
  }

  return json.data;
}

function activityStats(activities, processId) {
  const items = activities.filter(item => {
    const owner = clean(pick(item, ["proceso_id", "id_proceso", "proceso"]));
    return isActiveActivity(item) && owner === processId;
  });
  const completed = items.filter(item => {
    const state = norm(pick(item, ["estado", "estado_actividad"]));
    return isTrue(item?.completado) || state === "CERRADO" || state === "COMPLETADO";
  }).length;
  return { total: items.length, completed };
}

function processState(process, stats) {
  const raw = norm(pick(process, ["estado_proceso", "estado", "status"]));
  if (stats.total > 0 && stats.completed >= stats.total) return "CERRADO";
  if (raw.includes("CERR")) return "CERRADO";
  if (raw.includes("ATRAS")) return "ATRASADO";
  if (raw.includes("CURSO")) return "EN CURSO";
  if (raw.includes("PLAN")) return "PLANIFICADO";
  return "PLANIFICADO";
}

function processAlerts(process) {
  const raw = pick(process, ["alertas", "alerta_proceso", "alertas_motor", "diagnostico"]);
  if (Array.isArray(raw)) return raw.map(clean).filter(Boolean);
  return clean(raw)
    .split(/\s*(?:\||;|\n)\s*/g)
    .map(clean)
    .filter(Boolean);
}

function extractSessionToken(login) {
  if (typeof login === "string") return clean(login);
  return clean(
    login?.session_token ||
    login?.sessionToken ||
    login?.token ||
    login?.access_token ||
    login?.session?.session_token ||
    login?.session?.sessionToken ||
    login?.session?.token ||
    login?.auth?.session_token ||
    login?.auth?.token
  );
}

function loginShape(login) {
  if (!login || typeof login !== "object") return typeof login;
  return Object.keys(login).slice(0, 8).join(",") || "objeto sin llaves";
}

function deepFindArray(root, keys, depth = 0, seen = new Set()) {
  if (!root || typeof root !== "object" || depth > 6 || seen.has(root)) return [];
  seen.add(root);
  for (const key of keys) {
    const value = root[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      for (const nestedKey of ["rows", "data", "items", "values", "records"]) {
        if (Array.isArray(value[nestedKey])) return value[nestedKey];
      }
    }
  }
  for (const value of Object.values(root)) {
    const found = deepFindArray(value, keys, depth + 1, seen);
    if (found.length) return found;
  }
  return [];
}

function deepFindObject(root, keys, depth = 0, seen = new Set()) {
  if (!root || typeof root !== "object" || depth > 6 || seen.has(root)) return null;
  seen.add(root);
  for (const key of keys) {
    const value = root[key];
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  }
  for (const value of Object.values(root)) {
    const found = deepFindObject(value, keys, depth + 1, seen);
    if (found) return found;
  }
  return null;
}

function numericKpi(kpis, names, fallback = 0) {
  for (const name of names) {
    const raw = kpis?.[name];
    if (raw == null || raw === "") continue;
    const parsed = Number(String(raw).replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function percentKpi(kpis, names, fallback = "0%") {
  for (const name of names) {
    const raw = kpis?.[name];
    if (raw == null || raw === "") continue;
    if (String(raw).includes("%")) return clean(raw);
    const parsed = Number(String(raw).replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(parsed)) return `${Math.round(parsed)}%`;
  }
  return fallback;
}

function percentValue(row) {
  const raw = pick(row, [
    "avance",
    "avance_plan",
    "porcentaje_avance",
    "% avance",
    "%_avance",
    "progreso",
    "progress"
  ]);
  if (raw == null || raw === "") return null;
  const parsed = Number(String(raw).replace(",", ".").replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(100, parsed <= 1 ? parsed * 100 : parsed));
}

function methodType(row) {
  const ia = isTrue(pick(row, ["ia", "usa_ia", "metodo_ia", "levantamiento_ia", "con_ia"]));
  const trad = isTrue(pick(row, ["tradicional", "usa_tradicional", "metodo_tradicional", "levantamiento_tradicional", "con_tradicional"]));
  const text = norm(pick(row, ["metodo", "metodo_levantamiento", "tipo_levantamiento", "columnas_s_t"]));
  const hasIa = ia || text.includes("IA") || text.includes("INTELIGENCIA");
  const hasTrad = trad || text.includes("TRADICIONAL");
  if (hasIa && hasTrad) return "Ambos métodos";
  if (hasIa) return "Solo IA";
  if (hasTrad) return "Solo tradicional";
  return "Sin método marcado";
}

function dateFromRow(row, names) {
  return dateValue(pick(row, names));
}

function summarize(bootstrap) {
  const source = bootstrap?.bootstrap || bootstrap?.payload || bootstrap?.data || bootstrap;
  const processes = deepFindArray(source, ["procesos", "processes"]).filter(isActiveProcess);
  const activities = deepFindArray(source, ["actividades", "activities"]);
  const kpis = deepFindObject(source, ["kpis_admin", "kpis", "dashboard", "resumen", "metricas"]) || {};

  let activityTotal = 0;
  let activityClosed = 0;
  let planificados = 0;
  let enCurso = 0;
  let atrasados = 0;
  let cerrados = 0;
  let planificacionCompleta = 0;
  let alertasMotor = 0;
  let inicioTardio = 0;
  let atrasadoNoIniciado = 0;
  let cerradoFueraPlazo = 0;
  const avanceBuckets = [
    { label: "0 %", min: 0, max: 0, count: 0 },
    { label: "1-25 %", min: 1, max: 25, count: 0 },
    { label: "26-50 %", min: 26, max: 50, count: 0 },
    { label: "51-75 %", min: 51, max: 75, count: 0 },
    { label: "76-99 %", min: 76, max: 99, count: 0 },
    { label: "100 %", min: 100, max: 100, count: 0 }
  ];
  const hitosBuckets = new Map([["0 de 4", 0], ["1 de 4", 0], ["2 de 4", 0], ["3 de 4", 0], ["4 de 4", 0]]);
  const methodRows = new Map();
  const dates = [];

  function methodRow(name) {
    if (!methodRows.has(name)) methodRows.set(name, { metodo: name, cerrados: 0, pendientes: 0, activos: 0, avanceTotal: 0, avanceConteo: 0 });
    return methodRows.get(name);
  }

  for (const process of processes) {
    const processId = clean(pick(process, ["proceso_id", "id_proceso", "id", "codigo", "ID"]));
    const stats = activityStats(activities, processId);
    activityTotal += stats.total;
    activityClosed += stats.completed;

    const state = processState(process, stats);
    if (state === "CERRADO") cerrados += 1;
    else if (state === "ATRASADO") atrasados += 1;
    else if (state === "EN CURSO") enCurso += 1;
    else planificados += 1;

    const progress = percentValue(process);
    if (progress != null) {
      const bucket = avanceBuckets.find(item => progress >= item.min && progress <= item.max);
      if (bucket) bucket.count += 1;
    }

    const hitos = Math.max(0, Math.min(4, stats.total > 0 ? stats.completed : Math.round((progress || 0) / 25)));
    const hitosKey = `${hitos} de 4`;
    hitosBuckets.set(hitosKey, (hitosBuckets.get(hitosKey) || 0) + 1);

    const method = methodType(process);
    const row = methodRow(method);
    row.activos += 1;
    if (state === "CERRADO") row.cerrados += 1;
    else row.pendientes += 1;
    if (progress != null) {
      row.avanceTotal += progress;
      row.avanceConteo += 1;
    }

    const start = pick(process, [
      "semana_inicio",
      "fecha_inicio_plan",
      "fecha_inicio",
      "inicio_planificado"
    ]);
    const end = pick(process, [
      "semana_entrega",
      "fecha_fin_plan",
      "fecha_entrega",
      "fin_planificado"
    ]);
    if (clean(start) && clean(end)) planificacionCompleta += 1;

    const startDate = dateFromRow(process, ["fecha_inicio_plan", "fecha_inicio", "inicio_planificado", "inicio"]);
    const endDate = dateFromRow(process, ["fecha_fin_plan", "fecha_entrega", "fin_planificado", "fin", "cierre"]);
    if (startDate) dates.push(startDate);
    if (endDate) dates.push(endDate);

    const alerts = processAlerts(process);
    alertasMotor += alerts.length;
    const alertText = norm(alerts.join(" "));
    if (alertText.includes("INICIO TARD")) inicioTardio += 1;
    if (alertText.includes("ATRASADO NO INICIADO")) atrasadoNoIniciado += 1;
    if (alertText.includes("CERRADO FUERA") || alertText.includes("CIERRE FUERA")) {
      cerradoFueraPlazo += 1;
    }
  }

  const computedAdvance = activityTotal > 0
    ? `${Math.round((activityClosed / activityTotal) * 100)}%`
    : "0%";

  const runtimeDate =
    dateValue(source?.runtime?.timestamp) ||
    dateValue(source?.runtime?.generated_at) ||
    dateValue(bootstrap?.runtime?.timestamp) ||
    dateValue(bootstrap?.runtime?.generated_at) ||
    new Date();

  const hasProcesses = processes.length > 0;
  const timelineStart = dates.length ? new Date(Math.min(...dates.map(d => d.getTime()))) : null;
  const timelineEnd = dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : null;

  return {
    source: "RADAR modulo 8",
    radarUrl: RADAR_URL,
    corte: runtimeDate.toLocaleString("es-EC", { timeZone: "America/Guayaquil" }),
    procesosActivos: hasProcesses ? processes.length : numericKpi(kpis, ["procesos_activos", "procesosActivos", "activos", "total_procesos", "totalProcesos"]),
    cerrados: hasProcesses ? cerrados : numericKpi(kpis, ["cerrados", "procesos_cerrados", "cerrado"]),
    atrasados: hasProcesses ? atrasados : numericKpi(kpis, ["atrasados", "procesos_atrasados", "atrasado"]),
    enCurso: hasProcesses ? enCurso : numericKpi(kpis, ["en_curso", "enCurso", "procesos_en_curso"]),
    planificados: hasProcesses ? planificados : numericKpi(kpis, ["planificados", "procesos_planificados", "planificado"]),
    avancePlan: hasProcesses ? computedAdvance : percentKpi(kpis, ["avance_plan", "avancePlan", "avance", "porcentaje_avance"], computedAdvance),
    planificacionCompleta: hasProcesses ? planificacionCompleta : numericKpi(kpis, ["planificacion_completa", "planificacionCompleta"]),
    alertasMotor: hasProcesses ? alertasMotor : numericKpi(kpis, ["alertas_motor", "alertasMotor", "alertas", "alertas_v3"]),
    inicioTardio: hasProcesses ? inicioTardio : numericKpi(kpis, ["inicio_tardio", "inicioTardio"]),
    atrasadoNoIniciado: hasProcesses ? atrasadoNoIniciado : numericKpi(kpis, ["atrasado_no_iniciado", "atrasadoNoIniciado"]),
    cerradoFueraPlazo: hasProcesses ? cerradoFueraPlazo : numericKpi(kpis, ["cerrado_fuera_plazo", "cerradoFueraPlazo"]),
    estadoBuckets: [
      { label: "Cerrados", value: hasProcesses ? cerrados : numericKpi(kpis, ["cerrados", "procesos_cerrados", "cerrado"]) },
      { label: "Atrasados", value: hasProcesses ? atrasados : numericKpi(kpis, ["atrasados", "procesos_atrasados", "atrasado"]) },
      { label: "En curso", value: hasProcesses ? enCurso : numericKpi(kpis, ["en_curso", "enCurso", "procesos_en_curso"]) },
      { label: "Planificados", value: hasProcesses ? planificados : numericKpi(kpis, ["planificados", "procesos_planificados", "planificado"]) }
    ],
    avanceBuckets: avanceBuckets.map(({ label, count }) => ({ label, count })),
    hitosBuckets: [...hitosBuckets.entries()].map(([label, count]) => ({ label, count })),
    methodRows: [...methodRows.values()].map(row => ({
      metodo: row.metodo,
      cerrados: row.cerrados,
      pendientes: row.pendientes,
      activos: row.activos,
      avance: row.avanceConteo ? `${Math.round(row.avanceTotal / row.avanceConteo)}%` : "-"
    })),
    timeline: {
      inicio: timelineStart ? timelineStart.toLocaleDateString("es-EC", { timeZone: "America/Guayaquil" }) : "",
      fin: timelineEnd ? timelineEnd.toLocaleDateString("es-EC", { timeZone: "America/Guayaquil" }) : ""
    },
    diagnostico: {
      procesosDetectados: processes.length,
      actividadesDetectadas: activities.length,
      kpisDetectados: Object.keys(kpis).slice(0, 20)
    }
  };
}

export default async () => {
  try {
    const apiUrl = env("RADAR_API_URL");
    const username = env("RADAR_USERNAME");
    const password = env("RADAR_PASSWORD");

    if (!apiUrl || !username || !password) {
      return Response.json(
        {
          ok: false,
          message:
            "Faltan variables de entorno RADAR_API_URL, RADAR_USERNAME o RADAR_PASSWORD."
        },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    const login = await radarApi(apiUrl, "login", { username, password });
    const sessionToken = extractSessionToken(login);
    if (!sessionToken) {
      throw new Error(`RADAR no entrego token de sesion. Forma recibida: ${loginShape(login)}.`);
    }

    const bootstrap = await radarApi(apiUrl, "bootstrap", {}, sessionToken);

    return Response.json(
      {
        ok: true,
        generatedAt: new Date().toISOString(),
        ...summarize(bootstrap)
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (error) {
    console.error("load-radar error", error);
    return Response.json(
      {
        ok: false,
        message: error?.message || "No fue posible consultar RADAR."
      },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
};

export const config = {
  path: "/.netlify/functions/load-radar"
};
