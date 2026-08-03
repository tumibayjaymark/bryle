"use client";

import { useEffect, useRef, useState } from "react";
import { compressImage } from "@/lib/compressImage";

const MAX_PHOTOS = 100;
const TARGET_KB = 200;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

type PhotoStatus = "pending" | "saved";

// crypto.randomUUID() only exists in "secure contexts" (HTTPS or localhost).
// Phones accessing over plain http://10.x.x.x don't count as secure, so we
// need a fallback that works everywhere.
function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

export interface PhotoItem {
  id: string;
  file?: File; // only present for pending items
  previewUrl: string;
  description: string;
  draftDescription: string;
  originalKB?: number;
  compressedKB?: number;
  compressing: boolean;
  status: PhotoStatus;
  storagePath?: string; // only present for saved items
}

export default function PhotoUploader() {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [previewPhoto, setPreviewPhoto] = useState<PhotoItem | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragState = useRef<{ dragging: boolean; startX: number; startY: number; panX: number; panY: number }>({
    dragging: false,
    startX: 0,
    startY: 0,
    panX: 0,
    panY: 0,
  });

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/photos");
        const body = await res.json();
        const saved: PhotoItem[] = (body.photos ?? []).map((p: any) => ({
          id: p.id,
          previewUrl: p.url,
          description: p.description ?? "",
          draftDescription: p.description ?? "",
          compressing: false,
          status: "saved" as const,
          storagePath: p.storage_path,
        }));
        setPhotos((prev) => [...saved, ...prev]);
      } catch (err) {
        console.error("Failed to fetch saved photos:", err);
      } finally {
        setLoadingSaved(false);
      }
    })();
  }, []);

  const remainingSlots = MAX_PHOTOS - photos.length;
  const pendingCount = photos.filter((p) => p.status === "pending").length;

  function handleAddClick() {
    setError(null);
    inputRef.current?.click();
  }

  async function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    if (files.length > remainingSlots) {
      setError(
        `You can add ${remainingSlots} more photo${remainingSlots === 1 ? "" : "s"} (max ${MAX_PHOTOS} total).`
      );
    }
    const filesToAdd = files.slice(0, remainingSlots);

    const placeholders: PhotoItem[] = filesToAdd.map((file) => ({
      id: generateId(),
      file,
      previewUrl: URL.createObjectURL(file),
      description: "",
      draftDescription: "",
      originalKB: file.size / 1024,
      compressedKB: file.size / 1024,
      compressing: true,
      status: "pending",
    }));

    setPhotos((prev) => [...prev, ...placeholders]);

    for (const placeholder of placeholders) {
      try {
        const { file: compressedFile, originalKB, compressedKB } =
          await compressImage(placeholder.file!, { targetKB: TARGET_KB });

        setPhotos((prev) =>
          prev.map((p) =>
            p.id === placeholder.id
              ? {
                  ...p,
                  file: compressedFile,
                  previewUrl: URL.createObjectURL(compressedFile),
                  originalKB,
                  compressedKB,
                  compressing: false,
                }
              : p
          )
        );
      } catch (err) {
        console.error("Compression failed for", placeholder.file?.name, err);
        setPhotos((prev) =>
          prev.map((p) => (p.id === placeholder.id ? { ...p, compressing: false } : p))
        );
      }
    }
  }

  function requestDelete(id: string) {
    setConfirmDeleteId(id);
  }

  async function confirmDelete() {
    if (!confirmDeleteId) return;
    const target = photos.find((p) => p.id === confirmDeleteId);
    if (!target) {
      setConfirmDeleteId(null);
      return;
    }

    if (target.status === "pending") {
      URL.revokeObjectURL(target.previewUrl);
      setPhotos((prev) => prev.filter((p) => p.id !== confirmDeleteId));
      setConfirmDeleteId(null);
      setSuccessMessage("Photo deleted successfully!");
      setTimeout(() => setSuccessMessage(null), 5000);
      return;
    }

    try {
      const res = await fetch(`/api/photos/${target.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Delete failed");
      }
      setPhotos((prev) => prev.filter((p) => p.id !== confirmDeleteId));
      setSuccessMessage("Photo deleted successfully!");
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setConfirmDeleteId(null);
    }
  }

  function cancelDelete() {
    setConfirmDeleteId(null);
  }

  function handleDraftChange(id: string, draftDescription: string) {
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, draftDescription } : p)));
  }

  async function handleSaveDescription(id: string) {
    const target = photos.find((p) => p.id === id);
    if (!target) return;

    if (target.status === "pending") {
      setPhotos((prev) =>
        prev.map((p) => (p.id === id ? { ...p, description: p.draftDescription } : p))
      );
      return;
    }

    try {
      const res = await fetch(`/api/photos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: target.draftDescription }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to save description");
      }
      setPhotos((prev) =>
        prev.map((p) => (p.id === id ? { ...p, description: p.draftDescription } : p))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save description");
    }
  }

  async function handleUploadAll() {
    const pending = photos.filter((p) => p.status === "pending");
    if (pending.length === 0) return;
    setUploading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const formData = new FormData();
      pending.forEach((p, i) => {
        formData.append("files", p.file as File, (p.file as File).name);
        formData.append(`description_${i}`, p.description);
      });

      const res = await fetch("/api/photos/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Upload failed");
      }

      const { photos: uploaded } = (await res.json()) as {
        photos: { id: string; url: string; storage_path: string; description: string }[];
      };

      pending.forEach((p) => URL.revokeObjectURL(p.previewUrl));

      const savedItems: PhotoItem[] = uploaded.map((u) => ({
        id: u.id,
        previewUrl: u.url,
        description: u.description,
        draftDescription: u.description,
        compressing: false,
        status: "saved",
        storagePath: u.storage_path,
      }));

      setPhotos((prev) => [...prev.filter((p) => p.status === "saved"), ...savedItems]);
      setSuccessMessage(
        `${uploaded.length} photo${uploaded.length === 1 ? "" : "s"} uploaded successfully!`
      );
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function openPreview(photo: PhotoItem) {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setPreviewPhoto(photo);
  }

  function closePreview() {
    setPreviewPhoto(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  function handleWheelZoom(e: React.WheelEvent) {
    e.preventDefault();
    setZoom((z) => {
      const next = z - e.deltaY * 0.002;
      return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    });
  }

  function zoomIn() {
    setZoom((z) => Math.min(MAX_ZOOM, +(z + 0.5).toFixed(2)));
  }

  function zoomOut() {
    setZoom((z) => {
      const next = Math.max(MIN_ZOOM, +(z - 0.5).toFixed(2));
      if (next === MIN_ZOOM) setPan({ x: 0, y: 0 });
      return next;
    });
  }

  function resetZoom() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  function handlePointerDown(e: React.PointerEvent<HTMLImageElement>) {
    if (zoom <= 1) return;
    dragState.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLImageElement>) {
    if (!dragState.current.dragging) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    setPan({ x: dragState.current.panX + dx, y: dragState.current.panY + dy });
  }

  function handlePointerUp(e: React.PointerEvent<HTMLImageElement>) {
    dragState.current.dragging = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  return (
    <div className="w-full min-h-screen bg-white text-black p-6">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">
          {photos.length} / {MAX_PHOTOS} photos
        </p>
        <button
          type="button"
          onClick={handleUploadAll}
          disabled={pendingCount === 0 || uploading}
          className="px-4 py-2 rounded-md bg-black text-white text-sm font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-800 transition-colors"
        >
          {uploading ? "Uploading..." : `Upload ${pendingCount || ""}`}
        </button>
      </div>

      {successMessage && (
        <div className="flex items-center gap-2 text-sm text-black border-b border-gray-200 pb-3 mb-3">
          <span className="w-1.5 h-1.5 rounded-full bg-black" />
          <span>{successMessage}</span>
        </div>
      )}

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {photos.map((photo) => {
          const hasUnsavedChanges = photo.draftDescription !== photo.description;
          return (
            <div
              key={photo.id}
              className="rounded-lg overflow-hidden border border-gray-200 bg-white shadow-sm"
            >
              <div className="relative">
                <button
                  type="button"
                  onClick={() => openPreview(photo)}
                  className="block w-full aspect-square"
                >
                  <img
                    src={photo.previewUrl}
                    alt={photo.description || "Photo preview"}
                    className="w-full h-full object-cover"
                  />
                  {photo.compressing && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white text-xs">
                      Compressing...
                    </span>
                  )}
                  {uploading && photo.status === "pending" && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white text-xs">
                      Uploading...
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => requestDelete(photo.id)}
                  aria-label="Delete photo"
                  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-white text-black border border-gray-300 text-sm flex items-center justify-center hover:bg-red-50 hover:border-red-400 hover:text-red-600 transition-colors shadow-sm"
                >
                  ×
                </button>
              </div>

              <div className="p-2 space-y-1.5">
                <textarea
                  value={photo.draftDescription}
                  onChange={(e) => handleDraftChange(photo.id, e.target.value)}
                  placeholder="Add a description..."
                  rows={2}
                  className="w-full text-xs resize-none rounded border border-gray-300 bg-white text-black placeholder-gray-400 p-1.5 focus:outline-none focus:ring-1 focus:ring-black"
                />
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-gray-500">
                    {photo.status === "pending"
                      ? photo.compressing
                        ? "..."
                        : `${photo.originalKB?.toFixed(0)}KB → ${photo.compressedKB?.toFixed(0)}KB`
                      : "Uploaded"}
                  </p>
                  <button
                    type="button"
                    onClick={() => handleSaveDescription(photo.id)}
                    disabled={!hasUnsavedChanges}
                    className="text-[10px] px-2 py-1 rounded bg-black text-white disabled:opacity-20 disabled:cursor-default hover:bg-gray-800 transition-colors"
                  >
                    {hasUnsavedChanges ? "Save" : "Saved"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {remainingSlots > 0 && (
          <div className="relative aspect-square rounded-lg border border-dashed border-gray-300 hover:border-black transition-colors">
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleFilesSelected}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              style={{ fontSize: 0 }}
            />
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-gray-400">
              <span className="text-3xl leading-none mb-1">+</span>
              <span className="text-xs">Add photos</span>
            </div>
          </div>
        )}
      </div>

      {confirmDeleteId && (
        <div
          className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4"
          onClick={cancelDelete}
        >
          <div
            className="bg-white border border-gray-200 rounded-lg p-5 max-w-xs w-full shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-black text-sm mb-1 font-medium">Delete this photo?</p>
            <p className="text-gray-500 text-xs mb-4">This can't be undone.</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelDelete}
                className="px-3 py-1.5 rounded text-xs text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="px-3 py-1.5 rounded text-xs bg-red-600 text-white hover:bg-red-500 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {previewPhoto && (
        <div className="fixed inset-0 z-50 bg-white flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={zoomOut}
                disabled={zoom <= MIN_ZOOM}
                className="w-8 h-8 rounded-full border border-gray-300 text-gray-700 flex items-center justify-center disabled:opacity-30 hover:bg-gray-100"
                aria-label="Zoom out"
              >
                −
              </button>
              <span className="text-xs text-gray-600 w-12 text-center">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={zoomIn}
                disabled={zoom >= MAX_ZOOM}
                className="w-8 h-8 rounded-full border border-gray-300 text-gray-700 flex items-center justify-center disabled:opacity-30 hover:bg-gray-100"
                aria-label="Zoom in"
              >
                +
              </button>
              {zoom > 1 && (
                <button
                  type="button"
                  onClick={resetZoom}
                  className="text-xs text-gray-500 underline ml-1 hover:text-gray-800"
                >
                  Reset
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={closePreview}
              className="w-8 h-8 rounded-full border border-gray-300 text-gray-700 flex items-center justify-center hover:bg-gray-100"
              aria-label="Close preview"
            >
              ×
            </button>
          </div>

          <div
            className="flex-1 overflow-hidden flex items-center justify-center bg-white"
            onWheel={handleWheelZoom}
          >
            <img
              src={previewPhoto.previewUrl}
              alt={previewPhoto.description || "Photo preview"}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onDoubleClick={resetZoom}
              draggable={false}
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                cursor: zoom > 1 ? "grab" : "default",
                transition: dragState.current.dragging ? "none" : "transform 0.15s ease-out",
                touchAction: "none",
              }}
              className="max-w-full max-h-full object-contain select-none"
            />
          </div>

          <div className="px-4 py-3 border-t border-gray-200 text-center">
            {previewPhoto.description && (
              <p className="text-gray-800 text-sm mb-1">{previewPhoto.description}</p>
            )}
            <p className="text-gray-400 text-xs">
              Scroll or use +/− to zoom · drag to pan · double-click to reset
            </p>
          </div>
        </div>
      )}
    </div>
  );
}