import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { knowledgeDb } from "./db";

const cache = new Map();

function clean(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function assistancePage(value) {
  try {
    const url = new URL(value);

    if (
      url.protocol !== "https:" ||
      url.hostname !== "assistenza.tiscali.it" ||
      url.username ||
      url.password ||
      url.port ||
      !url.pathname.startsWith("/internet-telefono/")
    ) {
      return null;
    }

    url.hash = "";
    url.search = "";
    url.pathname =
      url.pathname.replace(/\/+$/, "");

    return url.href;
  } catch {
    return null;
  }
}

function videoMedia(value) {
  try {
    const url = new URL(value);

    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port
    ) {
      return null;
    }

    const host = url.hostname.toLowerCase();

    if (
      [
        "www.youtube.com",
        "youtube.com",
        "www.youtube-nocookie.com",
        "youtube-nocookie.com",
        "youtu.be",
      ].includes(host)
    ) {
      const id =
        host === "youtu.be"
          ? url.pathname.slice(1)
          : url.pathname.startsWith("/embed/")
            ? url.pathname.split("/")[2]
            : url.pathname === "/watch"
              ? url.searchParams.get("v")
              : null;

      if (
        !id ||
        !/^[A-Za-z0-9_-]{11}$/.test(id)
      ) {
        return null;
      }

      return {
        provider: "youtube",
        embedUrl:
          "https://www.youtube-nocookie.com/embed/" +
          id +
          "?autoplay=0&rel=0",
      };
    }

    if (
      [
        "player.vimeo.com",
        "vimeo.com",
        "www.vimeo.com",
      ].includes(host)
    ) {
      const id =
        url.pathname.match(
          /^\/(?:video\/)?(\d+)\/?$/,
        )?.[1];

      if (!id) return null;

      return {
        provider: "vimeo",
        embedUrl:
          "https://player.vimeo.com/video/" +
          id +
          "?autoplay=0",
      };
    }

    if (
      (
        host === "tiscali.it" ||
        host.endsWith(".tiscali.it")
      ) &&
      /\.(mp4|webm)$/i.test(url.pathname)
    ) {
      return {
        provider: "file",
        embedUrl: url.href,
      };
    }
  } catch {}

  return null;
}

function parseVideoPage(
  html,
  pageUrl,
  fallbackTitle,
) {
  const $ = cheerio.load(html);

  $(
    "nav,header,footer,script,style,noscript,[aria-hidden='true']",
  ).remove();

  const title =
    clean($("h1").first().text()) ||
    fallbackTitle;

  const root =
    $("main,article,[role='main']").first();

  const content =
    root.length ? root : $("body");

  const media = [];
  const seen = new Set();

  content
    .find("iframe,video,video source,a[href]")
    .each((_, element) => {
      const node = $(element);

      const raw =
        node.attr("src") ||
        node.attr("data-src") ||
        node.attr("href");

      if (!raw) return;

      let absolute;

      try {
        absolute =
          new URL(raw, pageUrl).href;
      } catch {
        return;
      }

      const video =
        videoMedia(absolute);

      if (
        !video ||
        seen.has(video.embedUrl)
      ) {
        return;
      }

      seen.add(video.embedUrl);

      const caption = clean(
        node.attr("title") ||
          node.attr("aria-label") ||
          (
            element.tagName === "a"
              ? node.text()
              : ""
          ),
      );

      media.push({
        ...video,
        title: caption || title,
      });
    });

  return { title, media };
}

async function documentById(documentId) {
  const sql = knowledgeDb();
  if (!sql) return null;

  const rows = await sql.begin(
    "read only",
    (tx) =>
      tx.unsafe(
        [
          'SELECT ',
          'd."id"::text AS id,',
          'd."title"::text AS title,',
          'd."deviceScope"::text AS "deviceScope",',
          'd."fileUrl"::text AS "fileUrl",',
          'd."updatedAt" AS "updatedAt" ',
          'FROM "KnowledgeDocument" d ',
          'WHERE d."id" = $1 ',
          'AND d."status" = \'ACTIVE\' ',
          'AND coalesce(d."sourceType",\'\') <> \'MOBILE_CONFIG\' ',
          'AND (',
          'upper(coalesce(d."serviceType",\'\')) LIKE \'FIXED%\' ',
          'OR upper(coalesce(d."serviceType",\'\')) IN (\'FIBRA\',\'ADSL\')',
          ') LIMIT 1',
        ].join(""),
        [documentId],
      ),
  );

  return rows[0] || null;
}

async function fetchPage(document) {
  const pageUrl =
    assistancePage(document.fileUrl);

  if (!pageUrl) return null;

  const key =
    document.id +
    ":" +
    String(document.updatedAt || "");

  const cached = cache.get(key);

  if (
    cached &&
    cached.expires > Date.now()
  ) {
    return cached.value;
  }

  const response = await fetch(pageUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(7000),
    headers: {
      Accept:
        "text/html,application/xhtml+xml",
      "Accept-Language":
        "it-IT,it;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36",
    },
  });

  if (
    !response.ok ||
    !response.headers
      .get("content-type")
      ?.includes("text/html")
  ) {
    return null;
  }

  const reader =
    response.body?.getReader();

  if (!reader) return null;

  const decoder = new TextDecoder();
  let html = "";
  let bytes = 0;

  try {
    while (true) {
      const part =
        await reader.read();

      if (part.done) break;

      bytes +=
        part.value.byteLength;

      if (bytes > 2_000_000) {
        return null;
      }

      html += decoder.decode(
        part.value,
        { stream: true },
      );
    }

    html += decoder.decode();
  } finally {
    await reader.cancel();
  }

  const parsed =
    parseVideoPage(
      html,
      pageUrl,
      document.title,
    );

  cache.set(key, {
    expires:
      Date.now() + 15 * 60_000,
    value: parsed,
  });

  if (cache.size > 96) {
    cache.delete(
      cache.keys().next().value,
    );
  }

  return parsed;
}

export async function videoGuidesForDocument(
  documentId,
) {
  const document =
    await documentById(documentId);

  if (!document) return [];

  try {
    const page =
      await fetchPage(document);

    if (!page) return [];

    return page.media
      .slice(0, 12)
      .map((media) => ({
        ...media,
        id: createHash("sha256")
          .update(media.embedUrl)
          .digest("hex")
          .slice(0, 24),
        documentId: document.id,
        title:
          media.title ||
          document.title,
      }));
  } catch (error) {
    console.error(
      "Gemma video guide error",
      error,
    );

    return [];
  }
}
