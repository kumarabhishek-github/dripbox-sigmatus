export default function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-gray-300 border-t-indigo-600 align-middle"
      style={{ width: size, height: size }}
      aria-label="Loading"
    />
  );
}
