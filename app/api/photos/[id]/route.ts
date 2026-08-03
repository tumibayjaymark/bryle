import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

const BUCKET = "memory-files";

// TEMPORARY: must match the value in app/api/photos/upload/route.ts
// and app/api/photos/route.ts until real auth is wired in.
const TEMP_USER_ID = "00000000-0000-0000-0000-000000000001";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = TEMP_USER_ID;
    const { description } = await req.json();

    const supabase = createSupabaseServiceClient();
    const { error } = await supabase
      .from("memory_photos")
      .update({ description })
      .eq("id", id)
      .eq("user_id", userId);

    if (error) {
      console.error("Update description error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("PATCH /api/photos/[id] error:", err);
    return NextResponse.json({ error: "Failed to update description" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = TEMP_USER_ID;
    const supabase = createSupabaseServiceClient();

    // Look up the storage path before deleting the row.
    const { data: photo, error: fetchError } = await supabase
      .from("memory_photos")
      .select("storage_path")
      .eq("id", id)
      .eq("user_id", userId)
      .single();

    if (fetchError || !photo) {
      return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    }

    const { error: storageError } = await supabase.storage
      .from(BUCKET)
      .remove([photo.storage_path]);

    if (storageError) {
      console.error("Storage delete error:", storageError);
      // Continue anyway — still remove the DB row so the UI stays consistent.
    }

    const { error: dbError } = await supabase
      .from("memory_photos")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    if (dbError) {
      console.error("DB delete error:", dbError);
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/photos/[id] error:", err);
    return NextResponse.json({ error: "Failed to delete photo" }, { status: 500 });
  }
}