'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-white antialiased">
        <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
          <h1 className="text-2xl font-semibold text-white">Something went wrong</h1>
          <p className="mt-2 max-w-sm text-sm text-gray-400">
            An unexpected error occurred. Please try again.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="mt-6 inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white hover:from-indigo-700 hover:to-purple-700"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
