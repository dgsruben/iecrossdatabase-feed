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

function parseFeed(xml, source, baseUrl) {
  const channel = tagValue(xml, "channel") || xml;
  const lastBuildDate = tagValue(channel, "lastBuildDate");
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => {
    const item = match[1];
    const content = tagValue(item, "content:encoded");
    const imageMatch = content.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i);
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
      imageUrl: absoluteUrl(imageMatch?.[1], baseUrl),
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

function parseJstDate(text, referenceDate) {
  const match = text.match(/(\d{1,2})\/(\d{1,2})(?:\([^)]*\))?\s*(\d{1,2}):(\d{2})/u);
  if (!match) return null;
  let year = referenceDate.getUTCFullYear();
  let target = new Date(Date.UTC(year, Number(match[1]) - 1, Number(match[2]), Number(match[3]) - 9, Number(match[4])));
  if (target.getTime() < referenceDate.getTime() - 180 * 86_400_000) {
    year += 1;
    target = new Date(Date.UTC(year, Number(match[1]) - 1, Number(match[2]), Number(match[3]) - 9, Number(match[4])));
  }
  return target;
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
    headers: { "User-Agent": "IECrossDatabase-NewsBot/1.0 (+https://iecrossdatabase.pages.dev/)" },
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

function buildCalendar(items, cards, now) {
  const updates = items
    .filter((item) => item.title.includes("データ更新") || item.title.includes("メンテナンス"))
    .map((item) => ({ item, target: parseJstDate(`${item.title} ${plainText(item.content)}`, item.publishedAt) }))
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
    timeLabel: `${part("hour")}:${part("minute")} JST`,
    timezones: calendarZones.map((zone) => localizedTime(update.target, zone)),
    title: eventCard?.title ?? "Próxima actualización",
    summary: eventCard
      ? `La actualización de datos dará paso al ${eventCard.title}.`
      : "Hay una nueva actualización de datos anunciada para el juego.",
    image: "/brand/ie-cross-database-logo.png",
    imageUrl: eventCard?.imageUrl ?? null,
    imageSourceId: eventCard?.sourceId ?? `calendar-${update.item.sourceId}`,
  };
}

await mkdir(mediaDirectory, { recursive: true });
const feeds = await Promise.allSettled([
  fetchText(officialFeedUrl).then((xml) => parseFeed(xml, "official", officialFeedUrl)),
  fetchText(aimingFeedUrl).then((xml) => parseFeed(xml, "aiming", aimingFeedUrl)),
]);
const officialFeed = feeds[0].status === "fulfilled" ? feeds[0].value : null;
const aimingFeed = feeds[1].status === "fulfilled" ? feeds[1].value : null;

if (!officialFeed && !aimingFeed) {
  throw new Error(`No se pudo consultar ninguna fuente oficial: ${feeds.map((result) => result.status === "rejected" ? result.reason.message : "").filter(Boolean).join(" · ")}`);
}

const officialItems = officialFeed?.items.filter((item) =>
  item.categories.some((category) => ["お知らせ", "ガチャ", "イベント", "メンテナンス"].includes(category))
  && !item.title.includes("不具合")
) ?? [];
const aimingItems = aimingFeed?.items.filter((item) => item.categories.includes("イナズマイレブン クロス")) ?? [];
const relevantItems = officialItems.length >= 3 ? officialItems : [...officialItems, ...aimingItems];
const latestItems = relevantItems
  .filter((item) => item.title.includes("ピックアップガチャ") || item.title.includes("ガチャ"))
  .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
  .slice(0, 3);

if (latestItems.length < 3) {
  throw new Error(`Solo se detectaron ${latestItems.length} gachas activos; se conservan los datos actuales para evitar publicar una portada incompleta.`);
}

const cards = [];
for (const item of latestItems) {
  const card = spanishCard(item);
  card.image = card.image ?? await downloadImage(card);
  delete card.imageUrl;
  cards.push(card);
}
const featuredOrder = new Map([["1166", 0], ["1167", 1], ["1168", 2]]);
cards.sort((a, b) => (featuredOrder.get(a.playerId) ?? 99) - (featuredOrder.get(b.playerId) ?? 99));

const allOfficialCards = officialItems.map(spanishCard);

const updatedAtCandidates = latestItems.map((item) => item.publishedAt).filter((date) => !Number.isNaN(date.getTime()));
const updatedAt = new Date(Math.max(...updatedAtCandidates.map((date) => date.getTime())));
const nextUpdate = buildCalendar(officialItems, allOfficialCards, new Date());
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
  nextNews.nextUpdate ? path.basename(nextNews.nextUpdate.image) : null,
].filter(Boolean));
for (const filename of await readdir(mediaDirectory)) {
  if (/^official-[a-z0-9-]+\.(?:jpe?g|png|webp)$/i.test(filename) && !referencedAssets.has(filename)) {
    await unlink(path.join(mediaDirectory, filename)).catch(() => undefined);
  }
}

console.log(`Portada actualizada con ${cards.length} gachas activos. Próxima actualización: ${nextNews.nextUpdate?.dateLabel ?? "sin fecha anunciada"}.`);
