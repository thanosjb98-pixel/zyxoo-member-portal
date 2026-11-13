
export default {
  async fetch(request) {
    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" }
      });

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      const geminiKey = process.env.GEMINI_API_KEY;

      if (!supabaseUrl || !supabaseKey || !geminiKey) {
        return json({ error: "Server configuration is incomplete." }, 500);
      }

      const authHeader = request.headers.get("Authorization") || "";
      const token = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : "";

      if (!token) {
        return json({ error: "Please log in first." }, 401);
      }

      // Verify the logged-in Supabase user.
      const userResponse = await fetch(
        `${supabaseUrl}/auth/v1/user`,
        {
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${token}`
          }
        }
      );

     if (!userResponse.ok) {
  return json({
    error: "Supabase authentication failed. HTTP " + userResponse.status,
    details: await userResponse.text()
  }, 401);
}

      const user = await userResponse.json();

      // Check the user's own membership record.
      const membershipResponse = await fetch(
        `${supabaseUrl}/rest/v1/memberships?select=payment_status&user_id=eq.${encodeURIComponent(user.id)}&limit=1`,
        {
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${token}`
          }
        }
      );

      if (!membershipResponse.ok) {
        return json({ error: "Could not verify membership." }, 500);
      }

      const memberships = await membershipResponse.json();

      if (!memberships.length ||
          memberships[0].payment_status !== "approved") {
        return json({ error: "An approved membership is required." }, 403);
      }

      const body = await request.json();
      const prompt = String(body.prompt || "").trim();

      if (!prompt) {
        return json({ error: "Please enter a prompt." }, 400);
      }

      if (prompt.length > 12000) {
        return json({ error: "Your prompt is too long." }, 400);
      }

     // Reserve one of the member's 5 daily generation attempts.
const usageResponse = await fetch(
  `${supabaseUrl}/rest/v1/rpc/reserve_zyxoo_generation`,
  {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  }
);

if (!usageResponse.ok) {
  return json({
    error: "Could not verify your daily generation limit. Please try again later."
  }, 500);
}

const usageAllowed = await usageResponse.json();

if (usageAllowed !== true) {
  return json({
    error: "You have reached your limit of 5 generations for today. Please try again tomorrow."
  }, 429);
}
      // Generate content using Gemini.
      const aiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${encodeURIComponent(geminiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{
                text: "You are Zyxoo The ContentPilot, an expert AI content production assistant. Create original, detailed, practical content. Follow the user's requested language, platform, format, and creative direction. Avoid generic overused ideas."
              }]
            },
            contents: [{
              role: "user",
              parts: [{ text: prompt }]
            }],
            generationConfig: {
  maxOutputTokens: 3000
}
          })
        }
      );

      const result = await aiResponse.json();

      if (!aiResponse.ok) {
        return json({
          error: "AI generation failed. Please try again later."
        }, 502);
      }

      const generatedText =
        result.candidates?.[0]?.content?.parts
          ?.map(part => part.text || "")
          .join("\n")
          .trim();

      if (!generatedText) {
        return json({ error: "The AI returned no text. Please try again." }, 502);
      }

      return json({ text: generatedText });

    } catch (error) {
      return json({ error: "Something went wrong. Please try again." }, 500);
    }
  }
};
