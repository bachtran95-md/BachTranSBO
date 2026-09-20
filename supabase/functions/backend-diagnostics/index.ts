Deno.serve(() => new Response(JSON.stringify({ error: "disabled" }), {
  status: 404,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
}));