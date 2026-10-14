const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve((request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  return new Response(
    JSON.stringify({ error: true, message: "This legacy image endpoint is retired. Use the current image-generation flow." }),
    { status: 410, headers: { ...cors, "Content-Type": "application/json" } },
  );
});
