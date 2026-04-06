export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response("", { headers: corsHeaders });
    }

    if (request.method === "GET" && url.pathname === "/feed") {
      return handleFeedProxy(url, corsHeaders);
    }

    if (request.method === "GET" && url.pathname === "/product-detail") {
      return handleProductDetail(url, corsHeaders);
    }

    if (request.method === "POST" && url.pathname === "/order") {
      return handleOrder(request, env, corsHeaders);
    }

    if (request.method === "POST") {
      return handleContactForm(request, env, corsHeaders);
    }

    return new Response(
      JSON.stringify({ success: false, error: "Pouzi GET alebo POST." }),
      {
        status: 405,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      }
    );
  }
};

async function handleFeedProxy(url, corsHeaders) {
  try {
    const target = url.searchParams.get("url");

    if (!target) {
      return new Response("Missing url parameter", {
        status: 400,
        headers: corsHeaders
      });
    }

    const targetUrl = new URL(target);

    const feedResponse = await fetch(targetUrl.toString(), {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 PlatinumLechSpaApp/1.0",
        "Accept-Language": "sk-SK,sk;q=0.9,en;q=0.8"
      }
    });

    const text = await feedResponse.text();

    return new Response(text, {
      status: feedResponse.ok ? 200 : feedResponse.status,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        ...corsHeaders
      }
    });
  } catch (e) {
    return new Response("Feed proxy error", {
      status: 500,
      headers: corsHeaders
    });
  }
}

async function handleProductDetail(url, corsHeaders) {
  try {
    const target = url.searchParams.get("url");

    if (!target) {
      return jsonResponse(
        { success: false, error: "Chyba: chyba url parameter." },
        400,
        corsHeaders
      );
    }

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch {
      return jsonResponse(
        { success: false, error: "Neplatna URL adresa produktu." },
        400,
        corsHeaders
      );
    }

    if (!/virivkyonline\.sk$/i.test(targetUrl.hostname)) {
      return jsonResponse(
        { success: false, error: "Povolena je iba domena virivkyonline.sk." },
        400,
        corsHeaders
      );
    }

    const productResponse = await fetch(targetUrl.toString(), {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 PlatinumLechSpaApp/1.0",
        "Accept-Language": "sk-SK,sk;q=0.9,en;q=0.8"
      }
    });

    if (!productResponse.ok) {
      return jsonResponse(
        {
          success: false,
          error: "Nepodarilo sa nacitat stranku produktu.",
          detail: "HTTP " + productResponse.status
        },
        productResponse.status,
        corsHeaders
      );
    }

    const html = await productResponse.text();
    const data = parseProductHtml(html, targetUrl.toString());

    return jsonResponse(
      {
        success: true,
        product: data
      },
      200,
      corsHeaders
    );
  } catch (e) {
    return jsonResponse(
      {
        success: false,
        error: "Chyba servera pri nacitani detailu produktu."
      },
      500,
      corsHeaders
    );
  }
}

function parseProductHtml(html, productUrl) {
  const cleanedHtml = removeScriptsAndStyles(html);

  const title =
    decodeHtmlEntities(
      firstMatch(cleanedHtml, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
      firstMatch(cleanedHtml, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"]+)["']/i) ||
      firstMatch(cleanedHtml, /<title[^>]*>([\s\S]*?)<\/title>/i) ||
      "Produkt"
    ).trim();

  const metaDescription = decodeHtmlEntities(
    firstMatch(cleanedHtml, /<meta[^>]+name=["']description["'][^>]+content=["']([^"]+)["']/i) || ""
  ).trim();

  const gallery = extractGalleryImages(cleanedHtml, productUrl);
  const mainImage = gallery[0] || "";

  const price =
    decodeHtmlEntities(
      firstMatch(cleanedHtml, /<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"]+)["']/i) || ""
    ).trim() ||
    findPriceInHtml(cleanedHtml);

  const description = extractFullDescription(cleanedHtml, metaDescription);
  const shortDescription = buildShortDescription(description, metaDescription);
  const variants = extractVariants(cleanedHtml);

  return {
    url: productUrl,
    title,
    price,
    image: mainImage,
    gallery,
    shortDescription,
    description,
    variants
  };
}

function removeScriptsAndStyles(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
}

function firstMatch(text, regex) {
  const m = text.match(regex);
  return m && m[1] ? m[1] : "";
}

function stripTags(text) {
  return decodeHtmlEntities(
    String(text || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function absolutizeUrl(url, base) {
  try {
    return new URL(url, base).toString();
  } catch {
    return "";
  }
}

function extractGalleryImages(html, baseUrl) {
  const results = [];

  const galleryBlockRegexes = [
    /<div[^>]*class=["'][^"']*p-detail-inner[^"']*["'][\s\S]*?<\/div>\s*<\/div>/i,
    /<div[^>]*class=["'][^"']*p-image-wrapper[^"']*["'][\s\S]*?<\/div>/i,
    /<div[^>]*class=["'][^"']*p-thumbnails-wrapper[^"']*["'][\s\S]*?<\/div>/i,
    /<div[^>]*class=["'][^"']*p-image-thumbnails[^"']*["'][\s\S]*?<\/div>/i,
    /<div[^>]*class=["'][^"']*slick-track[^"']*["'][\s\S]*?<\/div>/i
  ];

  let galleryHtml = "";
  for (const regex of galleryBlockRegexes) {
    const m = html.match(regex);
    if (m && m[0]) {
      galleryHtml += " " + m[0];
    }
  }

  if (!galleryHtml) {
    const ogImage = firstMatch(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"]+)["']/i);
    if (ogImage) {
      const full = absolutizeUrl(ogImage, baseUrl);
      return full ? [full] : [];
    }
    return [];
  }

  const imgRegex = /<(img|a)[^>]+(?:src|href|data-src|data-gallery-src)=["']([^"']+)["'][^>]*>/gi;
  let m;

  while ((m = imgRegex.exec(galleryHtml)) !== null) {
    const raw = m[2] || "";
    if (!raw) continue;

    const full = absolutizeUrl(raw, baseUrl);
    if (!full) continue;

    const lower = full.toLowerCase();

    if (
      !lower.includes("cdn.myshoptet.com") &&
      !lower.includes("myshoptet.com")
    ) continue;

    if (
      !lower.includes(".jpg") &&
      !lower.includes(".jpeg") &&
      !lower.includes(".png") &&
      !lower.includes(".webp")
    ) continue;

    if (
      lower.includes("favicon") ||
      lower.includes("logo") ||
      lower.includes("icon") ||
      lower.includes("placeholder") ||
      lower.includes("gift") ||
      lower.includes("house") ||
      lower.includes("home") ||
      lower.includes("badge") ||
      lower.includes("cert") ||
      lower.includes("filter") ||
      lower.includes("spa-line") ||
      lower.includes("chemia") ||
      lower.includes("tablety")
    ) continue;

    results.push(full);
  }

  const unique = [...new Set(results)];

  if (!unique.length) {
    const ogImage = firstMatch(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"]+)["']/i);
    if (ogImage) {
      const full = absolutizeUrl(ogImage, baseUrl);
      return full ? [full] : [];
    }
  }

  return unique;
}

function pickBestImage(html, baseUrl, title) {
  const gallery = extractGalleryImages(html, baseUrl);
  if (gallery.length) {
    return gallery[0];
  }

  const ogImage = firstMatch(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"]+)["']/i);
  if (ogImage) {
    const full = absolutizeUrl(ogImage, baseUrl);
    if (full) return full;
  }

  return "";
}

function findPriceInHtml(html) {
  const text = stripTags(html);
  const eurMatch = text.match(/(?:od\s*)?€\s*[0-9][0-9\s.,]*/i);
  if (eurMatch) {
    return eurMatch[0].replace(/\s+/g, " ").trim();
  }

  const eurAfterMatch = text.match(/(?:od\s*)?[0-9][0-9\s.,]*\s*€/i);
  if (eurAfterMatch) {
    return eurAfterMatch[0].replace(/\s+/g, " ").trim();
  }

  return "";
}

function extractFullDescription(html, fallback) {
  const candidates = [
    /<div[^>]*class=["'][^"']*description-inner[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*product-description[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*detail-description[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id=["'][^"']*description[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<section[^>]*class=["'][^"']*description[^"']*["'][^>]*>([\s\S]*?)<\/section>/i
  ];

  for (const regex of candidates) {
    const found = firstMatch(html, regex);
    const stripped = cleanDescriptionText(stripTags(found));
    if (stripped && stripped.length > 80) {
      return stripped;
    }
  }

  return cleanDescriptionText(fallback || "");
}

function cleanDescriptionText(text) {
  return String(text || "")
    .replace(/^\s*Popis\s*/i, "")
    .replace(/\bZdieľať\b.*$/i, "")
    .replace(/\bTweet\b.*$/i, "")
    .replace(/\bKód:\b.*$/i, "")
    .replace(/\bStrážny pes\b.*$/i, "")
    .replace(/\bSúvisiaci tovar\b[\s\S]*$/i, "")
    .replace(/\bSuvisejici zbozi\b[\s\S]*$/i, "")
    .replace(/\bHodnotenie produktu\b[\s\S]*$/i, "")
    .replace(/\bDiskusia\b[\s\S]*$/i, "")
    .replace(/\bParametre\b[\s\S]*$/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildShortDescription(description, fallback) {
  const source = String(description || fallback || "").trim();
  if (!source) return "";

  const normalized = source.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  if (normalized.length <= 220) return normalized;

  return normalized.slice(0, 217).trim() + "...";
}

function extractVariants(html) {
  const text = stripTags(html);

  const oblozenie = extractVariantBlock(
    html,
    text,
    [
      "FARBA OBLOŽENIA A SCHODÍKOV",
      "FARBA OBLOZENIA A SCHODIKOV",
      "FARBA OBLOŽENIA",
      "FARBA OBLOZENIA",
      "OBLOŽENIE",
      "OBLOZENIE"
    ]
  );

  const akryl = extractVariantBlock(
    html,
    text,
    [
      "FARBA AKRYLU NA VÝBER",
      "FARBA AKRYLU NA VYBER",
      "FARBA AKRYLU",
      "AKRYL"
    ]
  );

  return {
    oblozenie,
    akryl
  };
}

function extractVariantBlock(html, plainText, labels) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const selectRegex = new RegExp(
      escaped + "[\\s\\S]{0,250}?<select[\\s\\S]*?<\\/select>",
      "i"
    );
    const selectMatch = html.match(selectRegex);

    if (selectMatch) {
      const optionValues = extractOptionsFromSelect(selectMatch[0]);
      if (optionValues.length) return optionValues;
    }

    const textRegex = new RegExp(
      escaped + "\\s+Zvoľte variant\\s+([\\s\\S]*?)(?:\\n\\s*[A-ZÁČĎÉÍĹĽŇÓÔŔŠŤÚÝŽ][^\\n]*Zvoľte variant|\\n\\s*Kód:|\\n\\s*Cena:|\\n\\s*€|$)",
      "i"
    );
    const textMatch = plainText.match(textRegex);

    if (textMatch && textMatch[1]) {
      const values = textMatch[1]
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .map(x => x.trim())
        .filter(Boolean)
        .filter(x => !/^zvoľte$/i.test(x))
        .filter(x => !/^zvolte$/i.test(x))
        .filter(x => !/^variant$/i.test(x))
        .filter(x => !/^reset$/i.test(x))
        .filter(x => !/^vybraných$/i.test(x))
        .filter(x => !/^parametrov\.?$/i.test(x));

      if (values.length) return [...new Set(values)];
    }
  }

  return [];
}

function extractOptionsFromSelect(selectHtml) {
  const options = [];
  const optionRegex = /<option[^>]*value=["']?([^"'>]*)["']?[^>]*>([\s\S]*?)<\/option>/gi;
  let m;

  while ((m = optionRegex.exec(selectHtml)) !== null) {
    const value = stripTags(m[1] || "").trim();
    const label = stripTags(m[2] || "").trim();
    const finalValue = label || value;

    if (!finalValue) continue;
    if (/zvoľte/i.test(finalValue)) continue;
    if (/zvolte/i.test(finalValue)) continue;
    if (/vyberte/i.test(finalValue)) continue;
    if (/reset/i.test(finalValue)) continue;

    options.push(finalValue);
  }

  return [...new Set(options)];
}

async function handleContactForm(request, env, corsHeaders) {
  try {
    const data = await request.json();

    const meno = (data.meno || "").trim();
    const email = (data.email || "").trim();
    const sprava = (data.sprava || "").trim();

    if (!meno || !email || !sprava) {
      return jsonResponse(
        { success: false, error: "Vypln vsetky polia." },
        400,
        corsHeaders
      );
    }

    const html =
      "<h2>Novy dopyt z formulara</h2>" +
      "<p><strong>Meno:</strong> " + escapeHtml(meno) + "</p>" +
      "<p><strong>Email:</strong> " + escapeHtml(email) + "</p>" +
      "<p><strong>Sprava:</strong></p>" +
      "<p>" + escapeHtml(sprava).replace(/\n/g, "<br>") + "</p>";

    const resendResponse = await sendEmail(env, {
      from: "formular@send.e-bazarik.sk",
      to: "info@virivkyonline.sk",
      reply_to: email,
      subject: "Novy kontaktny formular od: " + meno,
      html
    });

    if (!resendResponse.ok) {
      const resendText = await resendResponse.text();
      return jsonResponse(
        {
          success: false,
          error: "Nepodarilo sa odoslat email.",
          detail: resendText
        },
        500,
        corsHeaders
      );
    }

    return jsonResponse(
      {
        success: true,
        message: "Formular bol uspesne odoslany."
      },
      200,
      corsHeaders
    );
  } catch (e) {
    return jsonResponse(
      {
        success: false,
        error: "Chyba servera."
      },
      500,
      corsHeaders
    );
  }
}

async function handleOrder(request, env, corsHeaders) {
  try {
    const data = await request.json();

    const meno = (data.meno || "").trim();
    const email = (data.email || "").trim();
    const phone = (data.phone || "").trim();
    const street = (data.street || "").trim();
    const houseNumber = (data.houseNumber || "").trim();
    const zip = (data.zip || "").trim();
    const city = (data.city || "").trim();
    const note = (data.note || "").trim();
    const items = Array.isArray(data.items) ? data.items : [];

    if (!meno || !email || !phone || !street || !houseNumber || !zip || !city || items.length === 0) {
      return jsonResponse(
        { success: false, error: "Vypln vsetky povinne udaje a pridaj produkty do kosika." },
        400,
        corsHeaders
      );
    }

    const phoneClean = phone.replace(/\s+/g, "");
    if (!/^09\d{8}$/.test(phoneClean)) {
      return jsonResponse(
        { success: false, error: "Telefonne cislo musi mat 10 cislic a zacinat na 09." },
        400,
        corsHeaders
      );
    }

    const zipClean = zip.replace(/\s+/g, "");
    if (!/^\d{5}$/.test(zipClean)) {
      return jsonResponse(
        { success: false, error: "PSC musi mat 5 cislic." },
        400,
        corsHeaders
      );
    }

    let total = 0;
    let itemsHtml = "";
    let itemsCustomerHtml = "";

    items.forEach((item, index) => {
      const title = (item.title || "Produkt").trim();
      const priceText = (item.price || "").trim();
      const qty = Math.max(1, parseInt(item.qty || 1, 10));
      const oblozenie = (item.oblozenie || "").trim();
      const akryl = (item.akryl || "").trim();

      const numericPrice = parsePriceNumber(priceText);
      const rowTotal = numericPrice * qty;
      total += rowTotal;

      const row =
        "<tr>" +
          "<td style='padding:8px;border:1px solid #ddd;'>" + (index + 1) + "</td>" +
          "<td style='padding:8px;border:1px solid #ddd;'>" + escapeHtml(title) + "</td>" +
          "<td style='padding:8px;border:1px solid #ddd;'>" + escapeHtml(priceText || "Cena na vyziadanie") + "</td>" +
          "<td style='padding:8px;border:1px solid #ddd;'>" + qty + "</td>" +
          "<td style='padding:8px;border:1px solid #ddd;'>" + escapeHtml(oblozenie || "-") + "</td>" +
          "<td style='padding:8px;border:1px solid #ddd;'>" + escapeHtml(akryl || "-") + "</td>" +
          "<td style='padding:8px;border:1px solid #ddd;'>" + (numericPrice ? rowTotal.toFixed(2) + " €" : "-") + "</td>" +
        "</tr>";

      itemsHtml += row;
      itemsCustomerHtml += row;
    });

    const addressHtml =
      escapeHtml(street) + " " + escapeHtml(houseNumber) + "<br>" +
      escapeHtml(zipClean) + " " + escapeHtml(city);

    const adminHtml =
      "<h2>Nova objednavka z aplikacie</h2>" +
      "<p><strong>Meno:</strong> " + escapeHtml(meno) + "</p>" +
      "<p><strong>Email:</strong> " + escapeHtml(email) + "</p>" +
      "<p><strong>Telefon:</strong> " + escapeHtml(phoneClean) + "</p>" +
      "<p><strong>Adresa dorucenia:</strong><br>" + addressHtml + "</p>" +
      "<p><strong>Poznamka:</strong><br>" + escapeHtml(note || "-").replace(/\n/g, "<br>") + "</p>" +
      "<h3>Produkty</h3>" +
      "<table style='border-collapse:collapse;width:100%;font-family:Arial,sans-serif;'>" +
        "<thead>" +
          "<tr>" +
            "<th style='padding:8px;border:1px solid #ddd;text-align:left;'>#</th>" +
            "<th style='padding:8px;border:1px solid #ddd;text-align:left;'>Produkt</th>" +
            "<th style='padding:8px;border:1px solid #ddd;text-align:left;'>Cena</th>" +
            "<th style='padding:8px;border:1px solid #ddd;text-align:left;'>Pocet</th>" +
            "<th style='padding:8px;border:1px solid #ddd;text-align:left;'>Farba oblozenia</th>" +
            "<th style='padding:8px;border:1px solid #ddd;text-align:left;'>Farba akrylu</th>" +
            "<th style='padding:8px;border:1px solid #ddd;text-align:left;'>Medzisucet</th>" +
          "</tr>" +
        "</thead>" +
        "<tbody>" + itemsHtml + "</tbody>" +
      "</table>" +
      "<p style='margin-top:16px;'><strong>Celkom:</strong> " + total.toFixed(2) + " €</p>";

    const customerHtml =
      "<h2>Potvrdenie objednavky</h2>" +
      "<p>Dakujeme za vasu objednavku. Kopia objednavky je nizsie.</p>" +
      "<p><strong>Meno:</strong> " + escapeHtml(meno) + "</p>" +
      "<p><strong>Telefon:</strong> " + escapeHtml(phoneClean) + "</p>" +
      "<p><strong>Adresa dorucenia:</strong><br>" + addressHtml + "</p>" +
      "<p><strong>Poznamka:</strong><br>" + escapeHtml(note || "-").replace(/\n/g, "<br>") + "</p>" +
      "<h3>Produkty</h3>" +
      "<table style='border-collapse:collapse;width:100%;font-family:Arial,sans-serif;'>" +
        "<thead>" +
          "<tr>" +
            "<th style='padding:8px;border:1px solid #ddd;text-align:left;'>#</th>" +
            "<th style='padding:8px;border:1px solid #ddd;text-align:left;'>Produkt</th>" +
            "<th style='padding:8px;border:1px solid #ddd;text-align:left;'>Cena</th>" +
            "<th style='padding:8px;border:1px solid #ddd;text-align:left;'>Pocet</th>" +
            "<th style='padding:8px;border:1px solid #ddd;text-align:left;'>Farba oblozenia</th>" +
            "<th style='padding:8px;border:1px solid #ddd;text-align:left;'>Farba akrylu</th>" +
            "<th style='padding:8px;border:1px solid #ddd;text-align:left;'>Medzisucet</th>" +
          "</tr>" +
        "</thead>" +
        "<tbody>" + itemsCustomerHtml + "</tbody>" +
      "</table>" +
      "<p style='margin-top:16px;'><strong>Celkom:</strong> " + total.toFixed(2) + " €</p>";

    const adminResponse = await sendEmail(env, {
      from: "formular@send.e-bazarik.sk",
      to: "info@virivkyonline.sk",
      reply_to: email,
      subject: "Nova objednavka od: " + meno,
      html: adminHtml
    });

    if (!adminResponse.ok) {
      const resendText = await adminResponse.text();
      return jsonResponse(
        {
          success: false,
          error: "Nepodarilo sa odoslat objednavku.",
          detail: resendText
        },
        500,
        corsHeaders
      );
    }

    const customerResponse = await sendEmail(env, {
      from: "formular@send.e-bazarik.sk",
      to: email,
      subject: "Potvrdenie objednavky - Platinum Lech Spa",
      html: customerHtml
    });

    if (!customerResponse.ok) {
      const resendText = await customerResponse.text();
      return jsonResponse(
        {
          success: false,
          error: "Objednavka prisla nam, ale kopia zakaznikovi sa nepodarila odoslat.",
          detail: resendText
        },
        500,
        corsHeaders
      );
    }

    return jsonResponse(
      {
        success: true,
        message: "Objednavka bola uspesne odoslana."
      },
      200,
      corsHeaders
    );
  } catch (e) {
    return jsonResponse(
      {
        success: false,
        error: "Chyba servera pri objednavke."
      },
      500,
      corsHeaders
    );
  }
}

async function sendEmail(env, payload) {
  return fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + env.RESEND_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

function jsonResponse(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders
    }
  });
}

function parsePriceNumber(priceText) {
  if (!priceText) return 0;
  const cleaned = String(priceText).replace(",", ".").replace(/[^0-9.]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
                                       }
