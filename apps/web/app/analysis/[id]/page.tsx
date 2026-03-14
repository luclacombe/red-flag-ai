export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold">Analysis</h1>
      <p className="mt-4 text-lg text-gray-600">Analysis ID: {id}</p>
      <p className="mt-2 text-sm text-gray-400">Results will appear here.</p>
    </main>
  );
}
