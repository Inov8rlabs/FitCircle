'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <h2 className="text-xl font-semibold text-white">Something went wrong</h2>
      <p className="mt-2 max-w-sm text-sm text-gray-400">
        We hit a snag loading this page. Give it another try.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="mt-6 inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white hover:from-indigo-700 hover:to-purple-700"
      >
        Try again
      </button>
    </div>
  );
}
