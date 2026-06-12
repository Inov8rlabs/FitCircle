import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-6 text-center text-white">
      <p className="text-5xl font-bold text-indigo-400">404</p>
      <h1 className="mt-4 text-xl font-semibold text-white">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm text-gray-400">
        The page you&apos;re looking for doesn&apos;t exist or has moved.
      </p>
      <Link
        href="/dashboard"
        className="mt-6 inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white hover:from-indigo-700 hover:to-purple-700"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
