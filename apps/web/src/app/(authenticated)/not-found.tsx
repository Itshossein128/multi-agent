export default function AuthenticatedNotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-24 text-center">
      <h1 className="text-lg font-semibold text-white">Not found</h1>
      <p className="max-w-md text-sm text-zinc-400">
        This page is unavailable or you do not have access.
      </p>
    </div>
  );
}
