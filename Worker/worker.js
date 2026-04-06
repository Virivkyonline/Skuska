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

    const feedResponse = await fetch(target, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 PlatinumLechSpaApp/1.0"
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
