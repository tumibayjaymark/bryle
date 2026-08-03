import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

// Prevent Next.js from caching this route's response — it must always
// hit the database fresh, otherwise devices can see stale/empty results.
export const dynamic = "force-dynamic";

// TEMPORARY: must match the value in app/api/photos/upload/route.ts
// and app/api/photos/[id]/route.ts until real auth is wired in.
const TEMP_USER_ID = "00000000-0000-0000-0000-000000000001";

export async function GET() {
  try {
    const userId = TEMP_USER_ID;
    const supabase = createSupabaseServiceClient();

    const { data, error } = await supabase
      .from("memory_photos")
      .select("id, url, storage_path, description, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Fetch photos error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ photos: data ?? [] });
  } catch (err) {
    console.error("GET /api/photos error:", err);
    return NextResponse.json({ error: "Failed to load photos" }, { status: 500 });
  }
}