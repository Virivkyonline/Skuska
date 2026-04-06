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

    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Pouzi POST." }),
        {
          status: 405,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders
          }
        }
      );
    }

    try {
      const data = await request.json();

      const meno = (data.meno || "").trim();
      const email = (data.email || "").trim();
      const sprava = (data.sprava || "").trim();

      if (!meno || !email || !sprava) {
        return new Response(
          JSON.stringify({ success: false, error: "Vypln vsetky polia." }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders
            }
          }
        );
      }

      const html =
        "<h2>Novy dopyt z formulara</h2>" +
        "<p><strong>Meno:</strong> " + meno + "</p>" +
        "<p><strong>Email:</strong> " + email + "</p>" +
        "<p><strong>Sprava:</strong></p>" +
        "<p>" + sprava.replace(/\n/g, "<br>") + "</p>";

      const resendResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + env.RESEND_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: "formular@send.e-bazarik.sk",
          to: "info@virivkyonline.sk",
          reply_to: email,
          subject: "Novy kontaktny formular od: " + meno,
          html: html
        })
      });

      const resendText = await resendResponse.text();

      if (!resendResponse.ok) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Nepodarilo sa odoslat email.",
            detail: resendText
          }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders
            }
          }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: "Formular bol uspesne odoslany."
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders
          }
        }
      );
    } catch (e) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Chyba servera."
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders
          }
        }
      );
    }
  }
};
