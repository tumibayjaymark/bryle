import PhotoUploader from "@/components/PhotoUploader";

export default function Home() {
  return (
    <main className="min-h-screen p-8">
      <h1 className="text-2xl font-semibold mb-6">Upload Photos</h1>
      <PhotoUploader />
    </main>
  );
}