import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

const BUCKET = "memory-files";
const MAX_PHOTOS = 100;

// TEMPORARY: hardcoded user id until real auth is wired in.
// Must match the same value used in app/api/photos/route.ts and
// app/api/photos/[id]/route.ts, or saved photos won't line up.
const TEMP_USER_ID = "00000000-0000-0000-0000-000000000001";

export async function POST(req: NextRequest) {
  try {
    const userId = TEMP_USER_ID;

    const formData = await req.formData();
    const files = formData.getAll("files") as File[];

    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }
    if (files.length > MAX_PHOTOS) {
      return NextResponse.json(
        { error: `Max ${MAX_PHOTOS} photos per upload` },
        { status: 400 }
      );
    }

    const supabase = createSupabaseServiceClient();
    const photos: { id: string; url: string; storage_path: string; description: string }[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const description = (formData.get(`description_${i}`) as string) ?? "";

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const path = `${userId}/photos/${Date.now()}-${i}-${sanitizeName(file.name)}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, buffer, {
          contentType: file.type || "image/jpeg",
          upsert: false,
        });

      if (uploadError) {
        console.error("Supabase upload error:", uploadError);
        return NextResponse.json({ error: uploadError.message }, { status: 500 });
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from(BUCKET).getPublicUrl(path);

      const { data: inserted, error: dbError } = await supabase
        .from("memory_photos")
        .insert({
          user_id: userId,
          storage_path: path,
          url: publicUrl,
          description,
        })
        .select()
        .single();

      if (dbError || !inserted) {
        console.error("DB insert error:", dbError);
        return NextResponse.json({ error: dbError?.message ?? "Insert failed" }, { status: 500 });
      }

      photos.push({
        id: inserted.id,
        url: inserted.url,
        storage_path: inserted.storage_path,
        description: inserted.description,
      });
    }

    return NextResponse.json({ photos });
  } catch (err) {
    console.error("Upload route error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
}