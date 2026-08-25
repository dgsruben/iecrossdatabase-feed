import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const newsPath = path.join(projectRoot, "app", "data", "news.json");
const mediaDirectory = path.join(projectRoot, "public", "news");
const officialFeedUrl = process.env.IE_CROSS_OFFICIAL_FEED ?? "https://www.inazuma-cross.jp/feed/";
const aimingFeedUrl = process.env.IE_CROSS_AIMING_FEED ?? "https://aiming-inc.com/ja/category/news/game-news/feed/";
const monthNames = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

const calendarZones = [
  { city: "Madrid", timeZone: "Europe/Madrid" },
  { city: "Buenos Aires", timeZone: "America/Argentina/Buenos_Aires", label: "ART" },
  { city: "Ciudad de México", timeZone: "America/Mexico_City", label: "CST" },
  { city: "Perú", timeZone: "America/Lima", label: "PET" },
];

const playerNames = [
  ["木野 秋", "Kino Aki"],
  ["木野秋", "Kino Aki"],
  ["音無 春奈", "Otonashi Haruna"],
  ["音無春奈", "Otonashi Haruna"],
  ["雷門 夏未", "Raimon Natsumi"],
  ["雷門夏未", "Raimon Natsumi"],
  ["神童 拓人", "Shindou Takuto"],
  ["神童拓人", "Shindou Takuto"],
  ["神童", "Shindou Takuto"],
  ["霧野 蘭丸", "Kirino Ranmaru"],
  ["霧野蘭丸", "Kirino Ranmaru"],
  ["霧野", "Kirino Ranmaru"],
  ["松風 天馬", "Matsukaze Tenma"],
  ["松風天馬", "Matsukaze Tenma"],
  ["剣城 京介", "Tsurugi Kyousuke"],
  ["剣城京介", "Tsurugi Kyousuke"],
  ["豪炎寺 修也", "Gouenji Shuuya"],
  ["豪炎寺修也", "Gouenji Shuuya"],
  ["豪炎寺", "Gouenji Shuuya"],
  ["黄名子", "Nanobana Kinako"],
  ["フェイ", "Fei Rune"],
];

const featuredGachaProfiles = {
  "Kino Aki": {
    playerId: "1166",
    title: "Kino Aki · Gerente ★3",
    summary: "Nueva portera de Montaña centrada en potenciar su propia parada y responder cuando falla un bloqueo de tiro aliado.",
    details: ["GK · Montaña · ★★★", "Despeje de fuego", "Mano celestial"],
    image: "/news/x-kino-aki-gacha-2026-08-21.webp",
  },
  "Otonashi Haruna": {
    playerId: "1167",
    title: "Otonashi Haruna · Gerente ★3",
    summary: "Nueva centrocampista de Viento que encadena regates para debilitar el tiro rival y refuerza el regate de los MF aliados.",
    details: ["MF · Viento · ★★★", "Espejismo de balón", "Campo de fuerza"],
    image: "/news/x-otonashi-haruna-gacha-2026-08-21.webp",
  },
  "Raimon Natsumi": {
    playerId: "1168",
    title: "Raimon Natsumi · Gerente ★3",
    summary: "Nueva delantera de Fuego que aumenta el Tiro de los FW al usar sus técnicas y castiga el Bloqueo de los DF rivales.",
    details: ["FW · Fuego · ★★★", "Tiro fantasma", "Lecho de rosas"],
    image: "/news/x-raimon-natsumi-gacha-2026-08-21.webp",
  },
};

const featuredGachaSourceNames = {
  "35520": "Kino Aki",
  "35662": "Kino Aki",
  "35521": "Otonashi Haruna",
  "35665": "Otonashi Haruna",
  "35522": "Raimon Natsumi",
  "35669": "Raimon Natsumi",
};

const activeGachaPlayerIds = {
  "35520": "1166",
  "35521": "1167",
  "35522": "1168",
  "35438": "4003",
  "35436": "4009",
};

function decodeXml(value = "") {
  return value
    .replace(/^<!\[CDATA\[|\]\]>$/g, "")
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([\da-f]+);/gi, (_, number) => String.fromCodePoint(Number.parseInt(number, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .trim();
}

function tagValue(xml, tag) {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return decodeXml(xml.match(new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`, "i"))?.[1] ?? "");
}

function tagValues(xml, tag) {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...xml.matchAll(new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`, "gi"))]
    .map((match) => decodeXml(match[1]));
}

function plainText(html = "") {
  return decodeXml(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function absoluteUrl(value, baseUrl) {
  if (!value) return null;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

function imageUrlsIn(content, baseUrl) {
  return [...new Set(
    [...content.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)]
      .map((match) => absoluteUrl(match[1], baseUrl))
      .filter(Boolean),
  )];
}

function parseFeed(xml, source, baseUrl) {
  const channel = tagValue(xml, "channel") || xml;
  const lastBuildDate = tagValue(channel, "lastBuildDate");
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => {
    const item = match[1];
    const content = tagValue(item, "content:encoded");
    const imageUrls = imageUrlsIn(content, baseUrl);
    const guid = tagValue(item, "guid");
    return {
      source,
      sourceId: guid.match(/(?:p=|\/)(\d+)(?:\D*$)/)?.[1] ?? guid,
      title: plainText(tagValue(item, "title")),
      link: absoluteUrl(tagValue(item, "link"), baseUrl),
      publishedAt: new Date(tagValue(item, "pubDate")),
      categories: tagValues(item, "category").map(plainText),
      description: plainText(tagValue(item, "description")),
      content,
      imageUrl: imageUrls[0] ?? null,
      imageUrls,
    };
  }).filter((item) => item.title && !Number.isNaN(item.publishedAt.getTime()));

  return { lastBuildDate: lastBuildDate ? new Date(lastBuildDate) : null, items };
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
      "User-Agent": "IECrossDatabase-NewsBot/1.0 (+https://iecrossdatabase.pages.dev/)",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${url} respondió ${response.status}.`);
  return response.text();
}

async function fetchOfficialHistory() {
  const pageUrls = Array.from({ length: 8 }, (_, index) => {
    const url = new URL(officialFeedUrl);
    if (index > 0) url.searchParams.set("paged", String(index + 1));
    return url.toString();
  });
  const results = await Promise.allSettled(pageUrls.map(async (url) => parseFeed(await fetchText(url), "official", url)));
  const pages = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
  if (!pages.length) {
    const reasons = results
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason.message)
      .join(" · ");
    throw new Error(reasons || "No se pudo consultar el historial oficial.");
  }

  const itemsById = new Map();
  for (const page of pages) {
    for (const item of page.items) itemsById.set(item.sourceId, item);
  }
  return {
    lastBuildDate: pages.map((page) => page.lastBuildDate).filter(Boolean).sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
    items: [...itemsById.values()],
  };
}

function dateLabel(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);
  const part = (type) => parts.find((value) => value.type === type)?.value;
  return `${part("day")} ${monthNames[Number(part("month")) - 1]} ${part("year")}`;
}

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function namesIn(text) {
  const found = [];
  for (const [japanese, romanized] of playerNames) {
    if (text.includes(japanese) && !found.includes(romanized)) found.push(romanized);
  }
  return found;
}

function parseJstDate(text, referenceDate, fallbackHour = null) {
  const exactMatch = text.match(/(\d{1,2})\/(\d{1,2})(?:\([^)]*\))?\s*(\d{1,2}):(\d{2})/u);
  const dateOnlyMatch = fallbackHour === null ? null : text.match(/(\d{1,2})\/(\d{1,2})(?:\([^)]*\))?/u);
  const match = exactMatch ?? dateOnlyMatch;
  if (!match) return null;
  const hour = exactMatch ? Number(match[3]) : fallbackHour;
  const minute = exactMatch ? Number(match[4]) : 0;
  let year = referenceDate.getUTCFullYear();
  let target = new Date(Date.UTC(year, Number(match[1]) - 1, Number(match[2]), hour - 9, minute));
  if (target.getTime() < referenceDate.getTime() - 180 * 86_400_000) {
    year += 1;
    target = new Date(Date.UTC(year, Number(match[1]) - 1, Number(match[2]), hour - 9, minute));
  }
  return target;
}

function parseGachaEndDate(text, referenceDate) {
  const match = text.match(/開催期間[\s\S]{0,180}?[～〜]\s*(?:(\d{4})\/)?(\d{1,2})\/(\d{1,2})(?:\([^)]*\))?\s*(\d{1,2}):(\d{2})/u);
  if (!match) return null;
  let year = match[1] ? Number(match[1]) : referenceDate.getUTCFullYear();
  let target = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[3]), Number(match[4]) - 9, Number(match[5])));
  if (!match[1] && target.getTime() < referenceDate.getTime() - 180 * 86_400_000) {
    year += 1;
    target = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[3]), Number(match[4]) - 9, Number(match[5])));
  }
  return target;
}

function bannerEndLabel(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const part = (type) => parts.find((value) => value.type === type)?.value;
  return `${part("day")} ${monthNames[Number(part("month")) - 1]} ${part("year")} · ${part("hour")}:${part("minute")} JST`;
}

function shortAvailability(date) {
  if (!date) return "Fecha por confirmar";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    day: "2-digit",
    month: "2-digit",
  }).formatToParts(date);
  const part = (type) => parts.find((value) => value.type === type)?.value;
  return `${part("day")} ${monthNames[Number(part("month")) - 1]}`;
}

function longAvailability(date) {
  if (!date) return "una fecha aún por confirmar";
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Asia/Tokyo",
    day: "numeric",
    month: "long",
  }).format(date);
}

function spanishCard(item) {
  const combinedText = `${item.title} ${plainText(item.content)} ${item.description}`;
  const names = namesIn(combinedText);
  const startsAt = parseJstDate(combinedText, item.publishedAt);
  const availability = shortAvailability(startsAt);
  const writtenAvailability = longAvailability(startsAt);
  const common = {
    sourceId: `${item.source}-${item.sourceId}`,
    sourceUrl: item.link,
    date: dateLabel(item.publishedAt),
    secondaryImage: null,
  };

  if (item.title.includes("ピックアップガチャ") || item.title.includes("ガチャ")) {
    const featured = featuredGachaSourceNames[item.sourceId] ?? names[0];
    const profile = featuredGachaProfiles[featured];
    return {
      ...common,
      id: `${featured ? slugify(featured) : "nuevo"}-gacha-${item.sourceId}`,
      playerId: profile?.playerId ?? null,
      label: "GACHA ACTIVO",
      title: profile?.title ?? (featured ? `${featured} · Gacha destacado` : "Gacha destacado"),
      summary: profile?.summary ?? (featured
        ? `Gacha activo protagonizado por ${featured}${startsAt ? ` desde el ${writtenAvailability}` : ""}.`
        : `Hay un gacha destacado activo${startsAt ? ` desde el ${writtenAvailability}` : ""}.`),
      details: profile?.details ?? [...names.slice(0, 2), "Gacha destacado", startsAt ? `Disponible el ${availability}` : "Fecha por confirmar"],
      image: profile?.image,
      imageUrl: item.imageUrl,
    };
  }

  if (item.title.includes("青春おでんフェス")) {
    return {
      ...common,
      id: `festival-oden-juvenil-${item.sourceId}`,
      label: "NUEVO EVENTO",
      title: "Festival de Oden Juvenil",
      summary: `Llega un nuevo evento con fases exclusivas, panel de conexiones y recompensas especiales${startsAt ? ` desde el ${writtenAvailability}` : ""}.`,
      details: ["Evento temporal", "Nuevas fases", startsAt ? `Comienza el ${availability}` : "Fecha por confirmar"],
      imageUrl: item.imageUrl,
    };
  }

  if (item.title.includes("イベント")) {
    return {
      ...common,
      id: `nuevo-evento-${item.sourceId}`,
      label: "NUEVO EVENTO",
      title: "Nuevo evento anunciado",
      summary: `Se ha anunciado un nuevo evento para Inazuma Eleven Cross${startsAt ? ` que comenzará el ${writtenAvailability}` : ""}.`,
      details: ["Evento temporal", "Contenido nuevo", startsAt ? `Comienza el ${availability}` : "Fecha por confirmar"],
      imageUrl: item.imageUrl,
    };
  }

  if (item.title.includes("データ更新") || item.title.includes("アップデート")) {
    return {
      ...common,
      id: `actualizacion-datos-${item.sourceId}`,
      label: "ACTUALIZACIÓN",
      title: "Nueva actualización de datos",
      summary: `El juego recibirá una actualización de datos${startsAt ? ` el ${writtenAvailability}` : " próximamente"}.`,
      details: ["Actualización del juego", startsAt ? `Programada el ${availability}` : "Fecha por confirmar"],
      imageUrl: item.imageUrl,
    };
  }

  if (names.length >= 2) {
    return {
      ...common,
      id: `nuevos-jugadores-${item.sourceId}`,
      label: "NUEVOS JUGADORES",
      title: `Llegan ${names[0]} y ${names[1]}`,
      summary: `La nueva actualización incorpora a ${names[0]} y ${names[1]}, además de contenido adicional para el juego.`,
      details: [...names.slice(0, 2), "Actualización oficial"],
      imageUrl: item.imageUrl,
    };
  }

  return {
    ...common,
    id: `novedad-oficial-${item.sourceId}`,
    label: "NOVEDAD",
    title: "Nueva información del juego",
    summary: "Se ha publicado nueva información oficial de Inazuma Eleven Cross.",
    details: ["Anuncio oficial", "Información del juego"],
    imageUrl: item.imageUrl,
  };
}

function spanishCards(item) {
  const common = {
    sourceUrl: item.link,
    date: dateLabel(item.publishedAt),
    secondaryImage: null,
    playerId: null,
  };

  if (item.title.includes("バージョン1.3.0")) {
    return [
      {
        ...common,
        sourceId: `${item.source}-${item.sourceId}-simulator`,
        id: `version-1-3-0-simulator-${item.sourceId}`,
        label: "VERSIÓN 1.3.0",
        title: "Simulador: fases 481–800",
        summary: "El Cross Simulator ampliará su recorrido con las fases 481 a 800 y nuevas recompensas por completar.",
        details: ["Fases 481–800", "Nuevas recompensas", "Próxima actualización"],
        imageUrl: item.imageUrls[0] ?? item.imageUrl,
      },
      {
        ...common,
        sourceId: `${item.source}-${item.sourceId}-level`,
        id: `version-1-3-0-level-${item.sourceId}`,
        label: "NUEVO LÍMITE",
        title: "Nivel máximo: 440",
        summary: "El límite del nivel Cross subirá de 340 a 440 para seguir mejorando jugadores y la potencia total del equipo.",
        details: ["Nivel 340 → 440", "Más progresión", "Mayor potencia total"],
        imageUrl: item.imageUrls[1] ?? item.imageUrl,
      },
      {
        ...common,
        sourceId: `${item.source}-${item.sourceId}-formations`,
        id: `version-1-3-0-formations-${item.sourceId}`,
        label: "FORMACIONES",
        title: "Cinco equipos guardados",
        summary: "Será posible guardar hasta cinco alineaciones de once jugadores por contenido y alternarlas con un solo toque.",
        details: ["Hasta 5 equipos", "Cambio con un toque", "Disponible según el contenido"],
        imageUrl: item.imageUrls[2] ?? item.imageUrl,
      },
    ];
  }

  if (item.title.includes("ワールド") && item.title.includes("統合")) {
    return [{
      ...common,
      sourceId: `${item.source}-${item.sourceId}`,
      id: `integracion-de-mundos-${item.sourceId}`,
      label: "1 DE SEPTIEMBRE",
      title: "Integración parcial de mundos",
      summary: "Algunos mundos compartirán clubes, emparejamientos, rankings y chat para reunir a más jugadores.",
      details: ["Clubes compartidos", "Emparejamiento ampliado", "Rankings y chat mundial"],
      image: "/brand/ie-cross-database-logo.png",
    }];
  }

  return [spanishCard(item)];
}

function localizedTime(target, { city, timeZone, label }) {
  const parts = new Intl.DateTimeFormat("es-ES", {
    timeZone,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).formatToParts(target);
  const value = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    city,
    time: `${value("day")} ${value("month").replace(".", "").toUpperCase()} · ${value("hour")}:${value("minute")}`,
    zone: label ?? value("timeZoneName").toUpperCase(),
  };
}

async function downloadImage(card) {
  if (!card.imageUrl) return "/brand/ie-cross-database-logo.png";
  const response = await fetch(card.imageUrl, {
    headers: {
      "User-Agent": "IECrossDatabase-NewsBot/1.0 (+https://iecrossdatabase.pages.dev/)",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`No se pudo descargar la imagen de ${card.sourceUrl ?? card.sourceId}.`);
  const contentType = response.headers.get("content-type") ?? "image/jpeg";
  const urlExtension = path.extname(new URL(card.imageUrl).pathname).replace(".", "").toLowerCase();
  const extension = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : urlExtension === "png" || urlExtension === "webp" ? urlExtension : "jpg";
  const filename = `official-${slugify(String(card.sourceId).replace(/^official-/, ""))}.${extension}`;
  await writeFile(path.join(mediaDirectory, filename), new Uint8Array(await response.arrayBuffer()));
  return `/news/${filename}`;
}

async function buildActiveBanners(items, now) {
  const banners = items
    .filter((item) => item.categories.includes("ガチャ"))
    .filter((item) => item.title.includes("ピックアップガチャ") && !item.title.includes("予告"))
    .map((item) => {
      const combinedText = `${item.title} ${plainText(item.content)} ${item.description}`;
      return { item, title: namesIn(item.title)[0] ?? namesIn(combinedText)[0] ?? null, endsAt: parseGachaEndDate(combinedText, item.publishedAt) };
    })
    .filter(({ title, endsAt }) => title && endsAt && endsAt.getTime() > now.getTime())
    .sort((a, b) => a.endsAt.getTime() - b.endsAt.getTime() || a.title.localeCompare(b.title, "es"));

  const results = [];
  for (const { item, title, endsAt } of banners) {
    results.push({
      id: `banner-${item.sourceId}`,
      playerId: activeGachaPlayerIds[item.sourceId] ?? null,
      title,
      label: "PICK-UP ACTIVO",
      endsAt: endsAt.toISOString(),
      endLabel: bannerEndLabel(endsAt),
      sourceUrl: item.link,
      image: await downloadImage({
        imageUrl: item.imageUrl,
        sourceId: `banner-${item.sourceId}`,
        sourceUrl: item.link,
      }),
    });
  }
  return results;
}

function buildCalendar(items, cards, now) {
  const updates = items
    .map((item) => {
      const text = `${item.title} ${plainText(item.content)}`;
      const isMaintenance = item.title.includes("データ更新")
        || item.title.includes("メンテナンス")
        || (item.title.includes("ワールド") && item.title.includes("統合"));
      if (!isMaintenance) return null;
      const exactTime = /(\d{1,2})\/(\d{1,2})(?:\([^)]*\))?\s*(\d{1,2}):(\d{2})/u.test(text);
      return { item, target: parseJstDate(text, item.publishedAt, 5), estimated: !exactTime };
    })
    .filter(Boolean)
    .filter(({ target }) => target && target.getTime() > now.getTime())
    .sort((a, b) => a.target.getTime() - b.target.getTime());
  const update = updates[0];
  if (!update) return null;

  const event = items.find((item) => {
    if (!item.title.includes("イベント")) return false;
    const eventTarget = parseJstDate(`${item.title} ${plainText(item.content)}`, item.publishedAt);
    return eventTarget && Math.abs(eventTarget.getTime() - update.target.getTime()) < 6 * 3_600_000;
  });
  const eventCard = event ? cards.find((card) => card.sourceId === `${event.source}-${event.sourceId}`) : null;
  const updateCard = cards.find((card) => card.sourceId === `${update.item.source}-${update.item.sourceId}`);
  const version130Card = cards.find((card) => card.id.startsWith("version-1-3-0-"));
  const isVersion130Update = update.item.sourceId === "35728" && Boolean(version130Card);
  const targetParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(update.target);
  const part = (type) => targetParts.find((value) => value.type === type)?.value;

  return {
    target: update.target.toISOString(),
    dateLabel: `${part("day")} ${monthNames[Number(part("month")) - 1]} ${part("year")}`,
    timeLabel: `${part("hour")}:${part("minute")} JST${update.estimated ? " · estimada" : ""}`,
    timezones: calendarZones.map((zone) => localizedTime(update.target, zone)),
    title: isVersion130Update ? "Actualización 1.3.0" : updateCard?.title ?? eventCard?.title ?? "Próxima actualización",
    summary: isVersion130Update
      ? "La versión 1.3.0 añadirá las fases 481–800 al Cross Simulator, elevará el nivel máximo de 340 a 440, permitirá guardar cinco formaciones e integrará parcialmente algunos mundos. La hora oficial aún no se ha anunciado; 05:00 JST es una estimación basada en el horario habitual."
      : updateCard
      ? `${updateCard.summary} La hora oficial aún no se ha anunciado; 05:00 JST es una estimación basada en el horario habitual.`
      : eventCard
      ? `La actualización de datos dará paso al ${eventCard.title}.`
      : "Hay una nueva actualización de datos anunciada para el juego.",
    image: isVersion130Update ? "/news/version-1-3-0-overview.jpg" : updateCard?.image ?? "/brand/ie-cross-database-logo.png",
    imageUrl: isVersion130Update ? null : updateCard?.imageUrl ?? eventCard?.imageUrl ?? null,
    imageSourceId: isVersion130Update ? "version-1-3-0-overview" : updateCard?.sourceId ?? eventCard?.sourceId ?? `calendar-${update.item.sourceId}`,
  };
}

await mkdir(mediaDirectory, { recursive: true });
const feeds = await Promise.allSettled([
  fetchOfficialHistory(),
  fetchText(aimingFeedUrl).then((xml) => parseFeed(xml, "aiming", aimingFeedUrl)),
]);
const officialFeed = feeds[0].status === "fulfilled" ? feeds[0].value : null;
const aimingFeed = feeds[1].status === "fulfilled" ? feeds[1].value : null;

if (!officialFeed && !aimingFeed) {
  throw new Error(`No se pudo consultar ninguna fuente oficial: ${feeds.map((result) => result.status === "rejected" ? result.reason.message : "").filter(Boolean).join(" · ")}`);
}

const officialItems = officialFeed?.items.filter((item) =>
  item.categories.some((category) => ["お知らせ", "重要", "ガチャ", "イベント", "メンテナンス"].includes(category))
  && !item.title.includes("不具合")
) ?? [];
const aimingItems = aimingFeed?.items.filter((item) => item.categories.includes("イナズマイレブン クロス")) ?? [];
const relevantItems = officialItems.length >= 2 ? officialItems : [...officialItems, ...aimingItems];
const latestItems = relevantItems
  .filter((item) => !item.title.includes("終了"))
  .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
  .slice(0, 8);

const cards = [];
const selectedItems = [];
for (const item of latestItems) {
  const itemCards = spanishCards(item);
  if (!itemCards.length) continue;
  selectedItems.push(item);
  for (const card of itemCards) {
    card.image = card.image ?? await downloadImage(card);
    delete card.imageUrl;
    cards.push(card);
    if (cards.length === 4) break;
  }
  if (cards.length === 4) break;
}

if (cards.length < 2) {
  throw new Error(`Solo se detectaron ${cards.length} novedades recientes; se conservan los datos actuales para evitar publicar una portada incompleta.`);
}

const allOfficialCards = officialItems.flatMap(spanishCards);

const updatedAtCandidates = selectedItems.map((item) => item.publishedAt).filter((date) => !Number.isNaN(date.getTime()));
const updatedAt = new Date(Math.max(...updatedAtCandidates.map((date) => date.getTime())));
const nextUpdate = buildCalendar(officialItems, allOfficialCards, new Date());
const activeBanners = await buildActiveBanners(officialItems, new Date());
if (nextUpdate?.imageUrl) {
  nextUpdate.image = await downloadImage({
    imageUrl: nextUpdate.imageUrl,
    sourceId: nextUpdate.imageSourceId,
    sourceUrl: "calendario",
  });
}
if (nextUpdate) {
  delete nextUpdate.imageUrl;
  delete nextUpdate.imageSourceId;
}
const nextNews = {
  updated: updatedAt.toISOString().slice(0, 10),
  updatedLabel: dateLabel(updatedAt),
  nextUpdate,
  activeBanners,
  items: cards,
};
const nextContents = `${JSON.stringify(nextNews, null, 2)}\n`;
const previousContents = await readFile(newsPath, "utf8");

if (nextContents === previousContents) {
  console.log("No hay anuncios nuevos. La portada ya está actualizada.");
  process.exit(0);
}

await writeFile(newsPath, nextContents, "utf8");
const referencedAssets = new Set([
  ...cards.map((item) => path.basename(item.image)),
  ...activeBanners.map((item) => path.basename(item.image)),
  nextNews.nextUpdate ? path.basename(nextNews.nextUpdate.image) : null,
].filter(Boolean));
for (const filename of await readdir(mediaDirectory)) {
  if (/^official-[a-z0-9-]+\.(?:jpe?g|png|webp)$/i.test(filename) && !referencedAssets.has(filename)) {
    await unlink(path.join(mediaDirectory, filename)).catch(() => undefined);
  }
}

console.log(`Portada actualizada con ${cards.length} novedades y ${activeBanners.length} banners activos. Próxima actualización: ${nextNews.nextUpdate?.dateLabel ?? "sin fecha anunciada"}.`);
