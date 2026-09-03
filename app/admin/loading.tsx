export default function Loading() {
  return (
    <div className="px-5 pt-safe">
      <div className="mb-4 h-8 w-40 rounded-md skeleton" />
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-24 rounded-lg skeleton" />
        ))}
      </div>
    </div>
  );
}
